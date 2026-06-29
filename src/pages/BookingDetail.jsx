import { useParams, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { getBookings, getPayments, savePayment } from '../helpers/storage';
import { formatCurrency } from '../helpers/format';
import { getPaymentLedger, createPaymentEntry, PAYMENT_MODES } from '../helpers/calculations';
import { ArrowLeft, Download, Plus, MoreVertical, Printer, FileText, Mail, AlertCircle } from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: { bg: '#F3F4F6', text: '#374151' },
  HELD: { bg: '#FEF3C7', text: '#92400E' },
  TICKETED: { bg: '#DBEAFE', text: '#1E40AF' },
  VOIDED: { bg: '#FEE2E2', text: '#991B1B' },
  CANCELLED: { bg: '#FEE2E2', text: '#991B1B' },
  AUTO_CANCELLED: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function BookingDetail() {
  const { invoiceNo } = useParams();
  const navigate = useNavigate();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount_paid: '',
    payment_mode: 'CASH',
    remarks: '',
  });

  const bookings = getBookings();
  const payments = getPayments();
  const booking = bookings.find(b => b.invoice_no === invoiceNo);

  if (!booking) {
    return (
      <div className="page-container fade-in" style={{ textAlign: 'center', padding: '40px' }}>
        <AlertCircle size={48} style={{ color: '#EF4444', margin: '0 auto' }} />
        <h2>Booking not found</h2>
        <button className="btn btn-primary" onClick={() => navigate('/bookings')}>
          Back to Bookings
        </button>
      </div>
    );
  }

  const bookingLedger = useMemo(() => getPaymentLedger([booking], payments), [booking, payments]);
  const ledger = bookingLedger.length > 0 ? bookingLedger[0] : booking;

  const handleAddPayment = () => {
    const amount = Number(paymentForm.amount_paid);
    if (!amount || amount <= 0) {
      alert('Enter a positive payment amount.');
      return;
    }

    const payment = createPaymentEntry(
      { ...paymentForm, amount_paid: amount, received_by: 'Finance Admin' },
      [booking],
      payments
    );
    savePayment(payment);

    setPaymentForm({ amount_paid: '', payment_mode: 'CASH', remarks: '' });
    setShowPaymentModal(false);
    window.location.reload();
  };

  const statusColor = STATUS_COLORS[booking.ticket_status] || STATUS_COLORS.DRAFT;
  const total = Number(booking.fare_sold || 0);
  const paid = ledger.cumulative_paid || 0;
  const balance = total - paid;

  return (
    <div className="page-container fade-in">
      {/* Breadcrumb & Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button
          onClick={() => navigate('/bookings')}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px',
            cursor: 'pointer',
            color: 'var(--color-text-info)'
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Bookings</span>
        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>/</span>
        <span style={{ fontSize: '13px', fontWeight: '500' }}>{invoiceNo}</span>
      </div>

      {/* Pinned Header */}
      <div style={{
        background: 'var(--color-background-primary)',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '12px 15px',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '15px', fontWeight: '500' }}>PNR {booking.pnr || '-'}</span>
          <span style={{
            fontSize: '12px',
            padding: '3px 10px',
            borderRadius: '12px',
            background: statusColor.bg,
            color: statusColor.text
          }}>
            {booking.ticket_status || 'DRAFT'}
          </span>
          <span style={{
            fontSize: '12px',
            padding: '3px 10px',
            borderRadius: '12px',
            background: '#EEEDFE',
            color: '#3C3489'
          }}>
            {booking.source || 'AMADEUS'} · manual
          </span>
          <span style={{
            fontSize: '12px',
            padding: '3px 10px',
            borderRadius: '12px',
            background: balance > 0 ? '#FAEEDA' : '#DBEAFE',
            color: balance > 0 ? '#633806' : '#1E40AF'
          }}>
            Balance {formatCurrency(balance)}
          </span>
          <span style={{ flex: 1 }}></span>
          <button className="btn" style={{ fontSize: '12px' }}>
            <Printer size={15} style={{ marginRight: '4px' }} />
            Print <MoreVertical size={12} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '7px', marginTop: '10px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ fontSize: '12px' }}>
            <FileText size={14} style={{ marginRight: '3px' }} />
            Void
          </button>
          <button className="btn" style={{ fontSize: '12px' }}>
            <FileText size={14} style={{ marginRight: '3px' }} />
            Cancel <MoreVertical size={12} />
          </button>
          <button className="btn" style={{ fontSize: '12px' }}>
            <Download size={14} style={{ marginRight: '3px' }} />
            Amend
          </button>
          <button className="btn" style={{ fontSize: '12px' }}>
            <FileText size={14} style={{ marginRight: '3px' }} />
            Apply refund
          </button>
        </div>
      </div>

      {/* Payment Band */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
        flexWrap: 'wrap'
      }}>
        <div style={{
          flex: 1,
          minWidth: '96px',
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 'var(--border-radius-md)',
          padding: '9px 12px'
        }}>
          <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Total</p>
          <p style={{ margin: '0', fontSize: '17px', fontWeight: '500' }}>{formatCurrency(total)}</p>
        </div>

        <div style={{
          flex: 1,
          minWidth: '96px',
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 'var(--border-radius-md)',
          padding: '9px 12px'
        }}>
          <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Paid</p>
          <p style={{ margin: '0', fontSize: '17px', fontWeight: '500', color: '#0F6E56' }}>{formatCurrency(paid)}</p>
        </div>

        <div style={{
          flex: 1,
          minWidth: '96px',
          background: '#FAEEDA',
          borderRadius: 'var(--border-radius-md)',
          padding: '9px 12px'
        }}>
          <p style={{ margin: '0 0 2px', fontSize: '11px', color: '#854F0B' }}>Balance due</p>
          <p style={{ margin: '0', fontSize: '17px', fontWeight: '500', color: '#633806' }}>{formatCurrency(balance)}</p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => setShowPaymentModal(true)}
          style={{ fontSize: '12px', alignSelf: 'center' }}
        >
          <Plus size={14} style={{ marginRight: '3px' }} />
          Add payment
        </button>
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: '10px' }}>

        {/* Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* Itinerary */}
          <div className="card">
            <h3 style={{ margin: '0 0 9px', fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '5px' }}>
              ✈️ Itinerary
            </h3>
            {booking.flight_segments && booking.flight_segments.map((segment, idx) => (
              <div key={idx} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderTop: '0.5px solid var(--color-border-tertiary)',
                fontSize: '12.5px'
              }}>
                <span>{segment.origin} → {segment.destination} · {segment.flight_no} · {segment.dep_date}</span>
                <span style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '9px', background: '#E1F5EE', color: '#085041' }}>
                  HK
                </span>
              </div>
            ))}
          </div>

          {/* Passengers & Baggage */}
          <div className="card">
            <h3 style={{ margin: '0 0 9px', fontSize: '13px', fontWeight: '500' }}>👥 Passengers, tickets & baggage</h3>
            {booking.passengers && booking.passengers.map((pax, idx) => (
              <div key={idx} style={{ padding: '7px 0', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <p style={{ margin: '0', fontSize: '13px' }}>
                  {pax.passenger_name} <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>· {pax.pax_type}</span>
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  <span style={{ fontFamily: 'monospace' }}>{booking.ticket_no || '-'}</span> · 23kg
                </p>
              </div>
            ))}
          </div>

          {/* Fare & Ledger */}
          <div className="card">
            <h3 style={{ margin: '0 0 9px', fontSize: '13px', fontWeight: '500' }}>📋 Fare & ledger</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: '12.5px' }}>
              <span>Ticket issue · charge</span>
              <span style={{ color: '#A32D2D' }}>+{formatCurrency(booking.fare_sold || 0)}</span>
            </div>
            {payments.filter(p => p.pnr === booking.pnr || p.booking_id === booking.id).map((payment, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: '12.5px' }}>
                <span>{payment.description || 'Payment'} <span style={{ color: 'var(--color-text-tertiary)' }}>· {payment.payment_mode}</span></span>
                <span style={{ color: '#3B6D11' }}>−{formatCurrency(payment.amount_paid)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 0', borderTop: '0.5px solid var(--color-border-secondary)', fontSize: '12.5px', fontWeight: '500' }}>
              <span>Balance due</span>
              <span style={{ color: '#633806' }}>{formatCurrency(balance)}</span>
            </div>
          </div>
        </div>

        {/* Right Rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* Contact */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>📋 Contact</h3>
            <p style={{ margin: '0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Agency</p>
            <p style={{ margin: '1px 0 0', fontSize: '12.5px' }}>{booking.bill_to_name || 'N/A'}</p>
            <p style={{ margin: '1px 0 6px', fontSize: '11.5px', color: 'var(--color-text-info)' }}>
              {booking.mobile} · contact@travel.com
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)', borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: '6px' }}>Lead passenger</p>
            <p style={{ margin: '1px 0 0', fontSize: '12.5px' }}>{booking.passenger_name || 'N/A'}</p>
            <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: 'var(--color-text-info)' }}>+91 98140 22553 · passenger@mail.com</p>
          </div>

          {/* Documents */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>📄 Documents</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: '12px' }}>
              <span>🎫 E-ticket</span>
              <Download size={14} style={{ color: 'var(--color-text-info)', cursor: 'pointer' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: '12px' }}>
              <span>🧾 Invoice {booking.invoice_no}</span>
              <Download size={14} style={{ color: 'var(--color-text-info)', cursor: 'pointer' }} />
            </div>
          </div>

          {/* Requests */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>
              📥 Requests
              <span style={{ fontSize: '11px', padding: '0 6px', borderRadius: '8px', background: '#FAEEDA', color: '#854F0B', marginLeft: '2px' }}>
                0
              </span>
            </h3>
            <p style={{ margin: '0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>No pending requests</p>
          </div>

          {/* Comms */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>💬 Comms</h3>
            <p style={{ margin: '0', fontSize: '12px' }}>Ticket confirmation sent</p>
            <p style={{ margin: '1px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              {booking.booking_date} · Latest update
            </p>
          </div>

          {/* Audit Log */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>📜 Audit log</h3>
            <p style={{ margin: '0', fontSize: '11.5px' }}>{booking.booking_date} · Booking created</p>
            <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: 'var(--color-text-info)', cursor: 'pointer' }}>
              View full log
            </p>
          </div>
        </div>
      </div>

      {/* Add Payment Modal */}
      {showPaymentModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <h3>Add Payment</h3>
            <div className="modal-form-grid">
              <label>
                <span>Amount Paid</span>
                <input
                  type="number"
                  value={paymentForm.amount_paid}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount_paid: e.target.value })}
                  min="0"
                />
              </label>
              <label>
                <span>Payment Mode</span>
                <select
                  value={paymentForm.payment_mode}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_mode: e.target.value })}
                >
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span>Remarks</span>
                <input
                  value={paymentForm.remarks}
                  onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddPayment}>Add Payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
