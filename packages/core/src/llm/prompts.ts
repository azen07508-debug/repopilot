/**
 * Prompt construction for the LLM provider.
 *
 * The prompts are short and structured. We pass the deterministic scores
 * and findings to the LLM and ask it to (a) write a 3-sentence summary and
 * (b) draft launch copy. The LLM is forbidden from inventing data: it must
 * base its output on the JSON we provide.
 */
import type { LLMGenerateInput } from './provider.js';

function compactFindings(input: LLMGenerateInput) {
  const rep = input.report;
  return {
    overall: rep.scores.overall,
    documentation: rep.scores.documentation,
    reproducibility: rep.scores.reproducibility,
    securityHygiene: rep.scores.securityHygiene,
    deploymentReadiness: rep.scores.deploymentReadiness,
    repository: rep.repository,
    detectedStack: rep.detectedStack,
    blockers: rep.blockers.map((b) => ({ id: b.id, severity: b.severity, title: b.title })),
    securityFindings: rep.securityFindings.map((b) => ({
      id: b.id,
      severity: b.severity,
      title: b.title,
    })),
    documentationGaps: rep.documentationGaps.map((b) => ({
      id: b.id,
      severity: b.severity,
      title: b.title,
    })),
  };
}

function langDirective(language: 'en' | 'zh-CN'): string {
  return language === 'zh-CN'
    ? '请用简体中文回答。输出必须是 JSON。'
    : 'Reply in English. Output must be valid JSON.';
}

export function buildPrompt(input: LLMGenerateInput): { system: string; user: string } {
  const data = compactFindings(input);
  const system = [
    'You are RepoPilot, an evidence-grounded audit assistant.',
    'You NEVER invent scores, file paths, line numbers, secrets, addresses, or capabilities.',
    'You may ONLY rephrase the deterministic findings provided below.',
    langDirective(input.language),
  ].join(' ');

  const user = (() => {
    switch (input.task) {
      case 'summary':
        return [
          'Based on the JSON below, write a 3-sentence summary of the project.',
          'Sentence 1: one-line pitch of what the repo is.',
          'Sentence 2: the top 1–2 blockers, with severity.',
          'Sentence 3: the most impactful next step.',
          'Return strict JSON: {"summary": "..."}',
          '---',
          JSON.stringify(data, null, 2),
        ].join('\n');
      case 'launch_copy':
        return [
          'Generate launch copy as strict JSON with fields:',
          '  - oneSentencePitch (max 140 chars, no hype, no price prediction)',
          '  - shortDescription (max 280 chars, factual, mentions stack and primary feature)',
          '  - xPost (max 260 chars, suitable for X / Twitter, NO hashtags unless the project already uses them, NO investment claims)',
          'Constraints:',
          '  - DO NOT include any URLs.',
          '  - DO NOT use the words "moon", "100x", "guaranteed", "profit", "alpha", "gem".',
          '  - DO NOT claim the project is audited unless the JSON explicitly says so.',
          '---',
          JSON.stringify(data, null, 2),
        ].join('\n');
      case 'polish':
        return [
          'Polish the following fields without changing facts:',
          '  - report.summary (3 sentences)',
          '  - report.launchCopy.{oneSentencePitch, shortDescription, xPost}',
          'Return strict JSON: {"summary": "...", "launchCopy": {...}}.',
          '---',
          JSON.stringify(data, null, 2),
        ].join('\n');
    }
  })();

  return { system, user };
}
