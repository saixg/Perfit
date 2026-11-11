// Supabase clients. Reads the new key format (SUPABASE_*_KEYS JSON) and falls back to legacy keys.
// The secret key bypasses RLS: only catalog writes and LLM logging use it.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { HttpError } from './http.ts';

// The one place supabase-js is pinned; other modules import the type from here.
export type { SupabaseClient };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

function namedKey(jsonVar: string, legacyVar: string): string {
  const raw = Deno.env.get(jsonVar);
  if (raw) {
    try {
      const k = JSON.parse(raw)?.default;
      if (typeof k === 'string' && k) return k;
    } catch { /* fall through to legacy */ }
  }
  const legacy = Deno.env.get(legacyVar);
  if (!legacy) throw new Error(`Missing ${jsonVar} / ${legacyVar}`);
  return legacy;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let admin: SupabaseClient | undefined;
export function adminClient(): SupabaseClient {
  admin ??= createClient(SUPABASE_URL, namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), noSession);
  return admin;
}

export interface AuthedUser {
  userId: string;
  /** Client acting as the user: every query is subject to RLS. */
  client: SupabaseClient;
}

/**
 * Resolve the caller. No token, a publishable key, or the legacy anon JWT ⇒ anonymous (null).
 * A user JWT is verified with getClaims (local JWKS verification for asymmetric signing keys).
 */
export async function getUser(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || token.split('.').length !== 3) return null; // not a JWT (e.g. sb_publishable_…)
  // Tokens that don't even claim to be a user (legacy anon key) are anonymous: they unlock nothing,
  // so they need no verification. Anything claiming role=authenticated MUST verify below.
  if (unverifiedRole(token) !== 'authenticated') return null;

  const client = createClient(SUPABASE_URL, namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims) throw new HttpError(401, 'invalid_token', 'Session is invalid or expired. Sign in again.');
  const { sub, role } = data.claims as { sub?: string; role?: string };
  if (role !== 'authenticated' || !sub) return null; // legacy anon key
  return { userId: sub, client };
}

/** Read the role claim WITHOUT verifying. Only used to route anonymous callers; never to grant access. */
function unverifiedRole(jwt: string): string | undefined {
  try {
    const b64 = jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))).role;
  } catch {
    return undefined;
  }
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const user = await getUser(req);
  if (!user) throw new HttpError(401, 'sign_in_required', 'Sign in with Google to sync and log recommendations.');
  return user;
}
