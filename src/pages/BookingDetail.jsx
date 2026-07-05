import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { getBookings, getPayments, saveBooking, getRefunds, getAmendments, getCancellations, getAllocations } from '../helpers/storage';
import { formatCurrency } from '../helpers/format';
import { numeric } from '../helpers/calculations';
import {
  CANCELLATION_SCOPES,
  amendmentTotalImpact,
  buildFinanceModel,
  cancellationEstimate,
  isAmendmentPosted,
  netRefundCredit,
  refundCaseStatus,
} from '../helpers/ledger';
import { isPostedPayment } from '../helpers/paymentVerification';
import PaymentRecordModal from '../components/PaymentRecordModal';
import AmendmentCaseModal from '../components/AmendmentCaseModal';
import CancellationCaseModal from '../components/CancellationCaseModal';
import RefundCaseModal from '../components/RefundCaseModal';
import { ArrowLeft, Download, Plus, Printer, FileText, AlertCircle, ChevronDown } from 'lucide-react';

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
  CANCELLATION: '🚫',
  NOTE: '📝',
  COMMS: '💬',
};

const TIMELINE_DOT_COLORS = {
  CREATED: '#DBEAFE',
  STATUS: '#F3F4F6',
  PAYMENT: '#DCFCE7',
  REFUND: '#FEE2E2',
  AMENDMENT: '#EDE9FE',
  CANCELLATION: '#FEE2E2',
  NOTE: '#FEF3C7',
  COMMS: '#DBEAFE',
};

const CASE_STATUS_TONE = {
  DRAFT: 'badge-neutral',
  QUOTE_PENDING: 'badge-warn',
  QUOTED: 'badge-info',
  CUSTOMER_APPROVED: 'badge-info',
  REQUESTED: 'badge-warn',
  IN_PROCESS: 'badge-info',
  CONFIRMED: 'badge-info',
  APPROVED: 'badge-info',
  PARTIALLY_SETTLED: 'badge-info',
  COMPLETED: 'badge-pass',
  SETTLED: 'badge-pass',
  REJECTED: 'badge-fail',
  CANCELLED: 'badge-fail',
  REVERSED: 'badge-fail',
};

const caseBadge = (status) => (
  <span className={`badge ${CASE_STATUS_TONE[status] || 'badge-neutral'}`}>{String(status || '').replace(/_/g, ' ')}</span>
);

// Passport/document numbers are sensitive PII - only the last 2 characters are shown.
const maskDocument = (value) => {
  const str = String(value || '');
  return str.length <= 2 ? str : '*'.repeat(str.length - 2) + str.slice(-2);
};

const createTicketNumber = () => `TKT-${Date.now()}`;

export default function BookingDetail() {
  const { invoiceNo } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const bookings = getBookings();
  const payments = getPayments();
  const refunds = getRefunds();
  const amendments = getAmendments();
  const cancellations = getCancellations();
  const allocations = getAllocations();
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
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [showCancelMenu, setShowCancelMenu] = useState(false);
  // Case modals: null = closed, { existing } = manage an existing case,
  // { scope } / {} = create a new one.
  const [amendModal, setAmendModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [showRefundModal, setShowRefundModal] = useState(false);

  // Derived finance model: ledger entries + open items + settlement state for
  // every counterparty. The refund case modal fetches the original financial
  // position from here instead of trusting manual entry. Recomputed per render
  // — the page reloads after every save, so the inputs are stable within one.
  const model = buildFinanceModel({ bookings, payments, refunds, allocations, amendments });

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

  // Calculate payment ledger and balance across every passenger/PNR in the booking.
  // Only verified, ledger-eligible payments count toward the paid position.
  const bookingPayments = payments.filter(p => groupPnrs.includes(normPnr(p.pnr)));
  const total = group.reduce((sum, b) => sum + numeric(b.fare_sold || 0), 0);
  const paid = bookingPayments.filter(isPostedPayment).reduce((sum, p) => sum + numeric(p.amount_paid), 0);
  const balance = total - paid;

  // Every refund case, amendment case, and cancellation case tied to this
  // booking's PNR(s) or rows - a booking can go through more than one of each,
  // so these are lists, not single records.
  const groupIds = group.map(b => String(b.id));
  const bookingRefunds = refunds.filter(r => groupPnrs.includes(normPnr(r.pnr)) || groupIds.includes(String(r.booking_id)));
  const bookingAmendments = amendments.filter(a => groupPnrs.includes(normPnr(a.pnr)) || groupIds.includes(String(a.booking_id)));
  const bookingCancellations = cancellations.filter(c => groupPnrs.includes(normPnr(c.pnr)) || groupIds.includes(String(c.booking_id)));
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
      const pending = !isPostedPayment(p);
      items.push({
        date: p.payment_date,
        type: 'PAYMENT',
        label: `${p.instalment_type || 'Payment'} ${pending ? 'submitted' : 'received'}`,
        detail: [formatCurrency(p.amount_paid), p.payment_mode, pending ? 'PENDING VERIFICATION' : '', p.remarks].filter(Boolean).join(' · '),
        actor: p.received_by,
      });
    });

    // Refund cases: creation, financial calculation, approval/posting, payout
    // status — with the actual input-driven amounts (spec §36).
    bookingRefunds.forEach((r) => {
      const status = refundCaseStatus(r);
      const created = r.request_date || r.created_at?.split('T')[0] || r.status_date;
      const net = netRefundCredit(r);
      items.push({
        date: created,
        type: 'REFUND',
        label: `Refund case ${r.refund_number || ''} created`.replace('  ', ' '),
        detail: [
          r.refund_category?.replace(/_/g, ' '),
          `Gross ${formatCurrency(r.gross_refund_amount ?? r.refundable_amount ?? 0)}`,
          `Net credit ${formatCurrency(net)}`,
          r.cancellation_number ? `from ${r.cancellation_number}` : '',
          r.remarks,
        ].filter(Boolean).join(' · '),
        actor: r.created_by || r.requested_by,
        tone: 'negative',
      });
      if (r.approved_at) {
        items.push({
          date: String(r.approved_at).slice(0, 10),
          type: 'REFUND',
          label: `Refund ${r.refund_number || ''} approved — credit ${formatCurrency(net)} posted`,
          detail: numeric(r.refund_payout_due) > 0
            ? `Refund payout due ${formatCurrency(r.refund_payout_due)}`
            : 'Credit offsets the original receivable · no payout due',
          actor: r.approved_by,
        });
      }
      if (['REJECTED', 'CANCELLED', 'PARTIALLY_SETTLED', 'SETTLED'].includes(status) && r.status_date && r.status_date !== created) {
        items.push({
          date: r.status_date,
          type: 'REFUND',
          label: `Refund ${r.refund_number || ''} ${status.replace(/_/g, ' ').toLowerCase()}`,
          tone: status === 'REJECTED' ? 'negative' : undefined,
        });
      }
    });

    // Cancellation cases: what was cancelled, why, and the expected refund
    // credit estimate. Cancellations never post to the ledger.
    bookingCancellations.forEach((c) => {
      const estimate = cancellationEstimate(c);
      const scopeLabel = String(c.cancellation_scope || '').replace(/_/g, ' ').toLowerCase();
      items.push({
        date: c.cancellation_date || c.created_at?.split('T')[0],
        type: 'CANCELLATION',
        label: `Cancellation case ${c.cancellation_number || ''} ${String(c.status || 'draft').toLowerCase()}`,
        detail: [
          scopeLabel,
          c.cancellation_category?.replace(/_/g, ' '),
          (c.affected_passengers || []).map((p) => p.label).join(', '),
          numeric(c.estimated_gross_refund) > 0 ? `Expected refund credit ${formatCurrency(estimate.expectedRefundCredit)}` : '',
          c.cancellation_reason,
        ].filter(Boolean).join(' · '),
        actor: c.confirmed_by || c.created_by,
        tone: 'negative',
      });
    });

    // Amendment cases: scope + the input-driven quote; posted cases show the
    // charge/credit that hit the ledger.
    [...bookingAmendments, ...(legacyAmendment ? [legacyAmendment] : [])].forEach((a) => {
      const isCase = Boolean(a.amendment_number);
      const total = amendmentTotalImpact(a);
      items.push({
        date: a.confirmed_at?.split('T')[0] || a.executed_date || a.request_date || a.created_at?.split('T')[0],
        type: 'AMENDMENT',
        label: isCase
          ? `Amendment ${a.amendment_number} ${String(a.status || 'draft').toLowerCase()}`
          : `Amendment ${(a.status || 'requested').toLowerCase()}`,
        detail: isCase
          ? [
            a.amendment_type?.replace(/_/g, ' '),
            (a.affected_tickets || []).map((t) => t.id).join(', '),
            total !== 0 ? `${total > 0 ? 'Charge' : 'Credit'} ${formatCurrency(Math.abs(total))}${isAmendmentPosted(a) ? ' posted' : ' (quote)'}` : '',
            a.remarks,
          ].filter(Boolean).join(' · ')
          : Object.entries(a.requested_changes || {})
            .filter(([, value]) => value)
            .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
            .join(' · '),
        actor: a.created_by || a.requested_by,
      });
    });

    return items
      .filter((item) => item.date)
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  const timeline = buildTimeline();


  // Flight duration from parsed departure/arrival date+time, when both are known.
  const getFlightDuration = (conn) => {
    if (!conn.departure_date || !conn.departure_time || !conn.arrival_date || !conn.arrival_time) return '';
    const departure = new Date(`${conn.departure_date}T${conn.departure_time}:00`);
    const arrival = new Date(`${conn.arrival_date}T${conn.arrival_time}:00`);
    const minutes = Math.round((arrival - departure) / 60000);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    return `${Math.floor(minutes / 60)}Hr ${minutes % 60}Min`;
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
      ticket_no: booking.ticket_no || createTicketNumber(),
      updated_at: new Date().toISOString(),
    });
    window.location.reload();
  };

  // Void keeps the seat-release action but shows no fabricated financials —
  // any refundable amount is handled through a refund case afterwards.
  const handleVoid = () => {
    const updatedBooking = {
      ...booking,
      ticket_status: 'VOIDED',
      void_date: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    };
    saveBooking(updatedBooking);
    setShowVoidModal(false);
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

      {/* Booking Command Bar */}
      <div className="booking-command-bar">
        <div className="booking-identity-cluster">
          <span className="booking-pnr-chip">
            PNR {booking.pnr || '-'}
            {groupPnrs.length > 1 && (
              <span>+{groupPnrs.length - 1} more</span>
            )}
          </span>
          <span className="booking-status-pill" style={{ background: statusColor.bg, color: statusColor.text }}>
            {booking.ticket_status || 'DRAFT'}
          </span>
          <span className="booking-status-pill booking-source-pill">
            {booking.source || 'GDS'} · {booking.manual_entry ? 'manual' : 'api'}
          </span>
        </div>

        <div className="booking-finance-strip" aria-label="Booking finance summary">
          <div className="booking-finance-cell">
            <span>Total</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <div className="booking-finance-cell">
            <span>Paid</span>
            <strong className="booking-paid-value">{formatCurrency(paid)}</strong>
          </div>
          <div className={`booking-finance-cell ${balance > 0 ? 'is-due' : 'is-clear'}`}>
            <span>{balance > 0 ? 'Balance due' : 'Balance'}</span>
            <strong>{formatCurrency(balance)}</strong>
          </div>
        </div>

        <div className="booking-command-actions">
          {booking.ticket_status === 'DRAFT' && (
            <button
              className="btn btn-primary booking-command-btn"
              onClick={handleHoldBooking}
            >
              <FileText size={14} />
              Hold booking
            </button>
          )}
          {canIssueTicket && (
            <button
              className="btn btn-primary booking-command-btn"
              onClick={handleIssueTicket}
            >
              <FileText size={14} />
              Issue ticket
            </button>
          )}
          {canVoid && (
            <button
              className="btn btn-primary booking-command-btn"
              onClick={() => setShowVoidModal(true)}
            >
              <FileText size={14} />
              Void
            </button>
          )}
          {canCancel && (
            <div className="booking-menu-anchor">
              <button
                className="btn booking-command-btn"
                onClick={() => setShowCancelMenu(!showCancelMenu)}
              >
                <FileText size={14} />
                Cancel <ChevronDown size={12} />
              </button>
              {showCancelMenu && (
                <div className="booking-dropdown-menu">
                  {CANCELLATION_SCOPES.map(([value, label]) => (
                    <button
                      key={value}
                      className="booking-dropdown-item"
                      onClick={() => {
                        setShowCancelMenu(false);
                        setCancelModal({ scope: value });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canAmend && (
            <button
              className="btn booking-command-btn"
              onClick={() => setAmendModal({})}
            >
              <FileText size={14} />
              Amend
            </button>
          )}
          {canRefund && (
            <button
              className="btn booking-command-btn"
              onClick={() => setShowRefundModal(true)}
            >
              <FileText size={14} />
              Create Refund Case
            </button>
          )}
          <button
            className="btn btn-primary booking-command-btn"
            onClick={() => setShowPaymentModal(true)}
          >
            <Plus size={14} />
            Add payment
          </button>
          <div className="booking-menu-anchor">
            <button
              className="btn booking-command-btn"
              onClick={() => setShowPrintMenu(!showPrintMenu)}
            >
              <Printer size={15} />
              Print <ChevronDown size={12} />
            </button>
            {showPrintMenu && (
              <div className="booking-dropdown-menu align-right">
                {PRINT_MENU_ITEMS.map(item => (
                  <button
                    key={item.id}
                    className="booking-dropdown-item"
                    onClick={() => handlePrint(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
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
            {group.map((pax, idx) => {
              const passportNo = pax.passport_no || pax.doc_number;
              const passportExpiry = pax.passport_expiry_date || pax.doc_expiry;
              const meal = pax.meal || pax.meal_code;
              const travelDetails = [
                `DOB ${pax.dob || '-'}`,
                `Nationality ${pax.nationality || '-'}`,
                `Passport ${passportNo ? maskDocument(passportNo) : '-'}`,
                `Issued ${pax.doc_country || '-'}`,
                `Exp ${passportExpiry || '-'}`,
                `Meal ${meal || '-'}`,
              ];
              if (pax.wchr && String(pax.wchr).toLowerCase() === 'yes') travelDetails.push('WCHR');

              return (
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
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                    {travelDetails.join('  ·  ')}
                  </p>
                </div>
              );
            })}
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

          {/* Servicing cases: amendment + cancellation + refund cases on this
              booking, with their lifecycle status. Manage reopens the case. */}
          {(bookingAmendments.some(a => a.amendment_number) || bookingCancellations.length > 0 || bookingRefunds.length > 0) && (
            <div className="card">
              <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '500' }}>🗂 Servicing cases</h3>
              <div className="servicing-case-list">
                {bookingAmendments.filter(a => a.amendment_number).map((a) => {
                  const total = amendmentTotalImpact(a);
                  return (
                    <div key={a.id} className="servicing-case-row">
                      <span>
                        ✏️ {a.amendment_number} · {String(a.amendment_type || '').replace(/_/g, ' ')}
                        {total !== 0 && <span style={{ color: 'var(--color-text-secondary)' }}> · {total > 0 ? '+' : '−'}{formatCurrency(Math.abs(total))}</span>}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {caseBadge(a.status)}
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAmendModal({ existing: a })}>Manage</button>
                      </span>
                    </div>
                  );
                })}
                {bookingCancellations.map((c) => (
                  <div key={c.id} className="servicing-case-row">
                    <span>
                      🚫 {c.cancellation_number} · {String(c.cancellation_scope || '').replace(/_/g, ' ').toLowerCase()}
                      {numeric(c.estimated_gross_refund) > 0 && (
                        <span style={{ color: 'var(--color-text-secondary)' }}> · expected credit {formatCurrency(cancellationEstimate(c).expectedRefundCredit)}</span>
                      )}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {caseBadge(c.status)}
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => setCancelModal({ existing: c })}>Manage</button>
                    </span>
                  </div>
                ))}
                {bookingRefunds.map((r) => (
                  <div key={r.id} className="servicing-case-row">
                    <span>
                      💰 {r.refund_number || 'Refund'} · net credit {formatCurrency(netRefundCredit(r))}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {caseBadge(refundCaseStatus(r))}
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/refunds')}>Open</button>
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                Refund approval and payouts are managed on the Refunds page. Only approval posts a refund credit to the ledger.
              </p>
            </div>
          )}

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

      {/* Add Payment Modal: full payment record form with verification workflow,
          locked to this booking's PNR */}
      {showPaymentModal && (
        <PaymentRecordModal
          user={user}
          bookings={bookings}
          payments={payments}
          lockedPnr={booking.pnr}
          onClose={() => setShowPaymentModal(false)}
          onSaved={() => {
            setShowPaymentModal(false);
            window.location.reload();
          }}
        />
      )}

      {/* Void confirmation: releases the seat. Financials, if any, go
          through a refund case afterwards - no fabricated amounts here. */}
      {showVoidModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <h3>Void Ticket</h3>
            <div style={{ background: '#FEF3C7', padding: '12px', borderRadius: 'var(--border-radius-md)', marginBottom: '16px', fontSize: '13px' }}>
              The ticket will be voided and the seat released. Any supplier void charges or refundable
              amounts are recorded afterwards through a refund case with input-driven amounts.
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowVoidModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleVoid}>Confirm Void</button>
            </div>
          </div>
        </div>
      )}

      {/* Amendment case modal (create or manage) */}
      {amendModal && (
        <AmendmentCaseModal
          user={user}
          booking={booking}
          group={group}
          amendments={amendments}
          existing={amendModal.existing || null}
          onClose={() => setAmendModal(null)}
          onSaved={() => {
            setAmendModal(null);
            window.location.reload();
          }}
        />
      )}

      {/* Cancellation case modal (create with preset scope, or manage) */}
      {cancelModal && (
        <CancellationCaseModal
          user={user}
          booking={booking}
          group={group}
          cancellations={cancellations}
          refunds={refunds}
          initialScope={cancelModal.scope || 'ENTIRE_BOOKING'}
          existing={cancelModal.existing || null}
          onClose={() => setCancelModal(null)}
          onSaved={() => {
            setCancelModal(null);
            window.location.reload();
          }}
        />
      )}

      {/* Refund case creation modal - review, approval and payout happen on
          the Refunds page */}
      {showRefundModal && (
        <RefundCaseModal
          user={user}
          booking={booking}
          group={group}
          model={model}
          refunds={refunds}
          onClose={() => setShowRefundModal(false)}
          onSaved={() => {
            setShowRefundModal(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
