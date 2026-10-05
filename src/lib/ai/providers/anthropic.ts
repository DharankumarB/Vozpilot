/**
 * Anthropic provider.
 *
 * The API key is read from the environment on the server only and is never
 * forwarded to the client. Tool calls are requested with Anthropic's native
 * tool-use format and normalised into `ChatResult`.
 */

import type { AiProvider, ChatRequest, ChatResult, ToolCallRequest, ToolSpec } from '../provider';
import { ProviderError } from '../provider';

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: ToolSpec['parameters'];
}

interface AnthropicResponse {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly kind = 'llm' as const;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  ) {
    this.model = model;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const tools: AnthropicTool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));

    // Only user/assistant turns are forwarded; tool results are replayed as
    // user-role tool_result blocks.
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: message.tool_call_id ?? '',
                content: message.content.slice(0, 20000),
              },
            ],
          };
        }
        return { role: message.role as 'user' | 'assistant', content: message.content };
      });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 2048,
        system: request.system,
        tools,
        messages,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        `Anthropic request failed (${response.status}). ${detail.slice(0, 200)}`,
        response.status === 429 || response.status >= 500,
      );
    }

    const payload = (await response.json()) as AnthropicResponse;
    const blocks = payload.content ?? [];

    const text = blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const toolCalls: ToolCallRequest[] = blocks
      .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, arguments: block.input ?? {} }));

    return {
      content: text,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      usage: payload.usage
        ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
        : undefined,
    };
  }
}
