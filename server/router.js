const routes = [
  { method: 'POST', path: '/api/auth/login', handler: 'handleLogin' },
  { method: 'POST', path: '/api/auth/logout', handler: 'handleLogout' },
  { method: 'GET', path: '/api/auth/me', handler: 'handleMe' },
  { method: 'POST', path: '/api/auth/change-password', handler: 'handleChangePassword' },
  { method: 'POST', path: '/api/bookings/parse-pnr', handler: 'handleParsePnr' },
  { method: 'POST', path: '/api/bookings/parse-text', handler: 'handleParseBookingText' },
  { method: 'POST', path: '/api/admin/users', handler: 'handleCreateUser' },
  { method: 'GET', path: '/api/admin/users', handler: 'handleListUsers' },
  { method: 'POST', path: '/api/admin/users/bulk', handler: 'handleBulk' },
  { method: 'GET', path: '/api/admin/role-templates', handler: 'handleTemplates' },
  { method: 'PATCH', path: '/api/admin/users/:id', handler: 'handleUpdateUser' },
  { method: 'POST', path: '/api/admin/users/:id/reset-password', handler: 'handleResetPassword' },
  { method: 'GET', path: '/api/admin/users/:id/audit-logs', handler: 'handleAuditLogs' },
  { method: 'PUT', path: '/api/admin/role-templates/:id', handler: 'handleUpdateTemplate' },
];

export function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;

    if (!route.path.includes(':')) {
      if (route.path === pathname) return { handler: route.handler, params: {} };
      continue;
    }

    const pattern = route.path.replace(/:[^/]+/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    const match = pathname.match(regex);
    if (match) {
      const paramNames = route.path.match(/:[^/]+/g)?.map(p => p.slice(1)) || [];
      const params = Object.fromEntries(paramNames.map((name, i) => [name, match[i + 1]]));
      return { handler: route.handler, params };
    }
  }
  return null;
}
