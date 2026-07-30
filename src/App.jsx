import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BadgeCheck, Bell, BookOpenText, CreditCard, FileText, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, Plane, Receipt, RefreshCcw, Search, Settings, ShieldCheck, UserCog } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import BookingDetail from './pages/BookingDetail';
import Accounts from './pages/Accounts';
import Payments from './pages/Payments';
import PaymentVerification from './pages/PaymentVerification';
import Refunds from './pages/Refunds';
import Expenses from './pages/Expenses';
import Alerts from './pages/Alerts';
import Statements from './pages/Statements';
import SettingsPage from './pages/Settings';
import Users from './pages/Users';
import Security from './pages/Security';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import { useAuth } from './AuthContext';
import { hasPermission } from './helpers/permissions';
import { getBookings, loadFinanceData } from './helpers/storage';
const brandLogo = '/Fly for Sure Logo no background no tagline.png';

const normalizeLookup = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const lookupFields = (booking = {}) => ({
  ref: booking.booking_ref || booking.invoice_no || '',
  invoice: booking.invoice_no || '',
  pnr: booking.pnr || '',
  passenger: booking.passenger_name || '',
  ticket: booking.ticket_no || '',
  sector: booking.sector || '',
  mobile: booking.mobile || '',
});

const bookingDetailPath = (booking = {}) => `/bookings/${encodeURIComponent(booking.booking_ref || booking.invoice_no || '')}`;

function scoreBookingLookup(booking, query) {
  const fields = lookupFields(booking);
  const rawQuery = query.trim().toLowerCase();
  const normalizedQuery = normalizeLookup(query);
  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeLookup(value)]),
  );
  const haystack = Object.values(fields).join(' ').toLowerCase();
  const normalizedHaystack = Object.values(normalizedFields).join(' ');

  if (!normalizedQuery) return 0;
  if ([normalizedFields.pnr, normalizedFields.ticket, normalizedFields.invoice, normalizedFields.ref].includes(normalizedQuery)) return 100;
  if ([normalizedFields.pnr, normalizedFields.ticket, normalizedFields.invoice, normalizedFields.ref].some((value) => value.startsWith(normalizedQuery))) return 90;
  if (normalizedFields.passenger.startsWith(normalizedQuery)) return 80;
  if (normalizedHaystack.includes(normalizedQuery)) return 60;
  if (haystack.includes(rawQuery)) return 50;
  return 0;
}

export default function App() {
  const location = useLocation();

  if (location.pathname === '/login') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [dataReady, setDataReady] = useState(false);
  const [sidebarMinimized, setSidebarMinimized] = useState(() => localStorage.getItem('ffs_sidebar_minimized') === '1');
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupFocused, setLookupFocused] = useState(false);

  const canLoadData = Boolean(user) && !user?.must_change_password;

  useEffect(() => {
    if (!canLoadData) return;
    let cancelled = false;
    loadFinanceData()
      .catch((error) => console.error('[app] Failed to load finance data:', error))
      .finally(() => { if (!cancelled) setDataReady(true); });
    return () => { cancelled = true; };
  }, [canLoadData]);

  useEffect(() => {
    localStorage.setItem('ffs_sidebar_minimized', sidebarMinimized ? '1' : '0');
  }, [sidebarMinimized]);

  const lookupResults = useMemo(() => {
    if (!dataReady || lookupQuery.trim().length < 2) return [];
    return getBookings()
      .map((booking) => ({ booking, score: scoreBookingLookup(booking, lookupQuery) }))
      .filter((result) => result.score > 0 && (result.booking.booking_ref || result.booking.invoice_no))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((result) => result.booking);
  }, [dataReady, lookupQuery]);

  const selectLookupResult = (booking) => {
    setLookupQuery('');
    setLookupFocused(false);
    navigate(bookingDetailPath(booking));
  };

  const submitLookup = (event) => {
    event.preventDefault();
    if (lookupResults[0]) selectLookupResult(lookupResults[0]);
  };

  if (loading) {
    return <div className="auth-screen"><div className="auth-card"><h1>Loading workspace</h1><p>Checking your secure session.</p></div></div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <ChangePassword />;

  if (!dataReady) {
    return <div className="auth-screen"><div className="auth-card"><h1>Loading workspace</h1><p>Fetching bookings and finance records.</p></div></div>;
  }

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: null },
    { path: '/bookings', label: 'Bookings', icon: Plane, permission: 'view_bookings' },
    { path: '/accounts', label: 'Ledgers', icon: BookOpenText, permission: 'view_payments' },
    { path: '/payments', label: 'Payments', icon: CreditCard, permission: 'view_payments' },
    { path: '/payments/verification', label: 'Verification', icon: BadgeCheck, permission: 'verify_payments' },
    { path: '/refunds', label: 'Refunds', icon: RefreshCcw, permission: 'view_refunds' },
    { path: '/expenses', label: 'Expenses', icon: Receipt, permission: 'view_financials' },
    { path: '/alerts', label: 'Alerts', icon: Bell, permission: 'view_bookings' },
    { path: '/statements', label: 'Statements', icon: FileText, permission: 'view_statements' },
    { path: '/users', label: 'Users', icon: UserCog, permission: 'manage_users' },
    { path: '/security', label: 'Security', icon: ShieldCheck, permission: 'view_audit_logs' },
    { path: '/settings', label: 'Settings', icon: Settings, permission: 'configure_settings' },
  ].filter((item) => !item.permission || hasPermission(user, item.permission));

  return (
    <div className={`app-container${sidebarMinimized ? ' sidebar-minimized' : ''}`}>
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <img src={brandLogo} alt="FlyForSure" />
          <div>
            <h2>FlyForSure</h2>
            <span>Finance Office</span>
          </div>
        </div>
        
        <nav className="nav-menu">
          {navItems.map((item) => (
            <NavLink 
              key={item.path}
              to={item.path} 
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              data-label={item.label}
              aria-label={item.label}
            >
              <item.icon className="nav-icon" size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-summary">
            <span>Workspace</span>
            <strong>Rome HQ</strong>
            <small>{user.role.replace(/_/g, ' ')} access</small>
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setSidebarMinimized((value) => !value)}
              aria-label={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
              title={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
            >
              {sidebarMinimized ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="top-header">
          <form className="search-lookup" onSubmit={submitLookup} onBlur={() => setTimeout(() => setLookupFocused(false), 120)}>
            <div className="search-bar">
              <Search size={18} />
              <input
                type="search"
                value={lookupQuery}
                onChange={(event) => setLookupQuery(event.target.value)}
                onFocus={() => setLookupFocused(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setLookupFocused(false);
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Search PNR, Passenger, or Ticket..."
                autoComplete="off"
              />
            </div>
            {lookupFocused && lookupQuery.trim().length >= 2 && (
              <div className="search-results" role="listbox">
                {lookupResults.length > 0 ? lookupResults.map((booking) => (
                  <button
                    key={`${booking.id}-${booking.invoice_no}`}
                    className="search-result-item"
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectLookupResult(booking);
                    }}
                  >
                    <span>
                      <strong>{booking.pnr || booking.booking_ref || booking.invoice_no}</strong>
                      <small>{booking.passenger_name || 'Unnamed passenger'}</small>
                    </span>
                    <span>
                      <strong>{booking.ticket_no || 'No ticket'}</strong>
                      <small>{[booking.sector, booking.booking_ref || booking.invoice_no].filter(Boolean).join(' · ')}</small>
                    </span>
                  </button>
                )) : (
                  <div className="search-result-empty">No matching booking found</div>
                )}
              </div>
            )}
          </form>
          <div className="top-header-status">
            <ShieldCheck size={16} />
            Secure session
          </div>
          <div className="user-profile">
            <div className="avatar">{(user.name || user.email || 'U').slice(0, 1).toUpperCase()}</div>
            <span>{user.name || user.email}</span>
            <button className="icon-button" type="button" onClick={logout} title="Log out" aria-label="Log out">
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/bookings/:invoiceNo" element={<BookingDetail />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/:accountKey" element={<Accounts />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/payments/verification" element={<PermissionGate permission="verify_payments"><PaymentVerification /></PermissionGate>} />
            <Route path="/refunds" element={<Refunds />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/statements" element={<Statements />} />
            <Route path="/users" element={<PermissionGate permission="manage_users"><Users /></PermissionGate>} />
            <Route path="/security" element={<PermissionGate permission="view_audit_logs"><Security /></PermissionGate>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function PermissionGate({ permission, children }) {
  const { user } = useAuth();
  if (!hasPermission(user, permission)) {
    return (
      <div className="page-container fade-in">
        <div className="empty-state">
          <h5>Access restricted</h5>
          <p>Your role does not include this workspace permission.</p>
        </div>
      </div>
    );
  }
  return children;
}
