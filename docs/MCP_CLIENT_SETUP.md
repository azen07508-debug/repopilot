# RepoPilot — MCP Client Setup

RepoPilot ships an MCP (Model Context Protocol) server that exposes
RepoPilot as thirteen tools to any MCP-compatible client.

## Contents

- [Build the server](#build-the-server)
- [Configuration](#configuration)
- [Client setup](#client-setup)
- [Tool reference](#tool-reference)
- [Repository intelligence tools](#repository-intelligence-tools)
- [Debugging](#debugging)
- [Security notes](#security-notes)

**Paid** — these run the analysis pipeline:

- `audit_github_repository` — start a new audit
- `reaudit_repository` — audit a repository you already audited, after
  fixing something

**Free** — pure derivations of a report that already exists, so an agent
can call them as often as it likes:

- `quality_status` — may this ship? pass / pass_with_warnings / blocked
- `release_check` — which findings block a release, by fingerprint
- `get_fix_plan` — an actionable plan per finding, with evidence and
  agent instructions
- `compare_audits` — before/after with rule-level score attribution
- `list_audit_history` — audits recorded for a repository this session
- `get_audit_status` — poll a previously started audit
- `get_repopilot_capabilities` — metadata, limits, pricing, and which
  tools are free or paid

**Free, and they do read a repository** — the Repository Intelligence
artifacts. These need a file list and file contents, so they fetch a
tree and a tarball (three requests) and derive. "Free" means **no
analysis pipeline**: nothing here scores, judges or scans for findings.

- `get_repository_context` — what is this repository, and where do I
  start reading? The one call to make first
- `get_repository_map` — modules with an importance score, entrypoints,
  the ranked important files, declared dependencies with versions
- `get_symbol_map` — the declaration surface, with line ranges
- `get_dependency_graph` — what imports what, with the importing line as
  evidence on every edge

The first group closes the loop an agent actually needs: audit → fix
plan → fix → re-audit → compare. The second answers "what am I looking
at?" before spending money on an audit. `get_repopilot_capabilities`
returns a `billing` map so an agent can tell what costs money before
calling it.

The current transport is **stdio** (the official MCP TS SDK
`@modelcontextprotocol/sdk@1.22.0`). HTTP/SSE transport is on the
roadmap for 0.2.0.

## Build the server

```bash
pnpm install
pnpm --filter @repopilot/mcp-server build
# → packages/mcp-server/dist/cli.js
```

To check the four free repository-intelligence tools against real
repositories — the one path the test suite cannot reach, because it needs
the network:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm intelligence:smoke
# or point it at specific repositories:
GITHUB_TOKEN=$(gh auth token) pnpm intelligence:smoke https://github.com/owner/repo
```

Anonymous GitHub access is 60 requests/hour per IP, which one run over two
repositories is easily enough to exhaust — pass a token. See ADR D-029 for
what this script caught (a shipped defect in `.js` → `.tsx` resolution) and
why it is a script rather than a test.

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

The MCP server runs the analysis **in-process**. It does not call the
HTTP API and does not need the API to be running — configure it
entirely through its own environment:

```bash
# Payment. `mock` (default) auto-settles so an agent gets a synchronous
# result; `okx` returns a challenge the caller must settle.
export PAYMENT_MODE="mock"

# Required for real audits. Anonymous GitHub access is capped at 60
# requests/hour, which is not enough for a full audit.
export GITHUB_TOKEN="ghp_..."

# SSRF allow-list, comma-separated.
export ALLOWED_REPO_HOSTS="github.com,raw.githubusercontent.com"

# Only used when PAYMENT_MODE=okx.
export OKX_PAYMENT_ADDRESS="0x..."
export OKX_PAYMENT_NETWORK="xlayer"
export OKX_X402_VERSION="2"

# Optional price overrides, in USDT.
export PRICE_QUICK_SCAN="0.02"
export PRICE_FULL_AUDIT="0.10"

# Optional log level (logs go to stderr).
export LOG_LEVEL="info"
```

The server never holds a wallet key. In `okx` mode it builds the
challenge and verifies the signature; signing happens in the caller's
`onchainos` CLI. All `X-PAYMENT` material is redacted in its logs.

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
        "GITHUB_TOKEN": "ghp_...",
        "PAYMENT_MODE": "mock"
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
GITHUB_TOKEN = "ghp_..."
PAYMENT_MODE = "mock"
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
        "GITHUB_TOKEN": "ghp_...",
        "PAYMENT_MODE": "mock"
      }
    }
  }
}
```

### Generic MCP client

Any client that can launch a stdio subprocess and speak JSON-RPC 2.0
over its stdin/stdout can use the server:

```bash
# One-shot handshake over stdio. Each line is a complete JSON-RPC
# message; the server replies on stdout.
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node packages/mcp-server/dist/cli.js
```

The wire protocol is plain NDJSON on stdin/stdout, so any client that
can spawn a subprocess works.

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

### `get_fix_plan`

Turn a completed audit into work. One plan per finding, each with its
evidence, ordered steps, tests to add, acceptance criteria, estimated
effort, risks, and an `agentInstructions` block you can follow directly.

**Free** — derived from the stored report. No repository scan.

**Input**

```json
{ "job_id": "job_8a3b9d..." }
```

**Output**: a `FixPlanSet`. See `docs/API.md` for the full shape.

Failures come back as payloads, not exceptions, so an agent can branch:
`{"error":"job_not_found"}` or `{"error":"report_not_ready:queued"}`.

### `compare_audits`

Compare two completed audits of the same repository and explain what
changed.

**Free** — derived from the two stored reports.

**Input**

```json
{ "base_job_id": "job_base_001", "head_job_id": "job_head_002" }
```

**Output**: an `AuditDiff` with `scoreDelta`, `dimensionDeltas`,
`ruleDeltas`, and the findings split into `resolved`, `new` and
`persistent`.

`ruleDeltas` lists only the rules whose delta changed, so "why did the
score move" has a direct answer rather than a narrative. It is computed
from the `ScoreBreakdown` already inside each report.

Refuses a self-comparison (`invalid_input:...`) and a cross-repository
comparison (`repo_mismatch:...`).

### `list_audit_history`

List the audits recorded for a repository in this session, newest
first. Use it to find the job ids that `compare_audits` needs.

**Free.**

**Input**

```json
{ "repo_url": "https://github.com/owner/repo", "limit": 20 }
```

**Output**

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "count": 2,
  "audits": [
    {
      "jobId": "job_head_002",
      "status": "completed",
      "createdAt": "2026-09-20T10:30:00.000Z",
      "mode": "quick",
      "target": "open_source",
      "overall": 62.8,
      "findingCount": 10
    }
  ]
}
```

The MCP server keeps jobs in memory, so "history" here means "this
session". The HTTP API has the durable equivalent backed by the jobs
table.

### `reaudit_repository`

Run a fresh audit of a repository you audited before, after making
changes.

**Paid** — it runs the pipeline again, with the same payment flow as
`audit_github_repository`.

**Input**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "mode": "quick",
  "target": "open_source",
  "output_language": "en",
  "include_launch_copy": false
}
```

**Output**: same shape as `audit_github_repository`.

### `get_repopilot_capabilities`

Returns the same payload as `GET /api/v1/capabilities`, plus a
`billing` map marking every tool free or paid.

**Input**: none

**Output**

```json
{
  "name": "RepoPilot",
  "version": "0.1.0",
  "paymentMode": "mock",
  "limits": { "...": "..." },
  "pricing": { "...": "..." },
  "billing": {
    "audit_github_repository":    { "paid": true,  "reason": "Runs the analysis pipeline." },
    "reaudit_repository":         { "paid": true,  "reason": "Runs the analysis pipeline." },
    "get_fix_plan":               { "paid": false, "reason": "Derived from an existing report." },
    "compare_audits":             { "paid": false, "reason": "Derived from two existing reports." },
    "list_audit_history":         { "paid": false, "reason": "Reads recorded job metadata." },
    "get_audit_status":           { "paid": false, "reason": "Reads recorded job metadata." },
    "get_repopilot_capabilities": { "paid": false, "reason": "Static metadata." },
    "quality_status":             { "paid": false, "reason": "Derived from an existing report." },
    "release_check":              { "paid": false, "reason": "Derived from an existing report." },
    "get_repository_context":     { "paid": false, "reason": "Reads the repository tree and derives; never runs the pipeline." },
    "get_repository_map":         { "paid": false, "reason": "Reads the repository tree and derives; never runs the pipeline." },
    "get_symbol_map":             { "paid": false, "reason": "Reads the repository tree and derives; never runs the pipeline." },
    "get_dependency_graph":       { "paid": false, "reason": "Reads the repository tree and derives; never runs the pipeline." }
  }
}
```

## Repository intelligence tools

Four tools that answer questions about a repository *before* an audit.
All four take the same two arguments:

**Input**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "ref": "main"
}
```

`ref` is optional and defaults to the repository's default branch. A
branch is not a commit, so pass a commit SHA when you need a fixed view.

The server reads a repository once per process and keeps the snapshot in
memory, so calling all four costs one fetch, not four. The cache holds at
most 8 repositories and 64 MiB of file content, and the least recently
used is evicted first.

### `get_repository_context`

**Make this the first call.** One request that answers "what is this
repository?" — languages, frameworks, package managers, entrypoints, the
modules ranked by importance, the files worth reading first, the heaviest
imports, the dependencies the manifests declare (with versions), and the
counts by declaration kind.

It deliberately does not include the symbol list: `get_symbol_map` is
that, and a capped copy here would double the answer to buy a worse
version of a tool that already exists. The counts tell you whether the
full list is worth a second call.

The declared dependencies are **not** the imported ones. A dev tool is
declared and never imported; a phantom dependency is imported and never
declared. For what the code actually pulls in, use
`get_dependency_graph`.

**Output** (abridged)

```json
{
  "repository": { "name": "repo", "ref": "main", "languages": [ "..." ], "frameworks": [ "..." ] },
  "entrypoints": [ { "path": "src/index.ts", "kind": "library" } ],
  "modules": [ { "path": "src", "kind": "directory", "importance": 0.24 } ],
  "modulesTrimmed": { "returned": 2, "total": 2, "omitted": 0, "note": null },
  "importantFiles": [ { "path": "src/index.ts" } ],
  "topEdges": [ { "from": "src/index.ts", "to": "src/util.ts", "weight": 1 } ],
  "declaredDependencies": [ { "name": "express", "version": "^4.19.0", "kind": "runtime" } ],
  "symbolCounts": [ { "type": "function", "count": 2 } ],
  "symbolTotal": 3,
  "fileCount": 5,
  "limitations": [],
  "degraded": false
}
```

### `get_repository_map`

The repository structure in full: modules with an importance score,
entrypoints, the ranked important files, config / test / documentation
files, and the declared external dependencies with their versions and
manifests.

Scores are **absolute** — `0.6` means the same thing in a five-module
repository as in a five-hundred-module one — so two maps can be
compared. A per-repository maximum would read well inside one repository
and mean nothing across two.

### `get_symbol_map`

The declaration surface: functions, classes, interfaces, types, methods,
constants, contracts, structs and enums, each with a 1-based line range,
its enclosing declaration, and which parser produced it.

**Input** adds two optional filters:

```json
{
  "repo_url": "https://github.com/owner/repo",
  "path_prefix": "src/core",
  "max_symbols": 500
}
```

`path_prefix` is a directory, matched on path boundaries — `src/deep`
does not match `src/deeper/d.ts` or `src/deep-notes.ts` — and `.` means
the whole repository. Narrow with it rather than raising `max_symbols`:
the response always says how many symbols were withheld.

Parser confidence is per symbol, so a compiler-parsed declaration (0.95)
can be weighted against a line-matched one (0.5). A language with no
extractor is named in `failures` rather than silently contributing
nothing.

### `get_dependency_graph`

What imports what, at file level, with the importing line as evidence on
every edge.

External packages are listed separately from internal nodes, so the node
cap is spent on the repository rather than on `react`. An import that
matches no file in the repository is reported in `limitations` rather
than turned into an edge to the nearest-looking path — a wrong edge sends
you to the wrong file, which is worse than being told to go read.

**Input** adds:

```json
{
  "repo_url": "https://github.com/owner/repo",
  "path_prefix": "src/core",
  "max_nodes": 1000,
  "max_edges": 500
}
```

An edge is only returned when both of its ends are in the answer: a line
number pointing at a node that was capped away is a dead end.

### Errors

Every failure is a payload, not an exception, so an agent can branch:

```json
{ "error": "repository_unavailable", "message": "[404] Not Found" }
```

The HTTP status is kept because `404` / `403` / `502` are three different
next moves — check the URL, wait for the rate limit, or come back later.
A tool that throws gives an agent nothing to retry with.

### Trimmed lists

Any capped list carries its own account of what it withheld:

```json
{ "returned": 40, "total": 45, "omitted": 5, "note": "Declared dependencies: the first 40 of 45 are listed; 5 more were withheld." }
```

The note is also merged into the response's `limitations`, so a caller
that only reads the caveat list still learns the answer was cut. You
cannot tell "there were 500" from "the first 500 of 9000" by looking at
the list.

## Debugging

### "The MCP server exits immediately"

Check stderr — the server logs the failure and exits non-zero. The usual
causes are a missing build or a bad token:

```bash
pnpm --filter @repopilot/mcp-server build
```

Note that the MCP server does **not** need the HTTP API to be running.
It runs the pipeline in-process, so starting `apps/api` is not a
prerequisite.

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

- The MCP server does **not** hold a wallet key. In `okx` mode it builds
  the challenge and verifies the returned signature; signing happens in
  the caller's `onchainos` CLI.
- It runs the pipeline in-process, so the same static-analysis guarantees
  apply: no repository code is ever executed, binary files are skipped,
  and prompt-injection patterns are reported as findings.
- All `X-PAYMENT` material is redacted in its logs (the same Pino redact
  list as the API).
- Logs go to stderr; redirect with shell redirection as needed.
