/**
 * Agent loop protection.
 *
 * Every execution runs inside a budget. When the budget is exhausted the run is
 * stopped safely and the user is told why - the agent never silently continues.
 */

export interface AgentBudget {
  maxToolCalls: number;
  maxIterations: number;
  maxDurationMs: number;
  maxRetries: number;
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxToolCalls: 10,
  maxIterations: 6,
  maxDurationMs: 45_000,
  maxRetries: 2,
};

export class BudgetExceededError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'BudgetExceededError';
  }
}

export class AgentBudgetTracker {
  private toolCalls = 0;
  private iterations = 0;
  private retries = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly budget: AgentBudget = DEFAULT_BUDGET) {}

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  beginIteration(): void {
    this.iterations += 1;
    if (this.iterations > this.budget.maxIterations) {
      throw new BudgetExceededError(
        `Agent execution stopped safely. Reason: maximum reasoning iterations (${this.budget.maxIterations}) reached.`,
      );
    }
    this.checkDuration();
  }

  consumeToolCall(): void {
    this.toolCalls += 1;
    if (this.toolCalls > this.budget.maxToolCalls) {
      throw new BudgetExceededError(
        `Agent execution stopped safely. Reason: maximum tool calls (${this.budget.maxToolCalls}) reached.`,
      );
    }
  }

  consumeRetry(): void {
    this.retries += 1;
    if (this.retries > this.budget.maxRetries) {
      throw new BudgetExceededError(
        `Agent execution stopped safely. Reason: maximum retries (${this.budget.maxRetries}) reached.`,
      );
    }
  }

  private checkDuration(): void {
    if (this.elapsedMs > this.budget.maxDurationMs) {
      throw new BudgetExceededError(
        `Agent execution stopped safely. Reason: execution time limit (${this.budget.maxDurationMs}ms) reached.`,
      );
    }
  }

  stats(): { toolCalls: number; iterations: number; retries: number; durationMs: number } {
    return { toolCalls: this.toolCalls, iterations: this.iterations, retries: this.retries, durationMs: this.elapsedMs };
  }
}

/** Idempotency key helper - prevents double-clicks and retries from duplicating work. */
export function idempotencyKey(userId: string, action: string, payload: string): string {
  let hash = 0;
  const input = `${userId}:${action}:${payload}`;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return `${action}-${Math.abs(hash).toString(36)}`;
}
