import React, { useState, useEffect } from 'react';
import { getAlerts, getBookings, saveAlert } from '../helpers/storage';
import { getAlertLevel, daysBetween } from '../helpers/calculations';
import { Bell, AlertTriangle } from 'lucide-react';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    // Generate alerts dynamically from bookings
    const bookings = getBookings();
    const today = new Date().toISOString().split('T')[0];
    const generatedAlerts = [];

    bookings.forEach(b => {
      const days = daysBetween(today, b.outbound_date);
      const level = getAlertLevel(days, b.balance_due);
      
      if (level !== 'SETTLED') {
        generatedAlerts.push({
          id: b.id + '_alert',
          pnr: b.pnr,
          message: `Departure in ${days} days with €${b.balance_due} unpaid.`,
          level,
          created_date: today,
          status: 'ACTIVE'
        });
      }
    });

    setAlerts(generatedAlerts);
  }, []);

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Live Alerts</h1>
        <p>Auto-generated alerts for upcoming departures with pending balances.</p>
      </header>

      <div className="grid-3" style={{marginBottom: '20px'}}>
        <div className="card stat-card" style={{border: '1px solid #FF3B30'}}>
          <div className="stat-content">
            <p className="stat-label" style={{color: '#FF3B30'}}>Critical (≤ 0 Days)</p>
            <h3 className="stat-value">{alerts.filter(a => a.level === 'CRITICAL').length}</h3>
          </div>
        </div>
        <div className="card stat-card" style={{border: '1px solid #FF9500'}}>
          <div className="stat-content">
            <p className="stat-label" style={{color: '#FF9500'}}>Urgent (1-7 Days)</p>
            <h3 className="stat-value">{alerts.filter(a => a.level === 'URGENT').length}</h3>
          </div>
        </div>
        <div className="card stat-card" style={{border: '1px solid #FFCC00'}}>
          <div className="stat-content">
            <p className="stat-label" style={{color: '#FFCC00'}}>Follow Up (8-14 Days)</p>
            <h3 className="stat-value">{alerts.filter(a => a.level === 'FOLLOW_UP').length}</h3>
          </div>
        </div>
      </div>

      <div className="card">
        {alerts.length === 0 ? (
          <p style={{padding: '20px', textAlign: 'center', color: 'var(--zinc-500)'}}>No active alerts.</p>
        ) : (
          <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
            {alerts.sort((a,b) => {
              const order = { 'CRITICAL': 0, 'URGENT': 1, 'FOLLOW_UP': 2 };
              return order[a.level] - order[b.level];
            }).map((a, i) => (
              <li key={i} style={{
                padding: '15px', borderBottom: '1px solid var(--border)', 
                display:'flex', alignItems:'center', gap:'15px'
              }}>
                <AlertTriangle size={24} color={a.level === 'CRITICAL' ? '#FF3B30' : a.level === 'URGENT' ? '#FF9500' : '#FFCC00'} />
                <div style={{flex: 1}}>
                  <strong style={{marginRight:'10px'}}>{a.pnr}</strong>
                  <span>{a.message}</span>
                </div>
                <button className="btn btn-secondary" onClick={() => window.location.href='/payments'}>Record Payment</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
