# CLAUDE.md: Inbound Lead Pipeline

Guidance for AI coding assistants (and humans) working in this folder. Read this before changing anything. The full write-up is in `README.md`.

## What this is

An inbound lead pipeline: web form → Vercel serverless function → n8n workflow (enrichment, AI scoring, HubSpot sync, Slack routing, logging) with a separate error workflow. Target ICP: B2B healthtech selling to health plans, providers and employers.

## Layout

```
workflows/lead-pipeline.json         main n8n workflow (exported, no credentials)
workflows/lead-pipeline-errors.json  error workflow (Error Trigger → Slack + Sheets)
workflows/hubspot-schema-setup.json  one-time setup: creates HubSpot custom properties
vercel/lead.js                       serverless intake, deployed as api/lead.js
vercel/lead-demo.html                demo form
vercel/utm.js                        first-touch UTM capture (include on every page)
test-leads/*.json                    fictional payloads in the Vercel → n8n contract shape
docs/                                screenshots for the README
```

The live Vercel files are deployed from the separate `portfolio` repo. Copies here are for reference; keep both in sync when you change them.

## Architecture rules (do not break these)

1. **The Vercel → n8n payload is a contract.** Fields: `submission_id, submitted_at, name, email, email_domain, is_free_email, company, role, message, utm_source, utm_medium, utm_campaign`. Vercel creates IDs and timestamps. n8n re-validates everything anyway (defense in depth) and recomputes `email_domain` and `is_free_email` itself.
2. **Every path leaves a stage in the same shape.** Enrichment always ends with an `enrichment` object (`status`: `enriched_website | skipped_free_email | failed`). CRM steps always produce `crm.company`, `crm.contact`, `crm.association` with an `action` or `status`. Fallback nodes exist to normalize failure paths; don't add a branch that skips them.
3. **No lead is lost.** Every HTTP node uses retries and `On Error: Continue (using error output)`, and its error output is wired to a node that records the failure. The only exception is `Log run to Sheets`, which uses Stop Workflow on purpose so the error workflow catches logging failures.
4. **The LLM proposes, code decides.**
   - Enrichment: Claude must quote evidence for company size; code verifies the quote is on the page, otherwise size becomes `unknown`.
   - Scoring: Claude returns `segment_fit` (0–40), `role_fit` (0–30), `intent` (0–30) and `reason`. Code clamps, sums and sets the tier (hot ≥ 75, warm ≥ 45). The free-email cap at 74 is a business rule in code.
5. **Enum values must match HubSpot dropdown options exactly**: `icp_segment` (`health_plan, provider, employer, other`), `lead_tier` (`hot, warm, nurture`), `enrichment_status`. If you add a value, add it in HubSpot first.
6. **The pipeline owns its fields.** On existing companies, only update `icp_segment` and `enrichment_summary`. Never overwrite name, domain or description. `Map fields to HubSpot` drops empty values so failed runs never blank out good CRM data.
7. **Untrusted input stays untrusted.** Website text and lead messages are labelled as data in prompts. Lead text is escaped before posting to Slack.
8. **The log records events, not people.** No names, emails or messages in the Sheets log, only IDs and outcomes.

## Secrets: hard rules

- Never put API keys, tokens, webhook secrets or service-account keys in any file in this repo.
- n8n credentials are referenced by name only: `HubSpot Service Key - Lead Pipeline`, `Anthropic API Key`, `Lead Intake Webhook Secret`, `Slack Bot Token - Lead Pipeline`, `Google Sheets - Lead Log (service account)`.
- Vercel secrets live in environment variables: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`.
- **Never pin Webhook output with headers included**: pinned data is exported in `pinData`. Unpin everything before exporting a workflow.
- Before every commit, run from this folder (expect no output), then run a positive control to prove the search works:
  ```
  findstr /s /i /c:"pat-" /c:"sk-ant" /c:"xoxb-" /c:"PRIVATE KEY" /c:"x-webhook-secret\": \"" /c:"pinData\": {\"" *.*
  findstr /s /i /c:"Lead Intake Webhook Secret" *.*
  ```

## n8n conventions

- Code nodes use **Run Once for Each Item** and recover upstream data with item linking: `$('Node name').item.json`. HTTP nodes replace the item with their response, so the next Code node re-attaches the lead this way.
- Build API request bodies in a Code node, then send with `{{ JSON.stringify($json.some_request) }}`. Don't hand-write JSON containing free text.
- Node names are referenced in code. **Renaming a node breaks `$('...')` references**, so search the workflow first.
- Edits only go live after **Publish**. n8n refuses to publish a workflow with node configuration issues.

## Testing

- n8n test URL (editor listening): `/webhook-test/lead-intake`. Production URL (published): `/webhook/lead-intake`.
- Send a test lead (Windows cmd, secret in an env var, never typed into the command):
  ```
  set "WEBHOOK_SECRET=..."
  curl -i -X POST "https://<tunnel-domain>/webhook/lead-intake" -H "Content-Type: application/json" -H "x-webhook-secret: %WEBHOOK_SECRET%" --data @test-leads/hot-lead.json
  ```
  Expect `202`. A missing or wrong secret must return `403`.
- Test each branch deliberately: edit the pinned webhook data (`is_free_email: true`, an invalid email), click **Execute workflow** (not Execute step, which reuses stale upstream data), then revert.
- After a change, check all four outputs: n8n execution, Sheets row (`outcome`), HubSpot record, Slack (hot or failed only).

## Known gotchas (already hit once)

- **Claude Sonnet 5.5 rejects forced `tool_choice`**. Scoring uses structured outputs (`output_config.format`, `json_schema`). That schema can't use `minimum`/`maximum` and needs `additionalProperties: false`, so ranges are enforced in code. Check `stop_reason === "end_turn"` before parsing.
- **Slack returns HTTP 200 on failure** with `ok: false`. Always check `ok`.
- **HubSpot's default `industry` property is a fixed dropdown.** Free text is rejected; industry goes into `enrichment_summary`.
- **HubSpot search lags writes by a few seconds**, so near-simultaneous leads from a new domain can create duplicate companies. Known limitation.
- **Don't send HubSpot an empty company PATCH.** When enrichment fails, `Map fields to HubSpot` drops both owned fields, so the update body would be `{"properties":{}}`. `Anything to update?` skips the call instead. On that path the item is still the search result, so `Attach company id` takes the id from `results[0]` and records `unchanged`. It never reports success without an id.
- **Hunter's free Company Enrichment API returns null firmographics.** It was tested and deliberately not used.
- **Anthropic keys not scoped to a workspace** need an `anthropic-workspace-id` header. This project uses a workspace-scoped key instead.
- **Windows cmd `set`** keeps trailing spaces. Use `set "VAR=value"`.

## Style

- Explain *why* in comments, not just what.
- Prefer small, single-purpose Code nodes with descriptive names over one large node.
- When adding a failure path, wire it to a node that records the outcome. Silent drops are bugs.
