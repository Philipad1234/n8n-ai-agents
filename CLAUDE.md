# n8n AI Agents

A repo of n8n workflows. The main project is `lead-pipeline/`, an inbound lead pipeline (Vercel intake → n8n enrichment, AI scoring, HubSpot sync, Slack routing, logging). The other workflows (RAG agent, ingestion pipeline, sentiment classifier) are standalone JSON exports at the repo root.

## Project rules

@lead-pipeline/CLAUDE.md

## Claude Code setup in this repo

- `.claude/settings.json`: a `PreToolUse` hook that blocks `git commit` / `git push` when the changes contain secrets or pinned n8n data
- `.claude/skills/release-check/`: `/release-check`, the pre-commit checklist
- `.claude/skills/send-test-lead/`: `/send-test-lead`, sends one test lead to the webhook (manual only)
- `.claude/agents/workflow-reviewer.md`: read-only subagent that reviews n8n workflow exports against the project rules

## Working agreements

- Never print, log or commit secret values. Secrets come from environment variables or n8n credentials.
- Before committing, run `/release-check`. If a workflow JSON changed, also use the `workflow-reviewer` subagent.
- Don't commit or push unless the user asks.
