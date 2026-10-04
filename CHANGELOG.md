# CHANGELOG.md

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Contents

- [Unreleased](#unreleased) — [Added](#added) · [Changed](#changed) · [Fixed](#fixed)
- [0.1.0-rc.3](#010-rc3---2026-07-19)
- [0.1.0-rc.2](#010-rc2---2026-07-19)
- [0.1.0-rc.1](#010-rc1---2026-07-19)

## [Unreleased]

### Added

- **`free_check` — the free entry point, on the MCP surface.** The
  marketplace listing sells Free Check as "the entry point used by other AI
  agents to triage a repo before deciding to pay for a full audit", and MCP
  is the AI-agent channel — but the tool existed only over HTTP. The stated
  entry point was absent from the one surface that reaches the audience the
  sentence names. It is the same dependency-free `FreeCheckRunner`
  `/api/v1/free-check` uses and returns the same `FreeCheckReport`
  (`reportVersion: "1.0"`), with no `jobId`: a free check is not a job, so
  there is nothing to poll. A repository that cannot be read comes back as
  `{error: "repository_unavailable", message: "[404] …"}`, matching the
  intelligence tools. The MCP surface is now 14 tools.
- **`FreeCheckSource` — the seam that makes the free check testable.**
  `FreeCheckRunner` built `GitHubFetcher` and `MetadataAnalyzer` inline, so
  the product's own entry point was the one part of it no test could drive.
  `free-check.test.ts` worked around that by re-implementing the matching
  rules inside the test bodies — see Fixed. The seam is one interface with
  two methods (`metadata`, `tree`), defaulted to the real GitHub source, and
  it is what the MCP server's `freeCheckSource` option forwards.
- **`report/tiers.ts` — the one place that says what each tier contains.**
  R-30 was three `if (mode === 'full')` sites in `report/builder.ts` plus a
  claim in `MARKETPLACE_LISTING.md`, with nothing comparing them; two sites
  added advice rows, the listing promised analyzers that never existed, and
  the report told `quick` buyers that heuristics had been skipped when
  nothing was skipped. The declaration is now a list — `FULL_ONLY_SECTIONS`
  — and two things are derived from it rather than written by hand: the
  report's `omittedSections`, and the sentence the report uses to describe
  its own omissions. Adding a section to the list updates both.
- **`Report.omittedSections` — absent and empty are different claims.**
  `deploymentPlan: []` on a quick report does not mean "this repository has
  no deployment story"; it means the tier does not include one. Before this
  field the two were indistinguishable, and a reader would take the second
  for the first. The field defaults to `[]`, which is the true answer for a
  report written before it existed. `tiers.test.ts` checks the declaration
  against the report in both directions: every declared omission is actually
  empty, and every empty section is declared — the second direction is what
  catches a section quietly emptied without being declared, which is how
  `launchCopy` was represented before this change.
- **Three more non-credential shapes, and the shapes module now holds the
  decomposition as well as the judgements.** `uuid` (a canonical UUID is an
  identifier), `evm-address` (a 20-byte contract address is public by
  construction; the shape is anchored so that a 32-byte private key — `0x`
  plus 64 hex — does not match), and `path-or-name-run` (a run followed by a
  known file extension, or three-plus separator-joined segments of which two
  are purely alphabetic). Each carries its `why` and a test pair: a real false
  positive from a live audit, and a same-shape true positive that a lazily
  written shape would swallow — a 66-character private key, a 40-character
  opaque token, a 32-hex run, Telegram's documented `botToken` example.
  **Measured on this repository's tracked tree: `generic_high_entropy` 33 → 4**,
  and all four survivors are in a document or a test file, so the severity
  downgrade in `severityForPath` applies to every one of them.
- **`scripts/audit-diff.ts` and `scripts/audit-baseline.json`** — run the four
  reference audits sequentially and print a five-score × four-audit table plus
  the change against a recorded baseline. Every batch of the repair plan ended
  by hand-copying those numbers out of a terminal into a markdown table;
  `pnpm audit:diff` does it in one command. Deliberately not a CI gate: three of
  the four targets are other people's repositories, so a non-zero diff is
  information rather than a failure.
  - Its first live run found **R-29**, a 166-finding false positive that the
    hand-written baseline had been masking.
- **Root `dev:worker`, `start:api` and `start:worker` scripts.** The split
  deployment shape is documented in `PROJECT_STATE.md`, `docs/DEPLOYMENT.md` and
  the 0.1.0-rc.3 CHANGELOG entry, and all three tell an operator to run
  `pnpm start:api` and `pnpm start:worker` — neither of which existed at the
  root. `dev:api` existed while `dev:worker` did not.
- **A test that the `BILLING` map matches the registered tools.** `BILLING` is
  what `get_repopilot_capabilities` returns, so it is what an agent reads to
  decide what it can afford. It was module-private and asserted by nothing — the
  test named "registers every tool the billing map advertises" checked a
  hand-copied list in the test file instead. `BILLING` is exported now, and
  three assertions tie the registrations, the billing map and the frozen public
  list together.
- **`apps/web` has tests.** The package shipped a `test` script that
  printed `no web tests yet` and exited 0, so `pnpm -r test` reported
  success for a workspace with no web coverage at all. The bug that made
  the submit button a silent no-op — a settled `POST /api/v1/audits`
  answers 202, and the UI assumed the report arrived in that response
  body — was invisible to `tsc`, invisible to `vite build`, and invisible
  to every existing test. That is exactly the gap a stub script hides.
  - 16 tests in jsdom: 2 harness self-tests that prove the instrument
    receives the app's requests before any product assertion is trusted,
    and 14 contract tests that drive the real `App` through the real
    `lib/api.ts` against a `fetch` stub reproducing the status codes and
    bodies from `routes/audits.ts` — the 402 challenge (which carries
    **no** `statusUrl` / `pollAfterMs`), the replay with `X-PAYMENT`, the
    202 that does carry them, the `queued → processing → completed`
    transitions, `pollAfterMs` used as the poll interval, the report
    reaching `ReportView`, a failed job surfacing an error rather than a
    silent empty state, three transport failures, refreshing a job that
    is still running, and polling hygiene (one chain, stopped once the
    job settles).
  - The 202 body is additionally checked against the `required` list in
    `apps/api/src/openapi.ts`, so the fixture cannot drift from the
    published contract without the web suite saying so.
- **Repository Map builder (V0.2-d).** The first Repository Intelligence
  artifact: a deterministic description of what a repository is made of
  — modules, how important each is, how they depend on each other, and
  which files are worth reading first — built from the file list and
  file contents a snapshot already carries. No new network calls, no new
  dependencies, and deliberately **not wired into the pipeline**: R-20
  notes that the map is a large JSON artifact while `report_json` is a
  database column, so V0.2-g gives it its own surface instead.
  - `intelligence/repository-map/importance.ts` — the scoring
    primitives. Every score is a saturating curve `x / (x + half)`, so
    `0.6` means the same thing in a five-module repository and in a
    five-hundred-module one. A per-repository maximum ("the module with
    the most fan-in is 1.0, scale everything else to it") was rejected
    for exactly that reason: it reads well inside one repository and
    means nothing across two, which is the whole point of a map that
    gets stored and compared. Module importance is `0.5 * fan-in +
    0.3 * size + 0.2 * entrypoint`; a file's importance is the
    **maximum** of its reasons, never their sum — a root `package.json`
    is config and often also sits beside the entrypoint, so summing
    would let two weak reasons outrank one strong one and could leave
    the schema's `0..1` range.
  - `intelligence/repository-map/entrypoints.ts` — seven kinds of
    entrypoint (`cli`, `server`, `library`, `app`, `worker`, `test`,
    `contract`) detected from paths, file contents and `package.json`
    fields. `resolveTarget()` is the only place a path that did not come
    from the tree can enter the result, so it is where "never report a
    path the repository does not have" is enforced: every branch ends in
    a `known.has` check. Manifests routinely declare targets that are
    not there — `bin` → `dist/cli.js`, `exports` → compiled output,
    `main` → a file that was renamed — and a builder that trusted them
    would invent paths. `PATH_RULES` anchors on `(^|/)` rather than `^`,
    so every workspace package's own `src/index.ts` counts and not only
    the root one.
  - `intelligence/repository-map/manifests.ts` — dependency manifests
    for npm, pnpm, Python (`requirements.txt`, `pyproject.toml`,
    PEP 508), Cargo and Go, all hand-parsed to keep R-21 (zero new
    dependencies). Anything outside the supported subset is **reported**
    through `notes` → `limitations` rather than silently dropped: an
    unsupported `requirements.txt` operator, a `-r` / `-e` include line,
    an unparsed `Gemfile` or `pom.xml`. `MAX_NOTES_PER_MANIFEST` caps
    the notes at five plus a "…and N more note(s)" line, so a manifest
    that is entirely outside the subset cannot flood the report.
  - `intelligence/repository-map/modules.ts` — module detection from
    five sources, in order: workspace globs intersected with directories
    that really exist, `contracts/`, any other directory holding a
    manifest, top-level directories with at least three text files, and
    — for a flat repository — a single root module. Every candidate is
    derived from a path the tree actually contains, so a workspace glob
    matching no directory yields no module rather than a phantom one.
    `MANIFEST_NAME_PRIORITY` decides which manifest names a directory;
    without it the answer depended on `Map` insertion order, so two
    identical repositories could name the same module differently.
  - `intelligence/repository-map/build.ts` — the orchestrator: language
    mix, package managers, module edges, the dependency list and the
    ranked important-file list, assembled under explicit caps and
    validated with `RepositoryMapSchema.parse()` at the boundary, so the
    declared return type cannot be a lie and schema defaults are
    materialised. `degraded` is not a boolean flag but an explanation: a
    truncated tree or a failed archive sets `degraded: true` **and**
    adds a `limitations` line naming which one happened and why.
  - Exported as the `@repopilot/core/intelligence` subpath, and
    re-exported from the package root. Intelligence lives inside
    `packages/core` rather than in its own package because a separate
    package would buy a build-order problem and a circular dependency
    for no gain (§0.3).
  - ADR **D-025** records the decisions above, five rejected
    alternatives, and one consequence worth calling out: a `known.has`
    guard inside the recorder turned out to be **unreachable** —
    `resolveTarget` already guarantees it — so it was deleted and the
    invariant documented as living in exactly one place.
  - **Test baseline: core +118 across five new files** (545 total, was
    427). `fixture.test.ts` runs the builder over all six real fixtures
    and asserts, for each, that the map validates, is reproducible,
    names no path the tree does not contain, and gives every module at
    least one file — that last assertion is what caught `testFiles`
    coming back empty because test files were only recognised by
    directory and not by filename. `build.test.ts` pins the four
    `package.json` dependency kinds, the caps, and honest degradation.
  - Verified by mutation rather than by coverage: sixteen invariants were
    reintroduced into copies of the source one at a time — the existence
    check dropped, the root module mapped to `''` instead of `'.'`, the
    config reason added to the entrypoint score instead of maxed, a
    container directory treated as a module, an unmatched recursive
    workspace glob dropped in silence, the dependency dedupe key losing
    its `kind`, a truncated tree no longer counted as degraded, a capped
    list sliced before it was sorted. **16 caught, 0 missed.** The
    harness had to learn two traps. A mutation that does not compile
    makes vitest print `Tests no tests`, which a failure-count grep reads
    as a pass. And a mutation can be *semantically equivalent* — the
    first version of the "reasons are maxed" check rewrote
    `max(0, score)` as `min(1, 0 + score)`, the same function, so its
    survival said nothing about the tests; re-pointing it at the branch
    where a score is already on the board is what made it mean something.
    Two mutations found real bugs: the manifest ordering bug above, and
    the cap reporting fixed below.
- **Symbol Map (V0.2-e, ADR D-026).** The second Repository Intelligence
  artifact: the declaration surface of a repository — functions, classes,
  interfaces, types, methods, constants, contracts, structs, enums — with
  a 1-based line range, a parent, an exported flag and the provenance of
  the parser that produced it. Same shape of contract as the Repository
  Map: deterministic, schema-validated at the boundary, not wired into
  the audit path (V0.2-g exposes it).
  - Three tiers, and the tier travels with every symbol rather than
    being a property of the map. TypeScript and JavaScript use the
    `typescript` compiler API at 0.95; Python and Solidity use
    hand-written regex scanners at 0.75 / 0.7; Go, Rust, Java, Kotlin,
    Swift, Ruby, Shell, Protobuf and GraphQL use line-pattern heuristics
    at 0.5. A consumer can weight a compiler-parsed declaration against a
    line-matched one instead of trusting both equally.
  - `createSourceFile`, never a `Program`. A `Program` type-checks:
    resolving imports, loading `lib.d.ts`, walking `node_modules`. A
    declaration surface needs a parse, not a check, and a type checker is
    exactly what would make R-18's memory bound untrue. The price is that
    parents are unset, so `getCombinedModifierFlags` (which walks
    `node.parent`) is unusable and `isExported` reads `ts.getModifiers`
    directly.
  - **A language with no extractor is named, not guessed.** It produces
    no symbols and a `failures` entry carrying the language and its file
    count. A guessed symbol sends an agent to the wrong line; a missing
    one sends it to read the file. Same for a file over the R-18 byte
    limit, and for the symbol cap.
  - **A parser failure degrades, never propagates.** Each file is parsed
    inside its own `try`, a failure falls back to the line scanner, and a
    failure of *that* becomes a `failures` entry — the loop continues.
    Only the compiler API gets a fallback tier; it is the one parser here
    whose failure mode is not merely "a regex did not match".
  - **Span semantics are per language, and each is a decision.** Python
    ends a block at its last statement, not at trailing blank or comment
    lines, and starts a decorated function at its `@decorator`. Solidity
    strips comments and string literals before counting braces — a
    `revert("unbalanced {")` would otherwise make one symbol swallow the
    rest of the file. Ruby and Shell end a block by indentation **plus**
    the closing keyword at the same indent, because indentation alone
    leaves the `end` / `}` outside the range. A bodiless declaration
    spans one line, never to the end of the file.
  - Three defects were found by the mutation check rather than by a
    failing test, and all three are fixed:
    - **Solidity reported an implementation's locals as contract state.**
      `uint local = 1;` inside a function body matches the same pattern
      as `uint256 count;` in a contract body, and the guard only asked
      whether a contract was open — which it is, inside its own
      functions. The comment beside that guard claimed the opposite of
      what the code did. State variables are now recognised by brace
      depth.
    - **A container reached with the symbol cap already full was never
      opened.** A `namespace` contributes no symbol of its own — the
      schema has no `namespace` kind — so returning early at the cap
      dropped its whole subtree while `truncated` stayed `false`: an
      incomplete surface reported as a complete one. The cap is now
      checked per declaration, and the walk descends regardless.
    - **A dead clause in `isExported`.** `default` was read alongside
      `export`, but TypeScript only allows `default` on a declaration
      that already carries `export`, so it could never be the deciding
      modifier. Deleted — a mutation that swapped it for an unrelated
      keyword survived the entire suite, which is what dead code looks
      like from the outside.
  - `typescript` moves from `devDependencies` to `dependencies`: it is
    imported at runtime, so the published package would otherwise be
    broken for every consumer (D-018).
  - **Test baseline: core +78** (550 → 628), including one that builds a
    schema-valid map over each of the six real fixtures twice and asserts
    the two are identical. Forty mutations, **39 caught, 1 equivalent, 0
    invalid**; the equivalent one is recorded in D-026 rather than pinned
    by a test.
- **Dependency Graph (V0.2-f, ADR D-027).** The third Repository
  Intelligence artifact: for every file that declares imports, which
  files, packages or modules it reaches — with the importing line as
  evidence on every edge. Same shape of contract as the two maps:
  deterministic, schema-validated at the boundary, not wired into the
  audit path (V0.2-g exposes it).
  - **The unit of an edge is the unit the language imports.** TypeScript
    imports a *file*, so the target is a `file` node. Go imports a
    *package*, which is a directory, so the target is a `module` node —
    and a Go import produces no file candidates at all. A bare specifier
    that names nothing in this repository is an `external-dependency`.
  - **A node exists because an edge touches it.** A file with no imports
    and nothing importing it is not a node: the Repository Map already
    lists files, and absence from the graph *is* the answer to "what does
    this import?".
  - **An unresolved import is not an edge.** A relative specifier that
    names no file goes to `limitations` with the file and line that wrote
    it. An edge to the nearest-looking path would send an agent to read a
    plausible wrong file, which is worse than being told to go read.
  - **`.js` names `.ts` (D-001).** `import './index.js'` in a NodeNext
    project names `index.ts` on disk; without the rewrite every internal
    import in such a repository is reported unresolved. A real `.js` file
    on disk still wins over its `.ts` original.
  - **An uncertain record may only reach something in the tree.** Python
    `from a.b import c` also tries `a.b.c` because `c` may be a
    submodule — `from . import models` depends on it — but when that
    guess misses the honest reading is "a name inside the module already
    recorded", not "a third-party package". `from fastapi import
    FastAPI` yields one edge to `external:fastapi`, not a second to
    `external:fastapi.FastAPI`.
  - **Module conventions are per language.** Rust: `src/a.rs` owns
    `src/a/`, `lib.rs` / `main.rs` / `mod.rs` are crate roots that own
    the directory they sit in, `crate::` is rooted at `src/`. Python: one
    leading dot is the file's own package, and a relative import that
    would leave the root is refused rather than clamped. Java and Kotlin
    are dotted paths tried against the repository root and against
    `src/main/java`-style source roots.
  - `limitations` moves onto `DependencyGraphSchema` (it was declared
    only on the architecture graph in V0.2-b, so a dependency graph could
    be silently incomplete). `DEFAULT_MAX_FILE_BYTES` is extracted to
    `intelligence/limits.ts` so the two artifacts share one R-18 bound.
  - Two defects were found by the mutation check rather than by a failing
    test, and both are fixed: an uncertain Python submodule guess that
    missed became an `external-dependency` edge, and a relative Python
    import that walked past the root was clamped to the root instead of
    refused. Two pieces of dead code were deleted — a `specifier ===
    clean` clause in `stripRootPrefix` that the following `startsWith`
    already refused, and a `./` / `../` branch in `pythonCandidates` that
    was equivalent to the leading-dot reading for every input.
  - **Test baseline: core +112** (628 → 740), including a schema-valid
    graph over each of the six real fixtures, built twice and asserted
    identical, with every edge checked to point at a node that exists.
    Seventy-four mutations, **74 caught, 0 missed, 0 invalid**.
- **Repository Intelligence reaches an agent — four free MCP tools, and a
  snapshot test over the six real fixtures (V0.2-g, ADR D-028).** The
  three artifacts had no consumer: they were kept out of the audit path
  on purpose (R-20 — an artifact is a large JSON document and
  `report_json` is a column), and the MCP server's own rule said free
  tools never scan a repository. Those two facts were incompatible, and
  the rule was the one that was wrong.
  - **"Free" now means no analysis pipeline, not "no network".** The four
    intelligence tools fetch a tree and a tarball (three requests, D-017)
    and derive. Nothing they do scores, judges or scans history. The old
    rule conflated "costs the seller nothing" with "does not touch the
    network", and that conflation is what made this stage look blocked.
  - **Four tools: `get_repository_context`, `get_repository_map`,
    `get_symbol_map`, `get_dependency_graph`.** The first is the one-call
    answer — languages, frameworks, entrypoints, ranked modules, the
    files worth reading first, the heaviest imports, the declared
    dependencies and the symbol counts — and it deliberately carries no
    symbol list, because `get_symbol_map` is that and inlining a capped
    copy would double the answer to buy a worse version of a tool that
    already exists.
  - **`RepositorySnapshots`: an in-process LRU bounded by count *and*
    bytes** (8 snapshots, 64 MiB). A count bound alone allows eight
    copies of a 50 MiB repository; a byte bound alone lets one enormous
    repository fill the map. A snapshot larger than the whole bound is
    still kept, or the bound turns the cache into a no-op for exactly the
    repositories that cost the most to read.
  - **The ref a caller names back is served from the snapshot already
    held.** `get_repository_context` answers with `repository.ref` and
    the natural next call passes it straight back; keyed `url@ref` those
    are two keys, and the repository would be fetched twice — the one
    thing the cache exists to prevent.
  - **A failure is a machine-readable error, not an exception.**
    `{ error: 'repository_unavailable', message }`, and the message keeps
    the HTTP status, because 404 / 403 / 502 are three different next
    moves. A tool that throws gives an agent nothing to retry with.
  - **Every capped list says it was capped** — `{ returned, total,
    omitted, note }`, with the note merged into `limitations` as well. A
    caller cannot tell "there were 500" from "the first 500 of 9000" by
    looking at the list.
  - **The context tool reports what the manifests *declare*; the graph
    reports what the code *imports*.** Different sets in both directions
    — a dev tool is declared and never imported, a phantom dependency is
    imported and never declared — so the field is named
    `declaredDependencies` and carries the manifest's `version` and
    `kind`, and the description points at `get_dependency_graph`.
  - **`path_prefix` is a directory, matched on segment boundaries, and
    `.` is the root.** Two defects the mutation check found: it was a
    *string* prefix, so `src/deep` also returned `src/deep-notes.ts` and
    `src/deeper/d.ts`; and `path_prefix: '.'` matched nothing, though
    `"."` is exactly how the Repository Map spells the root module.
  - **Snapshot tests over the six real fixtures**
    (`intelligence/snapshot.test.ts`, 19 tests, 1012 lines). The fixture
    list itself is snapshotted first, so a new fixture cannot be accepted
    silently. Verified to have teeth before it was trusted: changing the
    evidence `reason` in the Dependency Graph from `imports` to
    `depends on` left all 35 dependency-graph unit tests **green** and
    turned the snapshot **red** with the exact diff.
  - `test-utils/fixtures.ts` — one fixture walk instead of three
    byte-identical private copies, with the `..` count written down once
    and `FIXTURE_NAMES` sorted so the snapshot does not depend on readdir
    order.
  - `McpServerOptions.snapshotLoader` — the seam a test drives instead of
    the network. `RepositorySnapshots` had taken a `load` override since
    it was written and nothing forwarded one, so the four tools could
    only be exercised against GitHub.
  - `packages/mcp-server` suite: 37 tests (19 + 18), where before there
    were 4. Thirty mutations over `intelligence.ts` and the new
    `withSnapshot` / `describeError`: **30 caught, 0 missed, 0 invalid.**
    Test baseline: core 740 → 759, workspace 823 → 879.
- **Integration tests for the three derived endpoints.**
  - `apps/api/src/tests/api.integration.test.ts` covered `/quality` and
    nothing else under `derived routes`. Twenty tests now pin
    `fix-plan`, `/diff` and `/repositories/{owner}/{repo}/audits`: what
    each returns, which commit each reports, and every error path
    (`400` / `404` / `409` — the missing-`base` message names the
    history endpoint that would supply one).
  - `AppDeps.metadataAnalyzer` is injectable now, so a test can fix the
    head SHA. Without it the only way to learn a SHA is to ask GitHub,
    which makes the value non-deterministic and the endpoint that
    reports it untestable — every job row would carry `commit_sha =
    NULL`.
  - Two tests state the invariant the module doc claims, rather than
    trusting it: reading a fix plan, a diff, a quality verdict and a
    history list leaves the pipeline's run count unchanged, and a
    repository GitHub could not be reached records no commit.
  - `api` suite: 36 passing in `api.integration.test.ts` (was 16).
- **`Report.fixtureSummary` — fixture findings grouped for reading.**
  - `packages/core/src/report/fixtures.ts`: `summarizeFixtures()`
    groups findings by `(file, ruleId)` and returns
    `{ file, ruleId, title, count, severity, lines }`, worst severity
    first. `lines` is capped at `MAX_GROUP_LINES` (10) while `count`
    keeps the true total, so a five-hundred-hit lockfile group is one
    row rather than five hundred.
  - `ReportSchema.fixtureSummary` is additive with a `.default([])`, so
    a report written before it existed still parses. `fixtureFindings`
    is unchanged and remains the authoritative list — the quality
    contract and the diff read it, not the summary.
  - The summary is stored rather than derived on read because
    `apps/web` imports core type-only (core pulls `@octokit/rest`, which
    must not reach the browser), so data is the only channel that
    reaches both a browser and an MCP client without a second copy of
    the rule.
  - `apps/web/src/components/ReportView.tsx`: a collapsed `<details>`
    section after the security findings, muted so it does not compete
    with the gating sections. Falls back to the raw `fixtureFindings`
    list when a stored report has no summary, rather than hiding them.
  - MCP `reportSummary()` gained `fixtureFindingCount` and
    `fixtureFileCount`, so an agent cannot read
    `securityFindingCount: 3` as "three findings total".
  - **Test baseline: core +17** (`report/fixtures.test.ts` 14,
    `fixture-split.test.ts` +3 including the thirty-hit collapse).
- **Repository Intelligence — Phase 0 audit + V0.2-b schemas.**
  - `docs/REPOSITORY_INTELLIGENCE_PLAN.md`: a full code audit plus the
    phased plan to evolve RepoPilot into a *Repository Intelligence
    Layer for AI Coding Agents*. No rewrite — the existing API, MCP
    tools, report schema, analyzers, fixtures and tests are preserved.
    The audit corrected three assumptions in the original proposal:
    there is no AST parser, there is no git history / local clone, and
    the per-file `getContent` I/O cannot sustain Repository Map under
    the 60 req/h anonymous limit.
  - ADRs **D-017 ~ D-021** in `DECISIONS.md`: tarball I/O (D-017),
    symbol parser selection (D-018), MCP billing split — report tools
    paid, query tools free (D-019), `ChangeSource` abstraction
    (D-020), intelligence artifact caching (D-021).
  - Risks **R-17 ~ R-21** in `RISKS.md`.
  - `packages/core/src/schemas/intelligence/`: versioned Zod schemas
    for `RepositoryMap`, `SymbolMap`, `DependencyGraph`,
    `ArchitectureGraph`, `ChangeImpact`, `AgentContextPack` and
    `EvidenceV2`. Every artifact carries its own `schemaVersion`,
    versioned independently of `Report.reportVersion`.
  - `EvidenceV2` is a strict superset of v1 `Evidence`: `file` and
    `line` survive as optional mirrors, so existing consumers are
    unaffected. `toEvidenceV2` / `toLegacyEvidence` round-trip between
    the two shapes.
- **Web UI redesign (preserve mode) + Simplified Chinese locale.**
  - `apps/web/src/styles.css` rewritten: off-black / off-white instead
    of pure `#000` / `#fff`, desaturated semantic colours, a documented
    radius scale (cards 14px, controls 10px, pills 999px, code 6px),
    two card elevation tiers, focus-visible rings, `:active` feedback,
    `prefers-reduced-motion` handling and a 768px breakpoint.
  - New `apps/web/src/i18n.tsx`: `en` and `zh-CN` dictionaries with a
    Context provider, localStorage persistence and
    `document.documentElement.lang` sync. No new dependency. The
    `zh-CN` dictionary is typed as the English one, so a missing key is
    a compile error.
  - Loading (skeleton), empty (dashed placeholder) and error states
    added; disabled buttons now change colour instead of using
    `opacity`; checklist emoji replaced by a CSS checkmark with an
    `aria-label`; section headings are no longer uppercase tracked
    eyebrows.
  - Every UI string in `App`, `Header`, `StatusBar`, `AuditForm`,
    `ReportView` and `Footer` now goes through the dictionary. Report
    *content* language is still driven by the API `outputLanguage`.
  - Measured with Playwright against system Chrome: card visual
    signatures 1 → 3, minimum text contrast 4.83 → 5.67 (dark mode
    7.53), zero horizontal overflow, zero dead white, zero wrapped
    buttons. `npm run typecheck` and `npm run build` both pass.
- **Launch Readiness layer, P0 (core only).**
  - `packages/core/src/schemas/fix-plan.ts`: `FixPlanSchema` with
    priority `P0|P1|P2`, effort `S|M|L`, status
    `open|resolved|ignored`, mandatory evidence (D-008 extended to
    plans), ordered steps, tests to add, acceptance criteria and a
    ready-to-paste `agentInstructions` block.
  - `packages/core/src/schemas/audit-diff.ts`: `AuditDiffSchema` with
    base/head refs, `scoreDelta`, `dimensionDeltas`, `ruleDeltas`,
    resolved / new / persistent finding ids and an
    improved / regressed / unchanged verdict.
  - `packages/core/src/fixplan/builder.ts`: `buildFixPlan()` and
    `buildFixPlanSet()` derive plans from an existing `Report` with no
    scan, no analyzer, no network and no pipeline call. Priority and
    effort come from severity; evidence is copied from the finding and
    never invented.
  - `packages/core/src/fixplan/template.ts`: deterministic plan text
    plus `renderAgentInstructions()` laid out as Repository / Commit /
    Finding / Evidence / Objective / Steps / Constraints / Acceptance
    Criteria.
  - `packages/core/src/diff/reports.ts`: `diffReports()` compares two
    reports. `ruleDeltas` is computed from the existing
    `ScoreBreakdown.rules[]`, so a score change is attributed rule by
    rule instead of being explained by an LLM.
  - `polishFixPlanSet()` is the only LLM touchpoint: it may rewrite the
    `why` sentence and nothing else. With the default
    `NoopLLMProvider` the output is fully deterministic and
    `llmEnhanced` stays `false`. A failing provider falls back to the
    deterministic text.
  - `Report.reportVersion` stays `'1.0'` and `ReportSchema` is
    untouched, so a fix plan remains an optional derivation rather
    than a required report field.
  - 61 new tests: fix-plan builder 15, templates 11, diff 16, fixture
    coverage + schema boundaries 19. Core suite is now 143 passing.
- **Audit history queries + the `setCommitSha` fix (Step 4).**
  - `JobRepository` gained `listByRepo()`, `listCompletedByRepo()` and
    `findByCommitSha()`, plus an optional `identity` argument on
    `insert()` that fills the new `owner` / `repo` / `mode` / `target`
    columns. Rows inserted without an identity keep NULL and are
    skipped by history queries rather than guessed at.
  - `JobService` gained `listHistory()`, `listCompletedHistory()` and
    `getByCommitSha()`.
  - **Fixed:** `JobService.setCommitSha()` was a no-op placeholder. The
    route resolved the head SHA and then silently discarded it, so the
    worker had to re-resolve it on every attempt. It now persists to
    the `commit_sha` column.
  - The route passes its already-parsed owner/repo down to
    `service.create()`, so `parseRepoUrl` and its host allow-list are
    never duplicated inside the data layer.
  - Verified against a real SQLite database (9 checks): identity
    persistence, identity-less rows staying NULL, newest-first
    ordering, limit handling, completed-with-report filtering, commit
    lookup, and "newest wins" when two jobs share a commit sha.
- **Three free, derived read-only endpoints (Step 5).**
  - `GET /api/v1/audits/{jobId}/fix-plan` — every fix plan for a
    completed audit, derived on read from the stored report. Plans are
    deliberately not persisted: a stored copy would only drift from the
    report it came from.
  - `GET /api/v1/audits/{jobId}/diff?base={jobId}` — before/after
    comparison with rule-level attribution, plus resolved / new /
    persistent findings. Rejects self-comparison and cross-repository
    comparison.
  - `GET /api/v1/repositories/{owner}/{repo}/audits?limit=` — newest
    first history summaries (jobId, commit sha, score, finding count).
    The limit is clamped to 1..100 rather than trusted.
  - None of the three issues a payment challenge, and none can scan a
    repository: the module does not import `AuditPipeline`, a fetcher,
    a queue or a payment adapter, and a test asserts that by inspecting
    the import list.
  - `AuditJobSchema` gained `commitSha` (nullable, default null) and the
    repository row mapper now returns it, so fix-plan instructions can
    name the exact commit.
  - OpenAPI: three new `derived` tag paths.
  - Verified with 14 checks against a real Fastify instance whose
    service stub exposes only read methods — "did it re-scan?" is
    answered structurally, not by inspecting mocks.
- **Web UI: fix plan, audit history and before/after comparison
  (Step 8).**
  - `FixPlanView` renders every plan for a completed audit: priority
    and effort pills, the evidence pointers, ordered steps, tests to
    add, acceptance criteria, the risk note, and the full
    `agentInstructions` block behind a disclosure with a copy button.
  - `AuditHistoryView` lists a repository's audits newest first with
    commit, mode, score and finding count, marking the audit currently
    on screen and offering the others as a comparison baseline.
  - `AuditDiffView` shows the verdict, the overall delta, per-dimension
    deltas, a rule-level table explaining *why* the score moved, and the
    resolved / new / still-open finding groups.
  - Score deltas follow the Chinese market convention — a rise is red, a
    fall is green — using dedicated `--delta-up` / `--delta-down`
    tokens rather than `--ok` / `--bad`, whose meaning is the opposite.
  - A `Report / History / Comparison` tab strip appears once an audit
    has completed; the comparison tab only appears after a baseline is
    chosen.
  - All new strings are bilingual (en / zh-CN).
  - Verified with 13 end-to-end checks in a real browser, including that
    an *unchanged* scoring rule does not leak into the rule-delta table
    and that the flow produces no console errors.
  - Bundle: 172.5 kB (up from 160 kB for three new views); `@octokit/rest`
    still absent, confirming the type-only core import holds.
- **Re-audit endpoint — the loop closes (Step 9).**
  - `POST /api/v1/repositories/{owner}/{repo}/reaudit` runs a fresh
    audit from coordinates the caller already has, so an agent (or the
    UI) can go fix → re-audit → compare without re-typing the URL.
  - It shares the *same* code path as `POST /api/v1/audits`: payment
    challenge, idempotency keys, head-SHA resolution and enqueueing are
    one closure (`handleCreate`), not two copies that drift.
  - `owner` / `repo` must match `/^[A-Za-z0-9._-]+$/`; the constructed
    URL still passes through `parseRepoUrl`, so the host allow-list
    applies here exactly as it does on the normal path.
  - Body is optional; `mode`, `target`, `outputLanguage` and
    `includeLaunchCopy` fall back to the same defaults as the main
    endpoint.
  - OpenAPI documents it under the `derived` tag.
  - Verified with 9 checks, three of which specifically re-test
    `POST /api/v1/audits` to prove the extraction changed nothing: the
    402 challenge, the 202 + enqueue, and the forwarded owner/repo
    identity. Also verified that a re-audit is rejected when the
    repository is outside the host allow-list.
- **MCP: the same loop, for agents (Step 7).**
  - Four new tools. `get_fix_plan` and `compare_audits` are the agent
    equivalents of the derived HTTP endpoints; `list_audit_history`
    removes the need to track job ids by hand; `reaudit_repository` is
    the paid write half of the loop.
  - `reaudit_repository` and `audit_github_repository` share one
    `runPaidAudit()` closure, so the payment handshake, the mock
    auto-verify and the pipeline call exist exactly once.
  - `get_repopilot_capabilities` now returns a `billing` map marking
    every tool free or paid (D-019). Agents on the OKX.AI marketplace
    need this to decide what they can afford to call.
  - Failures come back as structured payloads — `job_not_found`,
    `report_not_ready:<status>`, `base_job_not_found`,
    `invalid_input:…`, `repo_mismatch:…` — instead of thrown
    exceptions, so an agent can branch on them.
  - The free tools call the same pure functions as the API
    (`buildFixPlanSet`, `diffReports`). No second implementation, and
    no repository scan.
  - `JobStore.listByRepo()` added for in-memory history.
  - Verified with 11 checks over the in-memory MCP transport: the tool
    list, the billing map, plan derivation with evidence and agent
    instructions, diff attribution, and every error path.
- **`scripts/intelligence-smoke.mts` (ADR D-029).** Reads real
  repositories with the real loader and checks the four free tools
  against them — the one path the suite cannot reach, because it needs
  the network and every one of the 37 tool tests injects a fake loader.
  It is why the `.js → .tsx` defect above was found rather than shipped
  again. Two repositories by default: `octocat/Hello-World` (one file,
  where an empty graph is a valid answer and must not crash) and this
  repository (a NodeNext monorepo with a React app). 13 checks each.
  Its central check is deliberately **independent of `resolve.ts`**: it
  reads the limitation line, rebuilds the path the specifier points at,
  and asks the file list — a check written against `SOURCE_REWRITES`
  would have agreed with the defect. Run it with
  `GITHUB_TOKEN=$(gh auth token) pnpm intelligence:smoke`; anonymous
  access is 60 requests/hour per IP and one run exhausts it.
  It is `.mts`, not `.ts`: the repo root has no `"type": "module"`, so a
  `.ts` script is compiled as CJS by tsx and `@repopilot/core`'s
  `exports` declares only an `import` condition
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`).

### Changed

- **`FreeCheckOptions` lost three fields that did nothing.** `maxFiles`,
  `maxFileBytes` and `maxTotalBytes` were defaulted, stored on the instance,
  and never read by `run()` — while `apps/api` passed
  `maxFiles: Math.min(200, cfg.MAX_FILES)` into them, so `MAX_FILES` silently
  did nothing on `POST /api/v1/free-check` and looked like it did. Removed
  rather than implemented: the runner reads a tree listing and never
  downloads a file, so the byte bounds had no meaning, and bounding the tree
  by truncating it would turn a cut-off listing into `has-readme: FAIL` on a
  repository that has a README — the false negative this entry point has
  already produced once.
- **The audit tiers are separated by what the report delivers, not by
  claimed analysis depth (R-30).** Both tiers ran every analyzer over the
  same archive and produced the same scores, blockers and findings, while
  `mode` decided the price and three rows of advice. The tiers now differ in
  a way the code implements: `full` carries a `deploymentPlan` and
  `launchCopy`, `quick` carries neither. Everything a reader uses to judge
  the repository — the five dimension scores, the blocker list, the
  documentation gaps, the security findings, the detected stack, the
  recommended tasks, the launch checklist — is identical in both, which is
  the point: a score has to be a property of the repository, not of what was
  paid, or two audits of the same commit would disagree.
  **`Report.reportVersion` is 1.2.** The schema change is additive, so a
  stored 1.1 report still parses and still means "nothing omitted", but the
  *content* of a quick report changed, and `reportVersion` is in the report
  cache key precisely so a build does not serve a report written by an older
  one.
- **The full audit is 0.05 USDT, not 0.10.** The 5x gap described the
  difference the listing claimed. Once the tiers were separated by
  deliverable the honest multiple was the one the deliverables support — a
  deployment plan and a set of launch copy, not a second analysis. Updated
  in `DEFAULT_PRICING`, the API config default, `docker-compose.yml`,
  `env-check.ts`, `docs/API.md`, `docs/MCP_CLIENT_SETUP.md`, `README_OKX.md`
  and the OKX registration checklist.
- **`includeLaunchCopy`'s scope is now declared where the flag is.** It is a
  refinement inside `full`, not a second way to choose a tier: a quick audit
  omits the launch copy whatever it says. The scope lives in `report/tiers.ts`
  next to the tier that owns it, and `docs/API.md` documents it (it previously
  documented the default as `false` while the schema and the route both
  defaulted to `true`).
- **`/api/v1/capabilities` no longer types out the report version.**
  `outputs.report` said "schema (1.0)" while `REPORT_VERSION` said 1.1 — a
  drift recorded as a known residual because nothing compared the two. It now
  reads the constant.
- **The entropy heuristic measures the value of an assignment, not the
  variable name.** `=` is in the candidate character class because base64
  padding ends in it, so `NAME=value` arrived as a single run and the heuristic
  then measured the name as if it were part of the secret. A real audit
  reported `POSTGRES_PASSWORD=repopilot_test` — a throwaway password in a
  developer's `docker run` command — as a 33-character possible API key, of
  which 18 characters were the name. `assignmentValue()` splits the run first,
  and both the length test and the entropy test then run against the value, so
  the reported length is the length of the thing that could be a secret.
  Trailing `=` is stripped before the split so base64 padding is not read as an
  assignment, and the left side must look like a name rather than like data —
  otherwise an opaque token containing an `=` would be split and half of it
  silently discarded. The two thresholds the rule is built from
  (`MIN_TOKEN_LENGTH`, `ENTROPY_FLOOR`) are now named constants, because the
  length floor is read twice: once to build the candidate regex and once to
  re-check the value.
- **`shapes.ts` documents each shape with a run the shape itself suppresses.**
  The module's own prose is scanned like any other source, so citing a bare
  run that the shape does not cover puts a finding *in the file that defines
  the rule* — two of them, both in `shapes.ts`, until this change. The
  citations now read `docs/REPOSITORY_INTELLIGENCE_PLAN.md` rather than the
  bare stem, which is both the accurate filename and a live example.
  `shapes.test.ts` scans `shapes.ts` and fails if that slips.
- **The doc-facts check now declares which blocks each document carries, so a
  deleted block is a failure rather than a silence.** `BLOCK_DOCS` named the
  documents but left the block set implicit, and `checkBlocks()` can only
  compare a block it *finds* — so a document that lost one entirely had nothing
  left to be stale. `docs/RELEASE_CHECKLIST.md` was in exactly that state when
  the scope check was written: reading "(every workspace: )" with no block at
  all, and `pnpm docs:check` green. `BLOCK_DOCS` is now a map from document to
  the block ids it must contain; a declared block that is absent fails, and so
  does a block no document declares. **Verified by mutation: 8 mutations, 8
  caught** — including the `RELEASE_CHECKLIST` case itself. Two of the eight
  passed on the first attempt for the wrong reason (a body that was both
  undeclared *and* stale, so the staleness rule fired instead) and were re-run
  with a correct body so that only the intended rule could fire.
- **The doc-facts check now knows which documents it owns.** Its scope was a
  hand-written list of four files, and `ROADMAP.md` was not on it — so it had
  drifted in exactly the way the fourteen had: "all 5 packages + 2 apps" in a
  repository that has always had three packages, and "5 fixtures" directly
  above six fixture names. Every markdown file in the repository is now in
  exactly one of two lists, `BLOCK_DOCS` or `BLOCK_FREE_DOCS`, and the second
  one carries the reason a document has no generated block. A file in neither
  fails the check, so adding a document forces the question instead of
  defaulting to unchecked (D-034).
- **`fixture-count`, and two more documents inside the block set.** `README.md`
  and `PROJECT_STATE.md` both said "6 sample repos", and `docs/INDEX.md` and
  `docs/MCP_CLIENT_SETUP.md` both said "thirteen tools" — four numbers that
  were correct and that nothing kept correct. The count is generated now, from
  `fixtures/` and from the tool registrations.
- **The documents no longer keep their own copy of a number.**
  `scripts/docs-facts.ts` derives the facts a document states about the code —
  the MCP tool list and count, the compose service table, the workspace package
  names, the workspace count — and writes them into `README.md`,
  `PROJECT_STATE.md`, `docs/ARCHITECTURE.md` and `docs/RELEASE_CHECKLIST.md`
  between `<!-- docs-facts:… -->` markers. `pnpm docs:check` recomputes them and
  exits non-zero on any divergence; `pnpm docs:facts` rewrites them; CI runs the
  check on every push.
  - The 2026-10-01 review found fourteen places where a document disagreed with
    the repository, and nearly all of them were the same shape: a number or a
    name that can be read out of the source tree, typed into a paragraph by
    hand, and then kept in step by discipline. Six of the fourteen are fixed in
    this pass; the generated blocks make the class impossible rather than
    unlikely.
  - Three checks carry no generated block. They assert the `BILLING` map
    against the `server.tool()` registrations; that `docs/INDEX.md` links every
    `docs/*.md` file and that every link resolves; and that every `pnpm <script>`
    a document names exists. The last one had already caught `pnpm start:api`
    and `pnpm start:worker` being documented before they existed.
  - **Verified by mutation, not by inspection: 12 mutations, 12 caught.** Each
    block id was corrupted in both directions (the source moved; the block
    moved), a fake `pnpm` command was added to a document, a docs file was added
    without an INDEX link, an INDEX link was broken, a compose service was
    added, and every marker was deleted. That last one matters most: a
    marker-syntax change that stops the regex matching would otherwise turn
    every block check into a no-op that still prints a green tick (R-26).
  - Two mutations were discarded rather than counted. They failed because pnpm
    itself refused to run, not because the check caught anything — a mutation
    battery that counts those as catches is measuring the wrong thing.
- **Repository content is read in one request instead of one per file
  (ADR D-017, V0.2-c).** This was the V0.2 blocker: `fetchContents`
  issued a `repos.getContent` request per file, and
  `DEFAULT_LIMITS.maxFiles` is 2000, so a full audit could spend the
  whole 60 requests/hour anonymous budget (R-03) on downloading before
  it analysed anything. Repository Map and Symbol Map need to read a
  large number of source files, which is exactly the shape that broke.
  - `git/tar.ts` — a read-only ustar reader. Hand-written rather than a
    dependency because `@repopilot/core` ships octokit, pino and zod
    and nothing else. The format is narrow but not trivial: measured
    against a real 12,577-entry archive (`nodejs/node` v0.12.0), 192
    entries have a path split across `prefix` + `name` and one carries a
    130-character pax `path=`, so a reader that ignored both would
    mis-address 193 of the 12,577. Takes the archive *after* gunzipping,
    so it is pure and testable against a hand-built buffer.
  - `git/tarball.ts` — `extractTarball()` reads the wanted paths out of
    an archive. The archive's wrapper directory is derived from the
    archive and then **checked against the tree the caller already
    listed**, because the shape alone cannot settle it: `src/` +
    `src/a.ts` is a flat archive and `repo/src/a.ts` is a wrapped one,
    and in both cases every entry sits under one directory. Only the
    wanted set can tell them apart, and getting it wrong yields files
    that do not exist in the repository. Files that were not asked for
    are never decoded.
  - `GitHubFetcher.fetchRepositoryContents()` is the one entry point:
    tarball first, then the existing per-file path on failure, with
    `source` and `degraded` on the result. It also refuses an archive
    that parses cleanly but contains none of the listed files — how a
    moved ref would present — rather than returning an empty
    repository. `filterFiles` and `classifyFile` are reused unchanged,
    so the text/binary/ignore policy is identical on both paths.
  - ADR D-024 records one deliberate departure from D-017: the archive
    is decompressed in memory, not into a `mkdtemp` directory. The
    reader needs a contiguous buffer anyway, so writing to disk first
    would add a copy and a cleanup path without lowering peak memory —
    and R-17's disk risk disappears with it. Two caps stand in for it:
    64 MiB compressed, 256 MiB decompressed. Decompression runs off the
    event loop.
  - `degraded` reaches the report as a `limitations` line, because what
    degraded is the request budget, not what the audit saw.
- **The version is `0.1.0-rc.3`, which is what the code has been for two
  weeks.** Three documents written on different days — the `[0.1.0-rc.3]`
  CHANGELOG section, D-023 (2026-09-23) and R-23 — place the standalone worker
  process and the quality-gate dedupe in rc.3, and `apps/api/src/worker.ts` has
  been in the tree since the first commit. The version string is declared in
  six manifests and was bumped in none of them; `PROJECT_STATE.md`,
  `ROADMAP.md` and the release checklist quoted the un-bumped one.
  - `ROADMAP.md` listed the standalone worker as future work for 0.2.0 while
    `CHANGELOG.md` said rc.3 shipped it. The roadmap has an rc.3 section now,
    rc.2 is marked previous, and the 0.2.0 bullet is gone.
  - The two web test fixtures carried the release string. They carry
    `0.0.0-fixture` now: a fixture that names the current version is a second
    copy of it, and it goes stale on every bump.
  - `scripts/mcp-audit.ts` printed a literal version into the footer of every
    report it has ever produced. It reads `package.json` now.
- **`docs/INDEX.md` is checked, not trusted.** It describes itself as "the
  single entry point for every document in the repository". `pnpm docs:check`
  now verifies that it links every `docs/*.md` file and that every link
  resolves, so adding a document without listing it fails the build. The check
  skips `INDEX.md` itself, which is the one document that does not list itself.
- **The web UI has a production home.** Three artifacts disagreed about where
  it lived and none of them served it: the `Dockerfile` built
  `apps/web/dist` into the API image where no process ever read it, both
  reverse-proxy examples proxied `/` to the API and left the UI commented out
  at an `/app/` subpath — a shape that hands a browser the API's JSON service
  index — and `PROJECT_STATE.md` described the first of those as if it worked.
  There is now one public origin, owned by an nginx `web` service built from a
  `web` stage of the same Dockerfile: `/` and `/assets/*` serve the built UI
  with an SPA fallback, `/api/*`, `/health` and `/docs/*` proxy to Fastify, and
  `/healthz` answers from the edge (D-030).
  - The `web` stage is placed **before** `runtime` because Docker's default
    target is the last stage and `docker:check` / `docker.yml` build without
    `--target` expecting the API image. Both now name the target explicitly.
  - `apps/web` keeps `base: '/'`. The sub-path deployment question is closed
    rather than deferred: at the origin root there is no sub-path.
  - The API image no longer carries `apps/web/dist`, and the API is published
    on `127.0.0.1` only in compose.
  - `docs/deployment/nginx.conf.example` and `Caddyfile.example` were rewritten
    to the same routing table, and `docs/DEPLOYMENT.md` gained a *Production
    topology* section. Its compose description was also wrong — it claimed
    `./data/postgres` bind mounts that the compose file has never had.
- **`pnpm compose:check` now checks the topology, not just the YAML.** It
  asserts the `web` service exists on the right build target with a
  healthcheck, that nothing but the edge is published on every host interface,
  and that `deploy/nginx/repopilot.conf` actually routes `/api/`, `/health`,
  `/docs/` and the SPA fallback, forwards `X-Forwarded-For`, and that every
  `include` in it has a file behind it. A compose file is only correct together
  with the config inside the image it builds, and the YAML looks fine on its
  own. It runs in CI now, and seventeen mutations — each a real defect from the
  list above, from D-031, or from the Dockerfile's Node base image, its
  install/build filter lists, its install inputs and its runtime COPY list —
  were reintroduced one at a time and all seventeen were caught.
- **`.github/workflows/docker.yml` runs on push to `main`, and smoke-tests the
  topology rather than each image alone.** It builds both stages, runs them on
  one docker network, and asserts that `/` serves the app shell, `/api/*` and
  `/health` proxy through to the API, a deep link returns the shell instead of
  a 404, and `/healthz` answers from the edge. It was PR-only, so a Dockerfile
  change could merge without its own build ever running. It applies the schema
  before it serves, and it deliberately runs the API in `development` config:
  a production-shaped environment is refused by the R-02 guard before the first
  request arrives, which would have made every routing assertion fail for a
  reason that has nothing to do with routing.
- **The seven documents over 300 lines have a table of contents**, and
  the twelve untagged code fences — ASCII diagrams, directory trees and
  plain command output — are marked `text`. TOC anchors were generated
  with `github-slugger` instead of by hand: a hand-rolled slugger
  disagreed with GitHub on 124 of this repository's 414 headings, so
  every link it blessed would have 404'd.
- **The report view is now the page, instead of sitting underneath the
  pitch for it.** Measured with `playwright-core` against system Chrome,
  on a real 9219px report: the marketing hero (`h1`, 34px) and the input
  form owned the first 741px, so the report began at 8% page depth and
  the document's own title was an `h2` at 20px sitting 612px below a
  sales headline. Ten section headings were all exactly 15px/650 against
  13.5px body copy, and 17 of 18 surfaces shared one identical signature
  (radius + border + background + shadow) because the default card
  carried a shadow too. The fix plan ran 4384px — 47.6% of the page — as
  twelve `article.card` elements whose only two distinct heights were
  343px and 368px. Each change answers one of those measurements:
  - the hero and the form collapse into a `<details>` once a report
    exists, so the report starts at 220px. Every field and every string
    is unchanged; the form is one click away.
  - the repository is the `h1`, with a one-off label above it. **Every
    view now carries its own `h1`** — collapsing the hero would otherwise
    have left the history and diff views with no page heading at all.
  - `--shadow-card` is removed so the single `.card.elevated` surface is
    a visible step rather than one shadow among eighteen.
  - section headings move to 17px, and the seven that sit directly on the
    page get a hairline above them. Still deliberately not uppercase
    eyebrows: ten of those would be a templated rhythm, not hierarchy.
  - findings lose the card surface and become a rail-led list, which
    gives the report two registers — cards summarise, lists enumerate.
  - the fix plan becomes one `<ol>` with a priority rail. `P0`/`P1`/`P2`
    already discriminated (5/4/3) but were buried in two identical pills;
    the rail puts the gradient in the left margin.
  Verified after: report starts at 220px, `h1` is the repository name,
  score 52px against sub-scores' 12px, headings 17px, card count 18 → 6,
  page 9219px → 8609px — with contrast violations, dead panels, wrapped
  buttons and horizontal overflow all still at zero. **Not addressed:**
  the fix plan is still ~48% of the page. Shorter, reordered or
  collapsed-by-default is a decision about the primary deliverable, not a
  styling one.
- **CI actions moved to the first major that runs on Node 24.**
  `actions/checkout@v4 → v5`, `actions/setup-node@v4 → v5`,
  `actions/cache@v4 → v5`, `actions/upload-artifact@v4 → v6`. The `@v4`
  majors target Node 20 and were being forced onto Node 24, so every run
  carried a deprecation warning. `upload-artifact@v5` still declares
  `node20` in its `action.yml`, which is why v6 and not v5 is the first
  version that clears it — verified per tag by reading `runs.using`
  rather than trusting the release notes. `docker.yml`'s checkout was on
  the same `@v4` and moved with it.
  - `setup-node` sets `package-manager-cache: false`. From v5 it caches
    automatically whenever `package.json` declares `packageManager`, and
    the root declares `pnpm@11.11.0` — so the default would have added a
    second pnpm-store cache beside the explicit `actions/cache` step.
    One cache, keyed the way the workflow chooses.
  - Both workflows were parsed and their step wiring asserted after the
    edit, because a workflow that fails to parse fails every run in 0s
    with no logs — a failure mode this repository has already hit.
- **`jobs` table gained repository identity columns** — `owner`,
  `repo`, `commit_sha`, `mode`, `target` — plus two indexes
  (`idx_jobs_owner_repo_created`, `idx_jobs_commit_sha`), on both
  SQLite and Postgres. This is what makes audit history and
  before/after comparison queryable without scanning `input_json` on
  every request. All five columns are nullable, so rows written before
  the migration keep NULL and are excluded from history queries rather
  than being guessed at. No existing column was modified. The migration
  is idempotent and was verified against a real SQLite database,
  including an in-place upgrade of a pre-migration table and an
  `EXPLAIN QUERY PLAN` assertion that the new index is actually chosen
  by the planner.
- **`apps/web` now imports report types from `@repopilot/core`.**
  `lib/api.ts` previously kept a hand-copied duplicate of `Report`,
  `Finding` and `Evidence`, which meant a schema change would not
  surface in the UI. The import is type-only so `@octokit/rest` never
  reaches the browser bundle (verified: 160 kB, unchanged). Transport
  contracts (`Health`, `AuditResponse`) stay local because they
  describe HTTP, not the report schema.
- `get_repopilot_capabilities` gained a `billing` field. The three
  original MCP tool signatures are unchanged.
- Nothing else changed in the existing API surface or report schema.

### Fixed

- **The free check's test suite did not test the free check (R-35).** The
  "FreeCheck heuristics" cases built their own `README_NAMES`,
  `LICENSE_NAMES`, `LOCKFILE_PATTERNS` and `entries.find(...)` inside the
  test bodies, then asserted on those, so every assertion was about code
  written in the test file. Measured: with `LOCKFILE_PATTERNS` emptied in
  `free-check.ts`, the old file passed **5 of 5**. The two cases that did
  reach the real runner were URL rejections, which return before any network
  call. The file now drives the shipped runner through `FreeCheckSource` —
  26 cases over the five checks, the score arithmetic, the evidence strings,
  the branch-resolution order, the metadata-failure fallback and the stack
  detection. Verified by mutation: emptying the lockfile rules fails 8
  cases, reading a fixed `main` instead of the reported branch fails 1, and
  returning the first match instead of the shortest path fails 1.
- **Two `free_check` evidence strings named a place the check never looked.**
  `has-readme` and `has-license` match a basename at any depth, so a
  repository with `docs/README.md` passes; the failure message said "at the
  repository root". It now says "anywhere in the repository". A limitation
  the new tests record rather than hide: the lookup compares names exactly,
  so `Readme.md` is not recognised. Widening it changes the paid audit's
  scoring too — both read `README_FILENAMES` — so it is marked with
  `it.fails` and left for its own change.
- **The entropy heuristic no longer fires on the wordlist that defines the
  mnemonic rule (R-29).** The rule's candidate regex is "twelve lowercase
  words" and `bip39-english.ts` is a file of twelve-word lines, so the rule
  reported its own dictionary: **165 critical findings**, and in this
  repository's self-audit that was the single largest contributor to
  `securityHygiene: 0`. No per-match check can separate the two — the match is
  identical — so the distinguishing fact is about the *file*: a seed phrase is
  a line in a document, a wordlist is a file whose every word is a BIP-39 word.
  `isWordlistFile()` asks that, and a new `skipFile` gate on the pattern makes
  it inapplicable to such a file. Deliberately a property of the content
  rather than of the path: a path exclusion would miss a wordlist fetched to a
  temporary directory, renamed, or vendored. Threshold measured rather than
  guessed — the wordlist scores **0.956**, the next-highest of the 248 tracked
  files with at least 50 words scores **0.447**, and nothing measured lands
  between them, so the band is wide and 0.75 is its midpoint.
  **The first version of this fix missed the history path**, and the audit
  caught it: `securityFindings` stayed at 7 with a `critical` finding against
  `bip39-english.ts` in commit `82a244c`, and the report's headline read "Top
  blocker: Secret in commit history: Possible seed phrase". The history
  scanner scans a patch one added line at a time, so a file-level question was
  being asked of a single line — and twelve words is below the floor
  `isWordlistFile` needs before it will judge anything, so the answer was
  always no. `scanTextForSecrets` now takes the text a file-level judgement
  should be made against (`fileContent`), separately from the text being
  scanned, and the history scanner passes the whole patch. A patch is the
  widest sample that path has, and for the commit that adds a file it *is* the
  file. A test pins both directions: a commit that adds a wordlist reports
  nothing, and a single phrase added to an ordinary file is still reported.
- **`limitations` no longer claims a cap that did not bite (V0.2-d
  review).** Found by re-reading the builder rather than by a failing
  test, and fixed together with the tests that would have caught it.
  - The entrypoint cap was decided from
    `entrypoints.length >= MAX_ENTRYPOINTS` while the producer truncates
    on `>`, so a repository with exactly fifty entrypoints was told
    "Entrypoints are capped at 50; there may be more" about a list that
    was complete. The length cannot settle it — fifty entries is either
    fifty or the first fifty of more — so `detectEntrypointSet()` returns
    `{ entrypoints, total, truncated }` next to the unchanged
    array-returning `detectEntrypoints()`, and the limitation follows
    `truncated`.
  - The dependency cap compared the **pre-dedupe** declaration count
    against the cap while slicing the **deduplicated** list. A manifest
    set declaring 600 entries that deduplicate to 450 was told "Only the
    first 500 of 600 dependencies are listed" — a truncation that never
    happened, with both numbers wrong. `collectDependencies()` now
    returns `{ dependencies, total, truncated }` like `listFiles()` does,
    and `countDependencies()` is deleted.
  - A capped module list produced two `limitations` lines for one fact:
    one from `detectModules()`, which knows the true total, and one from
    `buildLimitations()`, which did not. The second is gone.
  - This matters more than a stray line usually would, because
    `limitations` is the artifact's honesty channel: a reader who catches
    one untrue line stops believing the rest.
  - **Test baseline: core +5** (545 → 550), four of them stating that a
    cap is reported only when it actually cut something.
- **`docker compose up -d` brought up a deployment that could not audit
  anything.** Neither `server.js` nor `worker.js` applies migrations, so a fresh
  stack ran against an empty database: the `/health` probe (`repo.list(1)`)
  threw `no such table`, `/health` answered `degraded` forever, and every audit
  POST failed at the database layer — while every container reported healthy,
  because `/health` returns HTTP 200 either way. `docker compose ps` showed a
  full set of green ticks. The docs had prescribed "run `pnpm db:migrate`
  once", which cannot be run in the runtime image: it carries `dist/` and
  `node_modules/` but no `tsx`, which is what the script shells out to. There
  is now a one-shot `migrate` service running `node
  apps/api/dist/db/migrate.js`, and both `api` and `worker` wait on it with
  `service_completed_successfully` (D-031). Re-running is a no-op — every
  statement in `runMigrations` is `IF NOT EXISTS`. `compose:check` asserts the
  ordering, and four mutations cover it (M9–M12). R-25 records the residual
  risk for the three deployment shapes that are not compose.
- **The single-image Docker instructions could not start.** The documented
  `docker run` set `NODE_ENV=production` with `PAYMENT_MODE=mock`, which
  `validateProductionConfig` rejects outright (R-02) — and it also omitted
  `AUDIT_QUEUE_DRIVER`, whose `inline` default is rejected in production for the
  same reason. It now runs as `NODE_ENV=development`, applies the schema first,
  and states what a production config actually requires. The Railway and Render
  sections gained the migration step they were missing.
- **`PROJECT_STATE.md` claimed `POST /api/v1/audits` answers "200 + report
  after X-PAYMENT replay".** It answers 202 with `statusUrl` and `pollAfterMs`,
  which is what D-015 says and what `routes/audits.ts` does. The same list said
  the OpenAPI document is "consumed by web UI"; the web client never fetches
  it. Both corrected.
- **The documentation index now covers every document it claims to.**
  `docs/INDEX.md` opens with "the single entry point for every document
  in the repository" and did not link six of them — including
  `DECISIONS.md`, the largest file in the repo at 1118 lines. The ADR
  log, the risk register and the changelog now sit under a new *For
  reviewers / auditors* section, and *Design intent* names the second
  overlapping cluster (`ROADMAP` / `BACKLOG` / `PROJECT_STATE`, which
  all answer some form of "what's next") with a precedence rule for
  each pair.
- **A `quick` report no longer claims an analysis was thinned (R-30).** The
  sentence `Quick scan skips some of the deeper reproducibility heuristics.`
  was false: `reproducibility` scored 28.5 in both modes and no analyzer
  consulted the mode. It is replaced by one generated from
  `FULL_ONLY_SECTIONS`, so it names what the tier actually omits. Nothing
  pinned the old sentence — it occurred in `builder.ts` and in generated
  audit artefacts and nowhere else — which is how it survived; `tiers.test.ts`
  now fails if any limitation line matches `/skip|deeper|thinner/i`.
- **`MARKETPLACE_LISTING.md` no longer sells the full tier as a deeper
  analysis.** It promised "the deeper reproducibility and Web3 analyzers" in
  English and in Chinese. The Web3 analyzer runs in both modes and there was
  no deeper reproducibility pass, so a 0.10 buyer received the same numbers
  as a 0.02 buyer. Both descriptions now state the deliverable difference,
  and `screenshots/README.md` — the third place that described the two modes
  with the same wrong theory, "same content here, repo is too small to
  differ" — says what actually differs and marks the stored artefacts as a
  record of what the tool said before the fix.
- **`ROADMAP.md` was outside the document check, and had drifted.**
  - "all 5 packages + 2 apps" — `packages/` has held three since the first
    commit, so this was never true rather than merely stale.
  - "5 fixtures: complete / minimal / no-readme / prompt-injection /
    secret-leak / web3-hackathon" — five, above six names.
  - `docs/REPOSITORY_INTELLIGENCE_PLAN.md` said "5 个 fixtures" in a boundary
    table. There are six.
  - The historical sections were left alone. A record of what rc.1 shipped may
    say "3 tools" and be right; a current-state claim may not.
- **`docs/RELEASE_CHECKLIST.md` carried an empty generated block.** The build
  line read "(every workspace: )" — the marker pair had been removed and the
  sentence left behind. `docs:check` could not see it, because it compares the
  blocks it finds and there was nothing to find.
- **`PROJECT_STATE.md` said it was last updated 2026-09-28** while its own test
  baseline said 2026-10-02, and its Contents entry for that baseline did not
  match the heading it pointed at.
- **`README.md` listed four scripts out of twelve** in its layout tree, and
  three `docs/` files out of twelve. Both lines point at the authoritative list
  now instead of keeping a partial copy of it.
- **Root `dev:api` started the wrong process.** It was
  `pnpm --filter @repopilot/api dev`, and that package's `dev` script is
  `REPOPILOT_API_MODE=combined`. So the root script named `dev:api` started the
  combined API+worker process — the opposite of the same-named script inside
  `apps/api`, which is `REPOPILOT_API_MODE=http`. It is
  `pnpm --filter @repopilot/api dev:api` now. Found by the new
  `pnpm docs:check` command-reference check, which had been written to catch a
  documented command that does not exist and caught a real one that did the
  wrong thing.
- **Six documentation contradictions with the code.**
  - `README.md` said the MCP server "exposes seven tools". It exposes thirteen,
    and the same file already said thirteen in its layout section.
  - `README.md` said "a background worker is on the P1 backlog". The worker
    exists — `apps/api/src/worker.ts`, the `worker` compose service, and a
    documented split deployment shape — and the bullet also claimed `mode:
    'full'` "runs synchronously inside the HTTP request", which the 202 shift
    ended.
  - `docs/ARCHITECTURE.md` said "all seven analyzers run in parallel". They run
    in sequence, synchronously, and there are nine of them. The order is
    load-bearing: `analyzeHackathon` consumes the chains and contract addresses
    `analyzeWeb3` produced. The document now names the nine calls in order and
    claims no count, because "how many analyzers are there" has three defensible
    answers — eight modules in `analyzers/`, nine calls in `ReportBuilder`, and
    `metadata.ts` called by the pipeline rather than the builder.
  - `docs/ARCHITECTURE.md` described `apps/api` worker mode as "(Future)". It
    shipped in 0.1.0-rc.3.
  - `PROJECT_STATE.md` listed three MCP tools. The list is generated now.
  - `docs/RELEASE_CHECKLIST.md` stated a test baseline of 104/104 in dev and
    106/106 in CI. The checklist no longer repeats a number at all;
    `PROJECT_STATE.md` owns the baseline, and the checklist points at it.
- **The high-level diagram in `docs/ARCHITECTURE.md` was ragged.** Four lines of
  the analyzer box were 68 characters where the other nine were 67, so the
  right-hand border sat one column out. It had been that way long enough to be
  invisible. The tool box below the diagram is generated now, so its borders
  cannot drift from its contents.
- **The Docker image had never built.** `FROM node:20-alpine`, against a
  `packageManager` of `pnpm@11.11.0` — which does not run on Node 20. `pnpm
  install` died partway through the builder stage with
  `ERR_UNKNOWN_BUILTIN_MODULE`, so `docker build .` failed in about 17 seconds
  and had done since the initial import. Nothing surfaced it because the only
  workflow that builds an image was PR-only, and the repository has had no PRs;
  `docker:check` skipped its build step without a Docker CLI, which is the
  situation on every machine that has run it. Both stages are now Node 22 —
  the version `.github/workflows/ci.yml` already tests on — and `engines.node`
  moved from `>=20.0.0` to `>=22.0.0` to state the requirement instead of
  leaving it implicit. The two stages have to agree, not merely be recent
  enough: `node_modules` is copied from `builder` into `runtime` and carries a
  compiled `better-sqlite3`, so a split major fails at *runtime* with
  `NODE_MODULE_VERSION`.
- **The builder compiled `@repopilot/web` without ever installing it.** The
  `pnpm install --filter` list named four packages and the `pnpm --filter ...
  build` list named five, so `tsc && vite build` ran against a missing
  `node_modules` and died with `TS2688: Cannot find type definition file for
  'vite/client'` — a full stage after the install had succeeded, which is why
  it read as a web problem rather than an install problem. Both lists are
  hand-maintained in one file and nothing kept them in sync; `docker:check` now
  asserts that everything the builder builds it also installs.
- **The runtime image did not contain `better-sqlite3`.** `.npmrc` — which
  carries `shamefully-hoist=true` — was not copied before `pnpm install`, only
  by the later `COPY . .`, so the image installed with different resolution
  settings than every other install in this repository. Without hoisting, the
  native module and the `@repopilot/*` workspace links live in each package's
  own `node_modules`; the `runtime` stage copies the root one and nothing else,
  so the container built cleanly and then died at startup with
  `ERR_MODULE_NOT_FOUND: Cannot find package 'better-sqlite3' imported from
  /app/apps/api/dist/db/client.js`. `.npmrc` now arrives before the install,
  and `docker:check` asserts that every file which changes how `pnpm install`
  resolves dependencies is copied first. The first version of that check
  searched the whole prefix rather than only `COPY` instructions and passed on
  a comment that mentioned `.npmrc` — which is the same mistake one level up.
- **The runtime image copied each package's `dist` but not its `node_modules`.**
  pnpm does not hoist a sub-package's dependencies to the workspace root —
  `shamefully-hoist` only affects the root project's own dependencies, so the
  root `node_modules` in this workspace holds five entries and no
  `better-sqlite3` at all. `apps/api/node_modules/better-sqlite3` is a symlink
  into the root `node_modules/.pnpm/...` and
  `apps/api/node_modules/@repopilot/core` is a relative link to
  `../../../../packages/core`, so the image built cleanly and then died on its
  first import with `ERR_MODULE_NOT_FOUND`. The per-package directories are
  symlink farms — 40K, 24K, 20K and 16K — and are now copied alongside each
  `dist`; the relative link targets resolve because the root `.pnpm` store is
  copied too. Verified by reproducing the runtime layout on disk and starting
  the real server in it: `/health` answers `status: ok` and
  `/api/v1/capabilities` answers 200. `docker:check` asserts that every package
  whose `dist` reaches the runtime stage also has its `node_modules` copied.
- **`docker:check` could not fail.** `err` printed a red ✗ and the script
  still exited 0, so every static assertion in it — including "the Dockerfile
  is present" — was advisory. It now counts errors and exits 1 before the
  build half, and `ci.yml` runs it on every push. It also gained a check that
  the Node base image matches `engines.node` and that no two stages disagree;
  both were falsified (splitting the majors, and raising `engines.node` above
  the image, each exit 1).
- **`docker:check`'s own smoke test could not start the container.** It ran
  the API with `NODE_ENV=production` and `PAYMENT_MODE=mock` — rejected
  outright by `validateProductionConfig` (R-02) — and omitted
  `AUDIT_QUEUE_DRIVER`, whose `inline` default is rejected for the same
  reason. It now runs in `development` config and migrates before serving,
  matching `docker-compose.yml`.
- **A failed audit told the user to submit a repository.** `App.tsx`
  rendered the empty state on `!report && !loading` without also checking
  `!error`, so a job that came back `failed` — or a request that never
  reached the server — showed "No report yet · Submit a public GitHub URL
  above to generate the first audit" directly beneath the error card. The
  user had just done exactly that, and the second message buried the
  first. `FixPlanView` already guarded its empty state with `!error`; the
  shell now follows the same rule. Found by the new web test suite, which
  had been asserting the wrong copy as-is until the fix landed.
- **The web UI never rendered a report, from the first commit onward.**
  `POST /api/v1/audits` is asynchronous by design — `InlineAuditQueue`'s
  own comment says `enqueue()` "schedules the job on a small, bounded
  worker pool and returns immediately. The HTTP request never waits for
  the analysis" — so settling the 402 challenge answers `202` with
  `statusUrl` and `pollAfterMs`, both `required` in `openapi.ts`.
  `onSubmit` handled a synchronous `report` and an `error` and nothing
  else, so a queued response matched neither branch and was discarded.
  Clicking **Run Quick Scan** therefore produced no report, no error and
  no message: the button flickered and the page stayed on "No report
  yet". Reading the report is a separate `GET`, and that step was missing.
  `AuditResponse` was wrong in three ways, which is why the compiler did
  not catch it: it omitted `statusUrl` / `pollAfterMs` (required by the
  schema), typed `error` as `string` where the route sends
  `{ code, message }`, and claimed a queued response might carry a
  `report`. The type is now a discriminated union over `status` matching
  the routes, and `settleAudit()` / `waitForReport()` own the polling so
  the UI has a single entry point; `onRefresh` polls too, because the user
  may click it the moment payment lands while the worker is still running.
  Verified against the running API: `402` → replay `202 queued` → `GET`
  `completed` with a real report. The consequence for earlier work is
  worth recording: because the async contract and the UI's synchronous
  assumption both date from the initial commit, **every previous audit of
  the report view was taken on a view that never rendered**.
- **The overall score rendered at 12px, the same size as the sub-scores
  it summarises.** `ReportView` rendered
  `<div className="score"><span className="pill">{n}</span></div>`.
  `.score` declared `font-size: 44px` but had **no text node of its own**,
  so the `.pill`'s 12px won and the 44px was dead CSS — measured as
  `wrapper 44px / pill 12px / wrapper text nodes ""`. The number now
  carries the type and the semantic colour at 52px, a 4.3x step against
  the sub-scores' 12px.
- **`.js` names `.tsx`, and `SOURCE_REWRITES` only knew about `.ts`
  (ADR D-029).** `Header.tsx` compiles to `Header.js`, so a React project
  on NodeNext writes `import { Header } from './components/Header.js'`
  for a file called `Header.tsx` — the convention D-001 already requires.
  The rewrite table held a single target per emitted extension, so
  **all nine such imports in this repository were reported as unresolved
  relative imports** while extension-less ones resolved fine. The table is
  now a fan-out (`.js` names `.ts`/`.tsx`/`.js`/`.jsx`; `.jsx` names
  `.tsx`/`.jsx`; `.mjs` names `.mts`/`.mjs`; `.cjs` names `.cts`/`.cjs`).
  Measured on this repository: unresolved relative imports 9 → 0,
  dependency-graph limitations 21 → 2, edges 470 → 488, nodes 205 → 206.
  Found by running the four free tools against a real repository, not a
  fixture — the fixture set contains no `.tsx` or `.jsx` at all, so the
  shape that finds this defect was not representable in it. The guard is a
  resolver unit test, not a snapshot: a snapshot records behaviour, not
  correctness, and would have recorded the missing target as expected.
- **`symbols.degraded` / `RepositoryContext.degraded` were documented
  more narrowly than they behave.** Both are deliberately wider than
  `languageCoverage[*].degraded` — they also cover a language with no
  extractor, an oversize file that was skipped, and a capped symbol list.
  Four tests pin the wide meaning; the comments were corrected rather than
  the code, because narrowing it would have made `get_symbol_map` return
  500 of 2062 symbols while reporting `degraded: false`.
- **Two credentials on one line satisfied a contract that allows one
  (R-23, ADR D-023).** `collectFindings()` deduplicated on
  `findingKey()` alone. A fingerprint is resolved rule id plus evidence
  locations — deliberately coarse so a finding that merely moved does
  not read as one fix plus one new problem — so two *different* hits of
  one rule at one `file:line` are one fingerprint. `scanTextForSecrets`
  emits one hit per matching pattern with no per-line dedupe and every
  `secret-` slug resolves to `SEC-SECRET-001`, so an AWS key and a
  Stripe key on one line are two findings with two ids and one
  fingerprint. `securitySection` compares the collected count against
  `security.maxSecrets`, so with `maxSecrets: 1` the pair was counted as
  one and the check passed. The key is now the pair `(findingKey, id)`,
  which is strictly finer than either half: it cannot merge anything the
  old key kept. The default contract (`maxSecrets: 0`) could not flip,
  which is why this never blocked a real run — the false pass needed a
  non-default `maxSecrets` or `maxCritical`. `collectFixableFindings`
  already deduped on `id`, so the fix plan and the gate now agree on how
  many findings a report carries. Reverting the key fails exactly 2 of
  `contract.test.ts`'s 48 tests.
- **`disableRequestLogging` removed — it emitted FSTDEP023 on every
  boot.** `apps/api/src/server.ts` set `disableRequestLogging: false`,
  which is Fastify's default; the line existed only to say so out loud.
  The option is deprecated in fastify@5 and will be removed in
  fastify@6, and it warns on *presence* rather than on value
  (`fastify.js`: `if (options.disableRequestLogging !== undefined)
  FSTDEP023()`, while `config-validator.js` fills in `false` when the
  option is undefined). So the declaration produced a deprecation
  warning on every server start while changing nothing. Omitting it says
  the same thing — request logging is still on: the integration suite
  emits 118 `incoming request` lines with the option gone, and no
  `FSTDEP` warning remains.
- **An unreachable GitHub was recorded as the commit `'unknown'`.**
  `POST /api/v1/audits` resolves the head SHA before enqueueing and
  fell back to the string `'unknown'` when both `main` and `master`
  lookups failed. `commit_sha` is nullable and `getByCommitSha` filters
  on it, so the sentinel read as a real SHA to anything looking a job
  up by commit — and it was written into a column whose NULL is
  meaningful. The fallback is now `null`, and
  `JobService.setCommitSha()` takes `string | null` to make that
  explicit at the call site.
- **One generated file could zero a score dimension (R-22, ADR D-022).**
  `severityPenalty()` summed `SEVERITY_PENALTY` over every finding with no
  bound on how many one file could contribute. A lockfile is mostly
  `sha512-` integrity digests, which are high-entropy by construction and
  so match the generic secret heuristic; `severityForPath` downgrades them
  to `low` rather than dropping them, so hundreds stayed in
  `securityFindings` at 1.5 points each. Measured on a repository whose
  only files were a lockfile, a README, a LICENSE and a one-line source
  file: `securityHygiene: 0`, `overall: 53.7` — 25 points below the same
  tree without the lockfile. The quality contract was already immune (it
  counts only `critical` and `high`); the score was not.
  - The penalty now caps each `(file, ruleId)` pair at
    `MAX_PER_GROUP` (3) findings, worst severity first. Breadth is
    untouched: a hundred secrets in a hundred files still costs a hundred
    penalties, and only repetition *inside* one file is bounded.
  - The group key is the **resolved** rule id, never the finding `id` —
    a secret finding's id embeds its line number, so keying on it would
    give every hit its own group and the cap would never apply.
  - The reason text now says "at most 3 counted per file and rule" when
    the cap bites, so a penalty smaller than the finding count is
    explained rather than mysterious.
  - `packages/core/src/scoring/penalty-cap.test.ts` pins both
    directions: the cap holds, and breadth still scores. Reverting the
    cap fails 7 of its 8 tests.
- **The secret heuristics were precise enough to be worth reading.**
  Auditing three real repositories (`octocat/Hello-World`, `pinojs/pino`,
  and this one) produced 676 findings, of which every hand-checked one was
  false. Not one was a credential. Five separate causes:
  - The mnemonic rule was "twelve to twenty-four lowercase words", which
    is a description of English. It is now a BIP-39 lookup
    (`security/bip39-english.ts`, 2048 words) over sliding windows of the
    valid lengths, so `chance` and `properties` are not seed phrases.
    `abandon ability able …` still is.
  - The generic high-entropy rule included `/` in its match class, so URL
    path segments cleared any threshold: `com/nodejs/node/blob/main/SECURITY`
    and `fastify/github-action-merge-dependabot`. URLs are now stripped
    before the entropy pass.
  - `sha512-<base64>` integrity digests are high-entropy by construction;
    557 of the self-audit's 639 findings came from one `pnpm-lock.yaml`.
    Digests are now skipped **by name** (`sha512-`, `md5:`, `integrity:`)
    rather than by dropping lockfiles from the scan — the existing rule
    deliberately *downgrades* rather than hides a credential in a
    lockfile, and that is preserved.
  - Placeholder detection was an enumeration (`your-key`, `your_key`) and
    always missed the next member of the family. `password: 'your-password'`
    in pino's own docs was reported as a hardcoded credential. It is now a
    pattern (`/your[-_]?(?:key|token|password|…)/`).
  - Identifier-shaped runs (`fastify/github-action-merge-dependabot@v3`)
    are now excluded from the entropy path.
  - Verified against real pino files: `README.md` 1 → 0,
    `docs/transports.md` 13 → 1, `docs/asynchronous.md` 2 → 0,
    `.github/workflows/ci.yml` 1 → 0. The survivor is
    `botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"` in
    `pino-telegram-webhook`, which is the string Telegram's own
    documentation uses — an inherent residual of the unknown-format
    catch-all, not a miss.
- **Two existence questions were being asked of the wrong list.** The
  screenshot check could never pass:
  `entries.some(e => /\.(png|jpe?g|gif|webp|svg)$/i.test(e.path))`, where
  `entries` came from `filterFiles`, which drops every extension in
  `BINARY_EXTENSIONS` — including all five of those. The self-audit
  reported "no image files in repo" about a repository with four. The only
  branch that could ever succeed was a `.svg` under 4 KB, since `.svg` is
  not in the binary list. `analyzeDocumentation` and `analyzeHackathon`
  now take the whole tree for existence questions and `fileContents` for
  content questions, and `ReportBuilderInput` carries both. The split
  needs one guard: a README that exists but was skipped — oversized, or
  dropped by a total-bytes cap — must not be reported as "0 characters
  long", so the content check requires the content and not merely the
  path.
- **Fixture trees were being read as evidence about the project.**
  RepoPilot audited itself as `Solidity, Foundry` and then ticked
  `[x] Contracts covered by tests (Foundry / Hardhat)` — a green tick over
  a capability that does not exist, taken from `fixtures/web3-hackathon/`,
  a fake Solidity project inside its own test suite. A false tick is worse
  than a false alarm: a reader questions an alarm, and nobody questions a
  green tick. Stack and web3 detection now skip
  `fixtures?` / `__fixtures__` / `test-data` directories, using a
  predicate deliberately narrower than `isFixturePath` — that one includes
  `test/`, and a repository's own `test/Counter.sol` really does mean the
  project is Solidity.
- **Two entry points disagreed about what a README is called.**
  `free-check` accepted a bare `README`; the full audit did not. That is
  not hypothetical: `octocat/Hello-World` — the repository this project's
  own MCP script audits by default — has exactly one file, called
  `README`. The free check said `has-readme: PASS` while the paid audit
  reported `[high] README.md is missing or empty` as its top blocker and
  dropped the documentation score to 5.5. The license lists differed too
  (`COPYING` against `LICENCE`). Both now read one set of constants in
  `utils/paths.ts`, which are the unions, so unifying made neither entry
  point stricter than it already was.
- **The launch checklist inlined every finding title.** Its two
  finding-backed rows mapped findings to titles one for one, so the
  self-audit printed a single line holding 639 of them — roughly forty
  wrapped rows in a terminal, from which only the row's own verdict
  ("no committed credentials: failed") survived. Evidence is now folded by
  (file, rule), worst severity first, capped at five groups with the
  remainder reported as counts of groups and of findings:
  `High-entropy string ×557 in pnpm-lock.yaml`. On the 2026-10-01
  self-audit data, 639 findings and 41 groups become six lines.
- **The prompt-injection detector fired on its own source.** The
  self-audit flagged eleven files and ten were false: `security/injection.ts`
  (the keyword table, matched against itself), its own test suite,
  `llm/prompts.ts` (`{ system: string; user: string }` — a TypeScript type
  annotation), and `contract as the parent`, where "act as" is a substring
  of "contract as". pino's one hit was a benchmark script printing
  `` `System: ${type()}/${platform()}` ``. Three changes, with two
  different scopes on purpose:
  - Instruction phrases are looked for in **prose documents only**. An
    instruction aimed at the reader of a report has to live where a reader
    looks, and scanning code made the rule fire hardest on the repositories
    that build language-model features — which is the audience.
  - Phrases match on **word boundaries**, so `act as` no longer reads out
    of `contract as`. Role markers (`system:`, `assistant:`) must **open a
    line** and be followed by content; as substrings they are a JSON key, a
    type annotation, a log label.
  - Invisible and bidirectional characters are still looked for in **every
    file, source included**. A bidi override in source is Trojan Source,
    and that is a source-level problem rather than a prose one.
  - Replayed over this repository: 736 files, 4 findings, all four in the
    deliberately planted `fixtures/prompt-injection/README.md`. Eleven
    files and about thirty findings before.
  - Recorded, not fixed: the audit prompt carries repository metadata and
    no file content, so the only repository text that can reach a model
    today is its GitHub description, and that is not scanned (R-08).
- **A test carried a thirty-five-line second copy of the scoring rules
  that nothing read.** `pipeline-fixture.test.ts` built a whole
  `ScoringInput` by hand and never used it; one of its predicates asked
  `filterFiles`' output whether a `.png` existed, which is precisely the
  defect the screenshot fix was about. The copy outlived the fix because
  fixing one copy of a rule does not fix the other. The dead block is
  deleted rather than updated, and the test now asserts on the analyzers'
  own outputs so those calls stay live.
- **The score breakdown asserted things that were not true.** It emitted
  every rule with `delta: 0` for the ones that did not fire, keeping the
  rule's penalty-shaped text — so a real report contained
  `{ rule: 'no-readme', delta: 0, reason: 'README.md is missing' }` about
  repositories whose README exists and contributes nothing. The reason
  asserts a falsehood, and `delta: 0` beside a rule named `no-readme`
  reads as "this problem is free". The breakdown now lists only the rules
  that fired, which is what `computeRuleDeltas` already assumed when it
  reads `b?.delta ?? 0`, and what the test's own name — "breakdown records
  every applied rule" — already claimed. Found by reading a real audit's
  JSON, not by reading the code.
## [0.1.0-rc.3] - 2026-07-19

### Added

- **Standalone worker process.** The audit worker no longer has to
  live inside the API process. New `apps/api/src/worker.ts` entry
  point; shared `apps/api/src/queue/build-queue.ts` factory. The
  API process and the worker process are now first-class deployment
  units.
  - New `pnpm dev:api` / `dev:worker` and `start:api` / `start:worker`
    scripts. `pnpm dev` and `pnpm start` keep the legacy combined
    behavior for backward compatibility.
  - `PgBossAuditQueue` accepts a `consume: boolean` flag; the API
    process passes `consume: false` so it only enqueues, the worker
    process is the sole consumer.
  - The `REPOPILOT_API_MODE=http` env var toggles the API to
    enqueue-only mode. Combined with `AUDIT_QUEUE_DRIVER=pg-boss`
    this is the production deployment shape.
  - The API refuses to start in `http` mode with the inline driver:
    the inline queue is in-process and the dedicated worker would
    never see the enqueued jobs.
  - 4 new tests in `apps/api/src/worker.test.ts`.
  - `verify:release` still runs in combined mode (the legacy
    default) and is fully green; the new mode is opt-in for
    production deployments.

## [0.1.0-rc.2] - 2026-07-19

### Fixed

- **AuditWorker error classification was case-sensitive.** The regex
  `/not found|404/` in `AuditWorker.classify()` did not match
  GitHub's actual error string `"Not Found - https://docs.github.com/.../...get-a-repository"`,
  so 404s fell through to the default `UPSTREAM_FAILED` (retryable=true).
  The inline audit queue has no retry loop, so the job stayed at
  `status=processing` until the test timeout (90s). The
  `POST /audits (404 repo, GET → failed)` smoke step failed
  twice in a row before the fix. Patched: regex now has the `/i`
  flag, all three classification rules normalised. Rebuilt API;
  `pnpm verify:release` now reports 1434ms for that step and the
  full 17-step suite is all green.

### Added

- **Production guards (R-02 mitigation).** `NODE_ENV=production` +
  `PAYMENT_MODE=mock` now fails the application start with a clear,
  secret-free error message. Implemented in the unified config schema
  (`apps/api/src/config.ts`); not a soft warning, not silent fallback.
  Also enforced by `pnpm env:check`.
- **`AUDIT_QUEUE_DRIVER=production + inline` guard.** When
  `NODE_ENV=production` is set without the explicit
  `ALLOW_INLINE_QUEUE_IN_PRODUCTION=1` override, the app refuses to
  start with the inline queue and instructs the operator to switch
  to `pg-boss`. Enforced both at config load and by `pnpm env:check`.
- **Async audit queue architecture.** New `AuditQueue` interface
  (`apps/api/src/queue/audit-queue.ts`) with two adapters:
  - `InlineAuditQueue` — in-process scheduler for SQLite dev / tests
    / `verify:release`. Bounded concurrency, idempotent at jobId,
    graceful shutdown.
  - `PgBossAuditQueue` — pg-boss 12.26.1 backed, persistent,
    production-grade. Self-managed pool, `application_name` tagging,
    `retryLimit: 1`, `expireInHours` job timeout, `error_code` for
    retry classification.
  Business code (analyzers, scoring, Report Cache, payment adapter)
  does not depend on pg-boss.
- **Single `AuditWorker`** (`apps/api/src/services/audit-worker.ts`).
  Owns the queued→processing→completed/failed state machine, calls
  the existing Report Cache, never bypasses payment, never re-validates
  payment, is idempotent at jobId. Resolves the head SHA inside the
  worker so jobs can be re-delivered later and stay cache-stable.
- **Audit API 202 contract.** `POST /api/v1/audits` now always
  returns `202 Accepted` with `Location: /api/v1/audits/<jobId>` and
  `Retry-After: 1`. `GET /api/v1/audits/:jobId` returns 202 while
  queued/processing and 200 when completed. Failed jobs return a
  stable structured error. Both flows are documented in OpenAPI.
- **Idempotency.** `Idempotency-Key` header on POST is now first-class:
  a unique index on `jobs.idempotency_key`, plus tests for sequential
  and concurrent submissions. The X-PAYMENT path already deduplicated
  by `payment_id`; both keys now coexist.
- **Graceful shutdown.** `SHUTDOWN_GRACE_PERIOD_MS` (default 30000).
  Fastify onClose stops accepting jobs, drains in-flight workers,
  closes the queue, then the DB. `/health` reports
  `queue.acceptingJobs=false` while shutting down.
- **/health now includes a `queue` block** describing driver, status,
  and `acceptingJobs`. No secrets, no connection strings, no internal
  worker ids.
- **Jobs table migrations** (SQLite + Postgres):
  added `attempts`, `started_at`, `completed_at`, `failed_at`,
  `error_code`, `idempotency_key`. Status transitions are conditional
  (only `queued → processing` is allowed via guarded update).
- **env:check** now also validates `AUDIT_QUEUE_DRIVER`,
  `AUDIT_QUEUE_CONCURRENCY`, `AUDIT_QUEUE_RETRY_LIMIT`,
  `AUDIT_QUEUE_JOB_TIMEOUT_MS`, `SHUTDOWN_GRACE_PERIOD_MS`.
- **Configuration.** `.env.example` documents every new variable
  with sane defaults and production guidance.

### Changed

- `mode: 'full'` no longer blocks the HTTP request: both Quick and
  Full Audit return 202. Free Check remains synchronous 200.
- `verify:release` accepts 200/404/429/502 on the live `free-check`
  step to absorb GitHub's anonymous rate limit; the 202 + Location
  + Retry-After + completed report + cache hit are all asserted.
- The OpenAPI document for `POST /api/v1/audits` now lists 202
  (accepted) with `Location` / `Retry-After`; `HealthResponse` carries
  a `queue` block.

### Security

- `pnpm env:check` + start-time schema refuse the combination of
  production + Mock Payment and production + inline queue.
- Workers never log payment headers, GitHub tokens, OKX secrets,
  or full stack traces for upstream errors. Only `error_code` and
  redacted messages are persisted to `jobs.error`.

### Known limitations

- The PostgreSQL queue adapter is unit-test covered locally; the
  `PgBossAuditQueue` is shipped but the CI Postgres job exercises
  pg-boss through the public adapter API, not the full end-to-end
  queue path. End-to-end Postgres verification remains a release-blocker
  and is tracked in BACKLOG.md.
- Redis, WebSocket, SSE, scheduled jobs, dashboards, and a Dead-Letter
  UI are intentionally out of scope for rc.2.

## [0.1.0-rc.1] - 2026-07-19

### Added

- 7 static analyzers: metadata, stack, documentation, reproducibility,
  secrets, web3, hackathon
- Rule-based scoring (configurable, no LLM involvement)
- ReportBuilder enforcing `evidence` on every finding
- Fastify API: `/health`, `/api/v1/capabilities`, `POST /api/v1/audits`,
  `GET /api/v1/audits/:jobId`
- Drizzle ORM — **two schema files** (SQLite + Postgres) and **two
  migration paths**, with a tagged-union `DB` handle in
  `apps/api/src/db/client.ts`. The repository layer is the only
  consumer and works against either backend with an `async` interface.
- `payment_id` has a **unique partial index** on both backends
  (Postgres: `CREATE UNIQUE INDEX ... WHERE payment_id IS NOT NULL`).
  Repository tests assert the constraint.
- PaymentAdapter interface; MockPaymentAdapter (default) and
  OkxPaymentAdapter (x402 v2 + EIP-3009, stub)
- MCP server (stdio) with `audit_github_repository`, `get_audit_status`,
  `get_repopilot_capabilities`
- React + Vite admin UI (form, report view, status bar, download JSON)
- 5 fixture repos: complete / minimal / no-readme / prompt-injection /
  secret-leak / web3-hackathon
- Pino logging with redaction for `Authorization`, `X-PAYMENT`,
  `X-PAYMENT-SIGNATURE`, `X-API-KEY` and `*.password / *.token / ...`
- LLM provider interface; NoopLlmProvider (default) and
  OpenAI-compatible provider
- Dockerfile (multi-stage, non-root, healthcheck) + .dockerignore
- docker-compose (api + Postgres)
- 104 unit + integration tests across 5 packages (including a Postgres
  integration test that activates when `DATABASE_URL` points at a
  Postgres instance, and a SQLite repository test that runs in CI
  by default)
- `POST /api/v1/free-check` — free, no-payment readiness signal
  (5 quick checks, never 402, registered in OpenAPI + capabilities)
- Report cache (per repo + commit SHA, configurable TTL, persistent in
  the same DB as jobs, request-coalescing, never bypasses payment;
  cache key includes commit SHA so SHA changes invalidate)
- Documentation: README, README_OKX, MARKETPLACE_LISTING (CN/EN)
- `.env.example` covering all 20+ environment variables
- `pnpm env:check` validates dev / production / okx mode
- `pnpm verify:release` runs the full end-to-end smoke
- `pnpm docker:check` reviews Docker config statically
- `pnpm lint` runs tsc + project-specific static rules
- GitHub Actions CI: Node 22 + pnpm 11 + SQLite + Postgres service
  container + verify:release
- GitHub Actions Docker: buildx, no push, smoke `/health`
- `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `SECURITY.md`, `API.md`,
  `MCP_CLIENT_SETUP.md`, `EXTERNAL_ACTIONS.md`, `RELEASE_CHECKLIST.md`,
  `HERO_IMAGE_BRIEF.md`
- `docs/deployment/nginx.conf.example`, `Caddyfile.example`
- Project management: PROJECT_STATE, ROADMAP, BACKLOG, DECISIONS, RISKS,
  CHANGELOG

### Security

- URL allowlist (`github.com`, `raw.githubusercontent.com`) — only
- Path traversal blocked; `.git/`, `node_modules/`, suspicious dotfiles ignored
- Binary files sniffed and skipped
- Target repo code is never executed
- Secret findings return only `path:line:type`; values are masked
- Prompt-injection patterns reported as findings, not followed
- API rate limit (60 req/min) on the audit endpoint
- Production CORS must not be `*` (enforced by env-check)
- `PAYMENT_MODE=mock` fails production (enforced by env-check)
- SQLite allowed in dev; warned in production; Postgres required for prod
- The OKX adapter factory refuses to construct when `recipientAddress`
  is empty. The application does not silently fall back to mock.

### Known limitations

- OKX.AI Beta not granted; `OkxPaymentAdapter` is wired but disabled
  unless `OKX_PAYMENT_ADDRESS` is configured. See `docs/EXTERNAL_ACTIONS.md`.
- `mode: 'full'` runs synchronously inside the HTTP request;
  very large repos may time out. 50 MiB / 2000 files documented.
- LLM is opt-in; default is template-based copy. This is by design.
- Hero image asset not provided; brief in `docs/HERO_IMAGE_BRIEF.md`.
