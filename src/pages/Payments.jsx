import React, { useState, useEffect } from 'react';
import { getPayments, getBookings, savePayment, saveBooking } from '../helpers/storage';
import { getPaymentStatus, getInstalmentType } from '../helpers/calculations';
import { CreditCard, Plus } from 'lucide-react';

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [showModal, setShowModal] = useState(false);

  // Form State
  const [pnr, setPnr] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('BANK_TRANSFER');

  useEffect(() => {
    setPayments(getPayments());
    setBookings(getBookings());
  }, [showModal]);

  const handleSavePayment = () => {
    const booking = bookings.find(b => b.pnr === pnr);
    if (!booking) return alert('PNR not found!');

    const amt = parseFloat(amount);
    const pnrPayments = getPayments(pnr);
    
    const instalment_no = pnrPayments.length + 1;
    const cumulative_paid = booking.total_paid + amt;
    const type = getInstalmentType(instalment_no, cumulative_paid, booking.fare_sold);

    const payment = {
      payment_date: new Date().toISOString().split('T')[0],
      pnr: pnr,
      passenger_name: booking.passenger_name,
      amount_paid: amt,
      payment_mode: mode,
      instalment_no,
      instalment_type: type,
      cumulative_paid
    };

    savePayment(payment);

    // Auto update booking
    booking.total_paid = cumulative_paid;
    booking.balance_due = booking.fare_sold - cumulative_paid;
    booking.payment_status = getPaymentStatus(booking.fare_sold, cumulative_paid);
    saveBooking(booking);

    setShowModal(false);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{display:'flex', justifyContent:'space-between'}}>
        <div>
          <h1>Payments</h1>
          <p>Ledger of all received payments by PNR.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Record Payment
        </button>
      </header>

      <div className="card">
        <table className="data-table" style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}}>
          <thead>
            <tr style={{borderBottom: '1px solid var(--border)'}}>
              <th style={{padding: '12px 8px'}}>Date</th>
              <th style={{padding: '12px 8px'}}>PNR</th>
              <th style={{padding: '12px 8px'}}>Instalment</th>
              <th style={{padding: '12px 8px'}}>Amount</th>
              <th style={{padding: '12px 8px'}}>Total Paid</th>
              <th style={{padding: '12px 8px'}}>Mode</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} style={{borderBottom: '1px solid var(--border)'}}>
                <td style={{padding: '12px 8px'}}>{p.payment_date}</td>
                <td style={{padding: '12px 8px', fontWeight: 'bold'}}>{p.pnr}</td>
                <td style={{padding: '12px 8px'}}>
                  <span className="badge" style={{background: 'var(--bg-secondary)'}}>{p.instalment_type}</span>
                </td>
                <td style={{padding: '12px 8px'}}>€{p.amount_paid}</td>
                <td style={{padding: '12px 8px'}}>€{p.cumulative_paid}</td>
                <td style={{padding: '12px 8px'}}>{p.payment_mode.replace('_', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="card" style={{width: '400px'}}>
            <h3>Record Payment</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'15px', marginTop:'20px'}}>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>PNR</label>
                <select value={pnr} onChange={e => setPnr(e.target.value)} style={{width:'100%', padding:'8px'}}>
                  <option value="">Select PNR</option>
                  {bookings.map(b => (
                    <option key={b.id} value={b.pnr}>{b.pnr} - {b.passenger_name} (Due: €{b.balance_due})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Amount Received (€)</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{width:'100%', padding:'8px'}} />
              </div>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Mode</label>
                <select value={mode} onChange={e => setMode(e.target.value)} style={{width:'100%', padding:'8px'}}>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CREDIT_CARD">Credit Card</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <div style={{display:'flex', gap:'10px', marginTop:'10px'}}>
                <button className="btn btn-primary" onClick={handleSavePayment}>Save</button>
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
