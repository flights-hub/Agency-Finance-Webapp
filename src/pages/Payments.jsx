import { useMemo, useState } from 'react';
import { getPayments, getBookings, getAllocations, savePayment } from '../helpers/storage';
import {
  getPaymentLedger,
  getSupplierPaymentLedger,
  numeric,
  PAYMENT_MODES,
} from '../helpers/calculations';
import {
  displayDirection,
  getLedgerPostingStatus,
  isSupplierPayment,
  normalizeVerificationStatus,
  PARTY_TYPES,
  transactionReference,
  VERIFICATION_LABELS,
  verificationProblems,
  withVerification,
} from '../helpers/paymentVerification';
import {
  buildFinanceModel,
  paymentAllocationSummary,
  paymentCounterparty,
} from '../helpers/ledger';
import { canManageAllocations, canRecordPayments, canVerifyPayments } from '../helpers/access';
import { useAuth } from '../AuthContext';
import { formatCurrency } from '../helpers/format';
import { downloadCSV } from '../helpers/downloadCSV';
import PaymentRecordModal from '../components/PaymentRecordModal';
import AllocationModal from '../components/AllocationModal';
import { ArrowUpDown, BadgeCheck, Download, Link2, Paperclip, Pencil, Plus, Search, SlidersHorizontal } from 'lucide-react';

const PAYMENT_COLUMNS = [
  ['sl', 'SL'],
  ['payment_reference', 'Payment Ref'],
  ['payment_date', 'Payment Date'],
  ['direction_display', 'Direction'],
  ['party_type_display', 'Party Type'],
  ['pnr', 'PNR'],
  ['passenger_name', 'Passenger Name'],
  ['amount_paid', 'Amount'],
  ['transaction_currency', 'Currency'],
  ['payment_mode', 'Payment Method'],
  ['transaction_ref', 'Transaction Ref'],
  ['verification_status_display', 'Verification'],
  ['ledger_posting_status_display', 'Ledger Posting'],
  ['allocated_amount', 'Allocated'],
  ['unallocated_amount', 'Unallocated'],
  ['allocation_status_display', 'Allocation'],
  ['instalment_no', 'Inst No'],
  ['instalment_type', 'Inst Type'],
  ['recorded_by_display', 'Recorded By'],
  ['verified_by_display', 'Verified By'],
  ['cumulative_paid', 'Cumulative Paid'],
  ['total_fare', 'Total Fare'],
  ['remaining_balance', 'Remaining Bal'],
  ['remarks', 'Remarks'],
];

const DEFAULT_HIDDEN_COLUMNS = new Set(['direction_display', 'transaction_currency', 'instalment_no', 'instalment_type', 'recorded_by_display', 'verified_by_display', 'total_fare', 'cumulative_paid', 'remaining_balance']);

const MONEY_COLUMNS = ['amount_paid', 'cumulative_paid', 'total_fare', 'remaining_balance', 'allocated_amount', 'unallocated_amount'];

function verificationBadge(status) {
  return (
    <span className={`badge ${status === 'VERIFIED' ? 'badge-pass' : 'badge-warn'}`}>
      {VERIFICATION_LABELS[status] || status}
    </span>
  );
}

function postingBadge(status) {
  const tone = status === 'POSTED' ? 'badge-pass'
    : status === 'READY_TO_POST' ? 'badge-info'
      : status === 'PENDING_VERIFICATION' ? 'badge-warn'
        : 'badge-fail';
  return <span className={`badge ${tone}`}>{String(status || '').replace(/_/g, ' ')}</span>;
}

function allocationBadge(status) {
  const tone = status === 'FULLY_ALLOCATED' ? 'badge-pass'
    : status === 'PARTIALLY_ALLOCATED' ? 'badge-info'
      : status === 'NOT_POSTED' ? 'badge-fail'
        : 'badge-warn';
  return <span className={`badge ${tone}`}>{String(status || '').replace(/_/g, ' ')}</span>;
}

export default function Payments() {
  const { user } = useAuth();
  const canRecord = canRecordPayments(user);
  const canVerify = canVerifyPayments(user);
  const canAllocate = canManageAllocations(user);

  const [payments, setPayments] = useState(() => getPayments());
  const [bookings] = useState(() => getBookings());
  const [allocations, setAllocations] = useState(() => getAllocations());
  const [showModal, setShowModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verifyNotes, setVerifyNotes] = useState('');
  const [allocateTarget, setAllocateTarget] = useState(null);

  // Finance model gives each payment its allocation summary and the account
  // it belongs to (needed to open the allocation screen).
  const model = useMemo(
    () => buildFinanceModel({ bookings, payments, refunds: [], allocations }),
    [bookings, payments, allocations],
  );
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(
    () => new Set(PAYMENT_COLUMNS.map(([key]) => key).filter((key) => !DEFAULT_HIDDEN_COLUMNS.has(key))),
  );
  const [sortKey, setSortKey] = useState('payment_date');
  const [sortDir, setSortDir] = useState('asc');

  // All payment rows: customer/agent receipts with running PNR balances,
  // supplier payments, and any remaining money-out records.
  const paymentRows = useMemo(() => {
    const customerRows = getPaymentLedger(bookings, payments);
    const supplierRows = getSupplierPaymentLedger(bookings, payments);
    const coveredIds = new Set([...customerRows, ...supplierRows].map((row) => row.id));
    const otherRows = payments
      .filter((payment) => !coveredIds.has(payment.id))
      .map((payment) => ({
        ...payment,
        amount_paid: numeric(payment.amount_paid),
        verification_status: normalizeVerificationStatus(payment),
        ledger_posting_status: getLedgerPostingStatus(payment),
        posted: getLedgerPostingStatus(payment) === 'POSTED',
      }));

    return [...customerRows, ...supplierRows, ...otherRows]
      .map((row) => {
        const original = payments.find((payment) => payment.id === row.id) || row;
        const allocation = paymentAllocationSummary(original, model);
        return {
          ...row,
          direction_display: displayDirection(row),
          party_type_display: row.party_type || (isSupplierPayment(row) ? 'SUPPLIER' : 'CUSTOMER'),
          party_display: row.party_name || row.supplier_name || row.passenger_name || '',
          transaction_ref: transactionReference(row),
          verification_status_display: VERIFICATION_LABELS[row.verification_status] || row.verification_status,
          ledger_posting_status_display: String(row.ledger_posting_status || '').replace(/_/g, ' '),
          allocated_amount: allocation.allocation_status === 'NOT_POSTED' ? null : allocation.allocated,
          unallocated_amount: allocation.allocation_status === 'NOT_POSTED' ? null : allocation.unallocated,
          allocation_status: allocation.allocation_status,
          allocation_status_display: allocation.allocation_status,
          recorded_by_display: row.recorded_by || row.received_by || '',
          verified_by_display: row.verified_by || '',
        };
      })
      .sort((a, b) => String(a.payment_date || '').localeCompare(String(b.payment_date || '')))
      .map((row, index) => ({ ...row, sl: index + 1 }));
  }, [bookings, payments, model]);

  const pendingCount = paymentRows.filter((row) => row.verification_status === 'TO_BE_VERIFIED').length;

  const activeColumns = useMemo(
    () => PAYMENT_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );

  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return paymentRows
      .filter((payment) => {
        const matchesQuery = !query || ['payment_reference', 'pnr', 'passenger_name', 'party_display', 'transaction_ref', 'receipt_ref', 'instalment_type', 'recorded_by_display', 'remarks']
          .some((key) => String(payment[key] || '').toLowerCase().includes(query));
        return matchesQuery
          && (!modeFilter || payment.payment_mode === modeFilter)
          && (!verificationFilter || payment.verification_status === verificationFilter)
          && (!partyFilter || payment.party_type_display === partyFilter);
      })
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [modeFilter, partyFilter, paymentRows, search, sortDir, sortKey, verificationFilter]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exportCSV = () => {
    const formatters = Object.fromEntries(MONEY_COLUMNS.map((key) => [key, (v) => formatCurrency(v)]));
    downloadCSV('payments', activeColumns, filteredPayments, formatters);
  };

  const openCreateModal = () => {
    setEditingPayment(null);
    setShowModal(true);
  };

  const openEditModal = (row) => {
    const original = payments.find((payment) => payment.id === row.id);
    if (!original) return;
    setEditingPayment(original);
    setShowModal(true);
  };

  const canEditRow = (row) => {
    if (!canRecord) return false;
    if (user?.role === 'AGENT') {
      return row.recorded_by_user_id === user.id && row.verification_status !== 'VERIFIED';
    }
    // Editing an already-verified payment requires verification rights, since
    // any financial change sends it back through the queue.
    return row.verification_status !== 'VERIFIED' || canVerify;
  };

  const openVerifyModal = (row) => {
    const original = payments.find((payment) => payment.id === row.id);
    if (!original) return;
    setVerifyTarget(original);
    setVerifyNotes(original.verification_notes || '');
  };

  const openAllocateModal = (row) => {
    const original = payments.find((payment) => payment.id === row.id);
    if (!original) return;
    const party = paymentCounterparty(original, model.bookingsByPnr);
    if (!model.accountList.find((entry) => entry.key === party.key)) {
      alert('This payment is not linked to any counterparty account yet.');
      return;
    }
    setAllocateTarget(original.id);
  };

  // Resolve the allocation target from the live model so it stays fresh after
  // an allocation is saved or reversed.
  const allocateSource = allocateTarget ? payments.find((payment) => payment.id === allocateTarget) : null;
  const allocateAccount = allocateSource
    ? model.accountList.find((entry) => entry.key === paymentCounterparty(allocateSource, model.bookingsByPnr).key)
    : null;

  const handleVerifyPayment = () => {
    if (!verifyTarget) return;
    const problems = verificationProblems(verifyTarget, payments);
    const blocking = problems.filter((problem) => !problem.startsWith('Possible duplicate'));
    const duplicates = problems.filter((problem) => problem.startsWith('Possible duplicate'));
    if (blocking.length) {
      alert(`Cannot verify this payment:\n${blocking.join('\n')}`);
      return;
    }
    if (duplicates.length && !window.confirm(`${duplicates.join('\n')}\n\nVerify anyway?`)) return;

    const verified = withVerification({ ...verifyTarget, verification_notes: verifyNotes }, user, true);
    savePayment(verified);
    setPayments(getPayments());
    setVerifyTarget(null);
    setVerifyNotes('');
    alert(verified.ledger_posting_status === 'POSTED'
      ? 'Payment verified and posted to ledger.'
      : 'Payment verified. It will post to the ledger once the transaction status becomes eligible.');
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Payments</h1>
          <p>
            Payment records with verification workflow: only verified, eligible payments post to the ledger.
            {pendingCount > 0 && <> <strong>{pendingCount}</strong> awaiting verification.</>}
          </p>
        </div>
        {canRecord && (
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={16} /> Record Payment
          </button>
        )}
      </header>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ref, PNR, party, transaction, remarks..." />
            </div>
          </label>
          <label>
            <span>Payment Method</span>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
              <option value="">All methods</option>
              {PAYMENT_MODES.filter((mode) => mode !== 'AUTO_DEBIT').map((mode) => (
                <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Verification</span>
            <select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="TO_BE_VERIFIED">To Be Verified</option>
              <option value="VERIFIED">Verified</option>
            </select>
          </label>
          <label>
            <span>Party Type</span>
            <select value={partyFilter} onChange={(event) => setPartyFilter(event.target.value)}>
              <option value="">All parties</option>
              {PARTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <div className="booking-table-actions">
          <div className="table-meta">
            <span><strong>{filteredPayments.length}</strong> of <strong>{paymentRows.length}</strong> payments</span>
            <span>{activeColumns.length} visible columns</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setSearch(''); setModeFilter(''); setVerificationFilter(''); setPartyFilter(''); }}>Reset</button>
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
            {PAYMENT_COLUMNS.map(([key, label]) => (
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
          <table className="data-table dense-table payment-ledger-table">
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
              {filteredPayments.map((payment) => (
                <tr key={payment.id}>
                  {activeColumns.map(([key]) => (
                    <td key={key}>
                      {MONEY_COLUMNS.includes(key)
                        ? (payment[key] === null || payment[key] === undefined || payment[key] === '' ? '' : formatCurrency(payment[key]))
                        : key === 'verification_status_display'
                          ? verificationBadge(payment.verification_status)
                          : key === 'ledger_posting_status_display'
                            ? postingBadge(payment.ledger_posting_status)
                            : key === 'allocation_status_display'
                              ? allocationBadge(payment.allocation_status)
                              : String(payment[key] || '').replace(/_/g, ' ')}
                    </td>
                  ))}
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(payment.attachment || payment.payment_proof) && (
                        <span title={`Proof: ${payment.payment_proof?.file_name || payment.attachment?.name || 'attached'}`}><Paperclip size={14} /></span>
                      )}
                      {canEditRow(payment) && (
                        <button className="icon-button" type="button" title="Edit payment" onClick={() => openEditModal(payment)}>
                          <Pencil size={14} />
                        </button>
                      )}
                      {canVerify && payment.verification_status === 'TO_BE_VERIFIED' && (
                        <button className="icon-button" type="button" title="Verify payment" onClick={() => openVerifyModal(payment)}>
                          <BadgeCheck size={15} />
                        </button>
                      )}
                      {canAllocate && payment.allocation_status !== 'NOT_POSTED' && payment.allocation_status !== 'FULLY_ALLOCATED' && numeric(payment.unallocated_amount) > 0 && (
                        <button className="icon-button" type="button" title="Allocate payment" onClick={() => openAllocateModal(payment)}>
                          <Link2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredPayments.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length + 1}>No payments recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <PaymentRecordModal
          user={user}
          bookings={bookings}
          payments={payments}
          editingPayment={editingPayment}
          onClose={() => { setShowModal(false); setEditingPayment(null); }}
          onSaved={() => {
            setPayments(getPayments());
            setShowModal(false);
            setEditingPayment(null);
          }}
        />
      )}

      {allocateSource && allocateAccount && (
        <AllocationModal
          user={user}
          source={allocateSource}
          sourceType="PAYMENT"
          account={allocateAccount}
          model={model}
          onClose={() => setAllocateTarget(null)}
          onSaved={(options = {}) => {
            setAllocations(getAllocations());
            if (!options.keepOpen) setAllocateTarget(null);
          }}
        />
      )}

      {verifyTarget && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '460px' }}>
            <h3>Verify Payment</h3>
            <div className="auto-preview-list compact-preview">
              <div><span>Payment Ref</span><strong>{verifyTarget.payment_reference || verifyTarget.id}</strong></div>
              <div><span>Amount</span><strong>{formatCurrency(verifyTarget.amount_paid)} {verifyTarget.transaction_currency || 'EUR'}</strong></div>
              <div><span>Method</span><strong>{String(verifyTarget.payment_method || verifyTarget.payment_mode || '').replace(/_/g, ' ')}</strong></div>
              <div><span>Transaction Ref</span><strong>{transactionReference(verifyTarget) || '-'}</strong></div>
              <div><span>Recorded By</span><strong>{verifyTarget.recorded_by || verifyTarget.received_by || '-'} ({verifyTarget.recorded_by_role || '-'})</strong></div>
            </div>
            <label style={{ display: 'block', marginTop: '10px' }}>
              <span>Verification Notes</span>
              <textarea
                rows={3}
                style={{ width: '100%' }}
                value={verifyNotes}
                onChange={(event) => setVerifyNotes(event.target.value)}
                placeholder="e.g. Amount matched bank statement"
              />
            </label>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setVerifyTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleVerifyPayment}>
                <BadgeCheck size={15} /> Verify Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
