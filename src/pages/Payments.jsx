import { useMemo, useState } from 'react';
import { getPayments, getBookings, savePayment } from '../helpers/storage';
import { createPaymentEntry, getBookingLedger, getPaymentLedger, PAYMENT_MODES } from '../helpers/calculations';
import { formatCurrency } from '../helpers/format';
import { downloadCSV } from '../helpers/downloadCSV';
import { ArrowUpDown, Download, Plus, Search, SlidersHorizontal } from 'lucide-react';

const PAYMENT_COLUMNS = [
  ['sl', 'SL'],
  ['payment_date', 'Payment Date'],
  ['pnr', 'PNR'],
  ['passenger_name', 'Passenger Name'],
  ['amount_paid', 'Amount Paid'],
  ['payment_mode', 'Payment Mode'],
  ['receipt_ref', 'Receipt Ref'],
  ['instalment_no', 'Inst No'],
  ['instalment_type', 'Inst Type'],
  ['received_by', 'Received By'],
  ['cumulative_paid', 'Cumulative Paid'],
  ['total_fare', 'Total Fare'],
  ['remaining_balance', 'Remaining Bal'],
  ['remarks', 'Remarks'],
];

export default function Payments() {
  const [payments, setPayments] = useState(() => getPayments());
  const [bookings] = useState(() => getBookings());
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(PAYMENT_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('payment_date');
  const [sortDir, setSortDir] = useState('asc');
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    pnr: '',
    amount_paid: '',
    payment_mode: 'BANK_TRANSFER',
    receipt_ref: '',
    remarks: '',
  });

  const bookingLedger = useMemo(() => getBookingLedger(bookings, payments), [bookings, payments]);
  const paymentLedger = useMemo(() => getPaymentLedger(bookings, payments), [bookings, payments]);
  const pnrOptions = bookingLedger.filter((booking) => booking.pnr_n === 1);
  const activeColumns = useMemo(
    () => PAYMENT_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );
  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return paymentLedger
      .filter((payment) => {
        const matchesQuery = !query || ['pnr', 'passenger_name', 'receipt_ref', 'instalment_type', 'received_by', 'remarks']
          .some((key) => String(payment[key] || '').toLowerCase().includes(query));
        return matchesQuery && (!modeFilter || payment.payment_mode === modeFilter);
      })
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [modeFilter, paymentLedger, search, sortDir, sortKey]);

  const selectedPreview = useMemo(() => {
    const nextPayment = createPaymentEntry(
      { ...form, amount_paid: Number(form.amount_paid || 0), received_by: 'Finance Desk' },
      bookings,
      payments,
    );
    return nextPayment;
  }, [bookings, form, payments]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

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
    const formatters = {
      amount_paid: (v) => formatCurrency(v),
      cumulative_paid: (v) => formatCurrency(v),
      total_fare: (v) => formatCurrency(v),
      remaining_balance: (v) => formatCurrency(v),
    };
    downloadCSV('payments', activeColumns, filteredPayments, formatters);
  };

  const handleSavePayment = () => {
    const amount = Number(form.amount_paid);
    if (!form.pnr || !amount || amount <= 0) {
      alert('Select a PNR and enter a positive payment amount.');
      return;
    }

    savePayment(createPaymentEntry({ ...form, amount_paid: amount, received_by: 'Finance Desk' }, bookings, payments));
    setPayments(getPayments());
    setForm({
      payment_date: new Date().toISOString().split('T')[0],
      pnr: '',
      amount_paid: '',
      payment_mode: 'BANK_TRANSFER',
      receipt_ref: '',
      remarks: '',
    });
    setShowModal(false);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Payments</h1>
          <p>Positive-only payment ledger with running balance and automatic instalment sequencing.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Record Payment
        </button>
      </header>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PNR, passenger, receipt, remarks..." />
            </div>
          </label>
          <label>
            <span>Payment Mode</span>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
              <option value="">All modes</option>
              {PAYMENT_MODES.filter((mode) => mode !== 'AUTO_DEBIT').map((mode) => (
                <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="booking-table-actions">
          <div className="table-meta">
            <span><strong>{filteredPayments.length}</strong> of <strong>{paymentLedger.length}</strong> payments</span>
            <span>{activeColumns.length} visible columns</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setSearch(''); setModeFilter(''); }}>Reset</button>
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
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment) => (
                <tr key={payment.id}>
                  {activeColumns.map(([key]) => (
                    <td key={key}>
                      {['amount_paid', 'cumulative_paid', 'total_fare', 'remaining_balance'].includes(key)
                        ? formatCurrency(payment[key])
                        : String(payment[key] || '').replace(/_/g, ' ')}
                    </td>
                  ))}
                </tr>
              ))}
              {filteredPayments.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length}>No payments recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '520px' }}>
            <h3>Record Payment</h3>
            <div className="modal-form-grid">
              <label>
                <span>Payment Date</span>
                <input type="date" value={form.payment_date} onChange={(event) => updateForm('payment_date', event.target.value)} />
              </label>
              <label>
                <span>PNR</span>
                <select value={form.pnr} onChange={(event) => updateForm('pnr', event.target.value)}>
                  <option value="">Select PNR</option>
                  {pnrOptions.map((booking) => (
                    <option key={booking.id} value={booking.pnr}>
                      {booking.pnr} - {booking.passenger_name} (Due: {formatCurrency(booking.balance_due)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Amount Paid</span>
                <input type="number" value={form.amount_paid} onChange={(event) => updateForm('amount_paid', event.target.value)} min="0" />
              </label>
              <label>
                <span>Payment Mode</span>
                <select value={form.payment_mode} onChange={(event) => updateForm('payment_mode', event.target.value)}>
                  {PAYMENT_MODES.filter((mode) => mode !== 'AUTO_DEBIT').map((mode) => (
                    <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Receipt Ref</span>
                <input value={form.receipt_ref} onChange={(event) => updateForm('receipt_ref', event.target.value)} />
              </label>
              <label>
                <span>Remarks</span>
                <input value={form.remarks} onChange={(event) => updateForm('remarks', event.target.value)} />
              </label>
            </div>

            <div className="auto-preview-list compact-preview">
              <div><span>Instalment No</span><strong>{selectedPreview.instalment_no || '-'}</strong></div>
              <div><span>Instalment Type</span><strong>{selectedPreview.instalment_type || '-'}</strong></div>
              <div><span>Cumulative Paid</span><strong>{formatCurrency(selectedPreview.cumulative_paid)}</strong></div>
              <div><span>Remaining Balance</span><strong>{formatCurrency(selectedPreview.remaining_balance)}</strong></div>
            </div>

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSavePayment}>Save Payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
