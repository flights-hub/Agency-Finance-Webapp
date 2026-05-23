import React from 'react';
import { FileText } from 'lucide-react';

export default function Statements() {
  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Statements</h1>
        <p>Generate daily statements for agents or suppliers.</p>
      </header>

      <div className="card" style={{textAlign: 'center', padding: '60px 20px'}}>
        <FileText size={48} color="var(--zinc-400)" style={{marginBottom: '20px'}} />
        <h2>Statement Generator</h2>
        <p style={{color: 'var(--zinc-500)', maxWidth: '400px', margin: '10px auto 30px'}}>
          Select an agent or supplier to generate a complete summary of all bookings, payments, and refunds for the selected period.
        </p>
        
        <div style={{display:'flex', gap:'10px', justifyContent:'center', alignItems:'center'}}>
          <select style={{padding: '10px', borderRadius: '4px', border: '1px solid var(--border)', minWidth: '200px'}}>
            <option>Rajesh Sharma (Agent)</option>
            <option>ITA Airways (Supplier)</option>
          </select>
          <input type="date" style={{padding: '10px', borderRadius: '4px', border: '1px solid var(--border)'}} />
          <button className="btn btn-primary">Generate Report</button>
        </div>
      </div>
    </div>
  );
}
