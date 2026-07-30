#!/usr/bin/env bash
# Issue tracker over GitHub Issues (repo inferred from the origin remote:
# snowplow-industry-solutions/signals-google-cx-agent-studio).
#
# Statuses are labels on the open issue; a closed issue is "done":
#   ready-for-agent      eligible for the agent pipeline
#   in-progress          claimed by a running pipeline; not eligible, does not
#                        satisfy blockers. If a host process dies mid-issue,
#                        reset manually: tracker.sh set-status <id> ready-for-agent
#   ready-for-human      human task; satisfies blockers only when done
#   awaiting-human-test  agent finished; satisfies blockers UNLESS the issue
#                        carries the "checkpoint:human-test-required" label
#   needs-human          parked by the pipeline; human must intervene
#   done                 issue closed; always satisfies blockers
#
# An open issue with none of the status labels reads as "needs-triage" and is
# never eligible. Blockers are "#N" references inside a "## Blocked by"
# section of the issue body.
#
# Usage:
#   tracker.sh list                    JSON array of issues eligible to work on
#   tracker.sh list-all                JSON array of every issue with status
#   tracker.sh view <id>               print the issue (body + comments)
#   tracker.sh set-status <id> <st>    swap the status label ("done" closes)
#   tracker.sh park <id>               set needs-human and comment findings from stdin
#
# <id> is the GitHub issue number, e.g. 3.
#
# Auth: uses GH_TOKEN from the environment, falling back to the GH_TOKEN line
# in .sandcastle/.env (gitignored), then to whatever `gh auth login` stored.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export GH_PAGER=cat # a configured pager eats output in non-interactive runs

if [ -z "${GH_TOKEN:-}" ] && [ -f "$SCRIPT_DIR/.env" ]; then
  GH_TOKEN="$(grep -m1 '^GH_TOKEN=' "$SCRIPT_DIR/.env" | cut -d= -f2- || true)"
  if [ -n "$GH_TOKEN" ]; then export GH_TOKEN; fi
fi

read -r -d '' JQ_LIB <<'JQ' || true
def status_of:
  if .state == "CLOSED" then "done"
  else ([.labels[].name
         | select(. == "ready-for-agent" or . == "in-progress"
                  or . == "ready-for-human" or . == "awaiting-human-test"
                  or . == "needs-human")]
        | first) // "needs-triage"
  end;
def is_checkpoint: any(.labels[].name; . == "checkpoint:human-test-required");
def blockers:
  ((.body // "") | gsub("\r"; ""))
  | (try (match("## Blocked by(.*?)(\n## |$)"; "m").captures[0].string) catch "")
  | [scan("#(\\d+)") | .[0] | tonumber];
def summary: {id: (.number | tostring), number, title, status: status_of,
              checkpoint: is_checkpoint, url};
JQ

fetch_all() {
  gh issue list --state all --limit 200 --json number,title,state,labels,body,url
}

# A blocker is satisfied when its issue is done (closed), or awaiting-human-test
# on a non-checkpoint issue (auto-merged work counts as available to build on).
# An unresolvable blocker reference never satisfies.
cmd_list() {
  fetch_all | jq "$JQ_LIB"'
    . as $all
    | [ .[]
        | select(status_of == "ready-for-agent")
        | select([ blockers[] as $n
                   | (first($all[] | select(.number == $n)) // null) as $b
                   | if $b == null then false
                     else ($b | status_of) == "done"
                          or ((($b | status_of) == "awaiting-human-test")
                              and (($b | is_checkpoint) | not))
                     end
                 ] | all)
        | summary ]'
}

cmd_list_all() {
  fetch_all | jq "$JQ_LIB"'[ .[] | summary ]'
}

cmd_view() { # body first, then the comment thread (--comments alone shows only comments)
  gh issue view "$1"
  echo ""
  gh issue view "$1" --comments
}

cmd_set_status() { # <id> <status>
  local id="$1" st="$2"
  case "$st" in
    ready-for-agent|in-progress|ready-for-human|awaiting-human-test|needs-human|done) ;;
    *) echo "error: unknown status '$st'" >&2; exit 1 ;;
  esac
  if [ "$st" = "done" ]; then
    gh issue close "$id" --reason completed >/dev/null
    echo "set #$id -> done (closed)"
    return
  fi
  local state
  state="$(gh issue view "$id" --json state -q .state)"
  if [ "$state" = "CLOSED" ]; then gh issue reopen "$id" >/dev/null; fi
  local current remove=""
  current="$(gh issue view "$id" --json labels -q '[.labels[].name] | join(",")')"
  local s
  for s in ready-for-agent in-progress ready-for-human awaiting-human-test needs-human; do
    [ "$s" = "$st" ] && continue
    case ",$current," in *,"$s",*) remove="$remove --remove-label $s" ;; esac
  done
  # shellcheck disable=SC2086  # $remove holds whole flags; labels have no spaces
  gh issue edit "$id" --add-label "$st" $remove >/dev/null
  echo "set #$id -> $st"
}

cmd_park() { # <id>, findings on stdin
  local id="$1"
  {
    echo "## Parked by pipeline ($(date '+%Y-%m-%d %H:%M'))"
    echo ""
    cat -
  } | gh issue comment "$id" --body-file - >/dev/null
  cmd_set_status "$id" needs-human >/dev/null
  echo "parked #$id"
}

case "${1:-}" in
  list)       cmd_list ;;
  list-all)   cmd_list_all ;;
  view)       cmd_view "${2:?usage: tracker.sh view <id>}" ;;
  set-status) cmd_set_status "${2:?id}" "${3:?status}" ;;
  park)       cmd_park "${2:?id}" ;;
  *) grep '^#' "$0" | head -28; exit 1 ;;
esac
