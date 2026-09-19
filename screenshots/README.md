# RepoPilot MCP audit — real-world run

This directory contains a real-world proof that the RepoPilot MCP server
(`audit_github_repository` tool) actually works against a public GitHub
repository. The artifacts are reproducible — re-run the script to regenerate
them.

## What this proves

1. The MCP server starts over stdio and answers the official MCP handshake
   (`initialize` + `notifications/initialized`).
2. `tools/list` advertises the three documented tools
   (`audit_github_repository`, `get_audit_status`, `get_repopilot_capabilities`).
3. `tools/call` with `audit_github_repository`:
   - goes through the payment adapter (`mock` mode here, auto-verifies);
   - clones the public repo, runs the analysis pipeline, and returns a full
     `Report` object conforming to the `@repopilot/core` Zod schema;
   - completes in **~2.3s** for the tiny `octocat/Hello-World` repo.
4. The output report contains real evidence, real blockers, and a real
   `launchChecklist` grounded in the actual repository contents.

## Repository under test

`https://github.com/octocat/Hello-World` — a 3-file public repo on `master`
with no README, no LICENSE, no lockfile, no CI. A useful negative baseline.

## Files in this directory

| File | Purpose |
| --- | --- |
| `mcp-audit-octocat-Hello-World-quick-*.json` | Full JSON response from `audit_github_repository` (mode=`quick`). |
| `mcp-audit-octocat-Hello-World-quick-*.md`   | Human-readable Markdown render of the same report. |
| `mcp-audit-octocat-Hello-World-quick-*.html` | HTML render used for the screenshot. |
| `mcp-audit-octocat-Hello-World-full-*.json`  | Same, but `mode=full` (same content here, repo is too small to differ). |
| `mcp-audit-octocat-Hello-World-full-*.md`    | Markdown render of the full report. |
| `mcp-audit-octocat-Hello-World-full-*.html`  | HTML render of the full report. |
| `mcp-audit-octocat-Hello-World-full.png`           | Viewport-sized screenshot (top of the report). |
| `mcp-audit-octocat-Hello-World-full-fullpage.png`  | Full-page screenshot of the entire report. |

## Headline numbers (from this run)

| Metric | Value |
| --- | --- |
| Status | `completed` |
| Overall score | **45.2 / 100** |
| Documentation | 5.5 |
| Reproducibility | 30 |
| Security hygiene | 100 |
| Deployment readiness | 63.5 |
| Blockers | 5 (all `high`) |
| Documentation gaps | 8 |
| Security findings | 0 |
| Wall-clock time | 2.34 s |

Top blocker: **`doc-readme`** — `README.md is missing or empty`.

## How to reproduce

From the repo root, with `pnpm` installed and the workspace built:

```bash
# Make sure the MCP server is built.
pnpm --filter @repopilot/mcp-server build

# Run the audit (defaults: octocat/Hello-World, mode=quick)
pnpm tsx scripts/mcp-audit.ts

# Or pick your own repo + mode:
pnpm tsx scripts/mcp-audit.ts https://github.com/expressjs/express full
```

The script writes new JSON / MD / HTML files into `screenshots/`. To regenerate
the PNG, run from this directory:

```bash
chromium-browser --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1100,4500 \
  --screenshot=screenshots/mcp-audit-octocat-Hello-World-full-fullpage.png \
  file://"$(pwd)/screenshots/mcp-audit-octocat-Hello-World-full-<timestamp>.html"
```

## Notes

- `PAYMENT_MODE=mock` is used, so the audit completes synchronously in the
  same call. In `okx` mode the tool returns a payment challenge and the
  caller must call `onchainos payment pay --payment-id <id> --yes` and then
  re-poll via `get_audit_status` (see `docs/OKX_LIVE_INTEGRATION.md`).
- The MCP server runs over stdio JSON-RPC and accepts no inbound network
  traffic. The audit itself only reads public repository metadata and files
  via the GitHub REST API and raw.githubusercontent.com (allowed hosts are
  configurable via `ALLOWED_REPO_HOSTS`).

## OKX seller-side smoke

`okx-seller-smoke-*` artifacts prove the x402 seller side is fully
wired. Run `pnpm tsx scripts/okx-seller-smoke.ts [recipient_address]`
to regenerate.

The smoke starts the API with `PAYMENT_MODE=okx` and a valid
`OKX_PAYMENT_ADDRESS`, hits `POST /api/v1/audits`, and dumps the real
x402 v2 challenge. The fullpage screenshot shows the response body
with `payTo` set to the configured recipient and `asset` set to the
X Layer USDT contract.
