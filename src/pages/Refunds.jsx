import { useMemo, useState } from 'react';
import { getRefunds, getBookings, saveRefund, saveBooking } from '../helpers/storage';
import { getEligibleRefund, getRefundLedger, REFUND_CATEGORIES, REFUND_STATUSES, PAYMENT_MODES } from '../helpers/calculations';
import { ArrowUpDown, Download, Plus, Search, SlidersHorizontal } from 'lucide-react';

const REFUND_COLUMNS = [
  ['sl', 'SL'],
  ['ticket_no', 'Ticket No'],
  ['pnr', 'PNR'],
  ['passenger_name', 'Passenger Name'],
  ['airline', 'Airline'],
  ['sector', 'Sector'],
  ['fare_sold', 'Fare Sold'],
  ['fare_issued', 'Fare Issued'],
  ['cancel_date', 'Cancel Date'],
  ['cancel_type', 'Cancel Type'],
  ['refund_category', 'Category'],
  ['airline_penalty', 'Airline Penalty'],
  ['service_fee', 'Service Fee'],
  ['eligible_refund', 'Eligible Refund'],
  ['supplier_refund', 'Supplier Refund'],
  ['refund_status', 'Status'],
  ['status_date', 'Status Date'],
  ['processing_days', 'Days'],
  ['refund_mode', 'Refund Mode'],
  ['remarks', 'Remarks'],
];

function money(value) {
  return `EUR ${Number(value || 0).toLocaleString()}`;
}

export default function Refunds() {
  const [refunds, setRefunds] = useState(() => getRefunds());
  const [bookings, setBookings] = useState(() => getBookings());
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(REFUND_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('sl');
  const [sortDir, setSortDir] = useState('asc');
  const [form, setForm] = useState({
    ticket_no: '',
    cancel_date: new Date().toISOString().split('T')[0],
    refund_category: 'VOLUNTARY',
    airline_penalty: 0,
    service_fee: 0,
    supplier_refund: 0,
    refund_status: 'TO_APPLY',
    status_date: new Date().toISOString().split('T')[0],
    refund_mode: 'BANK_TRANSFER',
    remarks: '',
  });

  const refundLedger = useMemo(() => getRefundLedger(bookings, refunds), [bookings, refunds]);
  const activeColumns = useMemo(
    () => REFUND_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );
  const filteredRefunds = useMemo(() => {
    const query = search.trim().toLowerCase();
    return refundLedger
      .filter((refund) => {
        const matchesQuery = !query || ['ticket_no', 'pnr', 'passenger_name', 'airline', 'sector', 'remarks']
          .some((key) => String(refund[key] || '').toLowerCase().includes(query));
        return matchesQuery
          && (!statusFilter || refund.refund_status === statusFilter)
          && (!categoryFilter || refund.refund_category === categoryFilter);
      })
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [categoryFilter, refundLedger, search, sortDir, sortKey, statusFilter]);
  const selectedBooking = bookings.find((booking) => booking.ticket_no === form.ticket_no);
  const eligiblePreview = getEligibleRefund(
    Number(selectedBooking?.fare_sold || 0),
    Number(form.airline_penalty || 0),
    Number(form.service_fee || 0),
  );

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
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

  const renderValue = (refund, key) => {
    if (['fare_sold', 'fare_issued', 'airline_penalty', 'service_fee', 'eligible_refund', 'supplier_refund'].includes(key)) return money(refund[key]);
    if (key === 'refund_status') return <span className={`badge ${String(refund[key]).toLowerCase()}`}>{String(refund[key] || '').replace(/_/g, ' ')}</span>;
    return String(refund[key] || '').replace(/_/g, ' ');
  };

  const exportCSV = () => {
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredRefunds.map((refund) => activeColumns.map(([key]) => (
      ['fare_sold', 'fare_issued', 'airline_penalty', 'service_fee', 'eligible_refund', 'supplier_refund'].includes(key)
        ? money(refund[key])
        : String(refund[key] || '').replace(/_/g, ' ')
    )));
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `refunds-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateRefund = () => {
    if (!selectedBooking) {
      alert('Select a ticket number from bookings.');
      return;
    }

    const checkedBookingsForPnr = bookings.filter((booking) => booking.pnr === selectedBooking.pnr && (booking.refund_flag || booking.ticket_no === form.ticket_no));
    const allBookingsForPnr = bookings.filter((booking) => booking.pnr === selectedBooking.pnr);
    const cancelType = checkedBookingsForPnr.length >= allBookingsForPnr.length ? 'FULL_BOOKING' : 'CANCEL_PAX';

    saveRefund({
      ...form,
      pnr: selectedBooking.pnr,
      passenger_name: selectedBooking.passenger_name,
      airline: selectedBooking.airline,
      sector: selectedBooking.sector,
      fare_sold: Number(selectedBooking.fare_sold || 0),
      fare_issued: Number(selectedBooking.fare_issued || 0),
      cancel_type: cancelType,
      airline_penalty: Number(form.airline_penalty || 0),
      service_fee: Number(form.service_fee || 0),
      eligible_refund: eligiblePreview,
      supplier_refund: Number(form.supplier_refund || 0),
    });

    saveBooking({ ...selectedBooking, refund_flag: true });
    setRefunds(getRefunds());
    setBookings(getBookings());
    setForm({
      ticket_no: '',
      cancel_date: new Date().toISOString().split('T')[0],
      refund_category: 'VOLUNTARY',
      airline_penalty: 0,
      service_fee: 0,
      supplier_refund: 0,
      refund_status: 'TO_APPLY',
      status_date: new Date().toISOString().split('T')[0],
      refund_mode: 'BANK_TRANSFER',
      remarks: '',
    });
    setShowModal(false);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Refunds</h1>
          <p>Ticket-keyed refund tracker with lookup, penalties, supplier refund, and lifecycle status.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> New Refund
        </button>
      </header>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ticket, PNR, passenger, sector..." />
            </div>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {REFUND_STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
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
            <span><strong>{filteredRefunds.length}</strong> of <strong>{refundLedger.length}</strong> refunds</span>
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
              <tr>{activeColumns.map(([key, label]) => (
                <th key={key}>
                  <button type="button" onClick={() => handleSort(key)}>
                    {label}
                    <ArrowUpDown size={13} />
                  </button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {filteredRefunds.map((refund) => (
                <tr key={refund.id}>
                  {activeColumns.map(([key]) => (
                    <td key={key}>{renderValue(refund, key)}</td>
                  ))}
                </tr>
              ))}
              {filteredRefunds.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length}>No refunds recorded.</td></tr>
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
          <div className="card modal-card" style={{ width: '680px' }}>
            <h3>Create Refund Entry</h3>
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
                <span>Status</span>
                <select value={form.refund_status} onChange={(event) => updateForm('refund_status', event.target.value)}>
                  {REFUND_STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Airline Penalty</span>
                <input type="number" value={form.airline_penalty} onChange={(event) => updateForm('airline_penalty', event.target.value)} />
              </label>
              <label>
                <span>Service Fee</span>
                <input type="number" value={form.service_fee} onChange={(event) => updateForm('service_fee', event.target.value)} />
              </label>
              <label>
                <span>Supplier Refund</span>
                <input type="number" value={form.supplier_refund} onChange={(event) => updateForm('supplier_refund', event.target.value)} />
              </label>
              <label>
                <span>Status Date</span>
                <input type="date" value={form.status_date} onChange={(event) => updateForm('status_date', event.target.value)} />
              </label>
              <label>
                <span>Refund Mode</span>
                <select value={form.refund_mode} onChange={(event) => updateForm('refund_mode', event.target.value)}>
                  {PAYMENT_MODES.filter((mode) => ['CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'CHEQUE'].includes(mode)).map((mode) => (
                    <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
                  ))}
                  <option value="ADJUSTED_AGAINST_BOOKING">Adjusted Against Booking</option>
                </select>
              </label>
              <label>
                <span>Remarks</span>
                <input value={form.remarks} onChange={(event) => updateForm('remarks', event.target.value)} />
              </label>
            </div>
            <div className="auto-preview-list compact-preview">
              <div><span>PNR Lookup</span><strong>{selectedBooking?.pnr || '-'}</strong></div>
              <div><span>Passenger</span><strong>{selectedBooking?.passenger_name || '-'}</strong></div>
              <div><span>Fare Sold</span><strong>{money(selectedBooking?.fare_sold)}</strong></div>
              <div><span>Eligible Refund</span><strong>{money(eligiblePreview)}</strong></div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '18px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateRefund}>Save Refund</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
