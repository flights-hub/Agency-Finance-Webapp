import React, { useState, useEffect } from 'react';
import { getBookings, getPayments, getRefunds, getExpenses, getAlerts } from '../helpers/storage';
import { calculatePnL } from '../helpers/calculations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { Euro, Users, CreditCard, AlertCircle, TrendingUp, RefreshCcw, Clock } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState({ pnl: {}, alerts: [] });
  const [refundStats, setRefundStats] = useState({ total: 0, pendingCount: 0, avgDays: 0, overdueCount: 0 });

  useEffect(() => {
    // Load all data
    const bookings = getBookings();
    const refunds = getRefunds();
    const expenses = getExpenses();
    const alerts = getAlerts();

    const pnl = calculatePnL(bookings, refunds, expenses);
    
    // Calculate refund stats
    const pendingRefunds = refunds.filter(r => r.refund_status !== 'REFUNDED_TO_CLIENT' && r.refund_status !== 'REJECTED');
    const totalRefunded = refunds.filter(r => r.refund_status === 'REFUNDED_TO_CLIENT').reduce((sum, r) => sum + (r.eligible_refund || 0), 0);
    
    // Average processing days (simplified for trainee: average of all refunds)
    const processedRefunds = refunds.filter(r => r.refund_status === 'REFUNDED_TO_CLIENT');
    const avgDays = processedRefunds.length > 0 
      ? Math.round(processedRefunds.reduce((sum, r) => sum + (r.processing_days || 0), 0) / processedRefunds.length)
      : 0;
      
    const overdueCount = pendingRefunds.filter(r => (r.processing_days || 0) > 30).length;

    setRefundStats({
      total: totalRefunded,
      pendingCount: pendingRefunds.length,
      avgDays,
      overdueCount
    });

    setStats({ pnl, alerts: alerts.filter(a => a.status === 'ACTIVE') });
  }, []);

  const pnl = stats.pnl;

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your travel agency finances.</p>
      </header>

      {/* Row 1: KPI Cards */}
      <section className="grid-4">
        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(230,104,84,0.1)', color: 'var(--coral)'}}>
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Effective Revenue</p>
            <h3 className="stat-value">€{pnl.effectiveRevenue?.toLocaleString() || 0}</h3>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(52,199,89,0.1)', color: '#34C759'}}>
            <Euro size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Gross Profit</p>
            <h3 className="stat-value">€{pnl.grossProfit?.toLocaleString() || 0}</h3>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(255,149,0,0.1)', color: '#FF9500'}}>
            <CreditCard size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Total Expenses</p>
            <h3 className="stat-value">€{pnl.totalExpenses?.toLocaleString() || 0}</h3>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(90,200,250,0.1)', color: '#5AC8FA'}}>
            <AlertCircle size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Net Profit</p>
            <h3 className="stat-value">€{pnl.netProfit?.toLocaleString() || 0}</h3>
          </div>
        </div>
      </section>

      {/* Row 2: Refund Tracking Cards */}
      <section className="grid-4" style={{marginTop: '20px'}}>
        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(255,59,48,0.1)', color: '#FF3B30'}}>
            <RefreshCcw size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Total Refunds Issued</p>
            <h3 className="stat-value">€{refundStats.total.toLocaleString()}</h3>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(255,204,0,0.1)', color: '#FFCC00'}}>
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Pending Refunds</p>
            <h3 className="stat-value">{refundStats.pendingCount}</h3>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{background: 'rgba(142,142,147,0.1)', color: '#8E8E93'}}>
            <Users size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Avg Processing Time</p>
            <h3 className="stat-value">{refundStats.avgDays} <span style={{fontSize:'0.5em'}}>days</span></h3>
          </div>
        </div>

        <div className={`card stat-card ${refundStats.overdueCount > 0 ? 'alert-pulse' : ''}`} style={refundStats.overdueCount > 0 ? { border: '1px solid #FF3B30'} : {}}>
          <div className="stat-icon" style={{background: 'rgba(255,59,48,0.1)', color: '#FF3B30'}}>
            <AlertCircle size={24} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Overdue Refunds (>30d)</p>
            <h3 className="stat-value" style={refundStats.overdueCount > 0 ? {color: '#FF3B30'} : {}}>{refundStats.overdueCount}</h3>
          </div>
        </div>
      </section>

      {/* Row 3: Main Charts (Placeholders for now, populated with static data to show trainee how to map) */}
      <section className="grid-2" style={{marginTop: '20px'}}>
        <div className="card">
          <h3>Profit & Loss Summary</h3>
          <div style={{ padding: '20px 0', borderBottom: '1px solid var(--border)'}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px'}}>
              <span>Revenue (Sales)</span>
              <strong>€{pnl.revenue?.toLocaleString() || 0}</strong>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px', color: 'var(--zinc-500)'}}>
              <span>Cost of Goods Sold (Tickets)</span>
              <span>- €{pnl.cogs?.toLocaleString() || 0}</span>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px', color: '#34C759'}}>
              <span>Gross Profit</span>
              <strong>€{pnl.grossProfit?.toLocaleString() || 0}</strong>
            </div>
          </div>
          <div style={{ padding: '20px 0'}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px', color: 'var(--zinc-500)'}}>
              <span>Total Expenses</span>
              <span>- €{pnl.totalExpenses?.toLocaleString() || 0}</span>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', fontSize: '1.2em', fontWeight: 'bold'}}>
              <span>Net Profit</span>
              <span style={{color: pnl.netProfit >= 0 ? '#34C759' : '#FF3B30'}}>€{pnl.netProfit?.toLocaleString() || 0}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Quick Actions</h3>
          <div style={{display:'flex', flexDirection:'column', gap: '15px', marginTop:'20px'}}>
            <button className="btn btn-primary" onClick={() => window.location.href='/bookings'}>+ New Booking</button>
            <button className="btn btn-secondary" onClick={() => window.location.href='/payments'}>Record Payment</button>
            <button className="btn btn-secondary" onClick={() => window.location.href='/bookings'}>Upload PDF Ticket</button>
          </div>
        </div>
      </section>
    </div>
  );
}
