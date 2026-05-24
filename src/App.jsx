import { Navigate, Route, Routes, NavLink, useLocation } from 'react-router-dom';
import { Bell, CreditCard, FileText, LayoutDashboard, LogOut, Plane, Receipt, RefreshCcw, Search, Settings, ShieldCheck, UserCog } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Payments from './pages/Payments';
import Refunds from './pages/Refunds';
import Expenses from './pages/Expenses';
import Alerts from './pages/Alerts';
import Statements from './pages/Statements';
import SettingsPage from './pages/Settings';
import Users from './pages/Users';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import { useAuth } from './AuthContext';
import { hasPermission } from './helpers/permissions';
import brandLogo from '../Fly for Sure Logo no background no tagline.png';

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

  if (loading) {
    return <div className="auth-screen"><div className="auth-card"><h1>Loading workspace</h1><p>Checking your secure session.</p></div></div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <ChangePassword />;

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: null },
    { path: '/bookings', label: 'Bookings', icon: Plane, permission: 'view_bookings' },
    { path: '/payments', label: 'Payments', icon: CreditCard, permission: 'view_payments' },
    { path: '/refunds', label: 'Refunds', icon: RefreshCcw, permission: 'view_refunds' },
    { path: '/expenses', label: 'Expenses', icon: Receipt, permission: 'view_financials' },
    { path: '/alerts', label: 'Alerts', icon: Bell, permission: 'view_bookings' },
    { path: '/statements', label: 'Statements', icon: FileText, permission: 'view_statements' },
    { path: '/users', label: 'Users', icon: UserCog, permission: 'manage_users' },
    { path: '/settings', label: 'Settings', icon: Settings, permission: 'configure_settings' },
  ].filter((item) => !item.permission || hasPermission(user, item.permission));

  return (
    <div className="app-container">
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
            >
              <item.icon className="nav-icon" size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-summary">
          <span>Workspace</span>
          <strong>Rome HQ</strong>
          <small>{user.role.replace(/_/g, ' ')} access</small>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="top-header">
          <div className="search-bar">
            <Search size={18} />
            <input type="text" placeholder="Search PNR, Passenger, or Ticket..." />
          </div>
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
            <Route path="/payments" element={<Payments />} />
            <Route path="/refunds" element={<Refunds />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/statements" element={<Statements />} />
            <Route path="/users" element={<PermissionGate permission="manage_users"><Users /></PermissionGate>} />
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
