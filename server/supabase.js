export function assertSupabaseEnv() {
  const missing = [
    ['SUPABASE_URL', process.env.SUPABASE_URL],
    ['SUPABASE_ANON_KEY', process.env.SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
    ['APP_SESSION_SECRET', process.env.APP_SESSION_SECRET],
  ].filter(([, value]) => !value);

  if (missing.length) {
    const names = missing.map(([name]) => name).join(', ');
    const error = new Error(`Missing required environment variables: ${names}`);
    error.status = 500;
    throw error;
  }
}

export async function supabaseRequest(path, options = {}) {
  assertSupabaseEnv();

  const {
    body,
    method = 'GET',
    service = true,
    token = null,
    prefer = null,
  } = options;

  const apiKey = service ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token || apiKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || response.statusText);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function authPasswordGrant(email, password) {
  return supabaseRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    service: false,
    body: { email, password },
  });
}

export async function adminCreateAuthUser({ email, password, name, role }) {
  return supabaseRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    },
  });
}

export async function adminUpdateAuthUser(id, payload) {
  return supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: payload,
  });
}
