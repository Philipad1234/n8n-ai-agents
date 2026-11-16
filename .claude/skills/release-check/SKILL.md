---
name: release-check
description: Pre-commit checklist for this repo. Use before committing or pushing, or when the user asks if the repo is safe to publish. Checks for secrets, pinned n8n data, credential names and broken README links.
allowed-tools: Bash(git status:*), Bash(git diff:*), Read, Grep, Glob
---

# Release check

Run every step, then report a table: check, result (PASS / FAIL), details. Never print a secret value; name the file and line number only. Don't fix anything or commit unless the user asks.

## 1. What is changing

Run `git status --short` and `git diff --stat HEAD`. List the changed files. If any `workflows/*.json` changed, say so: the `workflow-reviewer` subagent should also review them.

## 2. Secret scan (token shapes, whole repo)

Use Grep across the repo (skip `.git/` and `node_modules/`) for each pattern. Any hit is a FAIL:

- `pat-(na|eu|ap)\d*-[0-9a-f]{8}-` (HubSpot key)
- `sk-ant-[A-Za-z0-9_-]{20,}` (Anthropic key)
- `xox[bpa]-[0-9A-Za-z-]{20,}` (Slack token)
- `-----BEGIN [A-Z ]*PRIVATE KEY-----` (service account key)
- `"x-webhook-secret"\s*:\s*"[^"%$]` (a real webhook secret value)

Also check that no `.env` file is tracked (`git ls-files` output must not include `.env`, other than `.env.example`).

## 3. Positive control

A scan that finds nothing might be broken. Grep for `Lead Intake Webhook Secret` in `lead-pipeline/workflows/`. It MUST find at least one hit (the credential name, which is safe). If it finds nothing, the scan is not working: report FAIL.

## 4. Pinned data

In every `*.json` workflow export, `"pinData"` must be absent or `{}`. Grep for `"pinData"\s*:\s*\{\s*"`. Any hit is a FAIL: unpin in n8n and re-export.

## 5. Credentials referenced by name only

In workflow JSON, every `"credentials"` block should reference one of these names, with no inline values:
`HubSpot Service Key - Lead Pipeline`, `Anthropic API Key`, `Lead Intake Webhook Secret`, `Slack Bot Token - Lead Pipeline`, `Google Sheets - Lead Log (service account)`.
Unknown names are a WARN (could be fine, ask the user).

## 6. README links

Read `lead-pipeline/README.md`. Every relative link or image path (e.g. `docs/workflow-overview.png`, `workflows/lead-pipeline.json`) must exist. Missing files are a FAIL.

## Report

End with one line: `READY TO COMMIT` if everything passed, otherwise `NOT READY` and the list of fixes.
