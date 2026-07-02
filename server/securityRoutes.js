import { supabaseRequest } from './supabase.js';
import {
  auditEvent,
  createAlert,
  getRequestContext,
  revokeAllSessions,
  revokeSessionById,
  revokeUserSessions,
} from './security.js';

const LOGIN_HISTORY_MAX_DAYS = 180;

function requireSecurityReader(user) {
  if (user.role !== 'ADMIN' && !user.permissions.includes('view_audit_logs')) {
    const error = new Error('Security log access requires admin or audit permission.');
    error.status = 403;
    throw error;
  }
}

function requireSecurityAdmin(user) {
  if (user.role !== 'ADMIN') {
    const error = new Error('Only Admin users can manage sessions and alerts.');
    error.status = 403;
    throw error;
  }
}

function clampLimit(value, fallback = 500, max = 2000) {
  const limit = Number(value) || fallback;
  return Math.min(Math.max(limit, 1), max);
}

function dateFilter(params, column) {
  const parts = [];
  const from = params.get('from');
  const to = params.get('to');
  if (from) parts.push(`${column}=gte.${encodeURIComponent(new Date(from).toISOString())}`);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    parts.push(`${column}=lte.${encodeURIComponent(end.toISOString())}`);
  }
  if (!from) {
    const floor = new Date(Date.now() - LOGIN_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000);
    parts.push(`${column}=gte.${encodeURIComponent(floor.toISOString())}`);
  }
  return parts;
}

function ilike(params, key, column) {
  const value = params.get(key);
  if (!value) return null;
  return `${column}=ilike.${encodeURIComponent(`*${value}*`)}`;
}

async function logExportIfRequested(ctx, user, params, reportName, rowCount) {
  if (params.get('export') !== '1') return;
  await auditEvent(ctx, user, {
    action: 'report_exported',
    module: 'reports',
    recordType: 'report',
    recordId: reportName,
    newValue: { report: reportName, rows: rowCount },
    risk: rowCount > 1000 ? 'high' : 'medium',
    remarks: `${reportName} exported (${rowCount} rows)`,
  });
  if (rowCount > 1000) {
    await createAlert(ctx, user, {
      type: 'large_report_export',
      reason: `${user.email} exported ${rowCount} rows from ${reportName}`,
      risk: 'high',
    });
  }
}

async function handleLoginHistory(req, res, url, deps) {
  const user = await deps.currentUser(req);
  requireSecurityReader(user);
  const params = url.searchParams;
  const filters = [
    ...dateFilter(params, 'login_time'),
    ilike(params, 'user', 'username'),
    ilike(params, 'ip', 'ip_address'),
    ilike(params, 'country', 'country'),
    ilike(params, 'city', 'city'),
    params.get('role') ? `role=eq.${encodeURIComponent(params.get('role'))}` : null,
    params.get('status') ? `login_status=eq.${encodeURIComponent(params.get('status'))}` : null,
    params.get('device') ? `device_type=eq.${encodeURIComponent(params.get('device'))}` : null,
    params.get('risk') ? `risk_score=eq.${encodeURIComponent(params.get('risk'))}` : null,
  ].filter(Boolean);

  const rows = await supabaseRequest(
    `/rest/v1/login_history?${filters.join('&')}&select=*&order=login_time.desc&limit=${clampLimit(params.get('limit'))}`,
  );
  const ctx = await getRequestContext(req);
  await logExportIfRequested(ctx, user, params, 'login_history', rows?.length || 0);
  deps.json(res, 200, { rows: rows || [] });
}

async function handleAuditTrail(req, res, url, deps) {
  const user = await deps.currentUser(req);
  requireSecurityReader(user);
  const params = url.searchParams;
  const filters = [
    ...dateFilter(params, 'created_at'),
    ilike(params, 'user', 'username'),
    ilike(params, 'ip', 'ip_address'),
    ilike(params, 'action', 'action'),
    params.get('role') ? `role=eq.${encodeURIComponent(params.get('role'))}` : null,
    params.get('module') ? `module_name=eq.${encodeURIComponent(params.get('module'))}` : null,
    params.get('risk') ? `risk_level=eq.${encodeURIComponent(params.get('risk'))}` : null,
    params.get('result') ? `result=eq.${encodeURIComponent(params.get('result'))}` : null,
  ].filter(Boolean);

  const rows = await supabaseRequest(
    `/rest/v1/audit_logs?${filters.join('&')}&select=*&order=created_at.desc&limit=${clampLimit(params.get('limit'))}`,
  );
  const ctx = await getRequestContext(req);
  await logExportIfRequested(ctx, user, params, 'audit_trail', rows?.length || 0);
  deps.json(res, 200, { rows: rows || [] });
}

async function handleSessions(req, res, url, deps) {
  const user = await deps.currentUser(req);
  requireSecurityReader(user);
  const status = url.searchParams.get('status') || 'ACTIVE';
  const [sessions, profiles] = await Promise.all([
    supabaseRequest(`/rest/v1/user_sessions?status=eq.${encodeURIComponent(status)}&select=*&order=last_activity.desc&limit=500`),
    supabaseRequest('/rest/v1/profiles?select=id,email,name,role'),
  ]);
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  deps.json(res, 200, {
    sessions: (sessions || []).map((session) => {
      // Never expose the session hash itself to the client.
      const { session_id_hash: _hash, ...safe } = session;
      const profile = profileMap.get(session.user_id);
      return { ...safe, email: profile?.email || null, name: profile?.name || null, role: profile?.role || null };
    }),
  });
}

async function handleRevokeSession(req, res, sessionId, deps) {
  const user = await deps.currentUser(req);
  requireSecurityAdmin(user);
  const ctx = await getRequestContext(req);
  const session = await revokeSessionById(sessionId, { revokedBy: user.id, reason: 'force_logout' });
  await auditEvent(ctx, user, {
    action: 'force_logout_session',
    module: 'security',
    targetUserId: session.user_id,
    recordType: 'session',
    recordId: session.id,
    risk: 'high',
    remarks: 'Admin forced logout of a single session',
  });
  await createAlert(ctx, user, {
    type: 'force_logout',
    reason: `Admin ${user.email} force-logged-out a session of user ${session.user_id}`,
    risk: 'high',
  });
  deps.json(res, 200, { ok: true });
}

async function handleRevokeUserSessions(req, res, userId, deps) {
  const user = await deps.currentUser(req);
  requireSecurityAdmin(user);
  const ctx = await getRequestContext(req);
  const count = await revokeUserSessions(userId, { revokedBy: user.id, reason: 'force_logout_all' });
  await auditEvent(ctx, user, {
    action: 'force_logout_user',
    module: 'security',
    targetUserId: userId,
    recordType: 'session',
    newValue: { revoked: count },
    risk: 'high',
    remarks: `Admin revoked all sessions (${count}) for user`,
  });
  await createAlert(ctx, user, {
    type: 'force_logout',
    reason: `Admin ${user.email} revoked all sessions (${count}) for user ${userId}`,
    risk: 'high',
  });
  deps.json(res, 200, { ok: true, revoked: count });
}

async function handleRevokeAll(req, res, deps) {
  const user = await deps.currentUser(req);
  requireSecurityAdmin(user);
  const ctx = await getRequestContext(req);
  const count = await revokeAllSessions({ exceptSid: deps.sessionIdFromRequest(req), revokedBy: user.id });
  await auditEvent(ctx, user, {
    action: 'emergency_revoke_all_sessions',
    module: 'security',
    recordType: 'session',
    newValue: { revoked: count },
    risk: 'critical',
    remarks: 'Emergency: all user sessions revoked',
  });
  await createAlert(ctx, user, {
    type: 'emergency_force_logout_all',
    reason: `Admin ${user.email} triggered emergency logout of all users (${count} sessions)`,
    risk: 'critical',
  });
  deps.json(res, 200, { ok: true, revoked: count });
}

async function handleAlerts(req, res, url, deps) {
  const user = await deps.currentUser(req);
  requireSecurityReader(user);
  const params = url.searchParams;
  const filters = [
    ...dateFilter(params, 'alert_time'),
    params.get('status') ? `status=eq.${encodeURIComponent(params.get('status'))}` : null,
    params.get('risk') ? `risk_level=eq.${encodeURIComponent(params.get('risk'))}` : null,
    ilike(params, 'user', 'username'),
  ].filter(Boolean);
  const rows = await supabaseRequest(
    `/rest/v1/security_alerts?${filters.join('&')}&select=*&order=alert_time.desc&limit=${clampLimit(params.get('limit'))}`,
  );
  deps.json(res, 200, { rows: rows || [] });
}

async function handleUpdateAlert(req, res, alertId, deps) {
  const user = await deps.currentUser(req);
  requireSecurityAdmin(user);
  const body = await deps.readBody(req);
  const status = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'FALSE_POSITIVE'].includes(body.status) ? body.status : 'UNDER_REVIEW';
  const rows = await supabaseRequest(`/rest/v1/security_alerts?id=eq.${encodeURIComponent(alertId)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      resolution_notes: body.resolution_notes || null,
    },
  });
  const ctx = await getRequestContext(req);
  await auditEvent(ctx, user, {
    action: 'alert_reviewed',
    module: 'security',
    recordType: 'security_alert',
    recordId: alertId,
    newValue: { status, resolution_notes: body.resolution_notes || null },
    remarks: `Alert marked ${status}`,
  });
  deps.json(res, 200, { alert: rows?.[0] || null });
}

async function handleOverview(req, res, deps) {
  const user = await deps.currentUser(req);
  requireSecurityReader(user);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.toISOString();
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [todayLogins, openAlerts, activeSessions, weekHighRisk] = await Promise.all([
    supabaseRequest(`/rest/v1/login_history?login_time=gte.${today}&select=login_status,role,is_new_device,is_new_location,risk_score,username,ip_address&limit=5000`),
    supabaseRequest('/rest/v1/security_alerts?status=in.(OPEN,UNDER_REVIEW)&select=id,risk_level,alert_type&limit=2000'),
    supabaseRequest('/rest/v1/user_sessions?status=eq.ACTIVE&select=id&limit=2000'),
    supabaseRequest(`/rest/v1/audit_logs?created_at=gte.${week}&risk_level=in.(high,critical)&select=id,risk_level&limit=2000`),
  ]);

  const logins = todayLogins || [];
  const failed = logins.filter((row) => row.login_status === 'FAILED');
  const failuresByUser = new Map();
  const failuresByIp = new Map();
  for (const row of failed) {
    if (row.username) failuresByUser.set(row.username, (failuresByUser.get(row.username) || 0) + 1);
    if (row.ip_address) failuresByIp.set(row.ip_address, (failuresByIp.get(row.ip_address) || 0) + 1);
  }

  deps.json(res, 200, {
    login: {
      success: logins.filter((row) => row.login_status === 'SUCCESS').length,
      failed: failed.length,
      blocked: logins.filter((row) => row.login_status === 'BLOCKED').length,
      admin: logins.filter((row) => row.role === 'ADMIN' && row.login_status === 'SUCCESS').length,
      newDevice: logins.filter((row) => row.is_new_device).length,
      newLocation: logins.filter((row) => row.is_new_location).length,
    },
    risk: {
      openAlerts: (openAlerts || []).length,
      criticalAlerts: (openAlerts || []).filter((row) => row.risk_level === 'critical').length,
      highRiskEvents7d: (weekHighRisk || []).length,
      repeatedFailureUsers: [...failuresByUser.entries()].filter(([, count]) => count >= 3).map(([name, count]) => ({ username: name, count })),
      suspiciousIps: [...failuresByIp.entries()].filter(([, count]) => count >= 3).map(([ip, count]) => ({ ip, count })),
    },
    sessions: { active: (activeSessions || []).length },
  });
}

async function handleTimeline(req, res, url, deps) {
  const user = await deps.currentUser(req);
  requireSecurityReader(user);
  const query = String(url.searchParams.get('user') || '').trim();
  if (!query) {
    const error = new Error('user query parameter is required (email or name).');
    error.status = 400;
    throw error;
  }
  const encoded = encodeURIComponent(`*${query}*`);
  const profiles = await supabaseRequest(`/rest/v1/profiles?or=(email.ilike.${encoded},name.ilike.${encoded})&select=id,email,name,role,status,last_login,created_at&limit=5`);
  const profile = profiles?.[0];
  if (!profile) {
    const error = new Error(`No user found matching "${query}".`);
    error.status = 404;
    throw error;
  }

  const id = encodeURIComponent(profile.id);
  const email = encodeURIComponent(profile.email);
  const [logins, actions, alerts, sessions] = await Promise.all([
    supabaseRequest(`/rest/v1/login_history?or=(user_id.eq.${profile.id},username.eq.${email})&select=*&order=login_time.desc&limit=500`),
    supabaseRequest(`/rest/v1/audit_logs?or=(actor_id.eq.${profile.id},target_user_id.eq.${profile.id})&select=*&order=created_at.desc&limit=500`),
    supabaseRequest(`/rest/v1/security_alerts?user_id=eq.${id}&select=*&order=alert_time.desc&limit=200`),
    supabaseRequest(`/rest/v1/user_sessions?user_id=eq.${id}&select=id,ip_address,country,city,device,browser,login_time,last_activity,status,revoked_reason&order=login_time.desc&limit=200`),
  ]);

  const ctx = await getRequestContext(req);
  await auditEvent(ctx, user, {
    action: 'security_timeline_generated',
    module: 'security',
    targetUserId: profile.id,
    recordType: 'investigation',
    recordId: profile.email,
    remarks: `Security timeline generated for ${profile.email}`,
  });

  deps.json(res, 200, {
    profile,
    logins: logins || [],
    actions: actions || [],
    alerts: alerts || [],
    sessions: sessions || [],
  });
}

export async function handleSecurityRoute(req, res, path, url, deps) {
  if (!path.startsWith('/api/security/')) return false;

  if (req.method === 'GET' && path === '/api/security/overview') { await handleOverview(req, res, deps); return true; }
  if (req.method === 'GET' && path === '/api/security/login-history') { await handleLoginHistory(req, res, url, deps); return true; }
  if (req.method === 'GET' && path === '/api/security/audit-trail') { await handleAuditTrail(req, res, url, deps); return true; }
  if (req.method === 'GET' && path === '/api/security/sessions') { await handleSessions(req, res, url, deps); return true; }
  if (req.method === 'GET' && path === '/api/security/alerts') { await handleAlerts(req, res, url, deps); return true; }
  if (req.method === 'GET' && path === '/api/security/timeline') { await handleTimeline(req, res, url, deps); return true; }
  if (req.method === 'POST' && path === '/api/security/sessions/revoke-all') { await handleRevokeAll(req, res, deps); return true; }

  let match = path.match(/^\/api\/security\/sessions\/([^/]+)\/revoke$/);
  if (match && req.method === 'POST') { await handleRevokeSession(req, res, match[1], deps); return true; }

  match = path.match(/^\/api\/security\/users\/([^/]+)\/revoke-sessions$/);
  if (match && req.method === 'POST') { await handleRevokeUserSessions(req, res, match[1], deps); return true; }

  match = path.match(/^\/api\/security\/alerts\/([^/]+)$/);
  if (match && req.method === 'PATCH') { await handleUpdateAlert(req, res, match[1], deps); return true; }

  return false;
}
