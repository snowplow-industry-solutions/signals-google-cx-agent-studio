#!/usr/bin/env bash
# Issue tracker over local markdown files (.scratch/signals-cx-agent-demo/issues/).
#
# Statuses (Status: line in each issue file):
#   ready-for-agent      eligible for the agent pipeline
#   in-progress          claimed by a running pipeline; not eligible, does not
#                        satisfy blockers. If a host process dies mid-issue,
#                        reset manually: tracker.sh set-status <id> ready-for-agent
#   ready-for-human      human task; satisfies blockers only when done
#   awaiting-human-test  agent finished; satisfies blockers UNLESS the issue
#                        carries "Checkpoint: human-test-required"
#   needs-human          parked by the pipeline; human must intervene
#   done                 verified complete; always satisfies blockers
#
# Usage:
#   tracker.sh list                    JSON array of issues eligible to work on
#   tracker.sh list-all                JSON array of every issue with status
#   tracker.sh view <id>               print the issue file
#   tracker.sh set-status <id> <st>    rewrite the Status: line
#   tracker.sh park <id>               set needs-human and append findings from stdin
#
# <id> is the filename without .md, e.g. 04-catalog-endpoint.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ISSUES_DIR="$REPO_ROOT/.scratch/signals-cx-agent-demo/issues"

status_of() { # <file>
  grep -m1 '^Status:' "$1" | sed 's/^Status:[[:space:]]*//' | tr -d '[:space:]'
}

is_checkpoint() { # <file> -> exit 0 if checkpoint
  grep -q '^Checkpoint: human-test-required' "$1"
}

blockers_of() { # <file> -> one blocker filename per line
  awk '/^## Blocked by/{flag=1; next} /^## /{flag=0} flag' "$1" \
    | grep -o '`[^`]*\.md`' | tr -d '`' || true
}

# A blocker is satisfied when its issue is done, or awaiting-human-test on a
# non-checkpoint issue (auto-merged work counts as available to build on).
blocker_satisfied() { # <blocker filename>
  local f="$ISSUES_DIR/$1"
  [ -f "$f" ] || { echo "warn: blocker $1 not found" >&2; return 1; }
  local st; st="$(status_of "$f")"
  [ "$st" = "done" ] && return 0
  if [ "$st" = "awaiting-human-test" ] && ! is_checkpoint "$f"; then return 0; fi
  return 1
}

issue_json() { # <file> -> single JSON object
  local f="$1"
  local id title st cp
  id="$(basename "$f" .md)"
  title="$(grep -m1 '^# ' "$f" | sed 's/^# *//')"
  st="$(status_of "$f")"
  if is_checkpoint "$f"; then cp=true; else cp=false; fi
  jq -n --arg id "$id" --arg title "$title" --arg status "$st" \
        --arg file "${f#"$REPO_ROOT"/}" --argjson checkpoint "$cp" \
        '{id: $id, title: $title, status: $status, file: $file, checkpoint: $checkpoint}'
}

cmd_list() { # eligible issues only
  local out="[]"
  for f in "$ISSUES_DIR"/*.md; do
    [ "$(status_of "$f")" = "ready-for-agent" ] || continue
    local ok=true
    while IFS= read -r b; do
      [ -n "$b" ] || continue
      blocker_satisfied "$b" || { ok=false; break; }
    done < <(blockers_of "$f")
    $ok || continue
    out="$(jq --argjson item "$(issue_json "$f")" '. + [$item]' <<<"$out")"
  done
  jq . <<<"$out"
}

cmd_list_all() {
  local out="[]"
  for f in "$ISSUES_DIR"/*.md; do
    out="$(jq --argjson item "$(issue_json "$f")" '. + [$item]' <<<"$out")"
  done
  jq . <<<"$out"
}

issue_file() { # <id>
  local f="$ISSUES_DIR/$1.md"
  [ -f "$f" ] || { echo "error: no issue '$1' in $ISSUES_DIR" >&2; exit 1; }
  echo "$f"
}

cmd_view() { cat "$(issue_file "$1")"; }

cmd_set_status() { # <id> <status>
  local f; f="$(issue_file "$1")"
  case "$2" in
    ready-for-agent|in-progress|ready-for-human|awaiting-human-test|needs-human|done) ;;
    *) echo "error: unknown status '$2'" >&2; exit 1 ;;
  esac
  sed -i.bak "s/^Status:.*/Status: $2/" "$f" && rm -f "$f.bak"
  echo "set $1 -> $2"
}

cmd_park() { # <id>, findings on stdin
  local f; f="$(issue_file "$1")"
  cmd_set_status "$1" needs-human >/dev/null
  {
    echo ""
    echo "## Parked by pipeline ($(date '+%Y-%m-%d %H:%M'))"
    echo ""
    cat -
  } >>"$f"
  echo "parked $1"
}

case "${1:-}" in
  list)       cmd_list ;;
  list-all)   cmd_list_all ;;
  view)       cmd_view "${2:?usage: tracker.sh view <id>}" ;;
  set-status) cmd_set_status "${2:?id}" "${3:?status}" ;;
  park)       cmd_park "${2:?id}" ;;
  *) grep '^#' "$0" | head -20; exit 1 ;;
esac
