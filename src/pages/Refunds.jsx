// Refund cases (spec §15–§25, §40–§43). A refund is two financial events:
//   1. REFUND CREDIT — the counterparty becomes entitled to money. Posting it
//      credits the ledger and, if the original ticket is still outstanding,
//      auto-offsets it (§19/§20/§42).
//   2. REFUND PAYOUT — actual money sent, recorded as an outgoing payment that
//      passes through the normal verification queue before it posts (§18/§24).
// Allocation of a credit to future tickets never changes the ledger.

import { useMemo, useState } from 'react';
import {
  getRefunds,
  getBookings,
  getPayments,
  getAllocations,
  saveRefund,
  saveBooking,
  savePayment,
  saveAllocation,
} from '../helpers/storage';
import { REFUND_CATEGORIES } from '../helpers/calculations';
import {
  bookingCounterparty,
  buildAllocationRecords,
  buildFinanceModel,
  buildRefundPayoutPayment,
  isRefundCreditPosted,
  netRefundCredit,
  nextRefundNumber,
  numeric,
  refundCaseStatus,
  refundCreditSummary,
  refundSettlementPreview,
  ticketOpenItemId,
  REFUND_CASE_STATUSES,
} from '../helpers/ledger';
import { canProcessRefunds, canVerifyPayments } from '../helpers/access';
import { useAuth } from '../AuthContext';
import { formatCurrency } from '../helpers/format';
import { downloadCSV } from '../helpers/downloadCSV';
import AllocationModal from '../components/AllocationModal';
import {
  ArrowUpDown,
  BadgeCheck,
  Ban,
  Download,
  Link2,
  Plus,
  RefreshCcw,
  Search,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react';

const money = (value) => formatCurrency(value);

const REFUND_COLUMNS = [
  ['refund_number', 'Refund No'],
  ['ticket_no', 'Ticket No'],
  ['pnr', 'PNR'],
  ['passenger_name', 'Passenger'],
  ['party_display', 'Party'],
  ['gross_refund_amount', 'Gross Refund'],
  ['net_refund_credit', 'Net Credit'],
  ['available_credit', 'Available Credit'],
  ['refund_category', 'Category'],
  ['case_status', 'Status'],
  ['status_date', 'Status Date'],
];

const STATUS_TONE = {
  REQUESTED: 'badge-warn',
  IN_PROCESS: 'badge-info',
  APPROVED: 'badge-info',
  PARTIALLY_SETTLED: 'badge-info',
  SETTLED: 'badge-pass',
  REJECTED: 'badge-fail',
  CANCELLED: 'badge-fail',
};

function statusBadge(status) {
  return <span className={`badge ${STATUS_TONE[status] || 'badge-warn'}`}>{String(status || '').replace(/_/g, ' ')}</span>;
}

const emptyForm = () => ({
  ticket_no: '',
  cancel_date: new Date().toISOString().split('T')[0],
  refund_category: 'VOLUNTARY',
  gross_refund_amount: '',
  airline_cancellation_fee: 0,
  flyforsure_cancellation_fee: 0,
  agent_cancellation_markup: 0,
  other_deductions: 0,
  supplier_refund: 0,
  remarks: '',
});

export default function Refunds() {
  const { user } = useAuth();
  const canProcess = canProcessRefunds(user);
  const canVerify = canVerifyPayments(user);

  const [refunds, setRefunds] = useState(() => getRefunds());
  const [bookings, setBookings] = useState(() => getBookings());
  const [payments, setPayments] = useState(() => getPayments());
  const [allocations, setAllocations] = useState(() => getAllocations());
  const [showModal, setShowModal] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [creditAllocId, setCreditAllocId] = useState(null); // refund id being allocated
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(REFUND_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('status_date');
  const [sortDir, setSortDir] = useState('desc');
  const [form, setForm] = useState(emptyForm);

  const model = useMemo(
    () => buildFinanceModel({ bookings, payments, refunds, allocations }),
    [bookings, payments, refunds, allocations],
  );

  const refresh = () => {
    setRefunds(getRefunds());
    setBookings(getBookings());
    setPayments(getPayments());
    setAllocations(getAllocations());
  };

  const rows = useMemo(() => refunds.map((refund) => {
    const booking = model.bookingsByTicket.get(String(refund.ticket_no || '').toLowerCase())
      || (model.bookingsByPnr.get(String(refund.pnr || '').replace(/[^a-z0-9]/gi, '').toUpperCase()) || [])[0];
    const party = booking ? bookingCounterparty(booking) : { type: refund.refund_party_type || 'CUSTOMER', name: refund.passenger_name || '' };
    const summary = refundCreditSummary(refund, model, booking);
    return {
      ...refund,
      booking,
      case_status: refundCaseStatus(refund),
      party_type: party.type,
      party_display: `${party.type} · ${party.name}`,
      gross_refund_amount: numeric(refund.gross_refund_amount ?? refund.fare_sold),
      net_refund_credit: netRefundCredit(refund),
      available_credit: isRefundCreditPosted(refund) ? summary.available : 0,
      passenger_name: refund.passenger_name || booking?.passenger_name || '',
      pnr: refund.pnr || booking?.pnr || '',
    };
  }), [refunds, model]);

  const stats = useMemo(() => {
    const pending = rows.filter((row) => ['REQUESTED', 'IN_PROCESS'].includes(row.case_status));
    const approvedCredit = rows
      .filter((row) => ['APPROVED', 'PARTIALLY_SETTLED'].includes(row.case_status))
      .reduce((sum, row) => sum + numeric(row.available_credit), 0);
    const settled = rows
      .filter((row) => row.case_status === 'SETTLED')
      .reduce((sum, row) => sum + numeric(row.net_refund_credit), 0);
    return {
      pendingCount: pending.length,
      pendingValue: pending.reduce((sum, row) => sum + numeric(row.net_refund_credit), 0),
      approvedCredit,
      settled,
      settledCount: rows.filter((row) => row.case_status === 'SETTLED').length,
    };
  }, [rows]);

  const activeColumns = useMemo(() => REFUND_COLUMNS.filter(([key]) => visibleColumns.has(key)), [visibleColumns]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        const matchesQuery = !query || ['refund_number', 'ticket_no', 'pnr', 'passenger_name', 'party_display', 'remarks']
          .some((key) => String(row[key] || '').toLowerCase().includes(query));
        return matchesQuery
          && (!statusFilter || row.case_status === statusFilter)
          && (!categoryFilter || row.refund_category === categoryFilter);
      })
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [rows, search, statusFilter, categoryFilter, sortKey, sortDir]);

  const selectedBooking = bookings.find((booking) => booking.ticket_no === form.ticket_no);
  const grossPreview = form.gross_refund_amount === '' ? numeric(selectedBooking?.fare_sold) : numeric(form.gross_refund_amount);
  const netPreview = Math.max(0, grossPreview
    - numeric(form.airline_cancellation_fee)
    - numeric(form.flyforsure_cancellation_fee)
    - numeric(form.agent_cancellation_markup)
    - numeric(form.other_deductions));

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleColumn = (key) => setVisibleColumns((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const renderValue = (row, key) => {
    if (['gross_refund_amount', 'net_refund_credit', 'available_credit'].includes(key)) return money(row[key]);
    if (key === 'case_status') return statusBadge(row.case_status);
    return String(row[key] || '').replace(/_/g, ' ');
  };

  const exportCSV = () => {
    const formatters = {
      gross_refund_amount: (v) => money(v),
      net_refund_credit: (v) => money(v),
      available_credit: (v) => money(v),
    };
    downloadCSV('refund-cases', activeColumns, filteredRows, formatters);
  };

  const handleCreateRefund = () => {
    if (!selectedBooking) { alert('Select a ticket number from bookings.'); return; }
    const party = bookingCounterparty(selectedBooking);
    const gross = grossPreview;
    const net = netPreview;

    const checkedForPnr = bookings.filter((b) => b.pnr === selectedBooking.pnr && (b.refund_flag || b.ticket_no === form.ticket_no)).length;
    const allForPnr = bookings.filter((b) => b.pnr === selectedBooking.pnr).length;

    saveRefund({
      refund_number: nextRefundNumber(refunds),
      ticket_no: form.ticket_no,
      pnr: selectedBooking.pnr,
      passenger_name: selectedBooking.passenger_name,
      airline: selectedBooking.airline,
      sector: selectedBooking.sector,
      refund_party_type: party.type,
      refund_status: 'REQUESTED',
      refund_category: form.refund_category,
      cancel_date: form.cancel_date,
      cancel_type: checkedForPnr >= allForPnr ? 'FULL_BOOKING' : 'CANCEL_PAX',
      status_date: new Date().toISOString().split('T')[0],
      // New refund-case fields.
      original_sale_amount: numeric(selectedBooking.fare_sold),
      gross_refund_amount: gross,
      airline_cancellation_fee: numeric(form.airline_cancellation_fee),
      flyforsure_cancellation_fee: numeric(form.flyforsure_cancellation_fee),
      agent_cancellation_markup: numeric(form.agent_cancellation_markup),
      other_deductions: numeric(form.other_deductions),
      net_refund_credit: net,
      supplier_refund: numeric(form.supplier_refund),
      // Legacy-compatible mirror fields so P&L and the old ledger stay correct.
      fare_sold: numeric(selectedBooking.fare_sold),
      fare_issued: numeric(selectedBooking.fare_issued),
      airline_penalty: numeric(form.airline_cancellation_fee),
      service_fee: numeric(form.flyforsure_cancellation_fee),
      eligible_refund: net,
      created_by: user?.name || user?.email || '',
      remarks: form.remarks,
    });
    saveBooking({ ...selectedBooking, refund_flag: true });
    refresh();
    setForm(emptyForm());
    setShowModal(false);
  };

  // Lifecycle transitions ---------------------------------------------------

  const updateStatus = (refund, patch) => {
    saveRefund({ ...refund, ...patch, status_date: new Date().toISOString().split('T')[0] });
    refresh();
  };

  const handleApprove = (row) => {
    const refund = refunds.find((r) => r.id === row.id);
    if (!refund) return;
    // Compute the original-ticket offset from the current (pre-approval) model.
    const preview = refundSettlementPreview(refund, model);
    const approved = {
      ...refund,
      refund_status: 'APPROVED',
      credit_posting_status: 'POSTED',
      net_refund_credit: preview.credit,
      eligible_refund: preview.credit,
      refund_payout_due: preview.payout_due,
      approved_by: user?.name || user?.email || '',
      approved_at: new Date().toISOString(),
      status_date: new Date().toISOString().split('T')[0],
    };
    saveRefund(approved);

    // Auto-offset the still-outstanding original ticket receivable (§19/§20/§42).
    if (preview.booking && preview.original_offset > 0) {
      const account = bookingCounterparty(preview.booking);
      const records = buildAllocationRecords({
        source: approved,
        sourceType: 'REFUND_CREDIT',
        account: { type: account.type, name: account.name },
        lines: [{
          open_item: {
            open_item_id: ticketOpenItemId(preview.booking),
            item_type: 'TICKET_RECEIVABLE',
            booking_id: preview.booking.id,
            pnr: preview.booking.pnr,
            ticket_no: preview.booking.ticket_no,
            passenger_name: preview.booking.passenger_name,
            outstanding_amount: preview.original_outstanding,
          },
          amount: preview.original_offset,
        }],
        allocations,
      });
      records.forEach((record) => saveAllocation(record));
    }
    refresh();
  };

  const handleCreatePayout = (row) => {
    const refund = refunds.find((r) => r.id === row.id);
    if (!refund) return;
    const preview = refundSettlementPreview(refund, model);
    const summary = refundCreditSummary(refund, model, preview.booking);
    const suggested = summary.available;
    const input = window.prompt(`Refund payout amount for ${refund.refund_number} (available credit ${money(suggested)}):`, String(suggested));
    if (input === null) return;
    const amount = numeric(input);
    if (amount <= 0 || amount > suggested + 0.001) {
      alert(`Payout must be between 0 and the available credit ${money(suggested)}.`);
      return;
    }
    const payout = buildRefundPayoutPayment({ refund, preview, amount, user, payments });
    savePayment(payout);
    // Move the case to partially settled; full settlement is reached when the
    // payout is verified and the available credit hits zero.
    saveRefund({ ...refund, refund_status: 'PARTIALLY_SETTLED', status_date: new Date().toISOString().split('T')[0] });
    refresh();
    alert(`Outgoing refund payout ${payout.payment_reference} created for ${money(amount)}. It will post to the ledger once verified in Payments.`);
  };

  const detailRow = detailId ? rows.find((row) => row.id === detailId) : null;
  const creditAllocRefund = creditAllocId ? refunds.find((r) => r.id === creditAllocId) : null;
  const creditAllocBooking = creditAllocRefund
    ? (model.bookingsByTicket.get(String(creditAllocRefund.ticket_no || '').toLowerCase())
      || (model.bookingsByPnr.get(String(creditAllocRefund.pnr || '').replace(/[^a-z0-9]/gi, '').toUpperCase()) || [])[0])
    : null;
  const creditAllocAccount = creditAllocBooking
    ? model.accountList.find((entry) => entry.key === bookingCounterparty(creditAllocBooking).key)
    : null;

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Refunds</h1>
          <p>Refund cases with credit and payout events: approve credits, auto-offset original tickets, and settle payouts.</p>
        </div>
        {canProcess && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> New Refund
          </button>
        )}
      </header>

      <div className="stats-row ledger-stats-row">
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Requests in process</p><h3 className="stat-value">{stats.pendingCount}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Requested value</p><h3 className="stat-value">{money(stats.pendingValue)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Approved credit available</p><h3 className="stat-value">{money(stats.approvedCredit)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Settled refunds</p><h3 className="stat-value">{money(stats.settled)}</h3></div></div>
      </div>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Refund no, ticket, PNR, passenger..." />
            </div>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {REFUND_CASE_STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              {REFUND_CATEGORIES.map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <div className="booking-table-actions">
          <div className="table-meta">
            <span><strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> refund cases</span>
            <span>{activeColumns.length} visible columns</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); }}>Reset</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowColumns((value) => !value)}>
              <SlidersHorizontal size={15} /> Columns
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
              <Download size={15} /> Export
            </button>
          </div>
        </div>
        {showColumns && (
          <div className="column-panel">
            {REFUND_COLUMNS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table dense-table refund-ledger-table">
            <thead>
              <tr>
                {activeColumns.map(([key, label]) => (
                  <th key={key}>
                    <button type="button" onClick={() => handleSort(key)}>
                      {label}
                      <ArrowUpDown size={13} />
                    </button>
                  </th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  {activeColumns.map(([key]) => (
                    <td key={key}>{renderValue(row, key)}</td>
                  ))}
                  <td>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => setDetailId(row.id)}>Manage</button>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length + 1}>No refund cases recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '720px' }}>
            <h3>New Refund Case</h3>
            <div className="modal-form-grid">
              <label>
                <span>Ticket Number</span>
                <select value={form.ticket_no} onChange={(event) => updateForm('ticket_no', event.target.value)}>
                  <option value="">Select ticket</option>
                  {bookings.map((booking) => (
                    <option key={booking.id} value={booking.ticket_no}>
                      {booking.ticket_no} - {booking.passenger_name} ({booking.pnr})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Cancel Date</span>
                <input type="date" value={form.cancel_date} onChange={(event) => updateForm('cancel_date', event.target.value)} />
              </label>
              <label>
                <span>Refund Category</span>
                <select value={form.refund_category} onChange={(event) => updateForm('refund_category', event.target.value)}>
                  {REFUND_CATEGORIES.map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Gross Refund Amount</span>
                <input type="number" value={form.gross_refund_amount} placeholder={selectedBooking ? String(selectedBooking.fare_sold) : '0'} onChange={(event) => updateForm('gross_refund_amount', event.target.value)} />
              </label>
              <label>
                <span>Airline Cancellation Fee</span>
                <input type="number" value={form.airline_cancellation_fee} onChange={(event) => updateForm('airline_cancellation_fee', event.target.value)} />
              </label>
              <label>
                <span>FlyForSure Cancellation Fee</span>
                <input type="number" value={form.flyforsure_cancellation_fee} onChange={(event) => updateForm('flyforsure_cancellation_fee', event.target.value)} />
              </label>
              <label>
                <span>Agent Cancellation Markup</span>
                <input type="number" value={form.agent_cancellation_markup} onChange={(event) => updateForm('agent_cancellation_markup', event.target.value)} />
              </label>
              <label>
                <span>Other Deductions</span>
                <input type="number" value={form.other_deductions} onChange={(event) => updateForm('other_deductions', event.target.value)} />
              </label>
              <label>
                <span>Supplier Refund (separate)</span>
                <input type="number" value={form.supplier_refund} onChange={(event) => updateForm('supplier_refund', event.target.value)} />
              </label>
              <label>
                <span>Remarks</span>
                <input value={form.remarks} onChange={(event) => updateForm('remarks', event.target.value)} />
              </label>
            </div>
            <div className="auto-preview-list compact-preview">
              <div><span>PNR</span><strong>{selectedBooking?.pnr || '-'}</strong></div>
              <div><span>Counterparty</span><strong>{selectedBooking ? `${bookingCounterparty(selectedBooking).type} · ${bookingCounterparty(selectedBooking).name}` : '-'}</strong></div>
              <div><span>Gross Refund</span><strong>{money(grossPreview)}</strong></div>
              <div><span>Net Refund Credit</span><strong>{money(netPreview)}</strong></div>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateRefund}>Create Refund Case</button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (
        <RefundDetailModal
          row={detailRow}
          model={model}
          canProcess={canProcess}
          canVerify={canVerify}
          onClose={() => setDetailId(null)}
          onApprove={() => { handleApprove(detailRow); }}
          onReject={() => { updateStatus(refunds.find((r) => r.id === detailRow.id), { refund_status: 'REJECTED' }); }}
          onRequestReview={() => { updateStatus(refunds.find((r) => r.id === detailRow.id), { refund_status: 'IN_PROCESS' }); }}
          onCreatePayout={() => { handleCreatePayout(detailRow); }}
          onAllocateCredit={() => { setCreditAllocId(detailRow.id); }}
        />
      )}

      {creditAllocRefund && creditAllocAccount && (
        <AllocationModal
          user={user}
          source={creditAllocRefund}
          sourceType="REFUND_CREDIT"
          account={creditAllocAccount}
          model={model}
          onClose={() => setCreditAllocId(null)}
          onSaved={(options = {}) => {
            refresh();
            if (!options.keepOpen) setCreditAllocId(null);
          }}
        />
      )}
    </div>
  );
}

function RefundDetailModal({ row, model, canProcess, canVerify, onClose, onApprove, onReject, onRequestReview, onCreatePayout, onAllocateCredit }) {
  const refund = row;
  const preview = refundSettlementPreview(refund, model);
  const summary = refundCreditSummary(refund, model, preview.booking);
  const status = row.case_status;
  const posted = isRefundCreditPosted(refund);
  const openForDecision = ['REQUESTED', 'IN_PROCESS'].includes(status);

  return (
    <div className="modal-backdrop allocation-backdrop">
      <div className="card modal-card allocation-modal">
        <div className="allocation-modal-head">
          <div>
            <h3>Refund Case {refund.refund_number || ''} {statusBadge(status)}</h3>
            <p className="allocation-subtitle">
              {row.party_display} · PNR {refund.pnr || '-'} · Ticket {refund.ticket_no || '-'} · {refund.passenger_name || ''}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <div className="refund-detail-grid">
          <div className="card">
            <h4>Original financial position</h4>
            <div className="auto-preview-list compact-preview">
              <div><span>Original sell amount</span><strong>{money(refund.original_sale_amount ?? refund.fare_sold)}</strong></div>
              <div><span>Outstanding before refund</span><strong>{money(preview.original_outstanding)}</strong></div>
              <div><span>Supplier refund (separate)</span><strong>{money(refund.supplier_refund)}</strong></div>
            </div>
          </div>

          <div className="card">
            <h4>Refund calculation</h4>
            <div className="auto-preview-list compact-preview">
              <div><span>Gross refund amount</span><strong>{money(refund.gross_refund_amount ?? refund.fare_sold)}</strong></div>
              <div><span>Airline cancellation fee</span><strong>− {money(refund.airline_cancellation_fee ?? refund.airline_penalty)}</strong></div>
              <div><span>FlyForSure cancellation fee</span><strong>− {money(refund.flyforsure_cancellation_fee ?? refund.service_fee)}</strong></div>
              <div><span>Agent cancellation markup</span><strong>− {money(refund.agent_cancellation_markup)}</strong></div>
              <div><span>Other deductions</span><strong>− {money(refund.other_deductions)}</strong></div>
              <div className="preview-total"><span>Net refund credit</span><strong>{money(preview.credit)}</strong></div>
            </div>
          </div>

          <div className="card">
            <h4>Settlement preview</h4>
            <div className="auto-preview-list compact-preview">
              <div><span>Original ticket offset</span><strong>{money(preview.original_offset)}</strong></div>
              <div><span>{preview.party_type === 'AGENT' ? 'Agent account credit' : 'Customer credit'}</span><strong>{money(preview.party_type === 'AGENT' ? preview.remaining_credit : 0)}</strong></div>
              <div><span>Immediate payout due</span><strong>{money(preview.payout_due)}</strong></div>
            </div>
          </div>

          {posted && (
            <div className="card">
              <h4>Refund credit status</h4>
              <div className="auto-preview-list compact-preview">
                <div><span>Net credit</span><strong>{money(summary.credit)}</strong></div>
                <div><span>Used vs original ticket</span><strong>{money(summary.used_original)}</strong></div>
                <div><span>Used vs future tickets</span><strong>{money(summary.used_future)}</strong></div>
                <div><span>Paid out</span><strong>{money(summary.paid_out)}</strong></div>
                <div className="preview-total"><span>Available credit</span><strong>{money(summary.available)}</strong></div>
              </div>
            </div>
          )}
        </div>

        <div className="form-actions refund-actions">
          {canProcess && openForDecision && (
            <>
              <button className="btn btn-secondary" type="button" onClick={onRequestReview}>
                <RefreshCcw size={14} /> Request Review
              </button>
              <button className="btn btn-danger" type="button" onClick={onReject}>
                <Ban size={14} /> Reject Refund
              </button>
              <button className="btn btn-primary" type="button" onClick={onApprove}>
                <BadgeCheck size={14} /> Approve Refund
              </button>
            </>
          )}
          {canProcess && posted && summary.available > 0 && (
            <>
              <button className="btn btn-secondary" type="button" onClick={onAllocateCredit}>
                <Link2 size={14} /> Allocate Credit
              </button>
              <button className="btn btn-primary" type="button" onClick={onCreatePayout}>
                <Send size={14} /> Create Refund Payout
              </button>
            </>
          )}
          {posted && summary.available <= 0 && !openForDecision && (
            <span className="badge badge-pass">Fully settled — no available credit</span>
          )}
        </div>
        {posted && !canVerify && (
          <p className="reconciliation-note">Refund payouts you create enter the verification queue and post once an admin verifies them.</p>
        )}
      </div>
    </div>
  );
}
