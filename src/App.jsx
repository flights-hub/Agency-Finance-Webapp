import { Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, Plane, CreditCard, RefreshCcw, Receipt, Bell, FileText, Settings } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Payments from './pages/Payments';
import Refunds from './pages/Refunds';
import Expenses from './pages/Expenses';
import Alerts from './pages/Alerts';
import Statements from './pages/Statements';
import SettingsPage from './pages/Settings';

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
          <div className="logo-placeholder">
            <span>F</span>
          </div>
          <h2>FlyForSure</h2>
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
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="top-header">
          <div className="search-bar">
            <input type="text" placeholder="Search PNR, Passenger, or Ticket..." />
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
