// Public, ship-in-the-bundle settings. The publishable key is designed to be public: it only
// identifies the project; RLS + the Edge Functions' own checks decide what it can do.

export const SUPABASE_URL = 'https://rvvbztzudcipbosavhii.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jorNs24cbdxkkyvefv34mQ_jLf4Fugy';

export const EXTENSION_VERSION = '0.1.0';

/** How long a server chart stays fresh in the local cache before resolve-chart is asked again. */
export const CHART_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
