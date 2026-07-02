import { useParams, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { getBookings, getPayments, savePayment, saveBooking, getRefunds, saveRefund, getAmendments, saveAmendment } from '../helpers/storage';
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

// Locally hosted, verified-current logos take priority over the third-party
// CDN fallback below - add more IATA codes here as logos are sourced.
const LOCAL_AIRLINE_LOGOS = {
  AI: '/airlines/AI.png',
};

const TIMELINE_ICONS = {
  CREATED: '🆕',
  STATUS: '📍',
  PAYMENT: '💵',
  REFUND: '💰',
  AMENDMENT: '✏️',
  NOTE: '📝',
  COMMS: '💬',
};

const TIMELINE_DOT_COLORS = {
  CREATED: '#DBEAFE',
  STATUS: '#F3F4F6',
  PAYMENT: '#DCFCE7',
  REFUND: '#FEE2E2',
  AMENDMENT: '#EDE9FE',
  NOTE: '#FEF3C7',
  COMMS: '#DBEAFE',
};

export default function BookingDetail() {
  const { invoiceNo } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const actorName = user?.name || user?.email || 'Admin';
  const bookings = getBookings();
  const payments = getPayments();
  const refunds = getRefunds();
  const amendments = getAmendments();
  // invoiceNo from the route is the booking reference. A booking groups every
  // passenger that shares this reference (one PNR, or several across suppliers).
  const normPnr = (value = '') => value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const groupBookings = bookings.filter(b => (b.booking_ref || b.invoice_no) === invoiceNo);
  const group = groupBookings.length
    ? groupBookings
    : (bookings.find(b => b.invoice_no === invoiceNo) ? [bookings.find(b => b.invoice_no === invoiceNo)] : []);
  const booking = group[0];
  const groupPnrs = [...new Set(group.map(b => normPnr(b.pnr)).filter(Boolean))];

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

  // Calculate payment ledger and balance across every passenger/PNR in the booking
  const bookingPayments = payments.filter(p => groupPnrs.includes(normPnr(p.pnr)));
  const total = group.reduce((sum, b) => sum + numeric(b.fare_sold || 0), 0);
  const paid = bookingPayments.reduce((sum, p) => sum + numeric(p.amount_paid), 0);
  const balance = total - paid;

  // Every refund case and amendment tied to this booking's PNR(s) - a booking
  // can go through more than one of each, so these are lists, not single records.
  const bookingRefunds = refunds.filter(r => groupPnrs.includes(normPnr(r.pnr)));
  const bookingAmendments = amendments.filter(a => groupPnrs.includes(normPnr(a.pnr)));
  // Older bookings stored a single amendment directly on the record before the
  // dedicated amendments collection existed - still surface it in the timeline.
  const legacyAmendment = booking.amendment_request && !bookingAmendments.some(a => a.id === booking.amendment_request.id)
    ? booking.amendment_request
    : null;

  // Builds one merged, chronological view of everything that happened on this
  // booking - status changes, payments, refunds, amendments, notes and comms -
  // so support/admin staff have a single timeline instead of hunting across cards.
  const buildTimeline = () => {
    const items = [];
    const createdDate = booking.booking_date || booking.created_at?.split('T')[0];

    if (createdDate) {
      items.push({ date: createdDate, type: 'CREATED', label: 'Booking created' });
    }
    if (booking.ticket_status === 'HELD') {
      items.push({ date: booking.updated_at?.split('T')[0] || createdDate, type: 'STATUS', label: 'Booking held' });
    }
    if (booking.ticket_status === 'TICKETED' && booking.ticket_no) {
      items.push({ date: booking.updated_at?.split('T')[0] || createdDate, type: 'STATUS', label: `Ticket issued · ${booking.ticket_no}` });
    }
    if (booking.ticket_status === 'VOIDED' && booking.void_date) {
      items.push({ date: booking.void_date, type: 'STATUS', label: 'Booking voided', tone: 'negative' });
    }
    if (booking.ticket_status === 'CANCELLED' && booking.cancel_date) {
      items.push({ date: booking.cancel_date, type: 'STATUS', label: 'Booking cancelled', tone: 'negative' });
    }
    if (booking.remarks) {
      items.push({ date: createdDate, type: 'NOTE', label: 'Note added', detail: booking.remarks });
    }
    items.push({
      date: createdDate,
      type: 'COMMS',
      label: booking.ticket_status === 'TICKETED' ? 'Ticket confirmation sent' : 'Booking confirmation sent',
    });

    bookingPayments.forEach((p) => {
      items.push({
        date: p.payment_date,
        type: 'PAYMENT',
        label: `${p.instalment_type || 'Payment'} received`,
        detail: [formatCurrency(p.amount_paid), p.payment_mode, p.remarks].filter(Boolean).join(' · '),
        actor: p.received_by,
      });
    });

    bookingRefunds.forEach((r) => {
      items.push({
        date: r.request_date,
        type: 'REFUND',
        label: `Refund ${(r.refund_status || 'applied').replace(/_/g, ' ').toLowerCase()}`,
        detail: [r.refund_category?.replace(/_/g, ' '), `Refundable ${formatCurrency(r.refundable_amount || 0)}`, r.remarks].filter(Boolean).join(' · '),
        actor: r.requested_by,
        tone: 'negative',
      });
    });

    [...bookingAmendments, ...(legacyAmendment ? [legacyAmendment] : [])].forEach((a) => {
      items.push({
        date: a.executed_date || a.request_date,
        type: 'AMENDMENT',
        label: `Amendment ${(a.status || 'requested').toLowerCase()}`,
        detail: Object.entries(a.requested_changes || {})
          .filter(([, value]) => value)
          .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
          .join(' · '),
        actor: a.requested_by,
      });
    });

    return items
      .filter((item) => item.date)
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  const timeline = buildTimeline();

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

  // Flight duration from parsed departure/arrival date+time, when both are known.
  const getFlightDuration = (conn) => {
    if (!conn.departure_date || !conn.departure_time || !conn.arrival_date || !conn.arrival_time) return '';
    const departure = new Date(`${conn.departure_date}T${conn.departure_time}:00`);
    const arrival = new Date(`${conn.arrival_date}T${conn.arrival_time}:00`);
    const minutes = Math.round((arrival - departure) / 60000);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    return `${Math.floor(minutes / 60)}Hr ${minutes % 60}Min`;
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
        received_by: actorName,
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
      requested_by: actorName,
    };

    const updatedBooking = {
      ...booking,
      outbound_date: amendForm.outbound_date || booking.outbound_date,
      inbound_date: amendForm.inbound_date || booking.inbound_date,
      passenger_name: amendForm.passenger_name || booking.passenger_name,
      updated_at: new Date().toISOString(),
    };

    saveAmendment(amendmentRequest);
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
      requested_by: actorName,
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
          <span style={{ fontSize: '15px', fontWeight: '500' }}>
            PNR {booking.pnr || '-'}
            {groupPnrs.length > 1 && (
              <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--color-text-secondary)' }}> +{groupPnrs.length - 1} more</span>
            )}
          </span>
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
              booking.flight_segments.map((segment, segIdx) => {
                const legBaggage = (segment.connections || []).find(c => c.check_in_baggage || c.cabin_baggage);
                return (
                  <div key={segIdx}>
                    <p style={{ margin: '8px 0 4px', fontSize: '11px', fontWeight: '500', color: 'var(--color-text-secondary)' }}>
                      {segment.label || `Leg ${segIdx + 1}`}
                    </p>
                    {segment.connections && segment.connections.map((conn, connIdx) => {
                      const duration = getFlightDuration(conn);
                      return (
                        <div key={connIdx} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 0',
                          borderTop: connIdx === 0 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            minWidth: 0,
                            fontSize: '12.5px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            <span style={{ position: 'relative', width: '32px', height: '18px', flexShrink: 0 }}>
                              {conn.airline && (
                                <img
                                  src={LOCAL_AIRLINE_LOGOS[conn.airline] || `https://images.kiwi.com/airlines/64/${conn.airline}.png`}
                                  alt={conn.airline}
                                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                  // Local logos are verified-current; the CDN fallback covers codes we
                                  // haven't sourced a local logo for yet, and itself falls back to a
                                  // generic airplane icon for codes it doesn't recognise. This onError
                                  // only fires if the CDN is unreachable entirely.
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling.style.display = 'flex';
                                  }}
                                />
                              )}
                              <span style={{
                                display: conn.airline ? 'none' : 'flex',
                                position: 'absolute',
                                inset: 0,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '5px',
                                background: 'var(--color-background-secondary)',
                                fontSize: '8.5px',
                                fontWeight: 600,
                              }}>
                                {conn.airline || '--'}
                              </span>
                            </span>
                            <span>{conn.airline || ''}{conn.flight_number || '-'}</span>
                            <span>·</span>
                            <span>{conn.departure_date || '-'}</span>
                            <span>·</span>
                            <span>{conn.departure_city || conn.origin || '-'} → {conn.arrival_city || conn.destination || '-'}</span>
                            <span>·</span>
                            <span>{conn.departure_time || '--:--'} – {conn.arrival_time || '--:--'}</span>
                            {duration && (<><span>·</span><span>{duration}</span></>)}
                          </div>
                          <span style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '9px', background: '#E1F5EE', color: '#085041', flexShrink: 0 }}>
                            {conn.segment_status || 'HK'}
                          </span>
                        </div>
                      );
                    })}
                    {legBaggage && (
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                        🧳 Check-in {legBaggage.check_in_baggage || '-'} · Cabin {legBaggage.cabin_baggage || '-'}
                      </p>
                    )}
                  </div>
                );
              })
            ) : (
              <div style={{ padding: '8px 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {booking.sector || 'No flight segments defined'}
              </div>
            )}
          </div>

          {/* Passengers & Baggage */}
          <div className="card">
            <h3 style={{ margin: '0 0 9px', fontSize: '13px', fontWeight: '500' }}>
              👥 Passengers, tickets & baggage
              {group.length > 1 && (
                <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--color-text-secondary)' }}> · {group.length} passengers</span>
              )}
            </h3>
            {group.map((pax, idx) => (
              <div key={pax.id || idx} style={{ padding: '7px 0', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <p style={{ margin: '0', fontSize: '13px' }}>
                  {pax.passenger_name || 'N/A'} <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>· {pax.pax_type || 'ADT'}</span>
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  <span style={{ fontFamily: 'monospace' }}>{pax.ticket_no || '-'}</span>
                  {groupPnrs.length > 1 && pax.pnr && <span> · PNR {pax.pnr}</span>}
                  <span> · {pax.check_in_baggage || '23'}kg</span>
                  {pax.mobile && <span> · {pax.mobile}</span>}
                </p>
              </div>
            ))}
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
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Bill To</p>
                <p style={{ margin: '1px 0 0', fontSize: '12.5px' }}>{booking.bill_to_name || 'N/A'}</p>
                <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: 'var(--color-text-info)' }}>
                  {booking.mobile || 'N/A'}
                </p>
              </div>
              <div style={{ flex: 1, borderLeft: '0.5px solid var(--color-border-tertiary)', paddingLeft: '12px' }}>
                <p style={{ margin: '0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Lead passenger</p>
                <p style={{ margin: '1px 0 0', fontSize: '12.5px' }}>{booking.passenger_name || 'N/A'}</p>
                <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: 'var(--color-text-info)' }}>
                  {booking.mobile || 'N/A'}
                </p>
              </div>
            </div>
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

          {/* Activity Timeline - merges audit log, comms, remarks, refunds and amendments
              into one chronological history so support/admin can see everything here */}
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>🕐 Activity timeline</h3>
            {timeline.length === 0 ? (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>No activity recorded yet</p>
            ) : (
              timeline.map((item, idx) => {
                const isLast = idx === timeline.length - 1;
                return (
                  <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
                    {/* Rail: dot + connecting line down to the next entry */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          minHeight: '20px',
                          borderRadius: '50%',
                          background: TIMELINE_DOT_COLORS[item.type] || '#F3F4F6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10.5px',
                          flexShrink: 0,
                        }}
                      >
                        {TIMELINE_ICONS[item.type] || '•'}
                      </div>
                      {!isLast && (
                        <div style={{ flex: 1, width: '2px', minHeight: '10px', background: 'var(--color-border-tertiary)', margin: '2px 0' }} />
                      )}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, paddingBottom: isLast ? 0 : '12px' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: item.tone === 'negative' ? '#991B1B' : 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ color: 'var(--color-text-tertiary)' }}>{item.date}</span>
                        {' · '}
                        {item.label}
                        {item.actor && <span style={{ color: 'var(--color-text-tertiary)' }}>{' · '}{item.actor}</span>}
                      </p>
                      {item.detail && (
                        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>{item.detail}</p>
                      )}
                    </div>
                  </div>
                );
              })
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
