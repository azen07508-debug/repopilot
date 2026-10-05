# OKX.AI Marketplace Listing — RepoPilot

> Ready-to-paste copy for the OKX.AI Agent Marketplace. Two languages,
> identical information.

## English

### Name
RepoPilot

### Tagline
One repo in. A launch-ready plan out.

### Description
RepoPilot audits public GitHub repositories for documentation gaps,
reproducibility problems, deployment blockers, Web3 configuration issues
and hackathon submission readiness. It returns structured evidence,
prioritized fixes and executable acceptance criteria. Static analysis
only. It does not execute repository code or provide formal security
audits.

### Pricing tiers

**Free Check — 0 USDT**
A no-account, no-payment read-only repository health probe. Returns
five boolean checks (README, LICENSE, .env.example, lockfile, CI) plus
a 0-100 score. No evidence, no task list, no launch copy. Always
returns HTTP 200 (or a 4xx/502 if the repo is unreachable). This is
the entry point used by other AI agents to triage a repo before
deciding to pay for a full audit — and it is on both channels an agent
might use: `POST /api/v1/free-check` over HTTP, `free_check` over MCP.

**Quick Scan — 0.02 USDT**
The readiness verdict: stack detection, README / LICENSE / .env.example
checks, lockfile and CI presence, secret hygiene, and an overall
launch-readiness score — plus every blocker, gap and security finding
behind that score, with evidence (file, line, reason). No code execution.

**Full Launch Audit — 0.05 USDT**
The same verdict, plus the materials you ship with: a step-by-step
deployment plan (environment, tests, container or host, TLS, observability)
and ready-to-paste launch copy (one-sentence pitch, short description,
announcement post).

Both tiers run the same analysis over the same commit and produce the same
scores, blockers and findings. The full audit adds deliverables; it does not
look deeper. That is deliberate — a score has to be a property of the
repository, not of what you paid, or two people comparing notes about the
same repo would get two different answers.

### What you get
- A JSON `Report` validated against the RepoPilot `1.2` schema
  (`@repopilot/core`).
- Scores for documentation, reproducibility, security hygiene and
  deployment readiness, each with a deterministic rule breakdown.
- A list of blockers with **evidence** (file, line, reason).
- A launch checklist and a prioritised task list.
- A launch copy block (one-sentence pitch, short description, X post).
- An `analyzerProvenance` map describing which detector produced which
  signal.

### How to call
- **HTTP** (x402 + accepts[]): see `README.md` for `curl` examples.
- **MCP** (stdio): see `README.md` for the `mcpServers` config.

### Brand assets
- [docs/brand/hero.png](docs/brand/hero.png) — 1280 × 640 listing banner,
  see `docs/HERO_IMAGE_BRIEF.md`
- [docs/brand/avatar.png](docs/brand/avatar.png) — 1024 × 1024 square,
  the `--picture` for ASP registration, see `docs/AVATAR_BRIEF.md`

### Constraints
- Public repositories only.
- Repository code is never executed.
- No private keys, mnemonics, or exchange API secrets are read, stored,
  or returned.
- The seller (RepoPilot) does not provide investment advice, price
  predictions, or trading signals.

## 简体中文

### 名称
RepoPilot

### 一句话定位
一个 GitHub 链接进去，一份可执行的上线计划出来。

### 描述
RepoPilot 审计公开的 GitHub 仓库，覆盖文档缺口、可复现性问题、部署阻塞、
Web3 配置问题与黑客松提交准备度。它返回结构化的证据、优先级排序的修复
建议以及可验收标准。RepoPilot 只做静态分析，不执行仓库代码，也不提供
正式的安全审计。

### 价格档

**免费快查 — 0 USDT**
无需账户、无需付费的只读仓库健康探测。返回五个布尔检查项（README、
LICENSE、.env.example、lockfile、CI）以及 0-100 的评分。不含证据、不含任务
清单、不含发布文案。始终返回 HTTP 200（或仓库不可达时的 4xx/502）。
该接口是其他 AI Agent 用来在决定付费做完整审计前先做初筛的入口，
且两条通道都可用：HTTP 走 `POST /api/v1/free-check`，MCP 走 `free_check`。

**快速扫描 — 0.02 USDT**
就绪度结论：技术栈识别、README / LICENSE / .env.example 检查、lockfile
与 CI 存在性、密钥卫生、整体上线就绪度评分，以及支撑这个评分的每一个
阻塞项、文档缺口与安全发现，全部带证据（文件、行号、原因）。不执行任何代码。

**完整上线审计 — 0.05 USDT**
同一份结论，外加你要用来发布的材料：一份分步部署计划（环境、测试、
容器或主机、TLS、可观测性），以及可直接粘贴的发布文案（一句话介绍、
短描述、发布贴）。

两个档位对同一个 commit 跑同一套分析，给出相同的评分、阻塞项与发现。
完整审计增加的是交付物，不是更深的分析。这是刻意的——评分必须是仓库的
属性，而不是你付了多少钱的属性，否则两个人对同一个仓库会对不上答案。

### 输出内容
- 一份符合 RepoPilot `1.2` 架构（`@repopilot/core`）的 JSON 报告。
- 文档、可复现性、安全卫生、部署就绪度四类评分，每一项都附带可解释的
  规则明细。
- 阻塞项列表，每条都附带 **证据**（文件、行号、原因）。
- 上线清单与优先级排序的任务列表。
- 发布文案（一句话简介、短描述、X 帖子）。
- 一份 `analyzerProvenance` 映射，说明每个信号来自哪个分析器。

### 调用方式
- **HTTP**（x402 + accepts[]）：参见 `README.md` 中的 `curl` 示例。
- **MCP**（stdio）：参见 `README.md` 中的 `mcpServers` 配置示例。

### 品牌素材
- [docs/brand/hero.png](docs/brand/hero.png) — 1280 × 640 的列表横幅，
  见 `docs/HERO_IMAGE_BRIEF.md`
- [docs/brand/avatar.png](docs/brand/avatar.png) — 1024 × 1024 方形，
  用于 ASP 注册的 `--picture`，见 `docs/AVATAR_BRIEF.md`

### 边界
- 仅支持公开仓库。
- 仓库代码永不被执行。
- 不读取、不存储、不输出任何私钥、助记词或交易所 API 密钥。
- RepoPilot 不提供投资建议、价格预测或交易信号。
