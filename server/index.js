import http from 'node:http';
import crypto from 'node:crypto';
import { pnrParser } from 'open-pnr';
import { loadEnvFile } from './env.js';
import { signJwt, verifyJwt } from './jwt.js';
import {
  adminCreateAuthUser,
  adminUpdateAuthUser,
  assertSupabaseEnv,
  authPasswordGrant,
  supabaseRequest,
} from './supabase.js';

loadEnvFile();

const PORT = Number(process.env.API_PORT || 8787);
const SESSION_COOKIE = 'ffs_session';
const SESSION_SECONDS = 60 * 60 * 8;

const PERMISSIONS = [
  'view_bookings',
  'create_bookings',
  'edit_bookings',
  'view_payments',
  'record_payments',
  'view_refunds',
  'process_refunds',
  'view_financials',
  'edit_financials',
  'view_statements',
  'send_statements',
  'manage_users',
  'view_audit_logs',
  'configure_settings',
];

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((cookie) => cookie.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${secure}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from(crypto.randomBytes(18), (byte) => alphabet[byte % alphabet.length]).join('');
}

const PNR_PROVIDERS = new Set(['auto', 'amadeus', 'sabre']);
const MONTH_INDEX = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

function normalizeProvider(provider) {
  const value = String(provider || 'auto').toLowerCase();
  return PNR_PROVIDERS.has(value) ? value : 'auto';
}

function detectPnrProvider(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let amadeusScore = 0;
  let sabreScore = 0;

  for (const line of lines) {
    if (/^RP\//.test(line)) amadeusScore += 3;
    if (/^[0-9]{1,2}\s\s[A-Z0-9]{2}\s?[0-9]{3,4}\s[A-Z]\s/.test(line)) amadeusScore += 2;
    if (/\b[A-Z]{6}\sHK[0-9]\b/.test(line)) amadeusScore += 1;
    if (/\s\/DC[A-Z0-9]{2}\b/.test(line)) sabreScore += 3;
    if (/^[0-9]{1,2}\s[A-Z0-9]{2}\s?[0-9]{3,4}[A-Z]\s[0-9]{2}[A-Z]{3}\s/.test(line)) sabreScore += 2;
    if (/\s[A-Z]{6}\*?SS[0-9]\b/.test(line)) sabreScore += 1;
  }

  if (amadeusScore > sabreScore) return { provider: 'amadeus', confidence: amadeusScore >= 3 ? 'high' : 'medium' };
  if (sabreScore > amadeusScore) return { provider: 'sabre', confidence: sabreScore >= 3 ? 'high' : 'medium' };
  return { provider: 'amadeus', confidence: 'fallback' };
}

function parseDdMmm(value) {
  const match = String(value || '').toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})?$/);
  if (!match || MONTH_INDEX[match[2]] === undefined) return null;
  return {
    day: Number(match[1]),
    month: MONTH_INDEX[match[2]],
    year: match[3] ? 2000 + Number(match[3]) : null,
  };
}

function formatIsoDate(parts) {
  if (!parts) return '';
  const month = String(parts.month + 1).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

function normalizePnrDate(value, baseParts = null, previousParts = null) {
  const parts = parseDdMmm(value);
  if (!parts) return '';

  parts.year = parts.year || baseParts?.year || new Date().getFullYear();

  if (baseParts && !parseDdMmm(value)?.year) {
    const beforeBase = parts.month < baseParts.month || (parts.month === baseParts.month && parts.day < baseParts.day);
    if (beforeBase) parts.year += 1;
  }

  if (previousParts) {
    const beforePrevious = parts.year < previousParts.year
      || (parts.year === previousParts.year && parts.month < previousParts.month)
      || (parts.year === previousParts.year && parts.month === previousParts.month && parts.day < previousParts.day);
    if (beforePrevious) parts.year = previousParts.year + 1;
  }

  return formatIsoDate(parts);
}

function normalizePassengerName(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  const [surname, given] = cleaned.split('/');
  if (!surname || !given) return cleaned;
  const withoutTitle = given.replace(/\b(MR|MRS|MS|MISS|MSTR|MASTER)\b\.?$/i, '').trim();
  return `${withoutTitle} ${surname}`.replace(/\s+/g, ' ').trim();
}

function normalizeFlightNo(segment) {
  const airline = String(segment?.airline || '').trim();
  const flightNo = String(segment?.flight_no || '').trim();
  if (!airline || flightNo.startsWith(airline)) return flightNo;
  return [airline, flightNo].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function normalizePnrDrafts(parsed, provider) {
  const warnings = [];
  const passengers = Array.isArray(parsed?.passengers) ? parsed.passengers : [];
  const segments = Array.isArray(parsed?.flightSegments) ? parsed.flightSegments : [];
  const recordLocator = parsed?.recordLocator?.locator || '';
  const baseDate = parseDdMmm(parsed?.recordLocator?.ticketingInfo?.issuingDate);
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const outboundDate = normalizePnrDate(firstSegment?.depart_date, baseDate);
  const outboundParts = parseDdMmm(firstSegment?.depart_date);
  if (outboundParts && outboundDate) outboundParts.year = Number(outboundDate.slice(0, 4));
  const inboundDate = normalizePnrDate(lastSegment?.arrive_date, baseDate, outboundParts);
  const sector = firstSegment && lastSegment
    ? `${firstSegment.depart_airport}-${lastSegment.arrive_airport}`
    : '';
  const segmentSummary = segments
    .map((segment) => `${normalizeFlightNo(segment)} ${segment.depart_airport}-${segment.arrive_airport} ${segment.depart_date} ${segment.depart_time}-${segment.arrive_time}`)
    .join('; ');
  const remarks = [
    `Parsed from ${provider.toUpperCase()} PNR`,
    segmentSummary ? `Segments: ${segmentSummary}` : '',
    parsed?.agency?.name ? `Agency: ${parsed.agency.name}` : '',
  ].filter(Boolean).join(' | ');

  if (!passengers.length) warnings.push('No passenger names were detected.');
  if (!segments.length) warnings.push('No flight segments were detected.');
  if (!recordLocator) warnings.push('No record locator was detected.');

  const passengerRows = passengers.length ? passengers : [''];

  return {
    drafts: passengerRows.map((passenger) => ({
      booking_date: new Date().toISOString().split('T')[0],
      passenger_name: normalizePassengerName(passenger),
      pax_type: 'ADT',
      mobile: '',
      airline: firstSegment?.airline || '',
      pnr: recordLocator,
      ticket_no: '',
      sector,
      outbound_date: outboundDate,
      inbound_date: inboundDate && inboundDate !== outboundDate ? inboundDate : '',
      fare_sold: '',
      fare_issued: '',
      booked_by: '',
      agent_issued_by: '',
      remarks,
      refund_flag: false,
    })),
    warnings,
  };
}

function parsePnrQuietly(text, provider) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return pnrParser(text, provider);
  } finally {
    console.log = originalLog;
  }
}

async function handleParsePnr(req, res) {
  const body = await readBody(req);
  const text = String(body.text || '').trim();
  const requestedProvider = normalizeProvider(body.provider);
  const warnings = [];

  if (!text) {
    const error = new Error('PNR text is required.');
    error.status = 400;
    throw error;
  }

  const detection = requestedProvider === 'auto'
    ? detectPnrProvider(text)
    : { provider: requestedProvider, confidence: 'selected' };

  if (detection.confidence === 'fallback') {
    warnings.push('Could not confidently detect provider, so Amadeus was used.');
  }

  let raw;
  try {
    raw = parsePnrQuietly(text, detection.provider);
  } catch (error) {
    error.status = 422;
    error.message = `Unable to parse ${detection.provider.toUpperCase()} PNR: ${error.message}`;
    throw error;
  }

  const normalized = normalizePnrDrafts(raw, detection.provider);

  json(res, 200, {
    provider: detection.provider,
    confidence: detection.confidence,
    raw,
    drafts: normalized.drafts,
    warnings: [...warnings, ...normalized.warnings],
  });
}

function normalizeRole(role) {
  const value = String(role || '').toUpperCase();
  if (!['ADMIN', 'EMPLOYEE', 'AGENT', 'SUPPLIER'].includes(value)) {
    const error = new Error('Role must be Admin, Employee, Agent, or Supplier.');
    error.status = 400;
    throw error;
  }
  return value;
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((permission) => PERMISSIONS.includes(permission));
}

function publicProfile(profile, permissions = []) {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    status: profile.status,
    linked_agent_id: profile.linked_agent_id,
    linked_supplier_id: profile.linked_supplier_id,
    must_change_password: Boolean(profile.must_change_password),
    last_login: profile.last_login,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    permissions,
  };
}

async function getProfile(id) {
  const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}

async function getRoleTemplates() {
  return supabaseRequest('/rest/v1/role_templates?select=*&order=role.asc');
}

async function getEffectivePermissions(userId, role) {
  const [templates, overrides] = await Promise.all([
    getRoleTemplates(),
    supabaseRequest(`/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}&select=permission_key,enabled`),
  ]);
  const template = templates.find((item) => item.role === role);
  const effective = new Set(template?.permission_keys || []);

  for (const override of overrides || []) {
    if (override.enabled) effective.add(override.permission_key);
    else effective.delete(override.permission_key);
  }

  return [...effective].filter((permission) => PERMISSIONS.includes(permission));
}

async function setUserPermissions(userId, permissions) {
  await supabaseRequest(`/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

  if (!permissions.length) return [];

  return supabaseRequest('/rest/v1/user_permissions', {
    method: 'POST',
    prefer: 'return=representation',
    body: permissions.map((permission) => ({
      user_id: userId,
      permission_key: permission,
      enabled: true,
    })),
  });
}

async function audit(actorId, action, targetUserId, metadata = {}) {
  return supabaseRequest('/rest/v1/audit_logs', {
    method: 'POST',
    body: {
      actor_id: actorId,
      action,
      target_user_id: targetUserId,
      metadata,
    },
  });
}

async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const payload = verifyJwt(token, process.env.APP_SESSION_SECRET);
  if (!payload?.sub) {
    const error = new Error('Not authenticated');
    error.status = 401;
    throw error;
  }

  const profile = await getProfile(payload.sub);
  if (!profile || profile.status !== 'ACTIVE') {
    const error = new Error('Account is inactive or suspended');
    error.status = 403;
    throw error;
  }

  const permissions = await getEffectivePermissions(profile.id, profile.role);
  return { ...publicProfile(profile, permissions), permissions };
}

async function requireAdmin(req) {
  const user = await currentUser(req);
  if (user.role !== 'ADMIN' && !user.permissions.includes('manage_users')) {
    const error = new Error('Admin user-management permission required');
    error.status = 403;
    throw error;
  }
  return user;
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const auth = await authPasswordGrant(body.email, body.password);
  const profile = await getProfile(auth.user.id);

  if (!profile) {
    const error = new Error('Supabase user is missing an app profile.');
    error.status = 403;
    throw error;
  }
  if (profile.status !== 'ACTIVE') {
    const error = new Error('Account is inactive or suspended.');
    error.status = 403;
    throw error;
  }

  const permissions = await getEffectivePermissions(profile.id, profile.role);
  await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { last_login: new Date().toISOString() },
  });
  await audit(profile.id, 'login', profile.id, { method: 'password' });

  const token = signJwt(
    { sub: profile.id, email: profile.email, role: profile.role },
    process.env.APP_SESSION_SECRET,
    SESSION_SECONDS,
  );

  json(res, 200, { user: publicProfile(profile, permissions) }, { 'Set-Cookie': sessionCookie(token) });
}

async function handleCreateUser(req, res) {
  const actor = await requireAdmin(req);
  const body = await readBody(req);
  const role = normalizeRole(body.role);
  const password = randomPassword();
  const authUser = await adminCreateAuthUser({
    email: body.email,
    password,
    name: body.name || body.email,
    role,
  });

  const profile = await supabaseRequest('/rest/v1/profiles', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      id: authUser.id,
      email: body.email,
      name: body.name || body.email,
      role,
      status: 'ACTIVE',
      linked_agent_id: role === 'AGENT' ? body.linked_agent_id || null : null,
      linked_supplier_id: role === 'SUPPLIER' ? body.linked_supplier_id || null : null,
      must_change_password: true,
    },
  });

  const permissions = normalizePermissions(body.permissions);
  await setUserPermissions(authUser.id, permissions);
  await audit(actor.id, 'create_user', authUser.id, { role, email: body.email });

  json(res, 201, {
    user: publicProfile(profile[0], permissions),
    temporaryPassword: password,
    loginUrl: `/login?email=${encodeURIComponent(body.email)}&temporary=1`,
  });
}

async function handleListUsers(req, res) {
  await requireAdmin(req);
  const [profiles, permissions] = await Promise.all([
    supabaseRequest('/rest/v1/profiles?select=*&order=created_at.desc'),
    supabaseRequest('/rest/v1/user_permissions?select=user_id,permission_key,enabled'),
  ]);
  const byUser = new Map();

  for (const permission of permissions || []) {
    if (!permission.enabled) continue;
    if (!byUser.has(permission.user_id)) byUser.set(permission.user_id, []);
    byUser.get(permission.user_id).push(permission.permission_key);
  }

  json(res, 200, {
    users: (profiles || []).map((profile) => publicProfile(profile, byUser.get(profile.id) || [])),
  });
}

async function handleUpdateUser(req, res, id) {
  const actor = await requireAdmin(req);
  const body = await readBody(req);
  const patch = {};

  if (body.name !== undefined) patch.name = body.name;
  if (body.role !== undefined) patch.role = normalizeRole(body.role);
  if (body.status !== undefined) patch.status = body.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
  if (body.linked_agent_id !== undefined) patch.linked_agent_id = body.linked_agent_id || null;
  if (body.linked_supplier_id !== undefined) patch.linked_supplier_id = body.linked_supplier_id || null;
  if (body.must_change_password !== undefined) patch.must_change_password = Boolean(body.must_change_password);

  const profile = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: patch,
  });

  if (body.status === 'SUSPENDED') await adminUpdateAuthUser(id, { ban_duration: '876000h' });
  if (body.status === 'ACTIVE') await adminUpdateAuthUser(id, { ban_duration: 'none' });

  let permissions = null;
  if (body.permissions !== undefined) {
    permissions = normalizePermissions(body.permissions);
    await setUserPermissions(id, permissions);
  }

  await audit(actor.id, 'update_user', id, { patch, permissions });
  json(res, 200, { user: publicProfile(profile[0], permissions || []) });
}

async function handleResetPassword(req, res, id) {
  const actor = await requireAdmin(req);
  const password = randomPassword();
  await adminUpdateAuthUser(id, { password });
  await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { must_change_password: true },
  });
  await audit(actor.id, 'reset_password', id);
  json(res, 200, { temporaryPassword: password });
}

async function handleBulk(req, res) {
  const actor = await requireAdmin(req);
  const body = await readBody(req);
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  const action = body.action;
  const results = [];

  for (const id of userIds) {
    if (action === 'suspend' || action === 'reactivate') {
      const status = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
      await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status },
      });
      await adminUpdateAuthUser(id, { ban_duration: status === 'SUSPENDED' ? '876000h' : 'none' });
      await audit(actor.id, action === 'suspend' ? 'suspend_user' : 'reactivate_user', id);
      results.push({ id, status });
    }
  }

  json(res, 200, { results });
}

async function handleAuditLogs(req, res, id) {
  const actor = await currentUser(req);
  if (actor.role !== 'ADMIN' && !actor.permissions.includes('view_audit_logs')) {
    const error = new Error('Audit permission required');
    error.status = 403;
    throw error;
  }
  const logs = await supabaseRequest(
    `/rest/v1/audit_logs?target_user_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.desc&limit=50`,
  );
  json(res, 200, { logs });
}

async function handleTemplates(req, res) {
  await requireAdmin(req);
  json(res, 200, { templates: await getRoleTemplates(), permissions: PERMISSIONS });
}

async function handleUpdateTemplate(req, res, role) {
  const actor = await requireAdmin(req);
  const body = await readBody(req);
  const roleKey = normalizeRole(role);
  const permissionKeys = normalizePermissions(body.permission_keys);
  const result = await supabaseRequest(`/rest/v1/role_templates?role=eq.${encodeURIComponent(roleKey)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { permission_keys: permissionKeys },
  });
  await audit(actor.id, 'update_role_template', null, { role: roleKey, permissionKeys });
  json(res, 200, { template: result[0] });
}

async function handleChangePassword(req, res) {
  const user = await currentUser(req);
  const body = await readBody(req);
  if (!body.password || String(body.password).length < 10) {
    const error = new Error('Password must be at least 10 characters.');
    error.status = 400;
    throw error;
  }
  await adminUpdateAuthUser(user.id, { password: body.password });
  await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { must_change_password: false },
  });
  await audit(user.id, 'change_password', user.id);
  json(res, 200, { ok: true });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/auth/login') return handleLogin(req, res);
  if (req.method === 'POST' && path === '/api/auth/logout') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }
  if (req.method === 'GET' && path === '/api/auth/me') return json(res, 200, { user: await currentUser(req) });
  if (req.method === 'POST' && path === '/api/auth/change-password') return handleChangePassword(req, res);
  if (req.method === 'POST' && path === '/api/bookings/parse-pnr') return handleParsePnr(req, res);
  if (req.method === 'POST' && path === '/api/admin/users') return handleCreateUser(req, res);
  if (req.method === 'GET' && path === '/api/admin/users') return handleListUsers(req, res);
  if (req.method === 'POST' && path === '/api/admin/users/bulk') return handleBulk(req, res);
  if (req.method === 'GET' && path === '/api/admin/role-templates') return handleTemplates(req, res);

  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') return handleUpdateUser(req, res, userMatch[1]);

  const resetMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if (resetMatch && req.method === 'POST') return handleResetPassword(req, res, resetMatch[1]);

  const logsMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/audit-logs$/);
  if (logsMatch && req.method === 'GET') return handleAuditLogs(req, res, logsMatch[1]);

  const templateMatch = path.match(/^\/api\/admin\/role-templates\/([^/]+)$/);
  if (templateMatch && req.method === 'PUT') return handleUpdateTemplate(req, res, templateMatch[1]);

  json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/health')) return json(res, 200, { ok: true });
    await route(req, res);
  } catch (error) {
    const status = error.status || 500;
    json(res, status, { error: error.message, details: error.data });
  }
});

try {
  assertSupabaseEnv();
} catch (error) {
  console.warn(`[api] ${error.message}`);
}

server.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
