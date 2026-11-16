#!/usr/bin/env node
// PreToolUse hook: blocks `git commit` / `git push` when the changes being
// committed or pushed contain secrets or pinned n8n data.
//
// Why a hook and not just an instruction in CLAUDE.md: instructions can be
// forgotten or skipped; a hook runs every time, outside the model.
//
// Contract (Claude Code hooks): the tool call arrives as JSON on stdin.
// Exit 0 = allow. Exit 2 = block, and stderr is shown to Claude as the reason.
//
// It only scans ADDED lines, and matches real token shapes (e.g. "sk-ant-" plus
// a long key), not bare prefixes, so docs that mention "sk-ant" don't trip it.

const { execSync } = require("child_process");

const PATTERNS = [
  { name: "HubSpot private app / service key", re: /pat-(na|eu|ap)\d*-[0-9a-f]{8}-[0-9a-f-]{20,}/i },
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Slack bot/user token", re: /xox[bpa]-[0-9A-Za-z-]{20,}/ },
  { name: "Private key (e.g. Google service account)", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Webhook secret value in JSON", re: /"x-webhook-secret"\s*:\s*"[^"%${}\s][^"]*"/i },
  { name: "Pinned n8n data (unpin before exporting)", re: /"pinData"\s*:\s*\{\s*"/ },
];

function git(args) {
  return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

function readStdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

let input;
try {
  input = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0); // not something we understand: don't block
}

const command = (input.tool_input && input.tool_input.command) || "";
const isCommit = /\bgit\b[^;&|]*\bcommit\b/.test(command);
const isPush = /\bgit\b[^;&|]*\bpush\b/.test(command);
if (!isCommit && !isPush) process.exit(0);

let diff = "";
let files = [];
try {
  git("rev-parse --is-inside-work-tree");
} catch {
  process.exit(0); // not a git repo
}

try {
  if (isCommit) {
    diff += git("diff --cached -U0");
    files = git("diff --cached --name-only").split("\n").filter(Boolean);
    // `git commit -a` also commits unstaged changes to tracked files
    if (/\scommit\b[^;&|]*\s(-a\b|--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)/.test(command)) {
      diff += git("diff -U0");
      files = files.concat(git("diff --name-only").split("\n").filter(Boolean));
    }
  }
  if (isPush) {
    // every commit on HEAD that no remote has yet
    diff += git("log -p -U0 HEAD --not --remotes");
  }
} catch {
  process.exit(0);
}

const findings = [];

for (const f of files) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)) {
    findings.push(`${f}: .env file staged (secrets belong in environment variables, not the repo)`);
  }
}

let currentFile = "(unknown file)";
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) {
    currentFile = line.replace(/^\+\+\+ (b\/)?/, "");
    continue;
  }
  if (!line.startsWith("+")) continue;
  for (const p of PATTERNS) {
    if (p.re.test(line)) findings.push(`${currentFile}: ${p.name}`);
  }
}

if (findings.length === 0) process.exit(0);

const unique = [...new Set(findings)];
process.stderr.write(
  `Blocked ${isPush ? "git push" : "git commit"}: possible secrets or pinned data in the changes.\n` +
    unique.map((f) => `  - ${f}`).join("\n") +
    "\nRemove the value (use an n8n credential or env var instead), unpin data in n8n and re-export, then try again. " +
    "Do not print the secret value.\n"
);
process.exit(2);
