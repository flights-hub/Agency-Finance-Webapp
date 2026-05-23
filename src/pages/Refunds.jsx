import React, { useState, useEffect } from 'react';
import { getRefunds, getBookings, saveRefund } from '../helpers/storage';
import { getEligibleRefund, daysBetween } from '../helpers/calculations';
import { RefreshCcw, Plus } from 'lucide-react';

export default function Refunds() {
  const [refunds, setRefunds] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [bookings, setBookings] = useState([]);

  // Form
  const [ticketNo, setTicketNo] = useState('');
  const [airlinePenalty, setAirlinePenalty] = useState(0);
  const [serviceFee, setServiceFee] = useState(0);
  const [refundCategory, setRefundCategory] = useState('VOLUNTARY');

  useEffect(() => {
    setRefunds(getRefunds());
    setBookings(getBookings());
  }, [showModal]);

  const handleCreateRefund = () => {
    const booking = bookings.find(b => b.ticket_no === ticketNo);
    if (!booking) return alert('Ticket number not found in bookings!');

    const eligible = getEligibleRefund(booking.fare_sold, airlinePenalty, serviceFee);
    
    const refund = {
      ticket_no: ticketNo,
      pnr: booking.pnr,
      passenger_name: booking.passenger_name,
      airline: booking.airline,
      sector: booking.sector,
      fare_sold: booking.fare_sold,
      fare_issued: booking.fare_issued,
      cancel_date: new Date().toISOString().split('T')[0],
      cancel_type: 'FULL_BOOKING', // simplistic
      refund_category: refundCategory,
      airline_penalty: airlinePenalty,
      service_fee: serviceFee,
      eligible_refund: eligible,
      refund_status: 'IN_PROCESS',
      status_date: new Date().toISOString().split('T')[0],
      processing_days: 0
    };

    saveRefund(refund);
    setShowModal(false);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{display:'flex', justifyContent:'space-between'}}>
        <div>
          <h1>Refunds</h1>
          <p>Track passenger ticket cancellations and refunds.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> New Refund
        </button>
      </header>

      <div className="card">
        <table className="data-table" style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}}>
          <thead>
            <tr style={{borderBottom: '1px solid var(--border)'}}>
              <th style={{padding: '12px 8px'}}>Ticket No</th>
              <th style={{padding: '12px 8px'}}>PNR</th>
              <th style={{padding: '12px 8px'}}>Passenger</th>
              <th style={{padding: '12px 8px'}}>Eligible (€)</th>
              <th style={{padding: '12px 8px'}}>Days</th>
              <th style={{padding: '12px 8px'}}>Status</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map(r => (
              <tr key={r.id} style={{borderBottom: '1px solid var(--border)'}}>
                <td style={{padding: '12px 8px', fontWeight: 'bold'}}>{r.ticket_no}</td>
                <td style={{padding: '12px 8px'}}>{r.pnr}</td>
                <td style={{padding: '12px 8px'}}>{r.passenger_name}</td>
                <td style={{padding: '12px 8px'}}>€{r.eligible_refund}</td>
                <td style={{padding: '12px 8px'}}>
                  <span style={{color: r.processing_days > 30 ? '#FF3B30' : 'inherit'}}>{r.processing_days}</span>
                </td>
                <td style={{padding: '12px 8px'}}>
                  <span className="badge" style={{
                    background: r.refund_status === 'REFUNDED_TO_CLIENT' ? 'rgba(52,199,89,0.1)' : 'rgba(255,204,0,0.1)',
                    color: r.refund_status === 'REFUNDED_TO_CLIENT' ? '#34C759' : '#FFCC00'
                  }}>
                    {r.refund_status.replace(/_/g, ' ')}
                  </span>
                </td>
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
            <h3>Create Refund Entry</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'15px', marginTop:'20px'}}>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Ticket Number</label>
                <input type="text" value={ticketNo} onChange={e => setTicketNo(e.target.value)} style={{width:'100%', padding:'8px'}} placeholder="e.g. 055-1234567890" />
              </div>
              <div style={{display:'flex', gap:'10px'}}>
                <div style={{flex:1}}>
                  <label style={{display:'block', marginBottom:'5px'}}>Airline Penalty (€)</label>
                  <input type="number" value={airlinePenalty} onChange={e => setAirlinePenalty(Number(e.target.value))} style={{width:'100%', padding:'8px'}} />
                </div>
                <div style={{flex:1}}>
                  <label style={{display:'block', marginBottom:'5px'}}>Service Fee (€)</label>
                  <input type="number" value={serviceFee} onChange={e => setServiceFee(Number(e.target.value))} style={{width:'100%', padding:'8px'}} />
                </div>
              </div>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Category</label>
                <select value={refundCategory} onChange={e => setRefundCategory(e.target.value)} style={{width:'100%', padding:'8px'}}>
                  <option value="VOLUNTARY">Voluntary (Client request)</option>
                  <option value="INVOLUNTARY">Involuntary (Airline cancel)</option>
                </select>
              </div>
              <div style={{display:'flex', gap:'10px', marginTop:'10px'}}>
                <button className="btn btn-primary" onClick={handleCreateRefund}>Save Refund</button>
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
