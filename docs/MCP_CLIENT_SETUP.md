# RepoPilot — MCP Client Setup

RepoPilot ships an MCP (Model Context Protocol) server that exposes
RepoPilot as three tools to any MCP-compatible client:

- `audit_github_repository` — start a new audit
- `get_audit_status` — poll a previously started audit
- `get_repopilot_capabilities` — service metadata

The current transport is **stdio** (the official MCP TS SDK
`@modelcontextprotocol/sdk@1.22.0`). HTTP/SSE transport is on the
roadmap for 0.2.0.

## Build the server

```bash
pnpm install
pnpm --filter @repopilot/mcp-server build
# → packages/mcp-server/dist/cli.js
```

The CLI is also exposed as a binary after `pnpm install`:

```bash
# inside the workspace
pnpm mcp
# or
node packages/mcp-server/dist/cli.js
# after `npm i -g .`
repopilot-mcp
```

## Configuration

The MCP server reads the API URL from the environment. The default is
`http://127.0.0.1:4000` if the API is running on the same host.

```bash
# The URL where the RepoPilot API is reachable from the MCP client.
# In most setups this is localhost; for remote setups use HTTPS.
export REPOPILOT_API_URL="https://api.example.com"

# Optional. A bearer token if you put RepoPilot behind a reverse proxy
# that requires one. RepoPilot itself does not implement auth in
# 0.1.0-rc.1; this is for users that front it with one.
export REPOPILOT_API_KEY=""
```

The server never holds secrets, never logs them, and never sends them
to the API. The `Authorization` header (when set) is added by the MCP
client, not by RepoPilot.

## Client setup

### Claude Code (Anthropic)

Claude Code reads MCP config from `~/.config/claude-code/mcp.json` or
`.mcp.json` in the project root.

```json
{
  "mcpServers": {
    "repopilot": {
      "command": "node",
      "args": [
        "/absolute/path/to/repopilot/packages/mcp-server/dist/cli.js"
      ],
      "env": {
        "REPOPILOT_API_URL": "http://127.0.0.1:4000"
      }
    }
  }
}
```

### Codex (OpenAI)

Codex reads MCP config from `~/.codex/mcp.toml` or
`.codex/mcp.toml` in the project root.

```toml
[mcp_servers.repopilot]
command = "node"
args = ["/absolute/path/to/repopilot/packages/mcp-server/dist/cli.js"]

[mcp_servers.repopilot.env]
REPOPILOT_API_URL = "http://127.0.0.1:4000"
```

### OpenClaw (and similar)

OpenClaw uses the standard MCP config shape. Drop this into your
session's MCP config:

```json
{
  "mcpServers": {
    "repopilot": {
      "command": "node",
      "args": [
        "/absolute/path/to/repopilot/packages/mcp-server/dist/cli.js"
      ],
      "env": {
        "REPOPILOT_API_URL": "http://127.0.0.1:4000"
      }
    }
  }
}
```

### Generic MCP client

Any client that can launch a stdio subprocess and speak JSON-RPC 2.0
over its stdin/stdout can use the server:

```bash
# Start the server
node packages/mcp-server/dist/cli.js

# Send initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"0.0.1"}}}' | nc -U /tmp/repopilot.sock
```

(Replace the IPC mechanism with whatever your client uses; the wire
protocol is plain NDJSON lines.)

## Tool reference

### `audit_github_repository`

Start a new audit. Returns the `jobId` and (if mock payment is
configured) settles it immediately. With real OKX payment the tool
returns the `paymentId` and the client should retry after the buyer
has signed.

**Input**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "mode": "quick",
  "target": "open_source",
  "output_language": "en",
  "include_launch_copy": true
}
```

**Output**

```json
{
  "jobId": "job_8a3b9d...",
  "status": "completed",
  "report": { ... full Report ... }
}
```

or, when payment is required:

```json
{
  "jobId": "job_8a3b9d...",
  "status": "queued",
  "payment": {
    "paymentId": "mock_xxx",
    "amount": "0.02",
    "currency": "USDT"
  }
}
```

### `get_audit_status`

Poll an existing audit. Returns the same shape as `GET
/api/v1/audits/:jobId`.

**Input**

```json
{ "job_id": "job_8a3b9d..." }
```

### `get_repopilot_capabilities`

Returns the same payload as `GET /api/v1/capabilities`. No input.

**Input**: none

**Output**: see `docs/API.md`.

## Debugging

### "The MCP server exits immediately"

Make sure the API is reachable:

```bash
curl $REPOPILOT_API_URL/health
```

If the API is down, the MCP server logs an error and exits. Start the
API first:

```bash
pnpm --filter @repopilot/api dev
```

### "tools/list returns empty"

Older MCP clients sometimes send `notifications/initialized` *after*
the first tool call. The server requires the canonical handshake
sequence:

1. `initialize` (with `protocolVersion`)
2. `notifications/initialized`
3. Then any other request

If you write your own client, follow that order.

### "My client can't find the binary"

Use an absolute path. The MCP client runs the command as a subprocess;
relative paths are resolved against the client process's CWD, which
may not be the repo root.

### "Mock payment is what I want for now"

Just leave `PAYMENT_MODE=mock` in the API's environment. The MCP
server will see the same `paymentMode` in `/health` and the tools
will auto-settle the audit without needing a real wallet.

## Security notes

- The MCP server does **not** hold any wallet key. It only forwards
  audit requests to the configured API.
- All `X-PAYMENT` headers are redacted in the MCP server's own logs
  (the same Pino redact list as the API).
- The MCP server's logs go to stderr by default; redirect with shell
  redirection as needed.
