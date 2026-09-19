/**
 * LLM provider interface.
 *
 * RepoPilot is LLM-agnostic. The business logic NEVER directly calls any
 * vendor SDK. If no LLM is configured, the report builder falls back to
 * deterministic templates — see `templates.ts`.
 *
 * Implementations live in:
 *   - `noop-provider.ts` (default; returns null/empty → templates are used)
 *   - `openai-compatible-provider.ts` (OpenAI-compatible HTTP API)
 *
 * Both share this interface so swapping providers is just a config change.
 */
import type { LaunchCopy, Report } from '../schemas/report.js';

export interface LLMGenerateInput {
  report: Report;
  /** What we need from the LLM. */
  task: 'summary' | 'launch_copy' | 'polish';
  /** BCP-47 language tag. */
  language: 'en' | 'zh-CN';
  /** Hard cap on the response. */
  maxTokens?: number;
}

export interface LLMProvider {
  /** Provider name (e.g. "noop", "openai-compatible"). */
  name: string;
  /** True if the provider is actually configured and ready to call. */
  isConfigured(): boolean;
  /** Generate text for a specific task. Returns null if the provider can't or won't. */
  generate(input: LLMGenerateInput): Promise<string | null>;
}

export interface LLMOptions {
  /** Optional pre-formatted context to embed in the prompt. */
  extraContext?: string;
  /** If true, never throw — log and return null. */
  safe?: boolean;
}

/**
 * Combined interface used by the report builder.
 */
export interface LLMSummary {
  summary: string;
  launchCopy: LaunchCopy;
}
