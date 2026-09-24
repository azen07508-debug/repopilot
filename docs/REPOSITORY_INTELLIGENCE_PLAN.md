# REPOSITORY_INTELLIGENCE_PLAN.md

**Phase 0 交付物 — 代码审计 + 渐进式升级方案**

- **审计对象 commit:** `f95ccb5` (RepoPilot 0.1.0-rc.2)
- **审计日期:** 2026-09-19
- **目标:** 将 RepoPilot 从 *GitHub 仓库发布就绪度审计工具* 渐进升级为
  *AI Coding Agent 的 Repository Intelligence Layer*
- **约束:** 不推倒重做。不破坏现有 API / MCP / report schema / analyzer / fixtures / tests。

> 本文是**唯一**的 Phase 0 事实来源。后续每个 Phase 开始前必须重读本文，
> 落地后必须更新本文末尾的 Phase 状态表。

---

## 0. 结论摘要（先读这段）

### 0.1 可行性判断

**可以做，但必须按顺序做，且必须修正原计划中的 3 个技术假设。**

现有地基是够用的：104 个测试全绿、`strict` TypeScript、Zod schema 单一事实来源、
evidence 强制校验（D-008）、LLM 可选（D-009）、static-only 安全边界（D-007）。
这四条恰好就是 Repository Intelligence 最需要的四条纪律，**不要动它们**。

### 0.2 三个必须修正的技术假设（最重要）

| # | 原计划假设 | 实际代码状态 | 必须修正为 |
|---|---|---|---|
| **C-1** | Symbol Map 可以直接实现 | `@repopilot/core` 生产依赖只有 `octokit / pino / zod`，**没有任何 AST parser** | 引入 parser 必须走 ADR。建议 TS/JS 用 `typescript` 编译器 API（已是 devDep），Python/Solidity 走正则降级。**禁止**一上来引 tree-sitter（native build，会破坏 D-002 的 `allowBuilds` 白名单和 Docker 多阶段构建） |
| **C-2** | Change Impact 用 git diff | `GitHubFetcher` 只用 **Trees API + 逐文件 `getContent`**，仓库里**没有 git 历史、没有本地 clone** | 用 GitHub **Compare API**（`repos.compareCommits`）——octokit 已有，零新依赖，且完全符合 static-only。抽象 `ChangeSource` 接口，先实现 `GitHubCompareSource`，`LocalGitSource` 留到 V0.5 |
| **C-3** | Repository Map 可以读很多文件 | 现在是**每文件一次 API 请求**；`maxFiles=2000` 意味着最多 2000 次请求。匿名限额 **60 req/h**（R-03） | V0.2 第一件事是换掉 I/O 层：改用 **tarball / zipball 一次性下载 + /tmp 只读解压**。这同时解决 rate limit 与 AST 需要完整源码两个问题 |

**C-3 是 V0.2 最大的工程风险。** 如果不先解决 I/O 层，Repository Map 在真实仓库上
会直接撞 rate limit 变成不可用功能，而不是"慢一点"。

### 0.3 对原计划的两条反对意见

1. **不要把 intelligence 拆成独立 package**（原计划 §19 建议 `packages/agent-context`）。
   现在 intelligence 需要和 analyzer 共享 `entries + contents` 数据结构，拆包会立刻引入
   跨包循环依赖和构建顺序问题。**先放 `packages/core/src/intelligence/`**，
   等 V0.5 之后再评估是否拆出 `packages/agent-context`。
2. **不要把 benchmarks 放进 `packages/`**（原计划 §19）。`pnpm-workspace.yaml` 是
   `packages/*`，放进去会被当成可发布包、被 `pnpm -r build/test` 扫到。
   **放仓库根目录 `benchmarks/`**，不是 workspace 成员。

---

## 1. 当前架构

### 1.1 分层

```
┌─────────────────────────────────────────────────────────┐
│ 客户端                                                   │
│   apps/web (React 18 + Vite 6)                          │
│   packages/mcp-server (MCP stdio, SDK 1.22.0)           │
│   第三方 HTTP 客户端 / AI Agent                          │
└───────────────┬─────────────────────────────────────────┘
                │ HTTP / JSON-RPC
┌───────────────▼─────────────────────────────────────────┐
│ apps/api — Fastify 5                                    │
│   routes/    audits, capabilities, free-check, health    │
│   services/  job-service, audit-worker, cache-service    │
│   queue/     AuditQueue { Inline, PgBoss }              │
│   repos/     job-repository, report-cache-repository     │
│   db/        Drizzle (SQLite schema.ts / PG schema.pg.ts)│
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│ packages/core                                           │
│   pipeline.ts    编排：URL → fetch → analyze → report    │
│   git/           url 解析, fetcher, files 分类           │
│   analyzers/     6 个纯函数 analyzer                     │
│   security/      secret-scanner, injection              │
│   scoring/       确定性规则引擎                          │
│   report/        builder（唯一 Report 构造点）            │
│   llm/           provider 抽象 + noop 实现               │
│   schemas/       Zod 单一事实来源                        │
└─────────────────────────────────────────────────────────┘
```

### 1.2 数据流（现状，逐字确认）

`packages/core/src/pipeline.ts:60-96`

```
parseRepoUrl(repoUrl, allowedHosts)
  → MetadataAnalyzer.fetch(owner, repo)        // Octokit repos.get
  → GitHubFetcher.fetchTree(owner, repo, ref)  // git.getTree recursive
  → filterFiles(entries, {maxFiles, maxFileBytes})
  → GitHubFetcher.fetchContents(...)           // 逐文件 repos.getContent  ⚠ C-3
  → ReportBuilder.build({metadata, entries, contents, ...})
      → detectStack / analyzeDocumentation / analyzeReproducibility
      → analyzeWeb3 / analyzeHackathon
      → scanForSecrets / detectPromptInjection
      → scoreAll(scoring, {target})
      → templateSummary / templateLaunchCopy
  → { report, truncated }
```

### 1.3 关键架构约束（来自 DECISIONS.md，必须继续遵守）

| ADR | 内容 | 对升级的影响 |
|---|---|---|
| D-001 | TS strict + NodeNext ESM，内部 import 必须带 `.js` | 新模块所有 import 必须写 `.js` 后缀 |
| D-003 | Zod 固定 `3.24.1`，MCP SDK 固定 `1.22.0` | 新 MCP tool 只能用 `server.tool()` 旧签名，**不能**用 SDK 1.23+ 的新 API |
| D-005 | Drizzle 手写迁移，无 drizzle-kit | 新增表必须同时改 `client.ts` 两个 dialect 的 CREATE |
| D-007 | **static-analysis-only，永不执行被审计仓库代码** | tarball 解压是"读取"不是"执行"，合规；但解压后禁止任何 spawn |
| D-008 | 每个 finding 必须有 ≥1 条 evidence，否则 ReportBuilder 拒绝 | intelligence 层的结论也必须过这条规则 |
| D-009 | LLM 可选，`noop` 为默认 | intelligence 层禁止把 LLM 放在关键路径上 |

---

## 2. 当前 analyzer 清单

全部是**纯函数**：输入 `FileEntry[]` + `Map<path, content>`，输出结构化结果 + findings。
无 I/O、无全局状态 —— 这是可以直接复用给 intelligence 层的形态。

| 模块 | 导出函数 | 输入 | 产出 finding id 前缀 |
|---|---|---|---|
| `analyzers/metadata.ts` | `MetadataAnalyzer.fetch()` | owner/repo (网络) | —（产出 `RepoMetadata`） |
| `analyzers/stack.ts` | `detectStack()`, `stackLabels()` | entries + contents | —（产出 `StackSignal[]`，含 confidence 0..1） |
| `analyzers/documentation.ts` | `analyzeDocumentation()` | entries + contents | `doc-*` |
| `analyzers/reproducibility.ts` | `analyzeReproducibility()` | entries + contents | `repro-*` |
| `analyzers/web3.ts` | `analyzeWeb3()` | entries + contents | `web3-*` |
| `analyzers/hackathon.ts` | `analyzeHackathon()`, `hasHackathonKeywords()` | entries + contents + web3 结果 | `hack-*` |
| `security/secret-scanner.ts` | `scanForSecrets()`, `toSecretFindings()` | `{path,content}[]` | 归入 `securityFindings` |
| `security/injection.ts` | `detectPromptInjection()`, `injectionFindingsToReport()` | `{path,content}[]` | 归入 `securityFindings` |
| `scoring/score.ts` | `scoreAll()`, `score{Documentation,Reproducibility,SecurityHygiene,DeploymentReadiness}()` | `ScoringInput` | —（产出 `Scores`） |

**已确认的 finding id 全集**（33 个）：

```
doc-api, doc-changelog, doc-coc, doc-contributing, doc-env-example,
doc-license, doc-readme, doc-readme-short, doc-security,
repro-no-ci, repro-no-docker, repro-no-lockfile, repro-no-run-script,
repro-no-scripts, repro-no-test-script, repro-pkg-invalid, repro-py-no-requirements,
web3-no-audit-note, web3-no-chain-config, web3-no-contract-tests, web3-no-deploy-script,
hack-no-architecture, hack-no-chain, hack-no-demo, hack-no-license,
hack-no-screenshots, hack-no-social, hack-no-video
```

**判定：现有 analyzer 全部是"文件存在性 + 正则"级别。**
没有 AST、没有跨文件引用、没有调用关系。
→ 这正是 intelligence 层要补的，而不是要替换的。两者是**叠加**关系。

---

## 3. 当前 report schema

`packages/core/src/schemas/report.ts`，`reportVersion: z.literal('1.0')`（常量 `REPORT_VERSION`）。

### 3.1 顶层结构

```
Report {
  reportVersion: '1.0'          // ⚠ literal，不可加值，只能用新字段表达 v2
  repository: Repository        // url/owner/name/defaultBranch/license/...
  summary: string
  detectedStack: string[]
  scores: Scores                // overall + 4 维度 + breakdown(rule/delta/reason)
  blockers: Finding[]
  documentationGaps: Finding[]
  securityFindings: Finding[]
  deploymentPlan: DeploymentStep[]
  recommendedTasks: Task[]
  launchChecklist: LaunchChecklistItem[]
  launchCopy: LaunchCopy
  limitations: string[]
  generatedAt: string
  auditMode: 'quick' | 'full'
  target: 'hackathon' | 'open_source' | 'production'
  outputLanguage: 'en' | 'zh-CN'
  analyzerProvenance: Record<string,string>
}
```

### 3.2 Evidence（现状 — 需要扩展，不能替换）

```ts
EvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive().nullable(),   // nullable，很多证据没有行号
  reason: z.string().min(1),
});
```

**原计划 Phase 5 要求** `source` + `confidence` + `endLine` + `symbol` + `module`。
→ **冲突点**：直接改 `EvidenceSchema` 会破坏 `reportVersion 1.0` 的兼容承诺。

**解决方案（见 §11）：新增 `EvidenceV2Schema` 作为超集，旧字段语义不变。**

### 3.3 Finding

```ts
Finding {
  id, category(8 枚举), severity(critical|high|medium|low),
  title, description,
  evidence: Evidence[],        // .min(1) — D-008 强制
  recommendedAction, acceptanceCriteria[]
}
```

`category` 枚举：`documentation | reproducibility | security | deployment | web3 | hackathon | meta`

---

## 4. 当前 MCP tools

`packages/mcp-server/src/index.ts` — 3 个 tool，stdio transport。

| tool | 参数 | 行为 |
|---|---|---|
| `audit_github_repository` | `repo_url, mode, target, output_language, include_launch_copy` | mock 模式下自动完成支付并**同步**跑 pipeline，返回 `reportSummary(report)`（内含完整 `ReportSchema.parse(report)`）；okx 模式返回 payment challenge |
| `get_audit_status` | `job_id` | 查 `JobStore`（内存） |
| `get_repopilot_capabilities` | — | 返回 name/version/inputs/outputs/limits/pricing |

**判定：**
- 3 → 15 个 tool 的扩展没有架构障碍，`server.tool(name, desc, zodShape, handler)` 模式可直接复制。
- **但有一个产品冲突**：现有每个 tool 都过 `paymentAdapter`（402 计费）。
  Agent Context / repo_map 这类**高频小查询**走 x402 计费不成立 ——
  Agent 每次进仓库都要调 5~10 次，会被计费模型打死。见 §12 ADR-003。

---

## 5. 当前数据库结构

Drizzle ORM，两套 schema 手写同步（D-005）。

### 5.1 表清单

| 表 | 用途 | 关键列 |
|---|---|---|
| `jobs` | 审计任务状态机 | `job_id`(PK), `status`, `input_json`, `report_json`, `payment_id`(UQ), `error`, `attempts`, `started_at`, `completed_at`, `failed_at`, `error_code`, `idempotency_key`(UQ), `cache_json`, `created_at`, `updated_at` |
| `report_cache` | 报告缓存（per repo + commit SHA，TTL 1h） | 见 `db/client.ts:167`(SQLite) / `:236`(PG) |

索引：`idx_jobs_status`, `idx_jobs_created`, `uq_jobs_payment_id`, `uq_jobs_idempotency_key`

SQLite 文件：`sqliteTable`（`schema.ts`）；PG：`pgTable` + jsonb + timestamptz（`schema.pg.ts`）

### 5.2 对升级的影响

Repository Intelligence 的产物（repositoryMap / architectureGraph）是**大 JSON**，
且需要跨请求复用（Agent 会反复查同一个仓库）。

**方案：不新增表**。复用 `report_cache` 的表结构模式，新增 `intelligence_cache` 表
（`repo_key` + `commit_sha` 复合键 + `kind` + `payload_json` + `schema_version`）。
必须同时改 `db/client.ts` 两个 dialect 的 CREATE（D-005）。

---

## 6. 当前 API

Fastify 5，`/api/v1` 前缀。

| Method | Path | 契约 |
|---|---|---|
| GET | `/health` | liveness + paymentMode + db status + **queue{driver,status,acceptingJobs}** |
| GET | `/api/v1/capabilities` | service metadata + input/output schema + pricing + limits |
| POST | `/api/v1/audits` | **恒返回 202** + `Location` + `Retry-After: 1`（D-015）。首次无 `X-PAYMENT` → 402 + challenge |
| GET | `/api/v1/audits/:jobId` | 202（queued/processing）/ 200（completed）/ 结构化错误（failed） |
| POST | `/api/v1/free-check` | **同步 200**，5 项快检，永不 402 |
| GET | `/docs/openapi.json` | OpenAPI 3.1，web UI 消费 |

中间件：`rate-limit.ts`（IP 级）、`security.ts`
进程模型：`combined`（默认）／`split`（`REPOPILOT_API_MODE=http` + worker）

**新增 intelligence 端点建议**（V0.4+，与 MCP 共用 service 层）：
`GET /api/v1/repositories/:owner/:repo/map`、`/architecture`、`/change-impact?base=&head=`

---

## 7. 可以复用的模块（明确清单）

复用不等于不改，但下面这些**只需要扩展，不需要重写**。

| 模块 | 复用方式 |
|---|---|
| `git/url.ts` `parseRepoUrl()` | intelligence 层所有入口复用其 host allowlist 校验 |
| `git/files.ts` `classifyFile()` / `detectLanguage()` / `filterFiles()` | Repository Map 的目录/语言分类直接复用；`LANGUAGE_BY_EXTENSION` 是 Symbol Map 的语言路由基础 |
| `git/fetcher.ts` `GitHubFetcher` | **改造**（C-3）：保留 `fetchTree` 的文件清单能力，把 `fetchContents` 换成 tarball 批量拉取。接口保持不变 |
| `analyzers/stack.ts` `detectStack()` | Repository Map 的 `language` / `framework` / `packageManager` 字段**直接吃** `StackSignal[]`，已有 confidence |
| `analyzers/metadata.ts` | Repository Map 的 repository metadata 块直接来自 `RepoMetadata` |
| `report/builder.ts` `ReportBuilder` | intelligence 结果作为**可选新字段**挂进 `Report`，复用 `buildProvenance` 模式 |
| `scoring/score.ts` 的 `rule/delta/reason` 结构 | Confidence System 直接复用这个"可解释加减分"形态 |
| `security/secret-scanner.ts` / `injection.ts` | Change Impact 的 security 段复用；安全边界不变 |
| `llm/provider.ts` + `noop-provider.ts` | Fix Plan 的 LLM 部分必须走这个接口，保证 noop 下仍可用 |
| `schemas/` Zod 模式 | 所有新 schema 放 `schemas/intelligence/`，沿用同构风格 |
| `apps/api/src/queue/*` | 大仓库的 intelligence 分析走同一个 AuditQueue，不新造轮子 |

---

## 8. 不应该重写的模块（禁止清单）

以下模块**禁止在本轮升级中重构**；如需变更，先写 ADR。

| 模块 | 原因 |
|---|---|
| `packages/okx-adapter/**` | 支付 / x402 / EIP-3009，与 intelligence 无关，改了就是事故 |
| `apps/api/src/queue/**` + `services/audit-worker.ts` | D-013/D-014 刚稳定，状态机单点，动则 job 丢失 |
| `apps/api/src/config.ts` 的生产守卫 | R-02 / R-16 的缓解措施，硬编码 release-blocker |
| `schemas/report.ts` 的 `reportVersion: '1.0'` 与已有字段语义 | 兼容性承诺，只能加可选字段 |
| `security/**` 的检测逻辑 | 安全边界，改动需要安全评审 |
| `scoring/score.ts` 的现有规则 | 分数必须可复现，改规则 = 改所有历史报告 |
| 5 个 fixtures | 所有回归测试的基线 |
| `scripts/verify-release.ts` | 唯一的端到端门禁 |

---

## 9. 新增模块

### 9.1 目录（落地版 — 已按 §0.3 修正）

```
repopilot/
├── packages/core/src/
│   ├── intelligence/                    # 新增 V0.2
│   │   ├── repository-map/              # V0.2   Phase 1
│   │   │   ├── build.ts
│   │   │   ├── entrypoints.ts
│   │   │   ├── modules.ts
│   │   │   └── importance.ts
│   │   ├── symbols/                     # V0.2   Phase 2
│   │   │   ├── index.ts                 # 语言路由 + 安全降级
│   │   │   ├── typescript.ts            # typescript compiler API
│   │   │   ├── javascript.ts
│   │   │   ├── python.ts                # 正则降级
│   │   │   ├── solidity.ts              # 正则降级
│   │   │   └── regex-fallback.ts
│   │   ├── graph/                       # V0.2-V0.3 Phase 3/4
│   │   │   ├── dependency-graph.ts
│   │   │   ├── architecture-graph.ts
│   │   │   ├── resolve.ts               # import 字符串 → 文件
│   │   │   └── metrics.ts               # 环依赖 / 耦合度 / 孤立模块
│   │   ├── changes/                     # V0.4   Phase 6
│   │   │   ├── change-source.ts         # 接口
│   │   │   ├── github-compare-source.ts
│   │   │   ├── local-git-source.ts      # V0.5
│   │   │   └── impact.ts
│   │   ├── task/                        # V0.5   Phase 7
│   │   │   ├── search.ts
│   │   │   └── reading-order.ts
│   │   └── context/                     # V0.5   Phase 8
│   │       ├── agent-context-pack.ts
│   │       └── conventions.ts
│   ├── schemas/intelligence/            # 新增 V0.2 —— 与 report.ts 平级
│   │   ├── repository-map.ts
│   │   ├── symbol-map.ts
│   │   ├── graph.ts
│   │   ├── change-impact.ts
│   │   ├── agent-context.ts
│   │   └── evidence-v2.ts
│   └── evidence/                        # V0.3   Phase 5
│       ├── graph.ts
│       └── confidence.ts
├── packages/mcp-server/src/tools/       # V0.3+ —— 按域拆分 tool 注册
├── benchmarks/                          # 根目录，非 workspace 成员  ⚠ 见 §0.3
├── action/repopilot-action/             # V0.7   Phase 11
└── apps/api/src/routes/intelligence.ts  # V0.4+
```

**注意**：原计划建议的 `packages/agent-context`、`packages/benchmarks` 不采用，理由见 §0.3。

### 9.2 Schema 草案（Phase 1 必须先定稿这几个）

```ts
// schemas/intelligence/repository-map.ts
export const RepositoryMapSchema = z.object({
  schemaVersion: z.literal('1.0'),           // 独立于 reportVersion
  generatedAt: z.string(),
  repository: z.object({
    url: z.string().url(),
    owner: z.string(),
    name: z.string(),
    defaultBranch: z.string(),
    commitSha: z.string().nullable(),        // 缓存键的一部分
    primaryLanguage: z.string().nullable(),
    languages: z.array(z.object({ language: z.string(), fileCount: z.number(), bytes: z.number() })),
    frameworks: z.array(z.string()),
    packageManagers: z.array(z.string()),
  }),
  entrypoints: z.array(z.object({
    path: z.string(),
    kind: z.enum(['app', 'cli', 'library', 'server', 'worker', 'test-runner', 'contract']),
    confidence: z.number().min(0).max(1),
  })),
  modules: z.array(z.object({
    name: z.string(),
    path: z.string(),
    kind: z.enum(['package', 'directory', 'workspace-package', 'contract-package']),
    importance: z.number().min(0).max(1),
    fileCount: z.number().int(),
    languages: z.array(z.string()),
    dependsOn: z.array(z.string()),
  })),
  importantFiles: z.array(z.object({
    path: z.string(),
    reason: z.string(),
    importance: z.number().min(0).max(1),
  })),
  configFiles: z.array(z.string()),
  testFiles: z.array(z.string()),
  documentationFiles: z.array(z.string()),
  externalDependencies: z.array(z.object({
    name: z.string(),
    version: z.string().nullable(),
    kind: z.enum(['runtime', 'dev', 'peer', 'optional']),
    manifest: z.string(),
  })),
  limitations: z.array(z.string()),          // 对齐 Report.limitations 的诚实风格
});
```

```ts
// schemas/intelligence/symbol-map.ts
export const SymbolSchema = z.object({
  id: z.string(),                            // `${path}#${name}#${startLine}`
  name: z.string(),
  type: z.enum(['function','class','interface','type','variable','method','contract','struct','enum','constant']),
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  parent: z.string().nullable(),             // 所属 class / contract
  exported: z.boolean(),
  references: z.number().int().nonnegative(),
  parser: z.enum(['typescript-compiler','regex','heuristic']),  // 溯源必备
  parserConfidence: z.number().min(0).max(1),
});

export const SymbolMapSchema = z.object({
  schemaVersion: z.literal('1.0'),
  languageCoverage: z.array(z.object({
    language: z.string(),
    fileCount: z.number().int(),
    parser: z.string(),
    degraded: z.boolean(),                   // true = 走了正则降级
  })),
  symbols: z.array(SymbolSchema),
  degraded: z.boolean(),                     // 任一语言解析失败 → true，但整体不失败
  failures: z.array(z.object({ language: z.string(), reason: z.string() })),
});
```

**关键设计点**：`degraded` + `failures` + `parser` 三个字段是 Phase 2
"禁止因为某个语言解析失败而导致整个 audit 失败" 的**强制实现**。
没有这三个字段，降级就是黑盒。

```ts
// schemas/intelligence/graph.ts
export const GraphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['file','module','function','class','package','external-dependency','contract']),
  name: z.string(),
  path: z.string().nullable(),
});
export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['imports','calls','extends','implements','depends_on','tests','exports']),
  weight: z.number().int().positive().default(1),
  evidence: z.array(EvidenceV2Schema).default([]),   // 每条边可回溯
});
export const DependencyGraphSchema = z.object({
  schemaVersion: z.literal('1.0'),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export const ArchitectureGraphSchema = DependencyGraphSchema.extend({
  entrypoints: z.array(z.string()),
  circularDependencies: z.array(z.array(z.string())),
  highCoupling: z.array(z.object({ node: z.string(), degree: z.number().int(), reason: z.string() })),
  isolatedModules: z.array(z.string()),
  llmUsed: z.literal(false),                 // Phase 4 硬约束：架构判定不经过 LLM
});
```

```ts
// schemas/intelligence/evidence-v2.ts —— 超集，兼容旧 Evidence
export const EvidenceSourceSchema = z.enum([
  'static-analysis','git','dependency-analysis','test-analysis',
  'documentation-analysis','llm-inference',
]);
export const EvidenceV2Schema = z.object({
  path: z.string(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  reason: z.string().min(1),
  source: EvidenceSourceSchema,
  confidence: z.number().min(0).max(1),
  symbol: z.string().nullable().default(null),
  module: z.string().nullable().default(null),
  // 兼容旧字段名（file/line）—— 旧代码读这两个字段不会坏
  file: z.string().optional(),
  line: z.number().int().positive().nullable().optional(),
});
```

```ts
// schemas/intelligence/change-impact.ts
export const ChangeImpactSchema = z.object({
  schemaVersion: z.literal('1.0'),
  base: z.string(),
  head: z.string(),
  changedFiles: z.array(z.object({
    path: z.string(),
    status: z.enum(['added','modified','removed','renamed']),
    additions: z.number().int(),
    deletions: z.number().int(),
  })),
  changedSymbols: z.array(z.object({ id: z.string(), name: z.string(), path: z.string(), change: z.string() })),
  affectedModules: z.array(z.object({ name: z.string(), path: z.string(), reason: z.string(), distance: z.number().int() })),
  affectedTests: z.array(z.string()),
  testGaps: z.array(z.object({ module: z.string(), reason: z.string(), evidence: z.array(EvidenceV2Schema) })),
  documentationGaps: z.array(z.object({ path: z.string(), reason: z.string(), evidence: z.array(EvidenceV2Schema) })),
  risk: z.enum(['none','low','medium','high','critical']),
  riskReasons: z.array(z.string()),
  evidence: z.array(EvidenceV2Schema),
  degraded: z.boolean(),                     // git 信息不可用 → true，不抛错
});
```

---

## 10. Migration strategy

### 10.1 版本映射

| 版本 | 内容 | 对应原计划 Phase |
|---|---|---|
| **V0.2** | I/O 层改造（tarball）+ Repository Map + Symbol Map + Dependency Graph | 1, 2, 3 + **C-3 修正** |
| **V0.3** | Architecture Graph + Evidence Graph + Confidence System | 4, 5, 13 |
| **V0.4** | Change Impact（`GitHubCompareSource`）+ HTTP 端点 | 6 |
| **V0.5** | Task Context + Agent Context Pack + `LocalGitSource` | 7, 8 |
| **V0.6** | Fix Plan + Agent Prompt Generator | 10 |
| **V0.7** | GitHub Action + PR Review | 11 |
| **V0.8** | GitHub App（接口层） | 12 |
| **V0.9** | Benchmark + 公开数据集 | 9, 15 |
| **V1.0** | Repository Intelligence Platform（Web UI 大改 + 差异化定位） | 14, 16, 18 |

### 10.2 每个 Phase 的执行纪律

1. **先 schema，后实现。** `schemas/intelligence/*.ts` 必须先落地并有 schema 测试。
2. **先 fixture，后算法。** 5 个现有 fixture 全部要能产出对应 intelligence 产物并快照。
3. **新增不替换。** 任何新能力以可选字段/新模块形式加入。
4. **每个 Phase 结束必须全绿：** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm verify:release`
5. **每个 Phase 结束更新：** `CHANGELOG.md`、`ROADMAP.md`、`PROJECT_STATE.md`、本文末状态表。
6. **冲突先写 ADR。** 若实现中发现与现有 ADR 冲突，先追加到 `DECISIONS.md`，选最小改动方案。

### 10.3 V0.2 落地顺序（细化到可交付）

```
V0.2-a  ADR 写入 DECISIONS.md（D-017 tarball I/O / D-018 parser 选型 / D-019 计费分层）
V0.2-b  schemas/intelligence/repository-map.ts + symbol-map.ts + evidence-v2.ts + schema 单测
V0.2-c  git/fetcher.ts 改造：TarballSource（保留原接口签名，内部换实现）+ 沙箱解压
V0.2-d  intelligence/repository-map/*：entrypoints / modules / importance
V0.2-e  intelligence/symbols/*：typescript（compiler API）+ python/solidity 正则降级
V0.2-f  intelligence/graph/dependency-graph.ts + resolve.ts
V0.2-g  6 个 fixture 的 repository-map 快照测试 + MCP 首批 4 个 tool
V0.2-h  文档 + CHANGELOG + 状态表
```

---

## 11. Backward compatibility strategy

### 11.1 五条硬规则

| 规则 | 内容 |
|---|---|
| **B-1** | `ReportSchema` 已有字段**一个都不删、不改语义、不改类型**。`reportVersion` 保持 `'1.0'`。 |
| **B-2** | 新能力以**可选字段**挂到 `Report`（如 `repositoryMap?: RepositoryMap`），或在独立 endpoint / MCP tool 上暴露。旧客户端不受影响。 |
| **B-3** | `Evidence` → `EvidenceV2` 是**超集**：保留 `file` / `line` 可选字段，新增 `path` / `startLine` / `endLine` / `source` / `confidence`。旧消费方读旧字段不坏。 |
| **B-4** | 新 schema 自带独立 `schemaVersion`，与 `reportVersion` 解耦。**禁止**用 `reportVersion` 表达 intelligence 产物的版本。 |
| **B-5** | MCP 只**增** tool，不改现有 3 个 tool 的参数与返回形状。`audit_github_repository` 的返回保持现状。 |

### 11.2 数据库兼容

- 新增表用 `CREATE TABLE IF NOT EXISTS`（现有迁移已幂等，D-005/R-09）。
- SQLite 与 PG 两套 schema **必须同时改**，否则 CI 的 PG 集成测试会红。
- 不修改 `jobs` / `report_cache` 的现有列。

### 11.3 降级兼容（"安全失败"契约）

以下任一情况**必须返回 `degraded: true` 而不是抛错**：
- tarball 下载失败 → 回退到现有逐文件 `getContent` 路径
- AST 解析某语言失败 → 该语言走 `regex-fallback`，`failures[]` 记录原因
- git 信息不可用 → `ChangeImpactSchema.degraded = true`，`changedFiles` 为空数组
- 超过 `maxFiles` / `maxTotalBytes` → `limitations[]` 追加说明（沿用现有 `buildLimitations` 风格）

---

## 12. 审计发现的风险 + 需要立的 ADR

| ADR | 议题 | 建议决策 |
|---|---|---|
| **D-017** | I/O 层改造（C-3） | 采用 tarball/zipball 一次性拉取 + `/tmp/repopilot-*` 只读解压解压后不做任何 `spawn`。保留 `GitHubFetcher.fetchContents` 作为降级路径。判定合规于 D-007（解压 ≠ 执行） |
| **D-018** | Symbol parser 选型（C-1） | TS/JS 用 `typescript` compiler API（devDep 提到 dependencies）；Python / Solidity / 其他用正则降级。**不引入 tree-sitter** |
| **D-019** | MCP 计费分层 | 报告类 tool（`audit_github_repository`）沿用 x402；**查询类 tool（repo_map / architecture / symbols / agent_context / change_impact）在 mock 与 production 下均免费**，避免 Agent 每次进仓库被反复计费 |
| **D-020** | Change Source 抽象（C-2） | 定义 `ChangeSource` 接口；V0.4 只实现 `GitHubCompareSource`（Compare API，零新依赖）；`LocalGitSource` 推迟到 V0.5，且只允许只读 git 命令 |
| **D-021** | intelligence 产物缓存 | 新增 `intelligence_cache` 表，键 = (`owner/repo`, `commitSha`, `kind`, `schemaVersion`)，复用 `report_cache` 的 TTL 与 request-coalescing 模式 |

### 12.1 风险登记表（新增，需并入 RISKS.md）

| ID | 风险 | 级别 | 缓解 |
|---|---|---|---|
| **R-17** | tarball 下载大仓库导致内存/磁盘压力 | Medium | 沿用 `maxTotalBytes`(50 MiB)；解压目录 `mkdtemp` + `finally` 清理；解压后先按 `filterFiles` 裁剪再读 |
| **R-18** | AST 解析 OOM（超大单文件） | Low | 单文件解析前检查 `maxFileBytes`；parser 包 try/catch，失败即降级 |
| **R-19** | Compare API 对超大 diff 返回不完整 | Low | `degraded: true` + `limitations` 说明；不静默截断 |
| **R-20** | intelligence 产物 JSON 过大撑爆 `report_json` 列 | Medium | **不作为 Report 内嵌字段默认开启**，走独立 endpoint + `intelligence_cache`；MCP tool 返回时做 token 裁剪 |
| **R-21** | 新增依赖破坏 D-003 的 zod/MCP 固定版本 | Medium | 新依赖不得引入 zod 3.25+ 或 MCP SDK 1.23+ 传递依赖；`pnpm install --frozen-lockfile` 为门禁 |

---

## 13. Phase 0 验收标准

- [x] 读完全部项目文档（README / PROJECT_STATE / ROADMAP / BACKLOG / DECISIONS / RISKS / CHANGELOG）
- [x] 读完 `packages/core` 全部 analyzer、pipeline、report builder、schemas、scoring、security、git
- [x] 读完 `packages/mcp-server`、`apps/api`（db/schema 双份）、`apps/web` 入口
- [x] 建立当前架构 / analyzer / schema / MCP / DB / API 六张清单
- [x] 明确可复用模块与禁止重写模块
- [x] 识别 3 个技术假设冲突（C-1 / C-2 / C-3）并给出修正
- [x] 提出 5 条待立 ADR（D-017 ~ D-021）
- [x] 提出 5 条新风险（R-17 ~ R-21）
- [x] ADR D-017 ~ D-021 写入 `DECISIONS.md` ← 完成 2026-09-19
- [x] R-17 ~ R-21 写入 `RISKS.md` ← 完成 2026-09-19
- [x] 未写任何实现代码（Phase 0 只审计）
- [x] V0.2-b：intelligence Zod schema 定稿 + 单测（完成 2026-09-19）
- [x] V0.2-c：tarball I/O 取代逐文件 `getContent`（完成 2026-09-23，ADR D-024）
- [x] V0.2-d：Repository Map builder（完成 2026-09-24，ADR D-025）
  - `importance.ts` 绝对饱和打分；`entrypoints.ts` 7 类入口 + 路径存在性唯一把关点；
    `manifests.ts` 手写 TOML / requirements / Cargo / go.mod 解析（零新依赖，R-21）；
    `modules.ts` 五路模块推导 + `MANIFEST_NAME_PRIORITY`；`build.ts` 组装 + 边界校验
  - 5 个新测试文件 / 123 个用例；core 总计 427 → 550
  - 变异测试 16 条不变量全部捕获（0 漏报），其中一条查出真实的模块命名顺序依赖 bug，
    复查又修掉一处「截断没发生却声称发生了」的假 limitation（见 D-025 决策 7）
  - **未接入 pipeline**（R-20）：map 是大 JSON 产物，`report_json` 是 DB 列，留给 V0.2-g 单独出接口

---

## 14. Phase 状态表

| Phase | 内容 | 状态 |
|---|---|---|
| Phase 0 | 代码审计 + 本计划 | ✅ 完成（2026-09-19） |
| Phase 1 | Repository Map | ✅ builder 完成（V0.2-d，2026-09-24）；快照测试 + MCP tool 待 V0.2-g |
| Phase 2 | Symbol Map | ⬜ 未开始 |
| Phase 3 | Dependency Graph | ⬜ 未开始 |
| Phase 4 | Architecture Graph | ⬜ 未开始 |
| Phase 5 | Evidence Graph + Confidence | ⬜ 未开始 |
| Phase 6 | Change Impact | ⬜ 未开始 |
| Phase 7 | Task Context | ⬜ 未开始 |
| Phase 8 | Agent Context Pack | ⬜ 未开始 |
| Phase 9 | MCP 扩展（15 tools） | ⬜ 未开始 |
| Phase 10 | Fix Plan | ⬜ 未开始 |
| Phase 11 | GitHub Action | ⬜ 未开始 |
| Phase 12 | GitHub App | ⬜ 未开始 |
| Phase 13 | Benchmark | ⬜ 未开始 |
| Phase 14 | Web UI | ⬜ 未开始 |
| Phase 15 | Web3 plugin | ⬜ 未开始 |
| Phase 16 | Demo | ⬜ 未开始 |

---

## 附：本计划与原计划的差异对照

| 原计划条目 | 本计划处理 |
|---|---|
| §19 目录 `packages/agent-context` | ❌ 不采用，先放 `packages/core/src/intelligence/`（§0.3） |
| §19 `packages/benchmarks` | ❌ 改根目录 `benchmarks/`（会被 workspace 扫到） |
| §三 Repository Map | ✅ 采纳，schema 已细化（§9.2） |
| §五 Change Impact | ⚠️ 采纳但换实现：Compare API 而非 git diff（C-2） |
| §十二 Evidence Graph | ⚠️ 采纳但改为 `EvidenceV2` 超集扩展（B-3） |
| §十三 Confidence System | ✅ 采纳，复用 `scoring` 的 rule/delta/reason 形态 |
| §十四 不让 LLM 做核心分析 | ✅ 已由 D-007/D-009 保证，ArchitectureGraph 增加 `llmUsed: false` 硬字段 |
| §十五 Benchmark | ✅ 采纳，位置修正 |
| §十八 Web3 | ✅ 采纳为 plugin，不污染 core，复用现有 `analyzers/web3.ts` |
| §二十一 最重要 5 个功能 | ✅ 完全同意，且 V0.2 优先做前 3 个 |
