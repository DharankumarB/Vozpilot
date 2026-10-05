/**
 * VozCore - the central orchestration layer.
 *
 * Lifecycle per run:
 *   OBSERVE -> CONTEXT RETRIEVAL -> UNDERSTAND -> REASON -> PLAN -> SELECT TOOL
 *   -> EXECUTE TOOL -> VERIFY RESULT -> UPDATE DATABASE -> UPDATE MEMORY
 *   -> GENERATE RESPONSE
 *
 * The model never touches the database. It emits structured tool calls; VozCore
 * validates them, permission-checks them, executes them and returns the result.
 * Every run and every tool call is written to the audit log.
 */

import type { AgentAction, AgentName, PermissionLevel } from '../types';
import type { DbClient } from '../db/client';
import * as repo from '../db/repositories';
import { resolveProvider, type ChatMessage, type Clarification, type ToolSpec } from '../ai/provider';
import { buildSystemPrompt } from './prompts';
import { loadUserContext, providerCandidates, agentForTool, memoryBlockFor } from './context';
import { TOOLS, getTool } from './tools';
import { evaluatePermission } from './permissions';
import { AgentBudgetTracker, BudgetExceededError, DEFAULT_BUDGET, type AgentBudget } from './loopGuard';
import { emitNotification, notify } from '../notifications/service';

export interface VozCoreAction {
  tool: string;
  agent: AgentName;
  permission: PermissionLevel;
  status: AgentAction['status'];
  summary: string;
  entityType?: string;
  entityId?: string;
  reason?: string;
}

export interface RunVozCoreInput {
  db: DbClient;
  userId: string;
  message: string;
  timezone: string;
  conversationId?: string;
  confirmed?: boolean;
  budget?: Partial<AgentBudget>;
  channel?: 'chat' | 'system' | 'api' | 'onboarding' | 'cron';
}

export interface RunVozCoreResult {
  ok: boolean;
  reply: string;
  actions: VozCoreAction[];
  runId: string | null;
  conversationId: string | null;
  clarification: Clarification | null;
  pendingConfirmation: { tool: string; args: Record<string, unknown>; preview: string } | null;
  provider: { id: string; model: string; kind: 'llm' | 'deterministic'; reason: string };
  stopped: string | null;
  usage?: { inputTokens: number; outputTokens: number };
}

export class VozCoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VozCoreUnavailableError';
  }
}

const MAX_HISTORY = 16;

export async function runVozCore(input: RunVozCoreInput): Promise<RunVozCoreResult> {
  const now = new Date();
  const budget = { ...DEFAULT_BUDGET, ...input.budget };
  const tracker = new AgentBudgetTracker(budget);
  const { provider, reason } = resolveProvider();

  const context = await loadUserContext(input.db, input.userId, input.timezone, { now });
  const permissions = context.permissions;
  const preferences = context.preferences;

  // Conversation bookkeeping (failures here must never block the answer).
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const existing = await repo.listMessages(input.db, input.userId, conversationId);
    if (existing.error) conversationId = null;
  }
  if (!conversationId) {
    const created = await repo.createConversation(input.db, input.userId, input.message.slice(0, 80));
    conversationId = created.data?.id ?? null;
  }
  if (conversationId) {
    await repo.createMessage(input.db, input.userId, {
      conversation_id: conversationId,
      role: 'user',
      content: input.message,
    });
  }

  const run = await repo.createAgentRun(input.db, input.userId, {
    agent: 'vozcore',
    channel: input.channel ?? 'chat',
    input_summary: input.message.slice(0, 300),
    status: 'running',
    provider: provider.kind === 'llm' ? provider.id : 'local',
    model: provider.model,
    started_at: now.toISOString(),
  });
  const runId = run.data?.id ?? null;

  const actions: VozCoreAction[] = [];
  const memoryBlock = memoryBlockFor(context, input.message, now);
  const candidates = providerCandidates(context);

  const history: ChatMessage[] = conversationId
    ? (await repo.listMessages(input.db, input.userId, conversationId)).data
        ?.slice(-MAX_HISTORY)
        .map((message) => ({ role: message.role as ChatMessage['role'], content: message.content })) ?? []
    : [];

  const tools: ToolSpec[] = TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: { type: 'object', properties: {}, required: [] },
  }));

  const system = buildSystemPrompt({
    context,
    tools,
    memoriesBlock: memoryBlock,
    timezone: input.timezone,
    now: now.toISOString(),
    providerKind: provider.kind,
  });

  const messages: ChatMessage[] = [...history, { role: 'user', content: input.message }];

  let reply = '';
  let clarification: Clarification | null = null;
  let pendingConfirmation: RunVozCoreResult['pendingConfirmation'] = null;
  let stopped: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let runStatus: AgentAction['status'] extends never ? never : 'completed' | 'failed' | 'cancelled' | 'limit_reached' = 'completed';

  const recordAction = async (action: {
    tool: string;
    agent: AgentName;
    permission: PermissionLevel;
    status: AgentAction['status'];
    summary: string;
    input: Record<string, unknown>;
    output?: unknown;
    entityType?: string;
    entityId?: string;
    reason?: string;
    error?: string;
  }): Promise<void> => {
    actions.push({
      tool: action.tool,
      agent: action.agent,
      permission: action.permission,
      status: action.status,
      summary: action.summary,
      entityType: action.entityType,
      entityId: action.entityId,
      reason: action.reason,
    });
    if (runId) {
      await repo.createAgentAction(input.db, input.userId, {
        run_id: runId,
        agent: action.agent,
        tool: action.tool,
        action: action.summary,
        entity_type: action.entityType ?? null,
        entity_id: action.entityId ?? null,
        permission: action.permission,
        input: action.input,
        output: (action.output ?? {}) as Record<string, unknown>,
        status: action.status,
        reason: action.reason ?? '',
        error: action.error ?? null,
      });
    }
  };

  try {
    for (;;) {
      tracker.beginIteration();

      let result;
      try {
        result = await provider.chat({ system, messages, tools, context: { ...candidates, timezone: input.timezone, now: now.toISOString() } });
      } catch (error) {
        tracker.consumeRetry();
        if (tracker.stats().retries > budget.maxRetries) {
          throw new VozCoreUnavailableError(
            'VozPilot AI is temporarily unavailable. Your existing data is safe. Please retry in a moment.',
          );
        }
        continue;
      }

      if (result.usage) usage = result.usage;

      if (result.clarification) {
        clarification = result.clarification;
        reply = result.clarification.question;
        break;
      }

      if (result.toolCalls.length === 0) {
        reply = result.content || 'Done.';
        break;
      }

      let shouldStop = false;

      for (const call of result.toolCalls) {
        tracker.consumeToolCall();
        const tool = getTool(call.name);

        if (!tool) {
          const message = `Unknown tool "${call.name}" - the request was rejected and nothing was changed.`;
          await recordAction({
            tool: call.name,
            agent: agentForTool(call.name),
            permission: 'read',
            status: 'denied',
            summary: message,
            input: call.arguments,
            reason: 'tool_not_registered',
          });
          messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify({ error: message }) });
          continue;
        }

        const agent = tool.agent;
        const decision = evaluatePermission(call.name, permissions, {
          confirmed: input.confirmed === true,
          preview: describeToolCall(call.name, call.arguments),
        });

        if (decision.status === 'denied') {
          await recordAction({
            tool: call.name,
            agent,
            permission: decision.level,
            status: 'denied',
            summary: decision.reason,
            input: call.arguments,
            reason: 'permission_denied',
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ error: decision.reason }),
          });
          continue;
        }

        if (decision.status === 'needs_confirmation') {
          await recordAction({
            tool: call.name,
            agent,
            permission: decision.level,
            status: 'skipped',
            summary: 'Waiting for user confirmation.',
            input: call.arguments,
            reason: 'confirmation_required',
          });
          pendingConfirmation = { tool: call.name, args: call.arguments, preview: decision.preview };
          reply = `${decision.reason}\n\n${decision.preview}\n\nConfirm to continue.`;
          shouldStop = true;
          break;
        }

        // Validate arguments. Malformed calls are rejected, never executed.
        const parsed = tool.schema.safeParse(call.arguments);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; ');
          await recordAction({
            tool: call.name,
            agent,
            permission: decision.level,
            status: 'failed',
            summary: `Rejected invalid arguments for ${call.name}.`,
            input: call.arguments,
            error: issues,
            reason: 'validation_failed',
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ error: `Invalid arguments: ${issues}` }),
          });
          continue;
        }

        const result = await tool.execute(
          {
            db: input.db,
            userId: input.userId,
            runId,
            agent,
            now,
            timezone: input.timezone,
            confirmed: input.confirmed === true,
          },
          parsed.data as Record<string, unknown>,
        );

        if (!result.ok) {
          await recordAction({
            tool: call.name,
            agent,
            permission: decision.level,
            status: 'failed',
            summary: result.summary,
            input: call.arguments,
            error: result.error,
            reason: 'execution_failed',
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ error: result.error ?? result.summary }),
          });
          continue;
        }

        await recordAction({
          tool: call.name,
          agent,
          permission: decision.level,
          status: 'success',
          summary: result.summary,
          input: call.arguments,
          output: result.data,
          entityType: result.entityType,
          entityId: result.entityId,
          reason: describeToolCall(call.name, call.arguments),
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: JSON.stringify({ data: result.data, summary: result.summary }).slice(0, 20000),
        });
      }

      if (shouldStop) break;
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      stopped = error.message;
      runStatus = 'limit_reached';
      reply = reply || error.message;
    } else if (error instanceof VozCoreUnavailableError) {
      stopped = error.message;
      runStatus = 'failed';
      reply = error.message;
    } else {
      stopped = error instanceof Error ? error.message : 'Unexpected agent failure.';
      runStatus = 'failed';
      reply = 'VozPilot AI hit an unexpected error. Your data is safe - please try again.';
    }
  }

  const stats = tracker.stats();

  if (runId) {
    await repo.finishAgentRun(input.db, input.userId, runId, {
      status: stopped ? runStatus : 'completed',
      iterations: stats.iterations,
      tool_calls: stats.toolCalls,
      duration_ms: stats.durationMs,
      error: stopped,
      finished_at: new Date().toISOString(),
    });
  }

  if (conversationId) {
    await repo.createMessage(input.db, input.userId, {
      conversation_id: conversationId,
      role: 'assistant',
      content: reply,
      tool_calls: actions.map((action) => ({ tool: action.tool, summary: action.summary, status: action.status })),
      action_summary: { actions, provider: { id: provider.id, model: provider.model, kind: provider.kind } },
    });
  }

  // Surface agent activity only when the user asked for it (avoids notification spam).
  if (preferences.agent_alerts && actions.some((action) => action.status === 'success' && action.permission !== 'read')) {
    await emitNotification(
      input.db,
      input.userId,
      notify.agentAction('VozCore completed actions', actions.map((action) => action.summary).join(' • ')),
      preferences,
      { now },
    );
  }

  return {
    ok: !stopped,
    reply,
    actions,
    runId,
    conversationId,
    clarification,
    pendingConfirmation,
    provider: { id: provider.id, model: provider.model, kind: provider.kind, reason },
    stopped,
    usage,
  };
}

function describeToolCall(tool: string, args: Record<string, unknown>): string {
  const title = (args.title as string) ?? (args.task_query as string) ?? (args.goal_query as string) ?? (args.project_query as string) ?? '';
  return title ? `${tool}: ${title}` : tool;
}
