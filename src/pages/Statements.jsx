import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowUpDown, FileSpreadsheet, FileText, Search, SlidersHorizontal } from 'lucide-react';
import { getBookings, getPayments, getRefunds } from '../helpers/storage';
import {
  bookingMatchesSupplier,
  getBookingLedger,
  getPaymentLedger,
  getRefundLedger,
  getStatementColumns,
  getSupplierPayableLedger,
  getSupplierPayableSummary,
  getSupplierPaymentLedger,
  supplierNamesForBooking,
} from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { filterBookingsForUser, filterRecordsForUser } from '../helpers/access';

function money(value) {
  return `EUR ${Number(value || 0).toLocaleString()}`;
}

export default function Statements() {
  const { user } = useAuth();
  const showStatementSummary = user?.role === 'ADMIN';
  const [statementType, setStatementType] = useState(user?.role === 'SUPPLIER' ? 'supplier' : 'agent');
  const [party, setParty] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const defaultColumns = useMemo(
    () => getStatementColumns({ role: user?.role, statementType }),
    [statementType, user?.role],
  );
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(defaultColumns.map(([key]) => key)));
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

  useEffect(() => {
    setVisibleColumns(new Set(defaultColumns.map(([key]) => key)));
    setSortKey((current) => (defaultColumns.some(([key]) => key === current) ? current : 'invoice_no'));
  }, [defaultColumns]);

  const parties = useMemo(() => {
    if (user?.role === 'AGENT') return [user.name || user.email].filter(Boolean);
    if (user?.role === 'SUPPLIER') return [user.name || user.email].filter(Boolean);
    if (statementType === 'agent') {
      return [...new Set(bookingLedger.map((booking) => booking.bill_to_name || booking.booked_by).filter(Boolean))];
    }
    return [...new Set(bookings.flatMap((booking) => supplierNamesForBooking(booking)).filter(Boolean))];
  }, [bookingLedger, bookings, statementType, user]);

  const selectedParty = party || parties[0] || '';
  const statementSupplier = user?.role === 'SUPPLIER' ? user : selectedParty;
  const supplierStatementRows = useMemo(
    () => getSupplierPayableLedger(bookings, payments, statementSupplier),
    [bookings, payments, statementSupplier],
  );
  const statementBookings = statementType === 'supplier'
    ? supplierStatementRows
    : (
      user?.role === 'ADMIN'
        ? bookingLedger.filter((booking) => (booking.bill_to_name || booking.booked_by) === selectedParty)
        : bookingLedger
    );
  const activeColumns = useMemo(
    () => defaultColumns.filter(([key]) => visibleColumns.has(key)),
    [defaultColumns, visibleColumns],
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
    ? supplierPaymentLedger.filter((payment) => bookingMatchesSupplier({ supplier_name: payment.supplier_name }, statementSupplier))
    : paymentLedger.filter((payment) => statementPnrs.has(payment.pnr));
  const statementRefunds = refundLedger.filter((refund) => statementTickets.has(refund.ticket_no));
  const supplierSummary = statementType === 'supplier'
    ? getSupplierPayableSummary(bookings, payments, statementSupplier)
    : null;
  const revenue = statementType === 'supplier'
    ? supplierSummary.payable
    : statementBookings.reduce((sum, booking) => sum + Number(booking.fare_sold || 0), 0);
  const payable = statementType === 'supplier'
    ? supplierSummary.payable
    : statementBookings.reduce((sum, booking) => sum + Number(booking.fare_sold || 0), 0);
  const collected = statementPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const outstanding = statementType === 'supplier'
    ? supplierSummary.outstanding
    : statementBookings
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
    if (['fare_sold', 'fare_issued', 'profit', 'supplier_payable', 'supplier_paid', 'supplier_balance_due'].includes(key)) {
      return money(booking[key]);
    }
    if (key === 'balance_due') return booking.pnr_n === 1 ? money(booking.balance_due) : '-';
    return booking[key] || '-';
  };

  const getExportRows = () => filteredStatementBookings.map((booking) => (
    Object.fromEntries(activeColumns.map(([key, label]) => [label, renderValue(booking, key)]))
  ));

  const statementFileBase = `${statementType}-statement-${new Date().toISOString().slice(0, 10)}`;

  const exportXlsx = () => {
    const worksheet = XLSX.utils.json_to_sheet(getExportRows());
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Statement');
    XLSX.writeFile(workbook, `${statementFileBase}.xlsx`);
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const exportPdf = () => {
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredStatementBookings.map((booking) => activeColumns.map(([key]) => renderValue(booking, key)));
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) {
      alert('Allow popups to generate the PDF statement.');
      return;
    }

    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(statementFileBase)}</title>
          <style>
            @page { size: A4 landscape; margin: 14mm; }
            body { font-family: Arial, sans-serif; color: #18181b; }
            h1 { margin: 0 0 4px; font-size: 22px; }
            .meta { margin-bottom: 18px; color: #52525b; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th { background: #090d14; color: #fff; text-align: left; padding: 8px; }
            td { border-bottom: 1px solid #e4e4e7; padding: 7px 8px; }
            tr:nth-child(even) td { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(statementType === 'supplier' ? 'Supplier Statement' : 'Agent Statement')}</h1>
          <div class="meta">
            Party: ${escapeHtml(selectedParty || 'Statement')} · Date: ${escapeHtml(statementDate)} · Rows: ${rows.length}
          </div>
          <table>
            <thead><tr>${header.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
            <tbody>
              ${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `);
    popup.document.close();
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
            <button className="btn btn-primary btn-sm" type="button" onClick={exportXlsx}>
              <FileSpreadsheet size={15} /> Excel
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={exportPdf}>
              <FileText size={15} /> PDF
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSearch('')}>Reset</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowColumns((value) => !value)}>
              <SlidersHorizontal size={15} /> Columns
            </button>
          </div>
        </div>
        {showColumns && (
          <div className="column-panel">
            {defaultColumns.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card statement-preview">
        {showStatementSummary && (
          <>
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
          </>
        )}

        <div className="table-scroll" style={{ marginTop: showStatementSummary ? 18 : 0 }}>
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
