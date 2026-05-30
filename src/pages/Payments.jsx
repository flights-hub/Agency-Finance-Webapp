import { useMemo, useState } from 'react';
import { getPayments, getBookings, savePayment } from '../helpers/storage';
import {
  createPaymentEntry,
  createSupplierPaymentEntry,
  getBookingLedger,
  getPaymentLedger,
  getSupplierPaymentLedger,
  PAYMENT_MODES,
  supplierNamesForBooking,
} from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { canExport, canRecordPayments, filterBookingsForUser, filterRecordsForUser } from '../helpers/access';
import { ArrowUpDown, Download, Plus, Search, SlidersHorizontal } from 'lucide-react';

const PAYMENT_COLUMNS = [
  ['sl', 'SL'],
  ['payment_date', 'Payment Date'],
  ['payment_direction', 'Direction'],
  ['supplier_name', 'Supplier'],
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

function money(value) {
  return `EUR ${Number(value || 0).toLocaleString()}`;
}

export default function Payments() {
  const { user } = useAuth();
  const allowRecordPayment = canRecordPayments(user);
  const allowExport = canExport(user);
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
    payment_direction: 'AGENT_IN',
    payment_date: new Date().toISOString().split('T')[0],
    pnr: '',
    supplier_name: '',
    supplier_payment_scope: 'SUPPLIER',
    segment_id: '',
    amount_paid: '',
    payment_mode: 'BANK_TRANSFER',
    receipt_ref: '',
    remarks: '',
  });

  const scopedBookings = useMemo(() => filterBookingsForUser(user, bookings), [bookings, user]);
  const scopedPayments = useMemo(
    () => filterRecordsForUser(user, payments, 'payments', { bookings: scopedBookings }),
    [payments, scopedBookings, user],
  );
  const bookingLedger = useMemo(() => getBookingLedger(scopedBookings, scopedPayments), [scopedBookings, scopedPayments]);
  const agentPaymentLedger = useMemo(() => getPaymentLedger(scopedBookings, scopedPayments), [scopedBookings, scopedPayments]);
  const supplierPaymentLedger = useMemo(() => getSupplierPaymentLedger(scopedBookings, scopedPayments), [scopedBookings, scopedPayments]);
  const paymentLedger = useMemo(() => (
    user?.role === 'SUPPLIER' ? supplierPaymentLedger : [...agentPaymentLedger, ...supplierPaymentLedger]
  ), [agentPaymentLedger, supplierPaymentLedger, user?.role]);
  const pnrOptions = bookingLedger.filter((booking) => booking.pnr_n === 1);
  const supplierOptions = useMemo(() => (
    [...new Set(scopedBookings.flatMap((booking) => supplierNamesForBooking(booking)).filter(Boolean))]
  ), [scopedBookings]);
  const supplierBookingOptions = useMemo(() => (
    scopedBookings.filter((booking) => supplierNamesForBooking(booking).includes(form.supplier_name))
  ), [form.supplier_name, scopedBookings]);
  const supplierSegmentOptions = useMemo(() => {
    const booking = supplierBookingOptions.find((item) => item.pnr === form.pnr);
    return (booking?.supplier_segments || [])
      .filter((segment) => segment.supplier_name === form.supplier_name || segment.supplier_id === form.supplier_name)
      .map((segment, index) => ({
        id: String(segment.id || segment.segment_id || `${booking.pnr}-${index}`),
        label: `${segment.segment || segment.sector || booking.sector || 'Segment'} - ${money(segment.buying_price || 0)}`,
      }));
  }, [form.pnr, form.supplier_name, supplierBookingOptions]);
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
    if (form.payment_direction === 'SUPPLIER_OUT') {
      const supplierPayment = createSupplierPaymentEntry(
        { ...form, amount_paid: Number(form.amount_paid || 0), received_by: 'Finance Desk' },
      );
      const ledger = getSupplierPaymentLedger(scopedBookings, [...scopedPayments, supplierPayment]);
      return ledger[ledger.length - 1] || supplierPayment;
    }
    const nextPayment = createPaymentEntry(
      { ...form, amount_paid: Number(form.amount_paid || 0), received_by: 'Finance Desk' },
      scopedBookings,
      scopedPayments,
    );
    return nextPayment;
  }, [form, scopedBookings, scopedPayments]);

  const updateForm = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'payment_direction') {
        next.pnr = '';
        next.supplier_name = '';
        next.supplier_payment_scope = 'SUPPLIER';
        next.segment_id = '';
      }
      if (key === 'supplier_name') {
        next.pnr = '';
        next.segment_id = '';
      }
      if (key === 'supplier_payment_scope') {
        next.pnr = '';
        next.segment_id = '';
      }
      if (key === 'pnr') next.segment_id = '';
      return next;
    });
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
    if (!allowExport) return;
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredPayments.map((payment) => activeColumns.map(([key]) => (
      ['amount_paid', 'cumulative_paid', 'total_fare', 'remaining_balance'].includes(key)
        ? money(payment[key])
        : String(payment[key] || '').replace(/_/g, ' ')
    )));
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSavePayment = () => {
    if (!allowRecordPayment) return;
    const amount = Number(form.amount_paid);
    if (!amount || amount <= 0) {
      alert('Enter a positive payment amount.');
      return;
    }

    if (form.payment_direction === 'SUPPLIER_OUT') {
      if (!form.supplier_name) {
        alert('Select a supplier.');
        return;
      }
      if (form.supplier_payment_scope !== 'SUPPLIER' && !form.pnr) {
        alert('Select a PNR for this supplier payment.');
        return;
      }
      if (form.supplier_payment_scope === 'SEGMENT' && !form.segment_id) {
        alert('Select a supplier segment.');
        return;
      }
      savePayment(createSupplierPaymentEntry({ ...form, amount_paid: amount, received_by: 'Finance Desk' }));
    } else {
      if (!form.pnr) {
        alert('Select a PNR.');
        return;
      }
      savePayment(createPaymentEntry({ ...form, amount_paid: amount, received_by: 'Finance Desk' }, bookings, payments));
    }
    setPayments(getPayments());
    setForm({
      payment_direction: 'AGENT_IN',
      payment_date: new Date().toISOString().split('T')[0],
      pnr: '',
      supplier_name: '',
      supplier_payment_scope: 'SUPPLIER',
      segment_id: '',
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
        {allowRecordPayment && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
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
            {allowExport && (
              <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
                <Download size={15} /> Export
              </button>
            )}
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
                        ? money(payment[key])
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
                <span>Payment Type</span>
                <select value={form.payment_direction} onChange={(event) => updateForm('payment_direction', event.target.value)}>
                  <option value="AGENT_IN">Agent payment to Admin</option>
                  <option value="SUPPLIER_OUT">Admin payment to Supplier</option>
                </select>
              </label>
              <label>
                <span>Payment Date</span>
                <input type="date" value={form.payment_date} onChange={(event) => updateForm('payment_date', event.target.value)} />
              </label>
              {form.payment_direction === 'SUPPLIER_OUT' ? (
                <>
                  <label>
                    <span>Supplier</span>
                    <select value={form.supplier_name} onChange={(event) => updateForm('supplier_name', event.target.value)}>
                      <option value="">Select supplier</option>
                      {supplierOptions.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Supplier Payment Scope</span>
                    <select value={form.supplier_payment_scope} onChange={(event) => updateForm('supplier_payment_scope', event.target.value)}>
                      <option value="SUPPLIER">Supplier total</option>
                      <option value="PNR">Specific PNR</option>
                      <option value="SEGMENT">Specific segment</option>
                    </select>
                  </label>
                  {form.supplier_payment_scope !== 'SUPPLIER' && (
                    <label>
                      <span>Supplier PNR</span>
                      <select value={form.pnr} onChange={(event) => updateForm('pnr', event.target.value)}>
                        <option value="">Select PNR</option>
                        {supplierBookingOptions.map((booking) => (
                          <option key={booking.id || booking.pnr} value={booking.pnr}>
                            {booking.pnr} - {booking.passenger_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {form.supplier_payment_scope === 'SEGMENT' && (
                    <label>
                      <span>Supplier Segment</span>
                      <select value={form.segment_id} onChange={(event) => updateForm('segment_id', event.target.value)}>
                        <option value="">Select segment</option>
                        {supplierSegmentOptions.map((segment) => (
                          <option key={segment.id} value={segment.id}>{segment.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <label>
                  <span>PNR</span>
                  <select value={form.pnr} onChange={(event) => updateForm('pnr', event.target.value)}>
                    <option value="">Select PNR</option>
                    {pnrOptions.map((booking) => (
                      <option key={booking.id} value={booking.pnr}>
                        {booking.pnr} - {booking.passenger_name} (Due: {money(booking.balance_due)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
              <div><span>Cumulative Paid</span><strong>{money(selectedPreview.cumulative_paid)}</strong></div>
              <div><span>Remaining Balance</span><strong>{money(selectedPreview.remaining_balance)}</strong></div>
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
