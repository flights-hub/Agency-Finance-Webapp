import http from 'node:http';
import crypto from 'node:crypto';
import { parseBookingText } from './bookingParser.js';
import { scopedFinanceData } from './financeAccess.js';
import { canVerifyPayments, enforcePaymentRules } from './paymentRules.js';
import { loadEnvFile } from './env.js';
import { signJwt, verifyJwt } from './jwt.js';
import {
  adminCreateAuthUser,
  adminUpdateAuthUser,
  assertSupabaseEnv,
  authPasswordGrant,
  supabaseRequest,
} from './supabase.js';
import {
  LOCKOUT_THRESHOLD,
  assessLoginRisk,
  auditEvent,
  countRecentLoginFailures,
  createAlert,
  createSession,
  endSession,
  getRequestContext,
  raiseFailedLoginAlerts,
  raiseLoginAlerts,
  recordLoginAttempt,
  revokeUserSessions,
  validateSession,
} from './security.js';
import { handleSecurityRoute } from './securityRoutes.js';

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
  'verify_payments',
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

  try {
    const result = parseBookingText({ text, source: 'CRYPTIC', provider: detection.provider });
    json(res, 200, {
      provider: detection.provider,
      confidence: result.meta?.confidence || detection.confidence,
      raw: result.raw,
      meta: {
        ...(result.meta || {}),
        provider: detection.provider,
        confidence: result.meta?.confidence || detection.confidence,
      },
      drafts: result.drafts || [],
      warnings: [...warnings, ...(result.warnings || [])],
    });
  } catch (error) {
    error.status = 422;
    error.message = `Unable to parse ${detection.provider.toUpperCase()} PNR: ${error.message}`;
    throw error;
  }
}

async function handleParseBookingText(req, res) {
  const body = await readBody(req);
  const text = String(body.text || '').trim();
  const source = String(body.source || 'CRYPTIC').toUpperCase();
  const requestedProvider = normalizeProvider(body.provider);

  if (!text) {
    const error = new Error('Booking text is required.');
    error.status = 400;
    throw error;
  }

  const detection = source === 'CRYPTIC' && requestedProvider === 'auto'
    ? detectPnrProvider(text)
    : { provider: requestedProvider, confidence: source === 'PDF' ? 'selected' : 'selected' };

  const result = parseBookingText({ text, source, provider: detection.provider });
  json(res, 200, {
    provider: detection.provider,
    confidence: result.meta?.confidence || detection.confidence,
    raw: result.raw,
    meta: {
      ...(result.meta || {}),
      provider: detection.provider,
      confidence: result.meta?.confidence || detection.confidence,
    },
    drafts: result.drafts || [],
    warnings: result.warnings || [],
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

const ACTION_MODULES = {
  login: 'auth',
  logout: 'auth',
  change_password: 'user_management',
  create_user: 'user_management',
  update_user: 'user_management',
  reset_password: 'user_management',
  suspend_user: 'user_management',
  reactivate_user: 'user_management',
  update_role_template: 'user_management',
  bulk_import_finance: 'finance',
  verify_payment: 'finance',
  unverify_payment: 'finance',
};

async function audit(req, actor, action, targetUserId, extras = {}) {
  const ctx = await getRequestContext(req);
  return auditEvent(ctx, actor, {
    action,
    module: ACTION_MODULES[action] || 'general',
    targetUserId,
    ...extras,
  });
}

function sessionIdFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const payload = verifyJwt(token, process.env.APP_SESSION_SECRET);
  return payload?.sid || null;
}

async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const payload = verifyJwt(token, process.env.APP_SESSION_SECRET);
  if (!payload?.sub) {
    const error = new Error('Not authenticated');
    error.status = 401;
    throw error;
  }

  // Tokens carry a server-side session id so sessions can be revoked or
  // expired centrally; a valid signature alone is not enough.
  const session = await validateSession(payload.sid);
  if (!session || session.user_id !== payload.sub) {
    const error = new Error('Session expired or revoked');
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
  const email = String(body.email || '').trim().toLowerCase();
  const ctx = await getRequestContext(req);

  // Account lockout: block before even attempting the password grant.
  const recentFailures = (await countRecentLoginFailures({ username: email })).length;
  if (recentFailures >= LOCKOUT_THRESHOLD) {
    await recordLoginAttempt(ctx, { username: email, status: 'BLOCKED', failureReason: 'locked_account' });
    await raiseFailedLoginAlerts(ctx, email);
    const error = new Error('Too many failed attempts. Account temporarily locked — try again later.');
    error.status = 429;
    throw error;
  }

  let auth;
  try {
    auth = await authPasswordGrant(email, body.password);
  } catch {
    await recordLoginAttempt(ctx, { username: email, status: 'FAILED', failureReason: 'wrong_password' });
    await raiseFailedLoginAlerts(ctx, email);
    const error = new Error('Invalid email or password.');
    error.status = 401;
    throw error;
  }

  const profile = await getProfile(auth.user.id);
  if (!profile) {
    await recordLoginAttempt(ctx, { username: email, status: 'FAILED', failureReason: 'missing_profile' });
    const error = new Error('Supabase user is missing an app profile.');
    error.status = 403;
    throw error;
  }
  if (profile.status !== 'ACTIVE') {
    await recordLoginAttempt(ctx, { profile, username: email, status: 'FAILED', failureReason: 'inactive_user' });
    const error = new Error('Account is inactive or suspended.');
    error.status = 403;
    throw error;
  }

  const permissions = await getEffectivePermissions(profile.id, profile.role);
  const assessment = await assessLoginRisk(profile, ctx, recentFailures);
  const { sid, sessionHash } = await createSession(profile, ctx, SESSION_SECONDS);

  await recordLoginAttempt(ctx, { profile, status: 'SUCCESS', sessionHash, assessment });
  await raiseLoginAlerts(ctx, profile, assessment, recentFailures);
  await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { last_login: new Date().toISOString() },
  });
  await audit(req, profile, 'login', profile.id, {
    metadata: { method: 'password' },
    risk: assessment.riskScore,
    remarks: assessment.isNewDevice || assessment.isNewLocation ? 'Login from new device or location' : null,
  });

  const token = signJwt(
    { sub: profile.id, email: profile.email, role: profile.role, sid },
    process.env.APP_SESSION_SECRET,
    SESSION_SECONDS,
  );

  json(res, 200, { user: publicProfile(profile, permissions) }, { 'Set-Cookie': sessionCookie(token) });
}

async function handleLogout(req, res) {
  const sid = sessionIdFromRequest(req);
  if (sid) await endSession(sid, 'logout');
  json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
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
  await audit(req, actor, 'create_user', authUser.id, {
    recordType: 'profile',
    recordId: authUser.id,
    newValue: { role, email: body.email, permissions },
    risk: role === 'ADMIN' ? 'critical' : 'medium',
  });
  if (role === 'ADMIN') {
    await createAlert(await getRequestContext(req), actor, {
      type: 'new_admin_created',
      reason: `New ADMIN user ${body.email} created by ${actor.email}`,
      risk: 'critical',
    });
  }

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
  const before = await getProfile(id);
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

  if (body.status === 'SUSPENDED') {
    await adminUpdateAuthUser(id, { ban_duration: '876000h' });
    await revokeUserSessions(id, { revokedBy: actor.id, reason: 'user_suspended' });
  }
  if (body.status === 'ACTIVE') await adminUpdateAuthUser(id, { ban_duration: 'none' });

  let permissions = null;
  if (body.permissions !== undefined) {
    permissions = normalizePermissions(body.permissions);
    await setUserPermissions(id, permissions);
  }

  const roleChanged = patch.role && before && patch.role !== before.role;
  await audit(req, actor, 'update_user', id, {
    recordType: 'profile',
    recordId: id,
    oldValue: before ? { name: before.name, role: before.role, status: before.status } : null,
    newValue: { ...patch, permissions },
    risk: roleChanged || permissions !== null ? 'high' : 'low',
    remarks: roleChanged ? `Role changed ${before.role} -> ${patch.role}` : null,
  });
  if (roleChanged || permissions !== null) {
    await createAlert(await getRequestContext(req), actor, {
      type: roleChanged ? 'role_changed' : 'permissions_changed',
      reason: roleChanged
        ? `Role of ${before?.email || id} changed from ${before.role} to ${patch.role} by ${actor.email}`
        : `Permissions of ${before?.email || id} changed by ${actor.email}`,
      risk: patch.role === 'ADMIN' ? 'critical' : 'high',
    });
  }
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
  // Password reset invalidates every existing session for the target user.
  const revoked = await revokeUserSessions(id, { revokedBy: actor.id, reason: 'password_reset' });
  const target = await getProfile(id);
  await audit(req, actor, 'reset_password', id, {
    recordType: 'profile',
    recordId: id,
    newValue: { password: 'changed from existing value to new value', sessions_revoked: revoked },
    risk: target?.role === 'ADMIN' ? 'critical' : 'high',
  });
  await createAlert(await getRequestContext(req), actor, {
    type: 'password_reset',
    reason: `Password of ${target?.email || id} reset by ${actor.email} (${revoked} sessions revoked)`,
    risk: target?.role === 'ADMIN' ? 'critical' : 'medium',
  });
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
      if (status === 'SUSPENDED') await revokeUserSessions(id, { revokedBy: actor.id, reason: 'user_suspended' });
      await audit(req, actor, action === 'suspend' ? 'suspend_user' : 'reactivate_user', id, {
        recordType: 'profile',
        recordId: id,
        newValue: { status },
        risk: 'medium',
      });
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
  const beforeTemplates = await getRoleTemplates();
  const beforeTemplate = beforeTemplates.find((item) => item.role === roleKey);
  const result = await supabaseRequest(`/rest/v1/role_templates?role=eq.${encodeURIComponent(roleKey)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { permission_keys: permissionKeys },
  });
  await audit(req, actor, 'update_role_template', null, {
    recordType: 'role_template',
    recordId: roleKey,
    oldValue: { permission_keys: beforeTemplate?.permission_keys || [] },
    newValue: { permission_keys: permissionKeys },
    risk: 'high',
  });
  await createAlert(await getRequestContext(req), actor, {
    type: 'permissions_changed',
    reason: `Role template ${roleKey} permissions changed by ${actor.email}`,
    risk: 'high',
  });
  json(res, 200, { template: result[0] });
}

const FINANCE_COLLECTIONS = {
  bookings: { view: 'view_bookings', write: ['create_bookings', 'edit_bookings'] },
  payments: { view: 'view_payments', write: ['record_payments'] },
  refunds: { view: 'view_refunds', write: ['process_refunds'] },
  expenses: { view: 'view_financials', write: ['edit_financials'] },
  // Settlement records linking payments/refund credits to open items.
  // Recording or refund staff can allocate; agents and suppliers cannot
  // (requireFinanceWriter blocks their roles for this collection).
  allocations: { view: 'view_payments', write: ['record_payments', 'process_refunds', 'edit_financials'] },
};

function hasAnyPermission(user, keys) {
  if (user.role === 'ADMIN') return true;
  return keys.some((key) => user.permissions.includes(key));
}

function financeCollection(name) {
  const config = FINANCE_COLLECTIONS[name];
  if (!config) {
    const error = new Error(`Unknown finance collection: ${name}`);
    error.status = 404;
    throw error;
  }
  return config;
}

function flattenFinanceRow(row) {
  return { ...row.data, id: row.id };
}

async function listFinanceRows(collection) {
  const rows = await supabaseRequest(`/rest/v1/${collection}?select=id,data&order=created_at.asc`);
  return (rows || []).map(flattenFinanceRow);
}

async function upsertFinanceRow(collection, record, userId) {
  const { id, ...data } = record;
  const existing = await supabaseRequest(
    `/rest/v1/${collection}?id=eq.${encodeURIComponent(id)}&select=id`,
  );

  if (existing?.length) {
    const rows = await supabaseRequest(`/rest/v1/${collection}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { data },
    });
    return flattenFinanceRow(rows[0]);
  }

  const rows = await supabaseRequest(`/rest/v1/${collection}`, {
    method: 'POST',
    prefer: 'return=representation',
    body: { id, data, created_by: userId },
  });
  return flattenFinanceRow(rows[0]);
}

async function handleFinanceData(req, res) {
  const user = await currentUser(req);
  const canView = (name) => hasAnyPermission(user, [financeCollection(name).view]);

  const [bookings, payments, refunds, expenses, allocations] = await Promise.all(
    ['bookings', 'payments', 'refunds', 'expenses', 'allocations'].map((name) => (
      canView(name) ? listFinanceRows(name) : Promise.resolve([])
    )),
  );

  json(res, 200, scopedFinanceData(user, { bookings, payments, refunds, expenses, allocations }));
}

async function requireFinanceWriter(req, collection) {
  const user = await currentUser(req);
  // Agents may submit payment records (they always land unverified); agents
  // and suppliers cannot write any other finance collection.
  const agentAllowed = collection === 'payments' && user.role === 'AGENT';
  const roleBlocked = ['AGENT', 'SUPPLIER'].includes(user.role) && !agentAllowed;
  if (roleBlocked || !hasAnyPermission(user, financeCollection(collection).write)) {
    const error = new Error(`You do not have permission to write ${collection}.`);
    error.status = 403;
    throw error;
  }
  return user;
}

async function handleSaveFinanceRecord(req, res, collection, id) {
  const user = await requireFinanceWriter(req, collection);
  let body = await readBody(req);

  if (!id || body.id !== id) {
    const error = new Error('Record id is required and must match the URL.');
    error.status = 400;
    throw error;
  }

  if (collection === 'payments') {
    // Verification is a server decision: only verify_payments holders can set
    // VERIFIED, financial edits to verified payments reset the status, and
    // recorded-by stamps always reflect the authenticated user.
    const rows = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(id)}&select=id,data`);
    const existing = rows?.length ? rows[0].data : null;
    const { record: enforced, action } = enforcePaymentRules(user, body, existing);
    body = { ...enforced, id };

    if (action) {
      await audit(req, user, action === 'verified' ? 'verify_payment' : 'unverify_payment', null, {
        recordType: 'payment',
        recordId: id,
        oldValue: { verification_status: existing?.verification_status || null },
        newValue: {
          verification_status: body.verification_status,
          ledger_posting_status: body.ledger_posting_status,
          reason: action,
        },
        risk: 'medium',
      });
    }
  }

  const record = await upsertFinanceRow(collection, body, user.id);
  json(res, 200, { record });
}

async function handleBulkImportFinance(req, res, collection) {
  const user = await requireFinanceWriter(req, collection);
  const body = await readBody(req);
  const records = Array.isArray(body.records) ? body.records : [];
  const imported = [];

  // Payment imports by non-verifiers land unverified; verifier imports pass
  // through untouched so pre-workflow records stay grandfathered as verified.
  const enforceEachPayment = collection === 'payments' && !canVerifyPayments(user);

  for (const record of records) {
    if (!record || !record.id) continue;
    const toSave = enforceEachPayment ? { ...enforcePaymentRules(user, record, null).record, id: record.id } : record;
    imported.push(await upsertFinanceRow(collection, toSave, user.id));
  }

  await audit(req, user, 'bulk_import_finance', null, {
    recordType: collection,
    newValue: { collection, count: imported.length },
    risk: imported.length > 50 ? 'medium' : 'low',
  });
  json(res, 200, { records: imported });
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
  // Force re-login everywhere else: only the session that changed the
  // password survives.
  const revoked = await revokeUserSessions(user.id, {
    exceptSid: sessionIdFromRequest(req),
    revokedBy: user.id,
    reason: 'password_changed',
  });
  await audit(req, user, 'change_password', user.id, {
    newValue: { password: 'changed from existing value to new value', other_sessions_revoked: revoked },
    risk: user.role === 'ADMIN' ? 'high' : 'medium',
  });
  if (user.role === 'ADMIN') {
    await createAlert(await getRequestContext(req), user, {
      type: 'admin_password_changed',
      reason: `Admin ${user.email} changed their password`,
      risk: 'high',
    });
  }
  json(res, 200, { ok: true });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/auth/login') return handleLogin(req, res);
  if (req.method === 'POST' && path === '/api/auth/logout') return handleLogout(req, res);
  if (req.method === 'GET' && path === '/api/auth/me') return json(res, 200, { user: await currentUser(req) });

  if (await handleSecurityRoute(req, res, path, url, { currentUser, readBody, json, sessionIdFromRequest })) return undefined;
  if (req.method === 'POST' && path === '/api/auth/change-password') return handleChangePassword(req, res);
  if (req.method === 'POST' && path === '/api/bookings/parse-pnr') return handleParsePnr(req, res);
  if (req.method === 'POST' && path === '/api/bookings/parse-text') return handleParseBookingText(req, res);
  if (req.method === 'GET' && path === '/api/finance/data') return handleFinanceData(req, res);

  const bulkFinanceMatch = path.match(/^\/api\/finance\/([a-z]+)\/bulk$/);
  if (bulkFinanceMatch && req.method === 'POST') return handleBulkImportFinance(req, res, bulkFinanceMatch[1]);

  const financeMatch = path.match(/^\/api\/finance\/([a-z]+)\/([^/]+)$/);
  if (financeMatch && req.method === 'PUT') return handleSaveFinanceRecord(req, res, financeMatch[1], financeMatch[2]);

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
