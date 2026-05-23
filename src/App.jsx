import { Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, Plane, CreditCard, RefreshCcw, Receipt, Bell, FileText, Settings, Search, ShieldCheck } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Payments from './pages/Payments';
import Refunds from './pages/Refunds';
import Expenses from './pages/Expenses';
import Alerts from './pages/Alerts';
import Statements from './pages/Statements';
import SettingsPage from './pages/Settings';
import brandLogo from '../Fly for Sure Logo no background no tagline.png';

export default function App() {
  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/bookings', label: 'Bookings', icon: Plane },
    { path: '/payments', label: 'Payments', icon: CreditCard },
    { path: '/refunds', label: 'Refunds', icon: RefreshCcw },
    { path: '/expenses', label: 'Expenses', icon: Receipt },
    { path: '/alerts', label: 'Alerts', icon: Bell },
    { path: '/statements', label: 'Statements', icon: FileText },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

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
          <small>Daily finance control</small>
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
            Live ledger
          </div>
          <div className="user-profile">
            <div className="avatar">A</div>
            <span>Admin</span>
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
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
