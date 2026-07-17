// Shared stubs for server tests. supabaseRequest() and the R2 helpers both go
// through global fetch, so a single fetch router can stand in for Supabase and
// R2 without any module mocking.

const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SESSION_SECRET',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
];

export const SUPABASE_URL = 'https://supabase.test';

export function withStubbedEnv() {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.APP_SESSION_SECRET = 'session-secret';
  process.env.R2_ACCOUNT_ID = 'account123';
  process.env.R2_ACCESS_KEY_ID = 'access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'secret-key';
  process.env.R2_BUCKET_NAME = 'proofs';

  return function restoreEnv() {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    text: async () => (body === undefined || body === null ? '' : JSON.stringify(body)),
  };
}

export function emptyResponse({ status = 204, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    text: async () => '',
  };
}

// Installs a fetch stub. `handler(request)` receives { url, method, body, isR2,
// isSupabase, path } and returns a response (or throws to simulate a network
// failure). Every call is recorded on `calls` for assertions.
export function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    const request = {
      url,
      method: (options.method || 'GET').toUpperCase(),
      body: options.body ? JSON.parse(options.body) : undefined,
      isR2: url.includes('r2.cloudflarestorage.com'),
      isSupabase: url.startsWith(SUPABASE_URL),
      path: url.startsWith(SUPABASE_URL) ? url.slice(SUPABASE_URL.length) : url,
    };
    calls.push(request);
    const result = await handler(request);
    if (!result) throw new Error(`Unhandled stub request: ${request.method} ${request.url}`);
    return result;
  };

  return {
    calls,
    restore() { globalThis.fetch = original; },
    supabaseCalls: () => calls.filter((c) => c.isSupabase),
    r2Calls: () => calls.filter((c) => c.isR2),
  };
}
