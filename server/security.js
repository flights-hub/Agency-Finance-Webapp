import crypto from 'node:crypto';
import { supabaseRequest } from './supabase.js';

export const IDLE_TIMEOUT_MINUTES = 45;
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MINUTES = 15;
const ACTIVITY_TOUCH_SECONDS = 60;
const BUSINESS_HOURS = { start: 7, end: 22 };

// ---------------------------------------------------------------------------
// Request context: IP, user agent, geo intelligence
// ---------------------------------------------------------------------------

function isPrivateIp(ip) {
  return !ip
    || ip === '::1'
    || ip.startsWith('127.')
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
    || ip.startsWith('fc') || ip.startsWith('fe80');
}

export function parseUserAgent(ua = '') {
  const value = String(ua);
  let browser = 'Unknown';
  let browserVersion = '';
  let match;
  if ((match = value.match(/Edg(?:e|A|iOS)?\/([\d.]+)/))) [browser, browserVersion] = ['Edge', match[1]];
  else if ((match = value.match(/OPR\/([\d.]+)/))) [browser, browserVersion] = ['Opera', match[1]];
  else if ((match = value.match(/Chrome\/([\d.]+)/))) [browser, browserVersion] = ['Chrome', match[1]];
  else if ((match = value.match(/Firefox\/([\d.]+)/))) [browser, browserVersion] = ['Firefox', match[1]];
  else if ((match = value.match(/Version\/([\d.]+).*Safari/))) [browser, browserVersion] = ['Safari', match[1]];

  let os = 'Unknown';
  if (/Windows NT/.test(value)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(value)) os = 'iOS';
  else if (/Mac OS X/.test(value)) os = 'macOS';
  else if (/Android/.test(value)) os = 'Android';
  else if (/Linux/.test(value)) os = 'Linux';

  let deviceType = 'desktop';
  if (/iPad|Tablet/i.test(value)) deviceType = 'tablet';
  else if (/Mobi|iPhone|Android.*Mobile/i.test(value)) deviceType = 'mobile';

  return { browser, browserVersion, os, deviceType };
}

async function geoLookup(ip) {
  const empty = { country: null, region: null, city: null, isp: null, asn: null, vpnProxyTor: null };
  if (isPrivateIp(ip)) return { ...empty, vpnProxyTor: 'local_network' };
  try {
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,as,proxy,hosting`,
      { signal: AbortSignal.timeout(1500) },
    );
    const data = await response.json();
    if (data.status !== 'success') return empty;
    return {
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
      isp: data.isp || null,
      asn: data.as || null,
      vpnProxyTor: data.proxy ? 'proxy_or_vpn' : data.hosting ? 'hosting_provider' : 'clean',
    };
  } catch {
    return empty;
  }
}

export async function getRequestContext(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const socketIp = req.socket?.remoteAddress?.replace(/^::ffff:/, '') || null;
  const ip = forwarded || socketIp;
  const userAgent = String(req.headers['user-agent'] || '');
  const fingerprint = String(req.headers['x-device-fingerprint'] || '') || null;
  const geo = await geoLookup(ip);
  return { ip, forwardedIp: forwarded, socketIp, userAgent, fingerprint, ...parseUserAgent(userAgent), ...geo };
}

// ---------------------------------------------------------------------------
// Data minimization: mask sensitive values before they reach any log row
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|otp|api[_-]?key|card|cvv|iban|passport|credential/i;

export function maskValue(value) {
  const text = String(value ?? '');
  if (!text) return '****';
  return `****${text.slice(-4)}`;
}

export function maskSensitive(input) {
  if (input == null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(maskSensitive);
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) output[key] = maskValue(value);
    else if (value && typeof value === 'object') output[key] = maskSensitive(value);
    else output[key] = value;
  }
  return output;
}

function agencyId(profile) {
  return profile?.linked_agent_id || profile?.linked_supplier_id || null;
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export async function auditEvent(ctx, actor, {
  action,
  module = 'general',
  targetUserId = null,
  recordType = null,
  recordId = null,
  oldValue = null,
  newValue = null,
  result = 'success',
  errorMessage = null,
  risk = 'low',
  remarks = null,
  metadata = {},
} = {}) {
  try {
    await supabaseRequest('/rest/v1/audit_logs', {
      method: 'POST',
      body: {
        actor_id: actor?.id || null,
        action,
        target_user_id: targetUserId,
        metadata: maskSensitive(metadata),
        username: actor?.name || actor?.email || null,
        role: actor?.role || null,
        agency_id: agencyId(actor),
        module_name: module,
        action_type: action,
        record_type: recordType,
        record_id: recordId == null ? null : String(recordId),
        old_value: maskSensitive(oldValue),
        new_value: maskSensitive(newValue),
        ip_address: ctx?.ip || null,
        country: ctx?.country || null,
        city: ctx?.city || null,
        device: ctx ? `${ctx.deviceType} / ${ctx.os}` : null,
        browser: ctx ? `${ctx.browser} ${ctx.browserVersion}`.trim() : null,
        user_agent: ctx?.userAgent || null,
        result,
        error_message: errorMessage,
        risk_level: risk,
        remarks,
      },
    });
  } catch (error) {
    console.error('[security] failed to write audit log:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Security alerts
// ---------------------------------------------------------------------------

export async function createAlert(ctx, profile, { type, reason, risk = 'medium' }) {
  try {
    await supabaseRequest('/rest/v1/security_alerts', {
      method: 'POST',
      body: {
        alert_type: type,
        user_id: profile?.id || null,
        username: profile?.name || profile?.email || null,
        role: profile?.role || null,
        ip_address: ctx?.ip || null,
        country: ctx?.country || null,
        city: ctx?.city || null,
        device: ctx ? `${ctx.deviceType} / ${ctx.os}` : null,
        browser: ctx ? `${ctx.browser} ${ctx.browserVersion}`.trim() : null,
        trigger_reason: reason,
        risk_level: risk,
      },
    });
    // Critical alerts are also emitted to the server log so an operator or a
    // log shipper (email/SMS relay) can pick them up immediately.
    if (risk === 'critical' || risk === 'high') {
      console.warn(`[security-alert] ${risk.toUpperCase()} ${type}: ${reason} (user=${profile?.email || 'unknown'} ip=${ctx?.ip || '-'})`);
    }
  } catch (error) {
    console.error('[security] failed to create alert:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Login history + risk scoring
// ---------------------------------------------------------------------------

function minutesAgoIso(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

export async function countRecentLoginFailures({ username, ip }) {
  const since = minutesAgoIso(LOCKOUT_WINDOW_MINUTES);
  const filter = username
    ? `username=eq.${encodeURIComponent(username)}`
    : `ip_address=eq.${encodeURIComponent(ip)}`;
  const rows = await supabaseRequest(
    `/rest/v1/login_history?${filter}&login_status=in.(FAILED,BLOCKED)&login_time=gte.${since}&select=id,username`,
  );
  return rows || [];
}

async function previousSuccessfulLogins(userId) {
  return supabaseRequest(
    `/rest/v1/login_history?user_id=eq.${encodeURIComponent(userId)}&login_status=eq.SUCCESS&select=browser,operating_system,device_type,country,city,device_fingerprint&order=login_time.desc&limit=200`,
  ) || [];
}

export async function assessLoginRisk(profile, ctx, recentFailures) {
  const history = await previousSuccessfulLogins(profile.id);
  const firstLogin = history.length === 0;
  const isNewDevice = !firstLogin && !history.some((row) => (
    row.browser === ctx.browser && row.operating_system === ctx.os && row.device_type === ctx.deviceType
  ));
  const knownCountries = new Set(history.map((row) => row.country).filter(Boolean));
  const knownCities = new Set(history.map((row) => row.city).filter(Boolean));
  const isNewCountry = Boolean(ctx.country) && knownCountries.size > 0 && !knownCountries.has(ctx.country);
  const isNewLocation = isNewCountry
    || (Boolean(ctx.city) && knownCities.size > 0 && !knownCities.has(ctx.city));

  const hour = new Date().getHours();
  const offHours = hour < BUSINESS_HOURS.start || hour >= BUSINESS_HOURS.end;
  const isAdmin = profile.role === 'ADMIN';
  const vpn = ctx.vpnProxyTor === 'proxy_or_vpn' || ctx.vpnProxyTor === 'hosting_provider';

  let score = 0;
  if (isNewDevice) score += 2;
  if (isNewLocation) score += 2;
  if (isNewCountry) score += 2;
  if (recentFailures >= 3) score += 3;
  else if (recentFailures > 0) score += 1;
  if (vpn) score += isAdmin ? 3 : 1;
  if (isAdmin && offHours) score += 2;
  if (isAdmin && (isNewDevice || isNewLocation)) score += 1;

  const riskScore = score >= 7 ? 'critical' : score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { isNewDevice, isNewLocation, isNewCountry, offHours, vpn, riskScore, firstLogin };
}

export async function recordLoginAttempt(ctx, {
  profile = null,
  username,
  status,
  failureReason = null,
  sessionHash = null,
  assessment = null,
}) {
  try {
    await supabaseRequest('/rest/v1/login_history', {
      method: 'POST',
      body: {
        user_id: profile?.id || null,
        username: profile?.email || username || null,
        role: profile?.role || null,
        agency_id: agencyId(profile),
        login_status: status,
        failure_reason: failureReason,
        ip_address: ctx.ip,
        forwarded_ip: ctx.forwardedIp,
        country: ctx.country,
        region: ctx.region,
        city: ctx.city,
        isp: ctx.isp,
        asn: ctx.asn,
        device_type: ctx.deviceType,
        operating_system: ctx.os,
        browser: ctx.browser,
        browser_version: ctx.browserVersion,
        user_agent: ctx.userAgent,
        device_fingerprint: ctx.fingerprint,
        session_id: sessionHash,
        is_new_device: Boolean(assessment?.isNewDevice),
        is_new_location: Boolean(assessment?.isNewLocation),
        vpn_proxy_tor_status: ctx.vpnProxyTor,
        risk_score: assessment?.riskScore || (status === 'SUCCESS' ? 'low' : 'medium'),
      },
    });
  } catch (error) {
    console.error('[security] failed to record login attempt:', error.message);
  }
}

export async function raiseLoginAlerts(ctx, profile, assessment, failuresBefore) {
  const isAdmin = profile.role === 'ADMIN';
  const alerts = [];
  if (assessment.isNewCountry) {
    alerts.push({ type: 'login_new_country', reason: `Login from new country: ${ctx.country}`, risk: isAdmin ? 'critical' : 'high' });
  } else if (assessment.isNewLocation) {
    alerts.push({ type: 'login_new_city', reason: `Login from new city: ${ctx.city || 'unknown'}`, risk: isAdmin ? 'high' : 'medium' });
  }
  if (assessment.isNewDevice) {
    alerts.push({ type: 'login_new_device', reason: `Login from unrecognized device (${ctx.browser} on ${ctx.os})`, risk: isAdmin ? 'high' : 'medium' });
  }
  if (failuresBefore >= 3) {
    alerts.push({ type: 'login_after_failures', reason: `Successful login after ${failuresBefore} recent failed attempts`, risk: 'high' });
  }
  if (isAdmin && assessment.offHours) {
    alerts.push({ type: 'admin_offhours_login', reason: 'Admin login outside business hours', risk: 'medium' });
  }
  if (isAdmin && assessment.vpn) {
    alerts.push({ type: 'admin_vpn_login', reason: `Admin login via VPN/proxy/hosting network (${ctx.isp || 'unknown ISP'})`, risk: 'high' });
  }
  for (const alert of alerts) await createAlert(ctx, profile, alert);
}

export async function raiseFailedLoginAlerts(ctx, username) {
  const [byUser, byIp] = await Promise.all([
    countRecentLoginFailures({ username }),
    ctx.ip ? countRecentLoginFailures({ ip: ctx.ip }) : Promise.resolve([]),
  ]);
  if (byUser.length >= LOCKOUT_THRESHOLD) {
    await createAlert(ctx, { email: username }, {
      type: 'multiple_failed_logins',
      reason: `${byUser.length} failed login attempts for ${username} within ${LOCKOUT_WINDOW_MINUTES} minutes`,
      risk: 'high',
    });
  }
  const distinctUsers = new Set(byIp.map((row) => row.username));
  if (distinctUsers.size >= 3) {
    await createAlert(ctx, { email: username }, {
      type: 'ip_credential_stuffing',
      reason: `Failed logins for ${distinctUsers.size} different accounts from IP ${ctx.ip}`,
      risk: 'critical',
    });
  }
  return byUser.length;
}

// ---------------------------------------------------------------------------
// Session registry (revocable server-side sessions)
// ---------------------------------------------------------------------------

function hashSessionId(sid) {
  return crypto.createHash('sha256').update(String(sid)).digest('hex');
}

export async function createSession(profile, ctx, ttlSeconds) {
  const sid = crypto.randomUUID();
  const sessionHash = hashSessionId(sid);
  await supabaseRequest('/rest/v1/user_sessions', {
    method: 'POST',
    body: {
      user_id: profile.id,
      session_id_hash: sessionHash,
      ip_address: ctx.ip,
      country: ctx.country,
      city: ctx.city,
      device: `${ctx.deviceType} / ${ctx.os}`,
      browser: `${ctx.browser} ${ctx.browserVersion}`.trim(),
      expiry_time: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    },
  });
  return { sid, sessionHash };
}

export async function validateSession(sid) {
  if (!sid) return null;
  const sessionHash = hashSessionId(sid);
  const rows = await supabaseRequest(
    `/rest/v1/user_sessions?session_id_hash=eq.${sessionHash}&select=*`,
  );
  const session = rows?.[0];
  if (!session || session.status !== 'ACTIVE') return null;

  const now = Date.now();
  const idleLimit = IDLE_TIMEOUT_MINUTES * 60 * 1000;
  if (new Date(session.expiry_time).getTime() < now || now - new Date(session.last_activity).getTime() > idleLimit) {
    await expireSession(session);
    return null;
  }

  if (now - new Date(session.last_activity).getTime() > ACTIVITY_TOUCH_SECONDS * 1000) {
    supabaseRequest(`/rest/v1/user_sessions?id=eq.${session.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { last_activity: new Date().toISOString() },
    }).catch(() => {});
  }
  return session;
}

async function expireSession(session) {
  await supabaseRequest(`/rest/v1/user_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { status: 'EXPIRED', revoked_reason: 'expired' },
  }).catch(() => {});
  await closeLoginRecord(session.session_id_hash, 'expired');
}

export async function closeLoginRecord(sessionHash, reason = 'logout') {
  if (!sessionHash) return;
  try {
    const rows = await supabaseRequest(
      `/rest/v1/login_history?session_id=eq.${encodeURIComponent(sessionHash)}&logout_time=is.null&select=id,login_time`,
    );
    for (const row of rows || []) {
      const duration = Math.max(0, Math.round((Date.now() - new Date(row.login_time).getTime()) / 1000));
      await supabaseRequest(`/rest/v1/login_history?id=eq.${row.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { logout_time: new Date().toISOString(), session_duration: duration },
      });
    }
  } catch (error) {
    console.error(`[security] failed to close login record (${reason}):`, error.message);
  }
}

export async function endSession(sid, reason = 'logout') {
  if (!sid) return;
  const sessionHash = hashSessionId(sid);
  await supabaseRequest(`/rest/v1/user_sessions?session_id_hash=eq.${sessionHash}&status=eq.ACTIVE`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { status: 'REVOKED', revoked_reason: reason },
  }).catch(() => {});
  await closeLoginRecord(sessionHash, reason);
}

export async function revokeUserSessions(userId, { exceptSid = null, revokedBy = null, reason = 'revoked' } = {}) {
  const exceptHash = exceptSid ? hashSessionId(exceptSid) : null;
  const rows = await supabaseRequest(
    `/rest/v1/user_sessions?user_id=eq.${encodeURIComponent(userId)}&status=eq.ACTIVE&select=id,session_id_hash`,
  );
  let count = 0;
  for (const session of rows || []) {
    if (exceptHash && session.session_id_hash === exceptHash) continue;
    await supabaseRequest(`/rest/v1/user_sessions?id=eq.${session.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { status: 'REVOKED', revoked_by: revokedBy, revoked_reason: reason },
    });
    await closeLoginRecord(session.session_id_hash, reason);
    count += 1;
  }
  return count;
}

export async function revokeSessionById(sessionRowId, { revokedBy, reason = 'force_logout' }) {
  const rows = await supabaseRequest(
    `/rest/v1/user_sessions?id=eq.${encodeURIComponent(sessionRowId)}&select=id,session_id_hash,user_id,status`,
  );
  const session = rows?.[0];
  if (!session) {
    const error = new Error('Session not found.');
    error.status = 404;
    throw error;
  }
  await supabaseRequest(`/rest/v1/user_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { status: 'REVOKED', revoked_by: revokedBy, revoked_reason: reason },
  });
  await closeLoginRecord(session.session_id_hash, reason);
  return session;
}

export async function revokeAllSessions({ exceptSid = null, revokedBy = null, reason = 'emergency_revoke_all' } = {}) {
  const exceptHash = exceptSid ? hashSessionId(exceptSid) : null;
  const rows = await supabaseRequest('/rest/v1/user_sessions?status=eq.ACTIVE&select=id,session_id_hash');
  let count = 0;
  for (const session of rows || []) {
    if (exceptHash && session.session_id_hash === exceptHash) continue;
    await supabaseRequest(`/rest/v1/user_sessions?id=eq.${session.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { status: 'REVOKED', revoked_by: revokedBy, revoked_reason: reason },
    });
    await closeLoginRecord(session.session_id_hash, reason);
    count += 1;
  }
  return count;
}
