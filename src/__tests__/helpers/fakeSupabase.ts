/**
 * In-memory Supabase-compatible test double.
 *
 * Repositories in `src/lib/db` speak only to the narrow `DbClient` interface, so
 * substituting this fake exercises the *real* production data-access code without
 * needing a live Postgres instance. It mirrors PostgREST semantics closely enough
 * for the behaviours under test: filtering, ordering, limiting, insert/update/
 * delete with and without `.select()`, `single()` vs `maybeSingle()`, and
 * unique-constraint violations.
 */

import type { DbClient, DbError, DbResponse, TableQuery } from '../../lib/db/client';

type Row = Record<string, unknown>;
type Comparator = (value: unknown) => boolean;

interface Filter {
  apply(row: Row): boolean;
}

class FakeQuery<T extends Row> implements TableQuery<T> {
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private selected = false;
  private pending: 'none' | 'insert' | 'update' | 'delete' | 'upsert' = 'none';
  private payload: Row | Row[] | null = null;
  private conflictColumns: string[] = [];
  private ignoreDuplicates = false;

  constructor(
    private readonly store: Map<string, Row[]>,
    private readonly table: string,
    private readonly now: string,
  ) {}

  private rows(): Row[] {
    return this.store.get(this.table) ?? [];
  }

  /**
   * Run the pending mutation. Errors are *returned*, never thrown — that is how
   * the real client behaves, and it is what makes repository error paths
   * testable.
   */
  private commit(): { rows: Row[]; error: DbError | null } {
    const table = this.rows();
    const matched = table.filter((row) => this.filters.every((filter) => filter.apply(row)));

    if (this.pending === 'insert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const inserted: Row[] = [];
      for (const raw of incoming) {
        const row = { ...defaults(this.table, this.now), ...raw } as Row;
        const clash = this.rows().some((existing) => uniqueClash(this.table, existing, row));
        if (clash) {
          if (this.ignoreDuplicates) continue;
          return {
            rows: [],
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          };
        }
        table.push(row);
        inserted.push(row);
      }
      return { rows: inserted, error: null };
    }

    if (this.pending === 'upsert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const result: Row[] = [];
      for (const raw of incoming) {
        const row = { ...defaults(this.table, this.now), ...raw } as Row;
        const existingIndex = this.rows().findIndex((candidate) =>
          this.conflictColumns.every((column) => candidate[column] === row[column]),
        );
        if (existingIndex >= 0) {
          this.rows()[existingIndex] = { ...this.rows()[existingIndex], ...row };
          result.push(this.rows()[existingIndex]);
        } else {
          table.push(row);
          result.push(row);
        }
      }
      return { rows: result, error: null };
    }

    if (this.pending === 'update') {
      const patch = this.payload as Row;
      for (const row of matched) Object.assign(row, patch);
      return { rows: matched, error: null };
    }

    if (this.pending === 'delete') {
      const remaining = this.rows().filter((row) => !matched.includes(row));
      this.store.set(this.table, remaining);
      return { rows: matched, error: null };
    }

    return { rows: matched, error: null };
  }

  private resolve(): DbResponse<T[]> {
    const { rows, error } = this.commit();
    if (error) return { data: null, error };
    let result = rows;
    if (this.orders.length > 0) {
      result = [...result].sort((a, b) => {
        for (const order of this.orders) {
          const av = a[order.column];
          const bv = b[order.column];
          if (av === bv) continue;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          const comparison = av! > bv! ? 1 : -1;
          return order.ascending ? comparison : -comparison;
        }
        return 0;
      });
    }
    if (this.limitCount !== null) result = result.slice(0, this.limitCount);
    return { data: (this.selected ? result : []) as T[], error: null };
  }

  select(): TableQuery<T> {
    this.selected = true;
    return this;
  }

  insert(rows: Row | Row[]): TableQuery<T> {
    this.pending = 'insert';
    this.payload = rows;
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): TableQuery<T> {
    this.pending = 'upsert';
    this.payload = rows;
    this.conflictColumns = options?.onConflict ? options.onConflict.split(',').map((column) => column.trim()) : [];
    this.ignoreDuplicates = options?.ignoreDuplicates === true;
    return this;
  }

  update(patch: Row): TableQuery<T> {
    this.pending = 'update';
    this.payload = patch;
    return this;
  }

  delete(): TableQuery<T> {
    this.pending = 'delete';
    return this;
  }

  eq(column: string, value: unknown): TableQuery<T> {
    this.filters.push({ apply: (row) => row[column] === value });
    return this;
  }

  neq(column: string, value: unknown): TableQuery<T> {
    this.filters.push({ apply: (row) => row[column] !== value });
    return this;
  }

  in(column: string, values: readonly unknown[]): TableQuery<T> {
    this.filters.push({ apply: (row) => values.includes(row[column]) });
    return this;
  }

  is(column: string, value: null | boolean): TableQuery<T> {
    this.filters.push({ apply: (row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value) });
    return this;
  }

  gte(column: string, value: unknown): TableQuery<T> {
    this.filters.push({ apply: (row) => compareValues(row[column], value) >= 0 });
    return this;
  }

  lte(column: string, value: unknown): TableQuery<T> {
    this.filters.push({ apply: (row) => compareValues(row[column], value) <= 0 });
    return this;
  }

  gt(column: string, value: unknown): TableQuery<T> {
    this.filters.push({ apply: (row) => compareValues(row[column], value) > 0 });
    return this;
  }

  lt(column: string, value: unknown): TableQuery<T> {
    this.filters.push({ apply: (row) => compareValues(row[column], value) < 0 });
    return this;
  }

  like(column: string, pattern: string): TableQuery<T> {
    this.filters.push({ apply: (row) => likeMatch(String(row[column] ?? ''), pattern) });
    return this;
  }

  ilike(column: string, pattern: string): TableQuery<T> {
    this.filters.push({ apply: (row) => likeMatch(String(row[column] ?? '').toLowerCase(), pattern.toLowerCase()) });
    return this;
  }

  or(filter: string): TableQuery<T> {
    // Supports the `col.ilike.%pattern%,col.ilike.%pattern%` shape used by search.
    const clauses = filter.split(',').map((clause) => clause.trim());
    this.filters.push({
      apply: (row) =>
        clauses.some((clause) => {
          const match = /^([a-z_]+)\.(ilike|eq|is)\.(.*)$/i.exec(clause);
          if (!match) return false;
          const [, column, operator, operand] = match;
          if (operator === 'eq') return String(row[column]) === operand;
          if (operator === 'is') return operand === 'null' ? row[column] === null : row[column] !== null;
          return likeMatch(String(row[column] ?? '').toLowerCase(), operand.toLowerCase());
        }),
    });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): TableQuery<T> {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): TableQuery<T> {
    this.limitCount = count;
    return this;
  }

  async single(): Promise<DbResponse<T>> {
    const result = this.resolve();
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    if (rows.length === 0) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<DbResponse<T | null>> {
    const result = this.resolve();
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = DbResponse<T[]>, TResult2 = never>(
    onfulfilled?: ((value: DbResponse<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

/**
 * Total order across the value shapes PostgREST compares: numbers, ISO-8601
 * timestamps, and plain strings. Nulls sort last, matching Postgres defaults.
 */
function compareValues(a: unknown, b: unknown): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  const left = String(a);
  const right = String(b);
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && /\d{4}-\d{2}-\d{2}/.test(left) && /\d{4}-\d{2}-\d{2}/.test(right)) {
    return leftTime - rightTime;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function likeMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 's').test(value);
}

/**
 * Column defaults for a table.
 *
 * `now` is a single timestamp captured once per store, modelling Postgres'
 * transaction-scoped `now()`: every row written by one connection sees the same
 * value. Capturing it per row instead would make tie-break ordering depend on
 * wall-clock milliseconds and turn ordering assertions flaky.
 */
function defaults(table: string, now: string): Row {
  const base: Row = { id: `id-${Math.random().toString(36).slice(2, 10)}`, created_at: now, updated_at: now };
  if (table === 'profiles') return { ...base, full_name: '', timezone: 'UTC', locale: 'en-US', onboarded_at: null };
  if (table === 'tasks') return { ...base, status: 'todo', priority: 'medium', tags: [], source: 'manual', idempotency_key: null };
  if (table === 'goals') return { ...base, progress: 0, health: 100, priority: 'medium', status: 'active', category: 'general' };
  if (table === 'projects') return { ...base, progress: 0, health: 100, risk: 0, status: 'planning', priority: 'medium' };
  return base;
}

/** Columns that carry a unique constraint in the real schema. */
const UNIQUE: Record<string, string[]> = {
  tasks: ['idempotency_key'],
  daily_plans: ['user_id', 'plan_date'],
  integrations: ['user_id', 'provider'],
  task_dependencies: ['task_id', 'depends_on_task_id'],
  ai_permissions: ['user_id'],
  user_preferences: ['user_id'],
};

function uniqueClash(table: string, existing: Row, incoming: Row): boolean {
  const columns = UNIQUE[table];
  if (!columns) return false;
  return columns.some((column) => {
    const value = incoming[column];
    if (value === null || value === undefined) return false;
    return existing[column] === value;
  });
}

export class DbConstraintError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DbConstraintError';
  }
}

export interface FakeSupabase {
  client: DbClient;
  table(name: string): Row[];
  seed(name: string, rows: Row[]): void;
  reset(): void;
}

export function createFakeSupabase(): FakeSupabase {
  const store = new Map<string, Row[]>();
  const now = new Date().toISOString();
  return {
    client: {
      from<T extends Row>(table: string): TableQuery<T> {
        if (!store.has(table)) store.set(table, []);
        return new FakeQuery<T>(store, table, now);
      },
    } as DbClient,
    table(name) {
      return store.get(name) ?? [];
    },
    seed(name, rows) {
      store.set(name, rows.map((row) => ({ ...defaults(name, now), ...row })));
    },
    reset() {
      store.clear();
    },
  };
}

export const TEST_USER = '11111111-1111-1111-1111-111111111111';
export const OTHER_USER = '22222222-2222-2222-2222-222222222222';

export function isoDaysFromNow(days: number, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}
