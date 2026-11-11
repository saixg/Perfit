// Tiny HTTP layer shared by all functions: CORS, JSON, typed errors, body limits.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Wraps a POST handler with CORS preflight, method check and uniform error responses. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Use POST.' } }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
      }
      console.error(e);
      return json({ error: { code: 'internal', message: 'Something went wrong.' } }, 500);
    }
  };
}

/** Parse a JSON body, refusing anything over maxBytes (charts are a few KB). */
export async function readJson(req: Request, maxBytes = 100_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large', `Body over ${maxBytes} bytes.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body is not valid JSON.');
  }
}
