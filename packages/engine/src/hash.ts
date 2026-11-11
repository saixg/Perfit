// Chart identity shared by the extension and the server: sha256 over canonical JSON.
// Uses Web Crypto, available in browsers, Deno (Edge Functions) and Node 20+.

/** JSON with object keys sorted recursively and undefined dropped, so equal charts hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

// The engine's tsconfig omits the DOM lib on purpose (no DOM access allowed), so declare only the
// two Web APIs used here. Both exist in every target runtime: browsers, Deno and Node 20+.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
interface WebCrypto { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } }

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const { subtle } = (globalThis as unknown as { crypto: WebCrypto }).crypto;
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The `raw_hash` stored on size_charts. */
export const hashChart = (chart: unknown): Promise<string> => sha256Hex(canonicalJson(chart));
