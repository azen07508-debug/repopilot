/**
 * OpenAI-compatible LLM provider.
 *
 * Speaks the OpenAI Chat Completions HTTP API. Most modern inference
 * providers (OpenAI, Together, Anyscale, OpenRouter, vLLM, etc.) implement
 * the same shape, so this single class covers a wide range of backends.
 *
 * The provider is intentionally minimal: one endpoint, one body shape, no
 * streaming. If you need tool calls or vision, add a sibling class.
 */
import type { LLMGenerateInput, LLMProvider } from './provider.js';
import { buildPrompt } from './prompts.js';

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** Optional request timeout in ms. */
  timeoutMs?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  error?: { message: string; type?: string };
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: OpenAICompatibleProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.model;
  }

  async generate(input: LLMGenerateInput): Promise<string | null> {
    if (!this.isConfigured()) return null;
    const prompt = buildPrompt(input);
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ] satisfies ChatMessage[],
      temperature: 0.2,
      max_tokens: input.maxTokens ?? 600,
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok) {
        return null;
      }
      const text = data.choices?.[0]?.message?.content?.trim();
      return text ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
