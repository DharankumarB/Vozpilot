/**
 * Built-in deterministic reasoning engine.
 *
 * Used when no hosted LLM key is configured. It performs the same job an LLM
 * would for command-style requests: understand the request, resolve it against
 * the user's real records, and emit a structured tool call. It is not a canned
 * response - every answer it produces comes from data VozCore retrieved from the
 * database during the same run.
 *
 * The UI always labels which engine answered so the distinction is never hidden.
 */

import type { AiProvider, ChatRequest, ChatResult, Clarification, ProviderContext } from '../provider';
import { parseIntent, type IntentContext } from '../intent';

export class LocalReasoningProvider implements AiProvider {
  readonly id = 'vozpilot-local';
  readonly model = 'local-reasoning-v1';
  readonly kind = 'deterministic' as const;

  async chat(request: ChatRequest): Promise<ChatResult> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) {
      return { content: 'Tell me what you would like to do.', toolCalls: [], finishReason: 'stop' };
    }

    const context = this.toIntentContext(request.context);
    const intent = parseIntent(lastUser.content, context);

    if (intent.clarification) {
      return {
        content: intent.clarification.question,
        toolCalls: [],
        finishReason: 'clarify',
        clarification: intent.clarification,
      };
    }

    if (!intent.tool) {
      return { content: intent.reply ?? 'I am not sure how to help with that yet.', toolCalls: [], finishReason: 'stop' };
    }

    const id = `call_${Math.random().toString(36).slice(2, 10)}`;
    return {
      content: intent.reply ?? '',
      toolCalls: [{ id, name: intent.tool, arguments: intent.args }],
      finishReason: 'tool_use',
    };
  }

  private toIntentContext(context: ProviderContext): IntentContext {
    return {
      tasks: context.tasks,
      projects: context.projects,
      goals: context.goals,
      timezone: context.timezone,
      now: new Date(context.now),
    };
  }
}

export type { Clarification };
