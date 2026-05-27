import { useMemo, useState } from 'react';
import { ArrowUpDown, Download, FileText, Search, SlidersHorizontal } from 'lucide-react';
import { getBookings, getPayments, getRefunds } from '../helpers/storage';
import { getBookingLedger, getPaymentLedger, getRefundLedger, getSupplierPaymentLedger } from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { canExport, filterBookingsForUser, filterRecordsForUser, getUserPartyKey } from '../helpers/access';

function money(value) {
  return `EUR ${Number(value || 0).toLocaleString()}`;
}

const STATEMENT_COLUMNS = [
  ['invoice_no', 'Invoice'],
  ['pnr', 'PNR'],
  ['passenger_name', 'Passenger'],
  ['ticket_no', 'Ticket'],
  ['sector', 'Sector'],
  ['fare_sold', 'Fare Sold'],
  ['fare_issued', 'Fare Issued'],
  ['balance_due', 'Balance'],
  ['alert', 'Alert'],
];

function supplierNamesForBooking(booking) {
  const segmentSuppliers = (booking.supplier_segments || []).map((segment) => segment.supplier_name).filter(Boolean);
  return [...new Set([
    booking.supplier_name,
    booking.supplier,
    booking.airline,
    ...segmentSuppliers,
  ].filter(Boolean))];
}

function bookingMatchesSupplier(booking, supplier) {
  return supplierNamesForBooking(booking).includes(supplier);
}

function supplierPayableForBooking(booking, supplier) {
  const matchingSegments = (booking.supplier_segments || []).filter((segment) => segment.supplier_name === supplier);
  const allocated = matchingSegments.reduce((sum, segment) => sum + Number(segment.buying_price || 0), 0);
  return allocated || Number(booking.fare_issued || 0);
}

export default function Statements() {
  const { user } = useAuth();
  const allowExport = canExport(user);
  const [statementType, setStatementType] = useState(user?.role === 'SUPPLIER' ? 'supplier' : 'agent');
  const [party, setParty] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(STATEMENT_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('invoice_no');
  const [sortDir, setSortDir] = useState('asc');
  const allBookings = getBookings();
  const allPayments = getPayments();
  const allRefunds = getRefunds();
  const bookings = useMemo(() => filterBookingsForUser(user, allBookings), [allBookings, user]);
  const payments = useMemo(
    () => filterRecordsForUser(user, allPayments, 'payments', { bookings }),
    [allPayments, bookings, user],
  );
  const refunds = useMemo(
    () => filterRecordsForUser(user, allRefunds, 'refunds', { bookings }),
    [allRefunds, bookings, user],
  );

  const bookingLedger = useMemo(() => getBookingLedger(bookings, payments), [bookings, payments]);
  const paymentLedger = useMemo(() => getPaymentLedger(bookings, payments), [bookings, payments]);
  const supplierPaymentLedger = useMemo(() => getSupplierPaymentLedger(bookings, payments), [bookings, payments]);
  const refundLedger = useMemo(() => getRefundLedger(bookings, refunds), [bookings, refunds]);

  const parties = useMemo(() => {
    if (user?.role === 'AGENT') return [user.name || user.email].filter(Boolean);
    if (user?.role === 'SUPPLIER') return [user.name || user.email].filter(Boolean);
    if (statementType === 'agent') {
      return [...new Set(bookingLedger.map((booking) => booking.bill_to_name || booking.booked_by).filter(Boolean))];
    }
    return [...new Set(bookingLedger.flatMap((booking) => supplierNamesForBooking(booking)).filter(Boolean))];
  }, [bookingLedger, statementType, user]);

  const selectedParty = party || parties[0] || '';
  const supplierForBooking = (booking) => {
    if (user?.role !== 'SUPPLIER') return selectedParty;
    const aliases = getUserPartyKey(user).aliases;
    return supplierNamesForBooking(booking).find((supplier) => aliases.has(String(supplier || '').trim().toLowerCase())) || selectedParty;
  };
  const statementBookings = user?.role === 'ADMIN'
    ? bookingLedger.filter((booking) => (
      statementType === 'agent'
        ? (booking.bill_to_name || booking.booked_by) === selectedParty
        : bookingMatchesSupplier(booking, selectedParty)
    ))
    : bookingLedger;
  const activeColumns = useMemo(
    () => STATEMENT_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );
  const filteredStatementBookings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return statementBookings
      .filter((booking) => !query || ['invoice_no', 'pnr', 'passenger_name', 'ticket_no', 'sector', 'alert']
        .some((key) => String(booking[key] || '').toLowerCase().includes(query)))
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [search, sortDir, sortKey, statementBookings]);
  const statementPnrs = new Set(statementBookings.map((booking) => booking.pnr));
  const statementTickets = new Set(statementBookings.map((booking) => booking.ticket_no));
  const statementPayments = statementType === 'supplier'
    ? supplierPaymentLedger
    : paymentLedger.filter((payment) => statementPnrs.has(payment.pnr));
  const statementRefunds = refundLedger.filter((refund) => statementTickets.has(refund.ticket_no));
  const revenue = statementBookings.reduce((sum, booking) => sum + Number(booking.fare_sold || 0), 0);
  const payable = statementBookings.reduce((sum, booking) => (
    sum + (statementType === 'supplier'
      ? supplierPayableForBooking(booking, supplierForBooking(booking))
      : Number(booking.fare_sold || 0))
  ), 0);
  const collected = statementPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const outstanding = statementBookings
    .filter((booking) => booking.pnr_n === 1)
    .reduce((sum, booking) => sum + Number(booking.balance_due || 0), 0);
  const refundExposure = statementRefunds.reduce((sum, refund) => sum + Number(refund.eligible_refund || 0), 0);

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

  const renderValue = (booking, key) => {
    if (key === 'fare_sold') return money(booking[key]);
    if (key === 'fare_issued') {
      return money(statementType === 'supplier' ? supplierPayableForBooking(booking, supplierForBooking(booking)) : booking[key]);
    }
    if (key === 'balance_due') return booking.pnr_n === 1 ? money(booking.balance_due) : '-';
    return booking[key] || '-';
  };

  const exportCSV = () => {
    if (!allowExport) return;
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredStatementBookings.map((booking) => activeColumns.map(([key]) => renderValue(booking, key)));
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${statementType}-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Statements</h1>
        <p>Generate daily agent or supplier summaries using booking, payment, and refund ledgers.</p>
      </header>

      <div className="card booking-controls statement-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Statement Type</span>
            <select value={statementType} disabled={user?.role !== 'ADMIN'} onChange={(event) => { setStatementType(event.target.value); setParty(''); }}>
              <option value="agent">Agent Statement</option>
              <option value="supplier">Supplier Statement</option>
            </select>
          </label>
          <label>
            <span>{statementType === 'agent' ? 'Agent' : 'Supplier'}</span>
            <select value={selectedParty} disabled={user?.role !== 'ADMIN'} onChange={(event) => setParty(event.target.value)}>
              {parties.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Statement Date</span>
            <input type="date" value={statementDate} onChange={(event) => setStatementDate(event.target.value)} />
          </label>
          <label>
            <span>Search Rows</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice, PNR, passenger..." />
            </div>
          </label>
        </div>
        <div className="booking-table-actions" style={{ marginTop: 16 }}>
          <div className="table-meta">
            <span><strong>{filteredStatementBookings.length}</strong> of <strong>{statementBookings.length}</strong> rows</span>
            <span>{activeColumns.length} visible columns</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSearch('')}>Reset</button>
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
            {STATEMENT_COLUMNS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card statement-preview">
        <div className="card-head">
          <div>
            <span className="page-kicker">{statementType} statement</span>
            <h3>{selectedParty || 'No party selected'}</h3>
          </div>
          <FileText size={22} />
        </div>

        <div className="refund-panel">
          <div><span>Bookings</span><strong>{statementBookings.length}</strong></div>
          <div><span>Revenue</span><strong>{money(revenue)}</strong></div>
          <div><span>{statementType === 'supplier' ? 'Supplier Receivable' : 'Agent Payable'}</span><strong>{money(payable)}</strong></div>
          <div><span>{statementType === 'supplier' ? 'Paid by Admin' : 'Paid to Admin'}</span><strong>{money(collected)}</strong></div>
          <div><span>Outstanding</span><strong>{money(outstanding)}</strong></div>
          <div><span>Refund Exposure</span><strong>{money(refundExposure)}</strong></div>
        </div>

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table className="data-table dense-table">
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
              {filteredStatementBookings.map((booking) => (
                <tr key={booking.id}>
                  {activeColumns.map(([key]) => <td key={key}>{renderValue(booking, key)}</td>)}
                </tr>
              ))}
              {filteredStatementBookings.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length}>No statement rows for this selection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
