/**
 * Narrow database boundary.
 *
 * Repositories in this folder speak only to the `DbClient` interface below.
 * The production adapter wraps the real Supabase client; tests substitute an
 * in-memory fake. Keeping the seam this small means every repository is unit
 * testable without a live database, and the production path is unchanged.
 */

export interface DbError {
  message: string;
  code?: string;
  details?: string;
}

export interface DbResponse<T> {
  data: T | null;
  error: DbError | null;
}

export interface OrderOptions {
  ascending?: boolean;
  nullsFirst?: boolean;
}

export interface TableQuery<T> extends PromiseLike<DbResponse<T[]>> {
  select(columns?: string): TableQuery<T>;
  insert(rows: Partial<T> | Partial<T>[]): TableQuery<T>;
  update(patch: Partial<T>): TableQuery<T>;
  upsert(rows: Partial<T> | Partial<T>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): TableQuery<T>;
  delete(): TableQuery<T>;
  eq(column: string, value: unknown): TableQuery<T>;
  neq(column: string, value: unknown): TableQuery<T>;
  in(column: string, values: readonly unknown[]): TableQuery<T>;
  is(column: string, value: null | boolean): TableQuery<T>;
  gte(column: string, value: unknown): TableQuery<T>;
  lte(column: string, value: unknown): TableQuery<T>;
  gt(column: string, value: unknown): TableQuery<T>;
  lt(column: string, value: unknown): TableQuery<T>;
  like(column: string, pattern: string): TableQuery<T>;
  ilike(column: string, pattern: string): TableQuery<T>;
  or(filter: string): TableQuery<T>;
  order(column: string, options?: OrderOptions): TableQuery<T>;
  limit(count: number): TableQuery<T>;
  single(): Promise<DbResponse<T>>;
  maybeSingle(): Promise<DbResponse<T | null>>;
}

export interface DbClient {
  from<T = Record<string, unknown>>(table: string): TableQuery<T>;
}

/** Adapt the real Supabase client to the narrow `DbClient` interface. */
export function toDbClient(client: unknown): DbClient {
  return client as DbClient;
}

export class DbFailure extends Error {
  readonly code: string | undefined;
  constructor(error: DbError, context: string) {
    super(`${context}: ${error.message}`);
    this.name = 'DbFailure';
    this.code = error.code;
  }
}

/** Normalise a Supabase error into a stable, non-leaking message. */
export function describeDbError(error: DbError | null, fallback: string): DbError {
  if (!error) return { message: fallback };
  // Postgres error codes we want to surface verbatim; everything else is generic.
  const surfaced = new Set(['23505', '23503', '23514', '23502', '22P02', '42501']);
  if (error.code && surfaced.has(error.code)) {
    const friendly: Record<string, string> = {
      '23505': 'That record already exists.',
      '23503': 'A linked record is missing or no longer exists.',
      '23514': 'A value is outside the allowed range.',
      '23502': 'A required value is missing.',
      '22P02': 'A value has an invalid format.',
      '42501': 'You do not have permission to perform this action.',
    };
    return { message: friendly[error.code] ?? fallback, code: error.code };
  }
  return { message: fallback, code: error.code };
}
