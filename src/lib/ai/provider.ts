/**
 * AI provider abstraction.
 *
 * VozCore never talks to a model directly. It talks to an `AiProvider`, which is
 * either a real hosted LLM (Anthropic / OpenAI, keys server-side only) or the
 * built-in deterministic reasoning engine used when no key is configured.
 *
 * Both providers emit the same shape: either a natural-language reply, or a list
 * of structured tool calls that the backend validates and executes.
 */

import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { LocalReasoningProvider } from './providers/local';

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface EntityCandidate {
  id: string;
  title: string;
  subtitle?: string;
}

export interface ProviderContext {
  /** Real records the provider may reference when resolving natural language. */
  tasks: EntityCandidate[];
  projects: EntityCandidate[];
  goals: EntityCandidate[];
  timezone: string;
  now: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  context: ProviderContext;
  maxTokens?: number;
}

export interface Clarification {
  question: string;
  options: Array<{ id: string; label: string }>;
  tool: string;
  partialArguments: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCallRequest[];
  finishReason: 'stop' | 'tool_use' | 'clarify' | 'error';
  clarification?: Clarification;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  /** `llm` = hosted model, `deterministic` = built-in reasoning engine. */
  readonly kind: 'llm' | 'deterministic';
  chat(request: ChatRequest): Promise<ChatResult>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
  }
}

/** Provider registry: the first configured provider wins. */
export function resolveProvider(): { provider: AiProvider; reason: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: new AnthropicProvider(process.env.ANTHROPIC_API_KEY),
      reason: 'ANTHROPIC_API_KEY detected - using Anthropic.',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: new OpenAIProvider(process.env.OPENAI_API_KEY),
      reason: 'OPENAI_API_KEY detected - using OpenAI.',
    };
  }
  return {
    provider: new LocalReasoningProvider(),
    reason: 'No AI provider key configured - using the built-in deterministic reasoning engine.',
  };
}
