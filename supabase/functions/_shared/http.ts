// Shared helpers for DropLink Edge Functions: CORS, JSON responses, and
// authenticating the caller.
//
// We set verify_jwt = false in config.toml and verify here instead, with
// auth.getUser(), which checks the token against Supabase Auth. That works with
// both legacy HS256 and the newer asymmetric signing keys.

import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // No list configured (local dev): reflect the caller. Production sets
  // ALLOWED_ORIGINS to the Netlify URL(s).
  const allow = allowed.length === 0 || allowed.includes(origin) ? origin || '*' : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  return null;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * The caller, plus a client that acts as them (so RLS applies to every query
 * it makes). Throws 401 if the token is missing or invalid.
 */
export async function requireUser(req: Request): Promise<{ user: User; db: SupabaseClient }> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token === anonKey) throw new HttpError(401, 'unauthorized');
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized');
  return { user: data.user, db };
}

/** Service-role client. Bypasses RLS: only for cleanup and account deletion. */
export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Read a JSON body with a size cap. */
export async function readJson<T>(req: Request, maxBytes = 4096): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Wrap a handler with CORS, method check, and error mapping (no internals leaked). */
export function handler(
  fn: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req);
    if (early) return early;
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.code }, e.status);
      console.error('unhandled error', e instanceof Error ? e.message : 'unknown');
      return json(req, { error: 'internal_error' }, 500);
    }
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
