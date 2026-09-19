/**
 * No-op LLM provider — used when no LLM is configured.
 *
 * RepoPilot is *designed* to produce complete, high-quality reports without
 * any LLM. This provider always reports `isConfigured: false`, so the report
 * builder will route to its deterministic templates.
 */
import type { LLMGenerateInput, LLMProvider } from './provider.js';

export class NoopLLMProvider implements LLMProvider {
  readonly name = 'noop';
  isConfigured(): boolean {
    return false;
  }
  async generate(_input: LLMGenerateInput): Promise<string | null> {
    return null;
  }
}
