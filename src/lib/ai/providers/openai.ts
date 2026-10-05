/**
 * OpenAI provider (Chat Completions API with function calling).
 *
 * Server-only. The key never leaves this module.
 */

import type { AiProvider, ChatRequest, ChatResult, ToolCallRequest, ToolSpec } from '../provider';
import { ProviderError } from '../provider';

interface OpenAIResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAIProvider implements AiProvider {
  readonly id = 'openai';
  readonly kind = 'llm' as const;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  ) {
    this.model = model;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const tools: ToolSpec[] = request.tools;
    const messages: Array<Record<string, unknown>> = [{ role: 'system', content: request.system }];

    for (const message of request.messages) {
      if (message.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: message.tool_call_id ?? '', content: message.content.slice(0, 20000) });
      } else {
        messages.push({ role: message.role, content: message.content });
      }
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 2048,
        messages,
        tools: tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        `OpenAI request failed (${response.status}). ${detail.slice(0, 200)}`,
        response.status === 429 || response.status >= 500,
      );
    }

    const payload = (await response.json()) as OpenAIResponse;
    const choice = payload.choices?.[0];
    const raw = choice?.message?.tool_calls ?? [];

    const toolCalls: ToolCallRequest[] = [];
    for (const call of raw) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.function.arguments || '{}');
      } catch {
        // Malformed arguments are rejected downstream by Zod; never executed raw.
        parsed = {};
      }
      toolCalls.push({ id: call.id, name: call.function.name, arguments: parsed });
    }

    return {
      content: (choice?.message?.content ?? '').trim(),
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      usage: payload.usage
        ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
        : undefined,
    };
  }
}
