// Sandcastle AFK pipeline — Signals × CX Agent Studio demo
//
// Per eligible issue (see tracker.sh for status/blocker semantics):
//   1. Implement    Sonnet 5   reads PRD + issue; BLOCKED escape hatch
//   2. Review       Fable      diff vs acceptance criteria + PRD, structured verdict
//   3. Fix          Sonnet 5   applies findings; max MAX_FIX_CYCLES review→fix rounds
//   4. Final review Fable      (last iteration of the review loop)
//   5. PR file      Haiku      writes PR-<issue>.md incl. manual testing plan
//   6. Merge        host-side  auto-merge to main, unless checkpoint issue
//
// Alerts land as macOS notifications + .sandcastle/logs/ALERTS.md.
// Issue Status: lines are only ever changed host-side (this script), never by
// agents, so issue selection stays consistent on main.
//
// Usage (from repo root):  npm run afk

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

const implementer = () => sandcastle.claudeCode("claude-sonnet-5");
const reviewer = () => sandcastle.claudeCode("claude-fable-5", { effort: "high" });
const clerk = () => sandcastle.claudeCode("claude-haiku-4-5-20251001");

const REPO_ROOT = process.cwd();
const TRACKER = path.join(REPO_ROOT, ".sandcastle", "tracker.sh");
const ALERTS_FILE = path.join(REPO_ROOT, ".sandcastle", "logs", "ALERTS.md");

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
  commitMetadata(`Park issue ${issueId} (pipeline)`);
}

function commitMetadata(message: string) {
  sh("git", ["add", ".scratch/signals-cx-agent-demo"], { allowFail: true });
  sh("git", ["commit", "-m", message, "--", ".scratch/signals-cx-agent-demo"], {
    allowFail: true, // nothing staged is fine
  });
}

function mainIsClean(): boolean {
  const out = sh("git", ["status", "--porcelain"]).stdout.trim();
  return out === "";
}

type Issue = { id: string; title: string; file: string; checkpoint: boolean };

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

// ---------------------------------------------------------------------------
// Pipeline for one issue
// ---------------------------------------------------------------------------

async function processIssue(issue: Issue): Promise<void> {
  const branch = `sandcastle/${issue.id}`;
  console.log(`\n=== Issue ${issue.id} — branch ${branch} ===\n`);

  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: docker(),
    hooks,
  });

  let approved = false;
  let findings = "";

  try {
    // 1. Implement -----------------------------------------------------------
    const impl = await sandbox.run({
      name: `implement:${issue.id}`,
      agent: implementer(),
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs: { ISSUE_ID: issue.id, ISSUE_FILE: issue.file },
      maxIterations: 3,
      completionSignal: ["<promise>COMPLETE</promise>", "<promise>BLOCKED</promise>"],
    });

    if (impl.completionSignal?.includes("BLOCKED")) {
      park(issue.id, `Implementer flagged a spec conflict / blocker:\n\n${impl.stdout.slice(-3000)}`);
      alert("Issue parked (spec conflict)", `${issue.id}: implementer signalled BLOCKED — see issue file.`);
      return;
    }
    if (!impl.commits.length) {
      park(issue.id, "Implementer finished without committing anything — needs a human look.");
      alert("Issue parked (no commits)", `${issue.id}: implement stage produced no commits.`);
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
        promptArgs: { ISSUE_ID: issue.id, ISSUE_FILE: issue.file, BRANCH: branch },
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
        promptArgs: { ISSUE_ID: issue.id, ISSUE_FILE: issue.file, FINDINGS: findings },
      });
    }

    if (!approved) {
      park(issue.id, `Review did not approve after ${MAX_FIX_CYCLES} fix cycle(s). Outstanding findings:\n\n${findings}\n\nBranch left intact: ${branch}`);
      alert("Issue parked (review failed)", `${issue.id}: review not approved after ${MAX_FIX_CYCLES} fix cycles — findings in issue file, branch ${branch}.`);
      return;
    }

    // 5. PR file + manual testing plan ---------------------------------------
    await sandbox.run({
      name: `pr:${issue.id}`,
      agent: clerk(),
      promptFile: "./.sandcastle/pr-prompt.md",
      promptArgs: { ISSUE_ID: issue.id, ISSUE_FILE: issue.file, BRANCH: branch },
    });
  } finally {
    await sandbox.close();
  }

  // 6. Merge / gate (host side) ----------------------------------------------
  const prFile = `.scratch/signals-cx-agent-demo/PR-${issue.id}.md`;

  if (issue.checkpoint) {
    tracker("set-status", issue.id, "awaiting-human-test");
    commitMetadata(`Issue ${issue.id} awaiting human test (checkpoint, branch ${branch})`);
    alert(
      "Checkpoint ready for manual test",
      `${issue.id} done on branch ${branch} — NOT merged (checkpoint). Test plan: ${prFile} (on the branch). Merge + mark done to unblock dependents.`,
    );
    return;
  }

  if (!mainIsClean()) {
    tracker("set-status", issue.id, "awaiting-human-test");
    alert(
      "Merge skipped (dirty working tree)",
      `${issue.id} approved on ${branch}, but main working tree is dirty — merge manually.`,
    );
    return;
  }

  const merge = sh("git", ["merge", "--no-ff", "-m", `Merge ${branch} (issue ${issue.id}, pipeline-approved)`, branch], { allowFail: true });
  if (!merge.ok) {
    sh("git", ["merge", "--abort"], { allowFail: true });
    park(issue.id, `Auto-merge of ${branch} into main conflicted. Resolve manually; approved work is on the branch.`);
    alert("Merge conflict", `${issue.id}: merge of ${branch} conflicted — parked, branch intact.`);
    return;
  }

  tracker("set-status", issue.id, "awaiting-human-test");
  commitMetadata(`Issue ${issue.id} merged, awaiting human test`);
  alert(
    "Merged — ready for manual test",
    `${issue.id} merged to main. Manual testing plan: ${prFile}. Revert the merge if it fails testing.`,
  );
}

// ---------------------------------------------------------------------------
// Outer loop
// ---------------------------------------------------------------------------

if (!mainIsClean()) {
  console.error("Working tree is dirty — commit or stash before an AFK run (auto-merge needs a clean tree).");
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
        ? `No agent-eligible issues left. Waiting on you: ${humanBlocked.map((i) => `${i.id} (${i.status})`).join(", ")}.`
        : "Every issue is done. 🎉",
    );
    break;
  }

  const issue = eligible[0];
  processed.add(issue.id);

  try {
    await processIssue(issue);
  } catch (err) {
    console.error(err);
    park(issue.id, `Pipeline crashed on this issue:\n\n${String(err).slice(0, 3000)}`);
    alert("Pipeline error", `${issue.id}: hard failure (${String(err).slice(0, 120)}). Parked; see logs.`);
  }
}

console.log("\nAFK run finished.");
