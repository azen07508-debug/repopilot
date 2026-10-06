# OKX.AI Marketplace Listing — RepoPilot

> Ready-to-paste copy for the OKX.AI Agent Marketplace. Two languages,
> identical information.
>
> The price stated here is the price the 402 challenge asks for. `pnpm
> docs:check` compares the two, so a reworded heading fails the gate instead of
> silently matching nothing.

## English

### Name
RepoPilot

### Tagline
One repo in. A ship-or-block verdict out.

### Description
RepoPilot is a release gate for public GitHub repositories. Give it a repo URL
and it returns a ship-or-block verdict with the findings that block the gate —
documentation gaps, reproducibility problems, deployment blockers, Web3
configuration issues, hackathon submission readiness — each carrying
file-and-line evidence, plus the prioritised fixes that clear it and the
materials you ship with. Static analysis only. It does not execute repository
code or provide formal security audits.

### Pricing

**Free Check — 0 USDT**
A no-account, no-payment read-only triage probe. Returns five pass/fail
checks (README, LICENSE, .env.example, lockfile, CI) and the stack it
detects. No findings, no evidence, and no readiness score — that is what
the paid gate computes. Always returns HTTP 200 (or a 4xx/502 if the repo
is unreachable). This is the entry point other AI agents use to decide
whether a repo is worth gating, and it is on both channels an agent might
use: `POST /api/v1/free-check` over HTTP, `free_check` over MCP.

**Release Gate — 1 USDT**
The verdict, and everything behind it: stack detection, documentation /
reproducibility / security-hygiene / deployment-readiness checks, a
deterministic 0-100 readiness score, every blocking finding with evidence
(file, line, reason), the prioritised fixes that clear the gate, a
step-by-step deployment plan (environment, tests, container or host, TLS,
observability) and ready-to-paste launch copy (one-sentence pitch, short
description, announcement post). No code execution.

One price, one product. There is no cheaper tier and no deeper tier — the same
analyzers run over the same commit and produce the same numbers for every
caller. A score has to be a property of the repository, not of what you paid,
or two people comparing notes about the same repo would get two different
answers. The request's `mode` selects how much of the report you receive, not
what is measured, and it costs the same either way; the service is sold as
`mode=full`.

### What you get
- A JSON `Report` validated against the RepoPilot `1.3` schema
  (`@repopilot/core`).
- A ship-or-block verdict, and scores for documentation, reproducibility,
  security hygiene and deployment readiness, each with a deterministic rule
  breakdown.
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
一个 GitHub 链接进去，一个「能不能发版」的结论出来。

### 描述
RepoPilot 是公开 GitHub 仓库的发版门禁。给它一个仓库地址，它给出「可发版 / 被阻塞」
的结论，以及挡住门禁的每一条发现——文档缺口、可复现性问题、部署阻塞、Web3 配置
问题、黑客松提交准备度——每条都附带文件与行号的证据，外加清除门禁所需的优先级
修复清单和发布所需材料。RepoPilot 只做静态分析，不执行仓库代码，也不提供正式的
安全审计。

### 价格

**免费快查 — 0 USDT**
无需账户、无需付费的只读初筛探测。返回五个通过/未通过的检查项（README、
LICENSE、.env.example、lockfile、CI）以及识别到的技术栈。不含发现项、不含证据，
也不给出就绪度评分——那是付费门禁算的。始终返回 HTTP 200（或仓库不可达时的
4xx/502）。该接口是其他 AI Agent 用来判断某个仓库是否值得做门禁的入口，且两条
通道都可用：HTTP 走 `POST /api/v1/free-check`，MCP 走 `free_check`。

**发版门禁 — 1 USDT**
结论，以及支撑结论的全部证据：技术栈识别、文档 / 可复现性 / 安全卫生 / 部署就绪度
四类检查、确定性的 0-100 就绪度评分、每一条带证据（文件、行号、原因）的阻塞性
发现、清除门禁所需的优先级修复清单、一份分步部署计划（环境、测试、容器或主机、
TLS、可观测性），以及可直接粘贴的发布文案（一句话介绍、短描述、发布贴）。
不执行任何代码。

一个价格，一个产品。没有更便宜的档位，也没有更深的档位——同一套分析器跑同一个
commit，对每个调用者给出相同的数字。评分必须是仓库的属性，而不是你付了多少钱的
属性，否则两个人对同一个仓库会对不上答案。请求里的 `mode` 决定你收到报告的多少，
不决定测什么，且两种取值价格相同；本服务按 `mode=full` 售卖。

### 输出内容
- 一份符合 RepoPilot `1.3` 架构（`@repopilot/core`）的 JSON 报告。
- 一个「可发版 / 被阻塞」的结论，以及文档、可复现性、安全卫生、部署就绪度四类
  评分，每一项都附带可解释的规则明细。
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
