'use client';

/**
 * Data-fetching hooks.
 *
 * Every screen uses these so loading, empty, error and retry behaviour is
 * identical everywhere. Requests are always authenticated by the server session;
 * no user id is ever sent from the client.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function useApi<T>(url: string | null, options: { enabled?: boolean } = {}): ApiState<T> {
  const enabled = options.enabled !== false && url !== null;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as { data: T };
      })
      .then((payload) => {
        if (!alive.current) return;
        setData(payload.data ?? null);
      })
      .catch((cause: unknown) => {
        if (!alive.current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load data.');
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const update = useCallback((updater: T | ((current: T | null) => T | null)) => {
    setData((current) => (typeof updater === 'function' ? (updater as (c: T | null) => T | null)(current) : updater));
  }, []);

  return { data, error, loading, reload, setData: update };
}

export interface MutationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/** Typed request helper used by every form in the app. */
export async function apiRequest<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<MutationResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!response.ok) {
      return { ok: false, error: payload.error ?? `Request failed (${response.status}).`, status: response.status };
    }
    return { ok: true, data: payload.data, status: response.status };
  } catch {
    return { ok: false, error: 'Network error. Check your connection and try again.' };
  }
}

/** Stable idempotency key so double-clicks and retries never duplicate work. */
export function useIdempotencyKey(scope: string): () => string {
  const ref = useRef<string | null>(null);
  return useCallback(() => {
    if (!ref.current) {
      ref.current = `${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return ref.current;
  }, [scope]);
}

export function resetIdempotencyKey(keyRef: { current: string | null }): void {
  keyRef.current = null;
}

/** Debounce a value (used by search). */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Media query hook for responsive behaviour that CSS alone cannot express. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
