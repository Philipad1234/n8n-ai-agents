---
name: send-test-lead
description: Send one fictional test lead to the n8n lead-intake webhook and check the response.
argument-hint: "[test-lead file name, default hot-lead]"
disable-model-invocation: true
allowed-tools: Bash(curl:*), Read
---

# Send a test lead

Manual only (it has side effects: it creates a HubSpot record and may post to Slack), so Claude never runs it on its own.

## Inputs

- Lead file: `lead-pipeline/test-leads/$ARGUMENTS.json`. If no argument was given, use `hot-lead`. If the file doesn't exist, list the files in `lead-pipeline/test-leads/` and stop.
- Environment variables (set by the user before starting Claude Code, never typed into chat):
  - `N8N_BASE_URL`: e.g. the tunnel domain, `https://<domain>`
  - `WEBHOOK_SECRET`: the intake webhook secret

## Steps

1. Check the variables exist without printing them: `test -n "$N8N_BASE_URL" && test -n "$WEBHOOK_SECRET" && echo ok`. If not `ok`, tell the user which to set and stop.
2. Send the lead to the production URL (the workflow must be published):
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST "$N8N_BASE_URL/webhook/lead-intake" \
     -H "Content-Type: application/json" \
     -H "x-webhook-secret: $WEBHOOK_SECRET" \
     --data @lead-pipeline/test-leads/<file>.json
   ```
3. Expect `202`. If you get:
   - `403`: the secret is wrong or missing.
   - `404`: the workflow isn't published, or the tunnel/URL is wrong.
   - anything else: report it.
4. Remind the user to check all four outputs: n8n execution, Sheets row (`outcome`), HubSpot record, Slack (hot or failed only).

Never echo `$WEBHOOK_SECRET` or include it in your reply.
