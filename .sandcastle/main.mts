// Sandcastle AFK pipeline — Signals × CX Agent Studio demo
//
// Per eligible issue (see tracker.sh for status/blocker semantics — the
// tracker is GitHub Issues on snowplow-industry-solutions/signals-google-cx-agent-studio):
//   1. Implement    Sonnet 5   reads embedded issue + PRD; BLOCKED escape hatch
//   2. Review       Fable      diff vs acceptance criteria + PRD, structured verdict
//   3. Fix          Sonnet 5   applies findings; max MAX_FIX_CYCLES review→fix rounds
//   4. Final review Fable      (last iteration of the review loop)
//   5. PR           Haiku emits <pr-title>/<pr-body>; host pushes branch + opens
//                   a real GitHub PR (manual testing plan in the body)
//   6. Merge        host-side  only with SANDCASTLE_AUTO_MERGE=1 on a
//                   non-checkpoint issue: local --no-ff merge + push (GitHub
//                   marks the PR merged). Default is no merge — approved work
//                   stops at an open PR plus an alert, and the human tests and
//                   merges it.
//
// Alerts land as macOS notifications + .sandcastle/logs/ALERTS.md.
// Issue status labels are only ever changed host-side (this script via
// tracker.sh), never by agents — sandboxes get no GitHub credentials.
//
// Usage (from repo root):  npm run afk
//
// If the host process dies mid-issue the in-progress label sticks; reset with
// .sandcastle/tracker.sh set-status <n> ready-for-agent

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ISSUES_PER_RUN = 5;
const MAX_FIX_CYCLES = 2; // review→fix rounds before parking the issue

// Auto-merge is opt-in. Off by default: approved work stops at an open PR and an
// alert, and the human merges after testing. tracker.sh reads the same variable —
// with auto-merge off, awaiting-human-test no longer satisfies a downstream
// issue's blocker, because the work isn't on main yet.
const AUTO_MERGE = process.env.SANDCASTLE_AUTO_MERGE === "1";

const implementer = () => sandcastle.claudeCode("claude-sonnet-5");
const reviewer = () => sandcastle.claudeCode("claude-fable-5", { effort: "high" });
const clerk = () => sandcastle.claudeCode("claude-haiku-4-5-20251001");

const REPO_ROOT = process.cwd();
const TRACKER = path.join(REPO_ROOT, ".sandcastle", "tracker.sh");
const ALERTS_FILE = path.join(REPO_ROOT, ".sandcastle", "logs", "ALERTS.md");
const LOGS_DIR = path.join(REPO_ROOT, ".sandcastle", "logs");

// Storefront is the actual app; install its deps when the sandbox comes up.
const hooks = {
  sandbox: {
    onSandboxReady: [{ command: "npm --prefix storefront install" }],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sh(cmd: string, args: string[], opts: { allowFail?: boolean } = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf8" }),
    };
  } catch (err: any) {
    if (!opts.allowFail) throw err;
    return { ok: false, stdout: String(err.stdout ?? "") + String(err.stderr ?? "") };
  }
}

function tracker(...args: string[]) {
  return sh("bash", [TRACKER, ...args]).stdout;
}

function alert(title: string, message: string) {
  fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  fs.appendFileSync(ALERTS_FILE, `\n## ${stamp} — ${title}\n\n${message}\n`);
  const esc = (s: string) => s.replace(/[\\"]/g, "").slice(0, 200);
  sh(
    "osascript",
    ["-e", `display notification "${esc(message)}" with title "Sandcastle" subtitle "${esc(title)}" sound name "Glass"`],
    { allowFail: true },
  );
  console.log(`\n🔔 ALERT [${title}] ${message}\n`);
}

function park(issueId: string, reason: string) {
  const proc = execFileSync("bash", [TRACKER, "park", issueId], {
    cwd: REPO_ROOT,
    input: reason,
    encoding: "utf8",
  });
  console.log(proc.trim());
}

function mainIsClean(): boolean {
  const out = sh("git", ["status", "--porcelain"]).stdout.trim();
  return out === "";
}

type Issue = { id: string; number: number; title: string; checkpoint: boolean; url: string };

// sandbox.run() has no structured-output support in sandcastle 0.12, so the
// reviewer emits a <verdict>{...}</verdict> JSON block that we parse from stdout.
function parseVerdict(stdout: string): { approved: boolean; findings: string } | null {
  const matches = [...stdout.matchAll(/<verdict>([\s\S]*?)<\/verdict>/g)];
  if (!matches.length) return null;
  try {
    const v = JSON.parse(matches[matches.length - 1][1]);
    if (typeof v.approved !== "boolean") return null;
    return { approved: v.approved, findings: String(v.findings ?? "") };
  } catch {
    return null;
  }
}

// Same trick for the clerk: <pr-title>…</pr-title> + <pr-body>…</pr-body>.
function parsePrDescription(stdout: string): { title: string; body: string } | null {
  const title = [...stdout.matchAll(/<pr-title>([\s\S]*?)<\/pr-title>/g)].pop();
  const body = [...stdout.matchAll(/<pr-body>([\s\S]*?)<\/pr-body>/g)].pop();
  if (!title || !body || !title[1].trim()) return null;
  return { title: title[1].trim(), body: body[1].trim() };
}

// Push the branch and open (or find) its PR. Returns the PR URL, or null with
// the failure output in `error`.
function openPullRequest(issue: Issue, branch: string, pr: { title: string; body: string }): { url: string | null; error: string } {
  const push = sh("git", ["push", "-u", "origin", branch], { allowFail: true });
  if (!push.ok) return { url: null, error: `git push failed:\n${push.stdout}` };

  const bodyFile = path.join(LOGS_DIR, `pr-body-issue-${issue.id}.md`);
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  // "Issue: #N", never "Closes #N" — merging must NOT close the issue; only a
  // human passes it to done after the manual test.
  fs.writeFileSync(bodyFile, `Issue: #${issue.id} (${issue.url})\n\n${pr.body}\n`);

  const create = sh(
    "gh",
    ["pr", "create", "--head", branch, "--base", "main", "--title", pr.title, "--body-file", bodyFile],
    { allowFail: true },
  );
  if (create.ok) return { url: create.stdout.trim(), error: "" };

  // Re-runs can hit "a PR for this branch already exists" — reuse it.
  const existing = sh("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"], { allowFail: true });
  if (existing.ok && existing.stdout.trim()) return { url: existing.stdout.trim(), error: "" };
  return { url: null, error: `gh pr create failed:\n${create.stdout}` };
}

// ---------------------------------------------------------------------------
// Pipeline for one issue
// ---------------------------------------------------------------------------

async function processIssue(issue: Issue): Promise<void> {
  const branch = `sandcastle/issue-${issue.id}`;
  console.log(`\n=== Issue #${issue.id} — branch ${branch} ===\n`);

  // The sandbox has no tracker access, so the full issue (body + comments) is
  // embedded into every prompt via {{ISSUE_CONTENT}}.
  const issueContent = tracker("view", issue.id);

  // A parked run leaves its fixed-name branch behind, pointing at the main it
  // was created from. createSandbox reuses an existing branch as-is, so a
  // re-run after amending the issue would hand the agent a stale tree — issue
  // 07 got double-parked exactly this way. If the leftover branch has no
  // commits of its own, drop it so the sandbox is recreated from main's HEAD.
  // Branches with unique commits (e.g. a review-failed park) are kept: they
  // hold real work, but note the sandbox then won't see issue edits made
  // since the branch was cut.
  const branchExists = sh("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFail: true }).ok;
  if (branchExists) {
    const unique = sh("git", ["log", "--oneline", `main..${branch}`]).stdout.trim();
    if (unique === "") {
      sh("git", ["branch", "-D", branch]);
      console.log(`Deleted stale fully-merged branch ${branch}; recreating from main.`);
    } else {
      console.warn(`Branch ${branch} has unique commits — reusing it; issue edits since it was cut are NOT visible to the sandbox.`);
    }
  }

  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: docker(),
    hooks,
  });

  let approved = false;
  let findings = "";
  let prStdout = "";

  try {
    // 1. Implement -----------------------------------------------------------
    const impl = await sandbox.run({
      name: `implement:${issue.id}`,
      agent: implementer(),
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs: { ISSUE_ID: issue.id, ISSUE_URL: issue.url, ISSUE_CONTENT: issueContent },
      maxIterations: 3,
      completionSignal: ["<promise>COMPLETE</promise>", "<promise>BLOCKED</promise>"],
    });

    if (impl.completionSignal?.includes("BLOCKED")) {
      park(issue.id, `Implementer flagged a spec conflict / blocker:\n\n${impl.stdout.slice(-3000)}`);
      alert("Issue parked (spec conflict)", `#${issue.id}: implementer signalled BLOCKED — see issue comments.`);
      return;
    }
    if (!impl.commits.length) {
      park(issue.id, "Implementer finished without committing anything — needs a human look.");
      alert("Issue parked (no commits)", `#${issue.id}: implement stage produced no commits.`);
      return;
    }
    console.log(`Implement done: ${impl.commits.length} commit(s).`);

    // 2–4. Review → fix cycles ------------------------------------------------
    for (let cycle = 0; cycle <= MAX_FIX_CYCLES; cycle++) {
      const stage = cycle === 0 ? "review" : `re-review-${cycle}`;
      const review = await sandbox.run({
        name: `${stage}:${issue.id}`,
        agent: reviewer(),
        promptFile: "./.sandcastle/review-prompt.md",
        promptArgs: { ISSUE_ID: issue.id, ISSUE_CONTENT: issueContent, BRANCH: branch },
      });
      const verdict = parseVerdict(review.stdout);
      if (!verdict) {
        // Malformed verdict: burn this cycle on a re-review rather than feeding
        // garbage findings to the fix agent.
        console.warn(`Review (${stage}): no parseable <verdict> block.`);
        approved = false;
        findings = "(reviewer emitted no parseable <verdict> block)";
        continue;
      }
      approved = verdict.approved;
      findings = verdict.findings;
      console.log(`Review (${stage}): ${approved ? "APPROVED" : "changes required"}`);
      if (approved || cycle === MAX_FIX_CYCLES) break;

      await sandbox.run({
        name: `fix-${cycle + 1}:${issue.id}`,
        agent: implementer(),
        promptFile: "./.sandcastle/fix-prompt.md",
        promptArgs: { ISSUE_ID: issue.id, ISSUE_CONTENT: issueContent, FINDINGS: findings },
      });
    }

    if (!approved) {
      park(issue.id, `Review did not approve after ${MAX_FIX_CYCLES} fix cycle(s). Outstanding findings:\n\n${findings}\n\nBranch left intact: ${branch}`);
      alert("Issue parked (review failed)", `#${issue.id}: review not approved after ${MAX_FIX_CYCLES} fix cycles — findings in issue comments, branch ${branch}.`);
      return;
    }

    // 5. PR description ------------------------------------------------------
    const prRun = await sandbox.run({
      name: `pr:${issue.id}`,
      agent: clerk(),
      promptFile: "./.sandcastle/pr-prompt.md",
      promptArgs: { ISSUE_ID: issue.id, ISSUE_CONTENT: issueContent, BRANCH: branch },
    });
    prStdout = prRun.stdout;
  } finally {
    await sandbox.close();
  }

  // 5b. Real GitHub PR (host side) --------------------------------------------
  const pr = parsePrDescription(prStdout) ?? {
    title: `${issue.title} (#${issue.id})`,
    body: "(clerk emitted no parseable <pr-title>/<pr-body> block — edit this description manually; stage logs are in .sandcastle/logs/)",
  };
  const { url: prUrl, error } = openPullRequest(issue, branch, pr);
  if (!prUrl) {
    park(issue.id, `Approved on ${branch}, but pushing/opening the PR failed:\n\n${error}`);
    alert("PR creation failed", `#${issue.id}: approved work on ${branch}, but ${error.slice(0, 140)}`);
    return;
  }

  // 6. Merge / gate (host side) ----------------------------------------------
  if (issue.checkpoint || !AUTO_MERGE) {
    tracker("set-status", issue.id, "awaiting-human-test");
    const why = issue.checkpoint ? "checkpoint issue" : "auto-merge disabled";
    alert(
      "PR raised — ready for manual test",
      `#${issue.id} done — PR NOT merged (${why}): ${prUrl}. Test per the PR plan, merge on GitHub, pull main, then set-status ${issue.id} done.`,
    );
    return;
  }

  if (!mainIsClean()) {
    tracker("set-status", issue.id, "awaiting-human-test");
    alert(
      "Merge skipped (dirty working tree)",
      `#${issue.id} approved — PR ${prUrl} — but main working tree is dirty; merge manually.`,
    );
    return;
  }

  const merge = sh("git", ["merge", "--no-ff", "-m", `Merge ${branch} (issue #${issue.id}, pipeline-approved)`, branch], { allowFail: true });
  if (!merge.ok) {
    sh("git", ["merge", "--abort"], { allowFail: true });
    park(issue.id, `Auto-merge of ${branch} into main conflicted. Resolve manually; approved work is on the branch and PR: ${prUrl}`);
    alert("Merge conflict", `#${issue.id}: merge of ${branch} conflicted — parked, branch and PR intact.`);
    return;
  }

  // Pushing main marks the PR merged on GitHub.
  const pushMain = sh("git", ["push", "origin", "main"], { allowFail: true });
  tracker("set-status", issue.id, "awaiting-human-test");
  if (!pushMain.ok) {
    alert(
      "Merged locally — push failed",
      `#${issue.id} merged to local main but 'git push origin main' failed (remote moved?). Push manually; PR: ${prUrl}`,
    );
    return;
  }
  alert(
    "Merged — ready for manual test",
    `#${issue.id} merged to main. Testing plan on the PR: ${prUrl}. Revert the merge if it fails testing; close the issue when it passes.`,
  );
}

// ---------------------------------------------------------------------------
// Outer loop
// ---------------------------------------------------------------------------

if (!mainIsClean()) {
  console.error("Working tree is dirty — commit or stash before an AFK run (the pipeline cuts branches from main and may merge into it).");
  process.exit(1);
}

const processed = new Set<string>();

for (let n = 1; n <= MAX_ISSUES_PER_RUN; n++) {
  const eligible = (JSON.parse(tracker("list")) as Issue[]).filter(
    (i) => !processed.has(i.id),
  );

  if (!eligible.length) {
    const all = JSON.parse(tracker("list-all")) as Array<Issue & { status: string }>;
    const humanBlocked = all.filter((i) =>
      ["ready-for-human", "needs-human", "awaiting-human-test"].includes(i.status),
    );
    alert(
      "Backlog drained",
      humanBlocked.length
        ? `No agent-eligible issues left. Waiting on you: ${humanBlocked.map((i) => `#${i.id} (${i.status})`).join(", ")}.`
        : "Every issue is done. 🎉",
    );
    break;
  }

  const issue = eligible[0];
  processed.add(issue.id);

  // Claim the issue before any work so a concurrently running AFK host doesn't
  // pick it up too. The label change is immediately visible to every host.
  // Every exit path in processIssue overwrites this with a terminal status; if
  // the host process itself dies, reset manually:
  // .sandcastle/tracker.sh set-status <n> ready-for-agent
  tracker("set-status", issue.id, "in-progress");

  try {
    await processIssue(issue);
  } catch (err) {
    console.error(err);
    park(issue.id, `Pipeline crashed on this issue:\n\n${String(err).slice(0, 3000)}`);
    alert("Pipeline error", `#${issue.id}: hard failure (${String(err).slice(0, 120)}). Parked; see logs.`);
  }
}

console.log("\nAFK run finished.");
