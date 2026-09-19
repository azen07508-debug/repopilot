/**
 * Deterministic report templates.
 *
 * When no LLM is configured, RepoPilot generates a complete report by
 * stringifying the same fields the LLM would have rephrased. The templates
 * are intentionally boring — they exist to guarantee that every field on
 * `Report` is populated, even in air-gapped or LLM-disabled environments.
 */
import type { LaunchCopy, Report, Severity } from '../schemas/report.js';

export function templateSummary(report: Report): string {
  const r = report.repository;
  const lang = report.outputLanguage;
  const overall = report.scores.overall;
  const top = report.blockers[0];
  const second = report.blockers[1];
  const fmt = (f: { title: string; severity: Severity } | undefined) =>
    f ? ` ${f.title} (${f.severity})` : '';

  if (lang === 'zh-CN') {
    return [
      `${r.name} 是一个${describeStack(report.detectedStack)}项目，整体上线就绪度得分 ${overall}/100。`,
      `主要阻塞项：${top ? top.title : '无严重阻塞'}。`,
      second
        ? `其次：${second.title}。`
        : '建议优先完成 README 与 LICENSE 之类的基础文档。',
    ].join('');
  }
  return [
    `${r.name} is a ${describeStack(report.detectedStack)} project with an overall launch-readiness score of ${overall}/100.`,
    top ? `Top blocker:${fmt(top)}.` : 'No critical blockers detected.',
    second
      ? `Next priority:${fmt(second)}.`
      : 'Next priority: complete the baseline documentation (README, LICENSE, .env.example).',
  ].join(' ');
}

function describeStack(stack: string[]): string {
  if (stack.length === 0) return 'source-available';
  if (stack.length <= 3) return stack.join(' / ').toLowerCase();
  return `${stack.slice(0, 3).join(' / ').toLowerCase()} project`;
}

export function templateLaunchCopy(report: Report): LaunchCopy {
  const r = report.repository;
  const lang = report.outputLanguage;
  const topStack = report.detectedStack.slice(0, 3).join(', ') || 'open-source';
  const pitchLimit = 140;
  const shortLimit = 280;
  const xLimit = 260;
  const repoUrl = r.url;

  if (lang === 'zh-CN') {
    const oneSentencePitch = clip(
      `${r.name}: ${report.detectedStack[0] ?? '开源'} 项目，自动审查仓库的上线就绪度，给出可执行的修复建议。`,
      pitchLimit
    );
    const shortDescription = clip(
      `${r.name} 基于 ${topStack}，提供结构化的仓库审查报告：文档缺口、可复现性问题、安全卫生、部署与 Web3 配置审计。仅做静态分析，不执行仓库代码。`,
      shortLimit
    );
    const xPost = clip(
      `刚把 ${r.name} 接入上线审查流水线：拿到一个 GitHub 链接就能输出文档/安全/部署/可复现性的修复清单，含证据和验收标准。${repoUrl}`,
      xLimit
    );
    return { oneSentencePitch, shortDescription, xPost };
  }

  const oneSentencePitch = clip(
    `${r.name}: ${report.detectedStack[0] ?? 'open-source'} project that turns a GitHub URL into a launch-readiness report with prioritized fixes.`,
    pitchLimit
  );
  const shortDescription = clip(
    `${r.name} audits public GitHub repos for documentation gaps, reproducibility issues, security hygiene, deployment readiness and Web3 configuration. Returns evidence-grounded findings and acceptance criteria. Static analysis only.`,
    shortLimit
  );
  const xPost = clip(
    `Shipped ${r.name}: paste a GitHub URL, get a launch-readiness report with blockers, evidence, and acceptance criteria. ${repoUrl}`,
    xLimit
  );
  return { oneSentencePitch, shortDescription, xPost };
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
