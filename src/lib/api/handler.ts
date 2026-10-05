/**
 * API route helpers.
 *
 * Every route:
 *   - resolves the user from the Supabase session (never from the request body),
 *   - validates input with Zod,
 *   - returns a consistent JSON envelope,
 *   - never leaks internal error detail to the client.
 */

import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { createServerDbClient, isSupabaseConfigured } from '../supabase/client';
import type { DbClient } from '../db/client';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'bad_request',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(error: ApiError | Error, status = 500): NextResponse<ApiEnvelope<never>> {
  if (error instanceof ApiError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  // Unexpected failures are logged server-side and reported generically.
  console.error('[vozpilot] unhandled api error', error);
  return NextResponse.json(
    { ok: false, error: 'Something went wrong on our side. Please try again.', code: 'internal_error' },
    { status },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('Request body must be valid JSON.', 400, 'invalid_json');
  }
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await readJson(request);
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
    throw new ApiError(`Invalid request. ${issues}`, 422, 'validation_error');
  }
  return result.data;
}

export interface AuthContext {
  db: DbClient;
  userId: string;
  email: string;
}

/**
 * Resolve the caller from the session. Throws 401 when unauthenticated so no
 * route can accidentally operate without a verified user.
 */
export async function requireUser(): Promise<AuthContext> {
  if (!isSupabaseConfigured()) {
    throw new ApiError('VozPilot is not connected to a database yet. Configure Supabase to continue.', 503, 'not_configured');
  }
  const supabase = await createServerDbClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiError('Your session has expired. Please sign in again.', 401, 'unauthenticated');
  }
  return { db: supabase as unknown as DbClient, userId: data.user.id, email: data.user.email ?? '' };
}

/** Idempotency: a client-supplied key that prevents double-submits from duplicating. */
export function idempotencyFrom(request: Request): string | null {
  return request.headers.get('idempotency-key') ?? request.headers.get('x-idempotency-key');
}

export function withRoute(handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return jsonError(error as Error);
    }
  };
}
