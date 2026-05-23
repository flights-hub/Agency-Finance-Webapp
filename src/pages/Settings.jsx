import React, { useState, useEffect } from 'react';
import { getUsers, saveUser } from '../helpers/storage';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    setUsers(getUsers());
  }, []);

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Settings</h1>
        <p>Manage users, roles, and application preferences.</p>
      </header>

      <div className="grid-2">
        <div className="card">
          <h3>Directory (Agents & Suppliers)</h3>
          <ul style={{listStyle: 'none', padding: 0, margin: '20px 0 0'}}>
            {users.map(u => (
              <li key={u.id} style={{padding: '10px 0', borderBottom: '1px solid var(--border)', display:'flex', justifyContent:'space-between'}}>
                <div>
                  <strong>{u.name}</strong>
                  <div style={{fontSize: '0.85em', color: 'var(--zinc-500)'}}>{u.email}</div>
                </div>
                <span className="badge" style={{alignSelf: 'center'}}>{u.role}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>Application Preferences</h3>
          <div style={{marginTop: '20px'}}>
            <label style={{display:'block', marginBottom:'10px', fontWeight:'bold'}}>Default Currency</label>
            <select style={{width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border)', marginBottom:'20px'}}>
              <option>EUR (€)</option>
              <option>USD ($)</option>
              <option>INR (₹)</option>
            </select>

            <label style={{display:'block', marginBottom:'10px', fontWeight:'bold'}}>Alert Threshold (Days)</label>
            <input type="number" defaultValue={14} style={{width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border)'}} />
            <p style={{fontSize: '0.85em', color: 'var(--zinc-500)', marginTop:'5px'}}>
              Number of days before departure to trigger a FOLLOW_UP alert for unpaid balances.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
