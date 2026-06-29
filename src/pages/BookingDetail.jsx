import { useParams, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { getBookings, getPayments, savePayment, saveBooking, getRefunds, saveRefund } from '../helpers/storage';
import { formatCurrency, formatDate } from '../helpers/format';
import { getPaymentLedger, createPaymentEntry, PAYMENT_MODES, numeric, REFUND_CATEGORIES, daysBetween, calculateVoidQuote, calculateCancelQuote, calculateAmendQuote, calculateRefundQuote } from '../helpers/calculations';
import { ArrowLeft, Download, Plus, MoreVertical, Printer, FileText, Mail, AlertCircle, ChevronDown, X } from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: { bg: '#F3F4F6', text: '#374151' },
  HELD: { bg: '#FEF3C7', text: '#92400E' },
  TICKETED: { bg: '#DBEAFE', text: '#1E40AF' },
  VOIDED: { bg: '#FEE2E2', text: '#991B1B' },
  CANCELLED: { bg: '#FEE2E2', text: '#991B1B' },
  AUTO_CANCELLED: { bg: '#FEE2E2', text: '#991B1B' },
};

const PRINT_MENU_ITEMS = [
  { id: 'eticket', label: 'E-ticket (per passenger)' },
  { id: 'invoice', label: 'Invoice/Receipt' },
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'booking_record', label: 'Full Booking Record' },
];

const CANCEL_SCOPES = [
  { id: 'booking', label: 'Entire Booking' },
  { id: 'flight', label: 'Single Flight Segment' },
  { id: 'passenger', label: 'Single Passenger' },
];

export default function BookingDetail() {
  const { invoiceNo } = useParams();
  const navigate = useNavigate();
  const bookings = getBookings();
  const payments = getPayments();
  const refunds = getRefunds();
  const booking = bookings.find(b => b.invoice_no === invoiceNo);

  // Modal states
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(null); // 'void', 'cancel', 'amend', 'refund'
  const [showAmendForm, setShowAmendForm] = useState(false);
  const [cancelScope, setCancelScope] = useState('booking');
  const [showCancelMenu, setShowCancelMenu] = useState(false);

  // Form states
  const [paymentForm, setPaymentForm] = useState({
    amount_paid: '',
    payment_mode: 'CASH',
    remarks: '',
  });

  const [amendForm, setAmendForm] = useState({
    outbound_date: booking?.outbound_date || '',
    inbound_date: booking?.inbound_date || '',
    passenger_name: booking?.passenger_name || '',
  });

  const [refundForm, setRefundForm] = useState({
    refund_category: 'VOLUNTARY',
    remarks: '',
  });

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

  // Calculate payment ledger and balance
  const bookingPayments = payments.filter(p => p.pnr === booking.pnr);
  const total = numeric(booking.fare_sold || 0);
  const paid = bookingPayments.reduce((sum, p) => sum + numeric(p.amount_paid), 0);
  const balance = total - paid;

  // Helper function to format segments for display
  const getSegmentDisplay = () => {
    if (!booking.flight_segments || booking.flight_segments.length === 0) {
      return `${booking.sector || 'N/A'}`;
    }
    return booking.flight_segments
      .flatMap(seg => seg.connections || [])
      .map(conn => `${conn.departure_city || conn.origin || ''} → ${conn.arrival_city || conn.destination || ''}`)
      .join(' > ');
  };


  const handleAddPayment = () => {
    const amount = Number(paymentForm.amount_paid);
    if (!amount || amount <= 0) {
      alert('Enter a positive payment amount.');
      return;
    }

    const payment = createPaymentEntry(
      {
        pnr: booking.pnr,
        amount_paid: amount,
        payment_mode: paymentForm.payment_mode,
        received_by: 'Finance Admin',
        remarks: paymentForm.remarks,
        payment_date: new Date().toISOString().split('T')[0],
      },
      [booking],
      bookingPayments
    );
    savePayment(payment);
    setPaymentForm({ amount_paid: '', payment_mode: 'CASH', remarks: '' });
    setShowPaymentModal(false);
    window.location.reload();
  };

  const handleHoldBooking = () => {
    saveBooking({
      ...booking,
      ticket_status: 'HELD',
      updated_at: new Date().toISOString(),
    });
    window.location.reload();
  };

  const handleIssueTicket = () => {
    saveBooking({
      ...booking,
      ticket_status: 'TICKETED',
      ticket_no: booking.ticket_no || `TKT-${Date.now()}`,
      updated_at: new Date().toISOString(),
    });
    window.location.reload();
  };

  const handleVoid = () => {
    const updatedBooking = {
      ...booking,
      ticket_status: 'VOIDED',
      void_date: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    };
    saveBooking(updatedBooking);
    setShowQuoteModal(null);
    window.location.reload();
  };

  const handleCancel = () => {
    const updatedBooking = {
      ...booking,
      ticket_status: 'CANCELLED',
      cancel_date: new Date().toISOString().split('T')[0],
      cancel_scope: cancelScope,
      updated_at: new Date().toISOString(),
    };
    saveBooking(updatedBooking);
    setShowQuoteModal(null);
    window.location.reload();
  };

  const handleAmend = () => {
    if (!amendForm.outbound_date && !amendForm.inbound_date && !amendForm.passenger_name) {
      alert('Please specify at least one change');
      return;
    }

    const amendmentRequest = {
      id: `amend-${Date.now()}`,
      booking_id: booking.id,
      pnr: booking.pnr,
      status: 'EXECUTED',
      requested_changes: {
        outbound_date: amendForm.outbound_date,
        inbound_date: amendForm.inbound_date,
        passenger_name: amendForm.passenger_name,
      },
      quote: calculateAmendQuote(),
      request_date: new Date().toISOString().split('T')[0],
      executed_date: new Date().toISOString().split('T')[0],
    };

    const updatedBooking = {
      ...booking,
      outbound_date: amendForm.outbound_date || booking.outbound_date,
      inbound_date: amendForm.inbound_date || booking.inbound_date,
      passenger_name: amendForm.passenger_name || booking.passenger_name,
      amendment_request: amendmentRequest,
      updated_at: new Date().toISOString(),
    };

    saveBooking(updatedBooking);
    setShowAmendForm(false);
    setShowQuoteModal(null);
    window.location.reload();
  };

  const handleRefund = () => {
    const quote = calculateRefundQuote();
    const refundCase = {
      id: `refund-${Date.now()}`,
      booking_id: booking.id,
      pnr: booking.pnr,
      ticket_no: booking.ticket_no,
      refund_status: 'APPLIED',
      refund_category: refundForm.refund_category,
      refundable_amount: quote.refundable,
      penalty: quote.penalty,
      non_refundable_emd: quote.nonRefundableEmd,
      remarks: refundForm.remarks,
      request_date: new Date().toISOString().split('T')[0],
    };

    saveRefund(refundCase);
    setShowQuoteModal(null);
    setRefundForm({ refund_category: 'VOLUNTARY', remarks: '' });
    window.location.reload();
  };

  const handlePrint = (type) => {
    console.log(`Printing ${type} for ${booking.pnr}`);
    // Implement actual print logic based on type
    setShowPrintMenu(false);
  };

  const statusColor = STATUS_COLORS[booking.ticket_status] || STATUS_COLORS.DRAFT;
  const canVoid = booking.ticket_status === 'TICKETED';
  const canCancel = ['DRAFT', 'HELD', 'TICKETED'].includes(booking.ticket_status);
  const canAmend = ['HELD', 'TICKETED'].includes(booking.ticket_status);
  const canRefund = booking.ticket_status === 'TICKETED' && !booking.refund_flag;
  const canIssueTicket = booking.ticket_status === 'HELD';

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
            {booking.source || 'GDS'} · {booking.manual_entry ? 'manual' : 'api'}
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
          <div style={{ position: 'relative' }}>
            <button
              className="btn"
              onClick={() => setShowPrintMenu(!showPrintMenu)}
              style={{ fontSize: '12px' }}>
              <Printer size={15} style={{ marginRight: '4px' }} />
              Print <ChevronDown size={12} />
            </button>
            {showPrintMenu && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                background: 'var(--color-background-primary)',
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                minWidth: '180px',
                zIndex: 10,
                marginTop: '4px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                {PRINT_MENU_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handlePrint(item.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '7px', marginTop: '10px', flexWrap: 'wrap' }}>
          {booking.ticket_status === 'DRAFT' && (
            <button
              className="btn btn-primary"
              onClick={handleHoldBooking}
              style={{ fontSize: '12px' }}>
              <FileText size={14} style={{ marginRight: '3px' }} />
              Hold booking
            </button>
          )}
          {canIssueTicket && (
            <button
              className="btn btn-primary"
              onClick={handleIssueTicket}
              style={{ fontSize: '12px' }}>
              <FileText size={14} style={{ marginRight: '3px' }} />
              Issue ticket
            </button>
          )}
          {canVoid && (
            <button
              className="btn btn-primary"
              onClick={() => setShowQuoteModal('void')}
              style={{ fontSize: '12px' }}>
              <FileText size={14} style={{ marginRight: '3px' }} />
              Void
            </button>
          )}
          {canCancel && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn"
                onClick={() => setShowCancelMenu(!showCancelMenu)}
                style={{ fontSize: '12px' }}>
                <FileText size={14} style={{ marginRight: '3px' }} />
                Cancel <ChevronDown size={12} />
              </button>
              {showCancelMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: 'var(--color-background-primary)',
                  border: '1px solid var(--color-border-secondary)',
                  borderRadius: 'var(--border-radius-md)',
                  minWidth: '160px',
                  zIndex: 10,
                  marginTop: '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  {CANCEL_SCOPES.map(scope => (
                    <button
                      key={scope.id}
                      onClick={() => {
                        setCancelScope(scope.id);
                        setShowCancelMenu(false);
                        setShowQuoteModal('cancel');
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        borderBottom: '0.5px solid var(--color-border-tertiary)',
                      }}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canAmend && (
            <button
              className="btn"
              onClick={() => setShowAmendForm(true)}
              style={{ fontSize: '12px' }}>
              <Download size={14} style={{ marginRight: '3px' }} />
              Amend
            </button>
          )}
          {canRefund && (
            <button
              className="btn"
              onClick={() => setShowQuoteModal('refund')}
              style={{ fontSize: '12px' }}>
              <FileText size={14} style={{ marginRight: '3px' }} />
              Apply refund
            </button>
          )}
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
            {booking.flight_segments && booking.flight_segments.length > 0 ? (
              booking.flight_segments.map((segment, segIdx) => (
                <div key={segIdx}>
                  <p style={{ margin: '8px 0 4px', fontSize: '11px', fontWeight: '500', color: 'var(--color-text-secondary)' }}>
                    {segment.label || `Leg ${segIdx + 1}`}
                  </p>
                  {segment.connections && segment.connections.map((conn, connIdx) => (
                    <div key={connIdx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 0',
                      borderTop: connIdx === 0 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                      fontSize: '12.5px'
                    }}>
                      <span>
                        {conn.departure_city || conn.origin || '-'} → {conn.arrival_city || conn.destination || '-'} · {conn.flight_number || conn.airline || '-'} · {conn.departure_date || '-'}
                      </span>
                      <span style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '9px', background: '#E1F5EE', color: '#085041' }}>
                        HK
                      </span>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div style={{ padding: '8px 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {booking.sector || 'No flight segments defined'}
              </div>
            )}
          </div>

          {/* Passengers & Baggage */}
          <div className="card">
            <h3 style={{ margin: '0 0 9px', fontSize: '13px', fontWeight: '500' }}>👥 Passengers, tickets & baggage</h3>
            {booking.passengers && Array.isArray(booking.passengers) && booking.passengers.length > 0 ? (
              booking.passengers.map((pax, idx) => (
                <div key={idx} style={{ padding: '7px 0', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                  <p style={{ margin: '0', fontSize: '13px' }}>
                    {pax.passenger_name || 'N/A'} <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>· {pax.pax_type || 'ADT'}</span>
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                    <span style={{ fontFamily: 'monospace' }}>{booking.ticket_no || '-'}</span> · {pax.check_in_baggage || '23'}kg
                    {pax.mobile && <span> · {pax.mobile}</span>}
                  </p>
                </div>
              ))
            ) : (
              <div style={{ padding: '8px 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                <p style={{ margin: '0', fontSize: '13px' }}>
                  {booking.passenger_name || 'N/A'} <span style={{ fontSize: '11px' }}>· {booking.pax_type || 'ADT'}</span>
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  <span style={{ fontFamily: 'monospace' }}>{booking.ticket_no || '-'}</span> · 23kg
                </p>
              </div>
            )}
          </div>

          {/* Fare & Ledger */}
          <div className="card">
            <h3 style={{ margin: '0 0 9px', fontSize: '13px', fontWeight: '500' }}>📋 Fare & ledger</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: '12.5px' }}>
              <span>Ticket issue · charge</span>
              <span style={{ color: '#A32D2D' }}>+{formatCurrency(total)}</span>
            </div>
            {bookingPayments.length > 0 ? (
              bookingPayments.sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || '')).map((payment, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: '12.5px' }}>
                  <span>
                    {payment.instalment_type || 'Payment'} <span style={{ color: 'var(--color-text-tertiary)' }}>· {payment.payment_mode} {payment.payment_date ? `· ${payment.payment_date}` : ''}</span>
                    {payment.verification_status && payment.verification_status !== 'VERIFIED' && (
                      <span style={{ color: '#DC2626', marginLeft: '4px', fontSize: '10px' }}>⚠ {payment.verification_status}</span>
                    )}
                  </span>
                  <span style={{ color: '#3B6D11' }}>−{formatCurrency(payment.amount_paid)}</span>
                </div>
              ))
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: '12.5px', color: 'var(--color-text-secondary)' }}>
                <span>No payments recorded</span>
              </div>
            )}
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
            <p style={{ margin: '0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Bill To</p>
            <p style={{ margin: '1px 0 0', fontSize: '12.5px' }}>{booking.bill_to_name || 'N/A'}</p>
            <p style={{ margin: '1px 0 6px', fontSize: '11.5px', color: 'var(--color-text-info)' }}>
              {booking.mobile || 'N/A'}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)', borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: '6px' }}>Lead passenger</p>
            <p style={{ margin: '1px 0 0', fontSize: '12.5px' }}>{booking.passenger_name || 'N/A'}</p>
            <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: 'var(--color-text-info)' }}>
              {booking.mobile || 'N/A'}
            </p>
          </div>

          {/* Documents */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>📄 Documents</h3>
            {booking.ticket_no && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: '12px' }}>
                <span>🎫 E-ticket</span>
                <Download size={14} style={{ color: 'var(--color-text-info)', cursor: 'pointer' }} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: '12px' }}>
              <span>🧾 Invoice {booking.invoice_no}</span>
              <Download size={14} style={{ color: 'var(--color-text-info)', cursor: 'pointer' }} />
            </div>
          </div>

          {/* Refund Status */}
          {booking.refund_flag && (
            <div className="card">
              <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>💰 Refund Case</h3>
              {refunds.find(r => r.pnr === booking.pnr) ? (
                (() => {
                  const refundCase = refunds.find(r => r.pnr === booking.pnr);
                  return (
                    <>
                      <p style={{ margin: '0', fontSize: '12px' }}>
                        Status: <span style={{ fontWeight: '500', color: refundCase.refund_status === 'REFUNDED_TO_CLIENT' ? '#0F6E56' : '#854F0B' }}>
                          {refundCase.refund_status?.replace(/_/g, ' ') || 'APPLIED'}
                        </span>
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                        Category: {refundCase.refund_category?.replace(/_/g, ' ') || 'N/A'}
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                        Refundable: {formatCurrency(refundCase.refundable_amount || 0)}
                      </p>
                    </>
                  );
                })()
              ) : (
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>Refund marked but no case created yet</p>
              )}
            </div>
          )}

          {/* Amendment Requests */}
          {booking.amendment_request && (
            <div className="card">
              <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>
                ✏️ Amendment
                <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '6px', background: booking.amendment_request.status === 'EXECUTED' ? '#DBEAFE' : '#FAEEDA', color: booking.amendment_request.status === 'EXECUTED' ? '#1E40AF' : '#854F0B', marginLeft: '4px' }}>
                  {booking.amendment_request.status}
                </span>
              </h3>
              <p style={{ margin: '0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                Requested: {booking.amendment_request.request_date}
              </p>
              {booking.amendment_request.executed_date && (
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  Executed: {booking.amendment_request.executed_date}
                </p>
              )}
            </div>
          )}

          {/* Comms */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>💬 Comms</h3>
            <p style={{ margin: '0', fontSize: '12px' }}>
              {booking.ticket_status === 'TICKETED' ? 'Ticket confirmation sent' : 'Booking confirmation sent'}
            </p>
            <p style={{ margin: '1px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              {booking.booking_date || booking.created_at?.split('T')[0]} · Latest update
            </p>
          </div>

          {/* Audit Log */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>📜 Audit log</h3>
            <p style={{ margin: '0', fontSize: '11.5px' }}>
              {booking.booking_date || booking.created_at?.split('T')[0]} · Booking created
            </p>
            {booking.ticket_status === 'HELD' && (
              <p style={{ margin: '3px 0 0', fontSize: '11.5px' }}>Booking held</p>
            )}
            {booking.ticket_status === 'TICKETED' && booking.ticket_no && (
              <p style={{ margin: '3px 0 0', fontSize: '11.5px' }}>Ticket issued · {booking.ticket_no}</p>
            )}
            {booking.ticket_status === 'VOIDED' && booking.void_date && (
              <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#991B1B' }}>Voided on {booking.void_date}</p>
            )}
            {booking.ticket_status === 'CANCELLED' && booking.cancel_date && (
              <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#991B1B' }}>Cancelled on {booking.cancel_date}</p>
            )}
          </div>
        </div>
      </div>

      {/* Add Payment Modal */}
      {showPaymentModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3>Add Payment</h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
              >
                <X size={18} />
              </button>
            </div>
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

      {/* Quote Modal - Void */}
      {showQuoteModal === 'void' && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <h3>Void Ticket - Review Changes</h3>
            {(() => {
              const quote = calculateVoidQuote(balance);
              return (
                <>
                  <div style={{ background: '#FEF3C7', padding: '12px', borderRadius: 'var(--border-radius-md)', marginBottom: '16px', fontSize: '13px' }}>
                    {quote.message}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: 'var(--color-background-primary)', padding: '12px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Refundable Amount</p>
                      <p style={{ margin: '0', fontSize: '15px', fontWeight: '500', color: '#0F6E56' }}>
                        {formatCurrency(quote.refundableAmount)}
                      </p>
                    </div>
                    <div style={{ background: 'var(--color-background-primary)', padding: '12px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Charges</p>
                      <p style={{ margin: '0', fontSize: '15px', fontWeight: '500', color: '#991B1B' }}>
                        {formatCurrency(quote.charges)}
                      </p>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => setShowQuoteModal(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleVoid}>Confirm Void</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Quote Modal - Cancel */}
      {showQuoteModal === 'cancel' && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <h3>Cancel Booking - Review Changes</h3>
            {(() => {
              const quote = calculateCancelQuote(balance);
              return (
                <>
                  <div style={{ background: '#FEF3C7', padding: '12px', borderRadius: 'var(--border-radius-md)', marginBottom: '16px', fontSize: '13px' }}>
                    {quote.message} ({quote.cancellationPercentage}%)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px', fontSize: '12px' }}>
                    <div style={{ background: 'var(--color-background-primary)', padding: '10px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '10px', color: 'var(--color-text-secondary)' }}>Cancellation Charge</p>
                      <p style={{ margin: '0', fontWeight: '500', color: '#991B1B' }}>{formatCurrency(quote.cancellationCharge)}</p>
                    </div>
                    <div style={{ background: 'var(--color-background-primary)', padding: '10px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '10px', color: 'var(--color-text-secondary)' }}>Processing Fee</p>
                      <p style={{ margin: '0', fontWeight: '500', color: '#991B1B' }}>{formatCurrency(quote.processingFee)}</p>
                    </div>
                    <div style={{ background: '#DBEAFE', padding: '10px', borderRadius: 'var(--border-radius-md)', gridColumn: '1 / -1' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '10px', color: 'var(--color-text-secondary)' }}>Refund Amount</p>
                      <p style={{ margin: '0', fontWeight: '500', color: '#1E40AF', fontSize: '13px' }}>{formatCurrency(quote.refundAmount)}</p>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => setShowQuoteModal(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleCancel}>Confirm Cancel</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Amend Modal */}
      {showAmendForm && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3>Request Amendment</h3>
              <button
                onClick={() => setShowAmendForm(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-form-grid">
              <label>
                <span>Outbound Date</span>
                <input
                  type="date"
                  value={amendForm.outbound_date}
                  onChange={(e) => setAmendForm({ ...amendForm, outbound_date: e.target.value })}
                />
              </label>
              <label>
                <span>Inbound Date (if RT)</span>
                <input
                  type="date"
                  value={amendForm.inbound_date}
                  onChange={(e) => setAmendForm({ ...amendForm, inbound_date: e.target.value })}
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span>Passenger Name (if changing)</span>
                <input
                  value={amendForm.passenger_name}
                  onChange={(e) => setAmendForm({ ...amendForm, passenger_name: e.target.value })}
                />
              </label>
            </div>

            {(() => {
              const quote = calculateAmendQuote();
              return (
                <>
                  <div style={{ background: '#DBEAFE', padding: '10px', borderRadius: 'var(--border-radius-md)', marginBottom: '12px', fontSize: '12px' }}>
                    <p style={{ margin: '0 0 3px', color: 'var(--color-text-secondary)' }}>Change Fee</p>
                    <p style={{ margin: '0', fontWeight: '500', color: '#1E40AF' }}>{formatCurrency(quote.changeFee)}</p>
                  </div>
                </>
              );
            })()}

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowAmendForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                setShowQuoteModal('amend');
                setShowAmendForm(false);
              }}>Review Quote</button>
            </div>
          </div>
        </div>
      )}

      {/* Quote Modal - Amend */}
      {showQuoteModal === 'amend' && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <h3>Amendment Quote</h3>
            {(() => {
              const quote = calculateAmendQuote(balance);
              return (
                <>
                  <div style={{ background: '#DBEAFE', padding: '12px', borderRadius: 'var(--border-radius-md)', marginBottom: '16px', fontSize: '13px' }}>
                    {quote.message}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: 'var(--color-background-primary)', padding: '12px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Change Fee</p>
                      <p style={{ margin: '0', fontSize: '15px', fontWeight: '500', color: '#1E40AF' }}>
                        {formatCurrency(quote.changeFee)}
                      </p>
                    </div>
                    <div style={{ background: 'var(--color-background-primary)', padding: '12px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>New Balance</p>
                      <p style={{ margin: '0', fontSize: '15px', fontWeight: '500', color: '#633806' }}>
                        {formatCurrency(quote.newBalance)}
                      </p>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => setShowQuoteModal(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleAmend}>Confirm Amendment</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Quote Modal - Refund */}
      {showQuoteModal === 'refund' && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3>Apply Refund</h3>
              <button
                onClick={() => setShowQuoteModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-form-grid" style={{ marginBottom: '12px' }}>
              <label>
                <span>Refund Category</span>
                <select
                  value={refundForm.refund_category}
                  onChange={(e) => setRefundForm({ ...refundForm, refund_category: e.target.value })}
                >
                  {REFUND_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span>Remarks</span>
                <input
                  value={refundForm.remarks}
                  onChange={(e) => setRefundForm({ ...refundForm, remarks: e.target.value })}
                />
              </label>
            </div>

            {(() => {
              const quote = calculateRefundQuote(balance);
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px', fontSize: '12px' }}>
                    <div style={{ background: '#DBEAFE', padding: '10px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '10px', color: 'var(--color-text-secondary)' }}>Refundable</p>
                      <p style={{ margin: '0', fontWeight: '500', color: '#1E40AF' }}>{formatCurrency(quote.refundable)}</p>
                    </div>
                    <div style={{ background: '#FEE2E2', padding: '10px', borderRadius: 'var(--border-radius-md)' }}>
                      <p style={{ margin: '0 0 3px', fontSize: '10px', color: 'var(--color-text-secondary)' }}>Penalty</p>
                      <p style={{ margin: '0', fontWeight: '500', color: '#991B1B' }}>{formatCurrency(quote.penalty)}</p>
                    </div>
                    {quote.nonRefundableEmd > 0 && (
                      <div style={{ background: '#FEE2E2', padding: '10px', borderRadius: 'var(--border-radius-md)', gridColumn: '1 / -1' }}>
                        <p style={{ margin: '0 0 3px', fontSize: '10px', color: 'var(--color-text-secondary)' }}>Non-Refundable EMDs</p>
                        <p style={{ margin: '0', fontWeight: '500', color: '#991B1B' }}>{formatCurrency(quote.nonRefundableEmd)}</p>
                      </div>
                    )}
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => setShowQuoteModal(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleRefund}>Apply Refund</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
