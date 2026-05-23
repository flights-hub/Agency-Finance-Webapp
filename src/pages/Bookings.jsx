import { useMemo, useState } from 'react';
import { getBookings, getPayments, saveBooking } from '../helpers/storage';
import { daysBetween, getAlertLevel, getBookingLedger, getPaymentStatus } from '../helpers/calculations';
import { extractTextFromPDF, parseTicketData } from '../helpers/pdfParser';
import { ArrowUpDown, Download, FileText, Plus, Search, SlidersHorizontal, UploadCloud } from 'lucide-react';

const TABLE_COLUMNS = [
  { key: 'sl', label: 'SL', type: 'auto' },
  { key: 'invoice_no', label: 'Invoice No', type: 'auto' },
  { key: 'booking_date', label: 'Booking Date', type: 'manual' },
  { key: 'passenger_name', label: 'Passenger Name', type: 'manual' },
  { key: 'pax_type', label: 'Pax Type', type: 'manual' },
  { key: 'mobile', label: 'Mobile', type: 'manual' },
  { key: 'airline', label: 'Airline', type: 'manual' },
  { key: 'pnr', label: 'PNR', type: 'manual' },
  { key: 'ow_rt', label: 'OW/RT', type: 'auto' },
  { key: 'ticket_no', label: 'Ticket No', type: 'manual' },
  { key: 'sector', label: 'Sector', type: 'manual' },
  { key: 'outbound_date', label: 'Outbound Date', type: 'manual' },
  { key: 'inbound_date', label: 'Inbound Date', type: 'manual' },
  { key: 'fare_sold', label: 'Fare Sold', type: 'manual' },
  { key: 'fare_issued', label: 'Fare Issued', type: 'manual' },
  { key: 'profit', label: 'Profit', type: 'auto' },
  { key: 'total_paid', label: 'Total Paid', type: 'auto' },
  { key: 'balance_due', label: 'Balance Due', type: 'auto' },
  { key: 'payment_status', label: 'Payment Status', type: 'auto' },
  { key: 'num_instalments', label: 'Num Instalments', type: 'auto' },
  { key: 'booked_by', label: 'Booked By', type: 'manual' },
  { key: 'agent_issued_by', label: 'Agent Issued By', type: 'manual' },
  { key: 'ticket_status', label: 'Ticket Status', type: 'auto' },
  { key: 'days_to_departure', label: 'Days To Dep', type: 'auto' },
  { key: 'alert', label: 'Alert', type: 'auto' },
  { key: 'remarks', label: 'Remarks', type: 'manual' },
  { key: 'refund_flag', label: 'Refund', type: 'manual' },
];

const DEFAULT_COLUMNS = [
  'sl',
  'invoice_no',
  'booking_date',
  'passenger_name',
  'pax_type',
  'mobile',
  'airline',
  'pnr',
  'ow_rt',
  'ticket_no',
  'sector',
  'outbound_date',
  'inbound_date',
  'fare_sold',
  'fare_issued',
  'profit',
  'total_paid',
  'balance_due',
  'payment_status',
  'alert',
  'refund_flag',
];

const EMPTY_FORM = {
  booking_date: new Date().toISOString().split('T')[0],
  passenger_name: '',
  pax_type: 'ADT',
  mobile: '',
  airline: '',
  pnr: '',
  ticket_no: '',
  sector: '',
  outbound_date: '',
  inbound_date: '',
  fare_sold: '',
  fare_issued: '',
  booked_by: '',
  agent_issued_by: '',
  remarks: '',
  refund_flag: false,
};

const FORM_FIELDS = [
  { key: 'booking_date', label: 'Booking Date', input: 'date' },
  { key: 'passenger_name', label: 'Passenger Name', required: true },
  { key: 'pax_type', label: 'Pax Type', input: 'select', options: ['ADT', 'CHD', 'INF'] },
  { key: 'mobile', label: 'Mobile' },
  { key: 'airline', label: 'Airline', required: true },
  { key: 'pnr', label: 'PNR', required: true },
  { key: 'ticket_no', label: 'Ticket No' },
  { key: 'sector', label: 'Sector', placeholder: 'FCO-DEL' },
  { key: 'outbound_date', label: 'Outbound Date', input: 'date' },
  { key: 'inbound_date', label: 'Inbound Date', input: 'date' },
  { key: 'fare_sold', label: 'Fare Sold', input: 'number', required: true },
  { key: 'fare_issued', label: 'Fare Issued', input: 'number' },
  { key: 'booked_by', label: 'Booked By' },
  { key: 'agent_issued_by', label: 'Agent Issued By' },
  { key: 'remarks', label: 'Remarks', input: 'textarea' },
  { key: 'refund_flag', label: 'Refund', input: 'checkbox' },
];

const moneyKeys = new Set(['fare_sold', 'fare_issued', 'profit', 'total_paid', 'balance_due']);

function numeric(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function invoiceNumber(index) {
  return `INV-${String(index + 1).padStart(5, '0')}`;
}

function normalizePnr(value = '') {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function deriveBooking(rawBooking, index, payments) {
  const pnrPayments = payments.filter((payment) => payment.pnr === rawBooking.pnr);
  const ledgerPaid = pnrPayments.reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
  const totalPaid = ledgerPaid || numeric(rawBooking.total_paid);
  const fareSold = numeric(rawBooking.fare_sold);
  const fareIssued = numeric(rawBooking.fare_issued);
  const balanceDue = Math.max(0, fareSold - totalPaid);
  const daysToDeparture = rawBooking.outbound_date
    ? daysBetween(new Date().toISOString().split('T')[0], rawBooking.outbound_date)
    : '';
  const alertLevel = rawBooking.outbound_date
    ? getAlertLevel(daysToDeparture, balanceDue)
    : 'SETTLED';

  return {
    ...rawBooking,
    sl: index + 1,
    invoice_no: rawBooking.invoice_no || invoiceNumber(index),
    booking_date: rawBooking.booking_date || rawBooking.created_at?.slice(0, 10) || '',
    pax_type: rawBooking.pax_type || 'ADT',
    ow_rt: rawBooking.inbound_date ? 'RT' : 'OW',
    fare_sold: fareSold,
    fare_issued: fareIssued,
    profit: fareSold - fareIssued,
    total_paid: totalPaid,
    balance_due: balanceDue,
    payment_status: getPaymentStatus(fareSold, totalPaid),
    num_instalments: pnrPayments.length,
    ticket_status: rawBooking.ticket_status || (rawBooking.ticket_no ? 'TICKETED' : 'PENDING'),
    days_to_departure: daysToDeparture,
    alert: alertLevel === 'CRITICAL' ? 'OVERDUE' : alertLevel,
    remarks: rawBooking.remarks || '',
    pnr_n: normalizePnr(rawBooking.pnr),
    refund_flag: Boolean(rawBooking.refund_flag),
  };
}

function formatCell(row, key) {
  if (row[key] === null) return '-';
  if (moneyKeys.has(key)) return `EUR ${Number(row[key] || 0).toLocaleString()}`;
  if (key === 'refund_flag') return row.refund_flag ? 'Yes' : 'No';
  if (key === 'payment_status' || key === 'ticket_status') return String(row[key] || '').replace(/_/g, ' ');
  return row[key] === '' || row[key] === undefined || row[key] === null ? '-' : row[key];
}

function makeBookingPayload(formValues, index) {
  const fareSold = numeric(formValues.fare_sold);
  const fareIssued = numeric(formValues.fare_issued);

  return {
    ...formValues,
    invoice_no: invoiceNumber(index),
    pnr: formValues.pnr.trim().toUpperCase(),
    pnr_n: normalizePnr(formValues.pnr),
    fare_sold: fareSold,
    fare_issued: fareIssued,
    total_paid: 0,
    balance_due: fareSold,
    payment_status: 'UNPAID',
    ow_rt: formValues.inbound_date ? 'RT' : 'OW',
    profit: fareSold - fareIssued,
    num_instalments: 0,
    ticket_status: formValues.ticket_no ? 'TICKETED' : 'PENDING',
    created_at: new Date().toISOString(),
  };
}

export default function Bookings() {
  const [activeTab, setActiveTab] = useState('LIST');
  const [bookings, setBookings] = useState(() => getBookings());
  const [payments, setPayments] = useState(() => getPayments());
  const [formValues, setFormValues] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [airlineFilter, setAirlineFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [alertFilter, setAlertFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(DEFAULT_COLUMNS));
  const [sortKey, setSortKey] = useState('sl');
  const [sortDir, setSortDir] = useState('asc');
  const [pdfStatus, setPdfStatus] = useState('');
  const [crypticText, setCrypticText] = useState('');

  const normalizedBookings = useMemo(
    () => getBookingLedger(bookings, payments),
    [bookings, payments],
  );

  const activeColumns = useMemo(
    () => TABLE_COLUMNS.filter((column) => visibleColumns.has(column.key)),
    [visibleColumns],
  );

  const filterOptions = useMemo(() => ({
    airlines: [...new Set(normalizedBookings.map((booking) => booking.airline).filter(Boolean))],
    paymentStatuses: [...new Set(normalizedBookings.map((booking) => booking.payment_status).filter(Boolean))],
    alerts: [...new Set(normalizedBookings.map((booking) => booking.alert).filter(Boolean))],
  }), [normalizedBookings]);

  const filteredBookings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return normalizedBookings
      .filter((booking) => {
        const matchesQuery = !query || [
          booking.invoice_no,
          booking.passenger_name,
          booking.mobile,
          booking.airline,
          booking.pnr,
          booking.ticket_no,
          booking.sector,
          booking.booked_by,
          booking.agent_issued_by,
          booking.remarks,
        ].some((value) => String(value || '').toLowerCase().includes(query));

        return matchesQuery
          && (!airlineFilter || booking.airline === airlineFilter)
          && (!paymentFilter || booking.payment_status === paymentFilter)
          && (!alertFilter || booking.alert === alertFilter);
      })
      .sort((a, b) => {
        const aValue = a[sortKey];
        const bValue = b[sortKey];
        const result = typeof aValue === 'number' && typeof bValue === 'number'
          ? aValue - bValue
          : String(aValue || '').localeCompare(String(bValue || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [airlineFilter, alertFilter, normalizedBookings, paymentFilter, search, sortDir, sortKey]);

  const draftPreview = deriveBooking(makeBookingPayload(formValues, bookings.length), bookings.length, []);

  const refreshBookings = () => {
    setBookings(getBookings());
    setPayments(getPayments());
  };

  const updateForm = (key, value) => {
    setFormValues((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setFormValues(EMPTY_FORM);
  };

  const handleSaveBooking = () => {
    if (!formValues.passenger_name || !formValues.pnr || !formValues.airline || !formValues.fare_sold) {
      alert('Passenger name, airline, PNR, and fare sold are required.');
      return;
    }

    saveBooking(makeBookingPayload(formValues, bookings.length));
    refreshBookings();
    resetForm();
    setPdfStatus('');
    setCrypticText('');
    setActiveTab('LIST');
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDir('asc');
  };

  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resetFilters = () => {
    setSearch('');
    setAirlineFilter('');
    setPaymentFilter('');
    setAlertFilter('');
  };

  const exportCSV = () => {
    const header = [...activeColumns.map((column) => column.label), 'PNR_N'];
    const rows = filteredBookings.map((booking) => [
      ...activeColumns.map((column) => formatCell(booking, column.key)),
      booking.pnr_n,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `booking-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyParsedFields = (parsed) => {
    setFormValues((current) => ({
      ...current,
      passenger_name: parsed.passenger_name?.value || current.passenger_name,
      airline: parsed.airline?.value || current.airline,
      pnr: parsed.pnr?.value || current.pnr,
      ticket_no: parsed.ticket_no?.value || current.ticket_no,
      fare_sold: parsed.fare_sold?.value || current.fare_sold,
      fare_issued: parsed.fare_issued?.value || current.fare_issued,
      sector: parsed.sector?.value || current.sector,
      outbound_date: parsed.outbound_date?.value || current.outbound_date,
      inbound_date: parsed.inbound_date?.value || current.inbound_date,
    }));
  };

  const handlePdfUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setPdfStatus('processing');

    try {
      const text = await extractTextFromPDF(file);
      applyParsedFields(parseTicketData(text));
      setPdfStatus('success');
    } catch (err) {
      console.error(err);
      setPdfStatus('error');
    }
  };

  const handleCrypticParse = () => {
    applyParsedFields(parseTicketData(crypticText));
    setActiveTab('ADD');
  };

  const renderBookingForm = () => (
    <div className="grid-2 booking-entry-grid">
      <div className="card">
        <h3>Manual Booking Fields</h3>
        <div className="booking-form-grid">
          {FORM_FIELDS.map((field) => (
            <label key={field.key} className={field.input === 'textarea' ? 'span-2' : ''}>
              <span>{field.label}{field.required ? ' *' : ''}</span>
              {field.input === 'select' ? (
                <select value={formValues[field.key]} onChange={(event) => updateForm(field.key, event.target.value)}>
                  {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : field.input === 'textarea' ? (
                <textarea value={formValues[field.key]} onChange={(event) => updateForm(field.key, event.target.value)} rows={4} />
              ) : field.input === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={formValues[field.key]}
                  onChange={(event) => updateForm(field.key, event.target.checked)}
                />
              ) : (
                <input
                  type={field.input || 'text'}
                  value={formValues[field.key]}
                  placeholder={field.placeholder}
                  onChange={(event) => updateForm(field.key, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" type="button" onClick={resetForm}>Clear</button>
          <button className="btn btn-primary" type="button" onClick={handleSaveBooking}>Save Booking</button>
        </div>
      </div>

      <div className="card auto-preview-card">
        <h3>Auto Calculated Fields</h3>
        <div className="auto-preview-list">
          {TABLE_COLUMNS.filter((column) => column.type === 'auto').map((column) => (
            <div key={column.key}>
              <span>{column.label}</span>
              <strong>{formatCell(draftPreview, column.key)}</strong>
            </div>
          ))}
          <div>
            <span>PNR_N (Hidden)</span>
            <strong>{draftPreview.pnr_n || '-'}</strong>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Bookings</h1>
          <p>Canonical booking ledger with manual fields, auto calculations, PDF extraction, and cryptic entry.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className={`btn ${activeTab === 'ADD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('ADD')}>
            <Plus size={16} /> Manual
          </button>
          <button className={`btn ${activeTab === 'CRYPTIC' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('CRYPTIC')}>
            <FileText size={16} /> Cryptic
          </button>
          <button className={`btn ${activeTab === 'UPLOAD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('UPLOAD')}>
            <UploadCloud size={16} /> Upload PDF
          </button>
          <button className={`btn ${activeTab === 'LIST' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('LIST')}>
            List
          </button>
        </div>
      </header>

      {activeTab === 'LIST' && (
        <>
          <div className="card booking-controls">
            <div className="booking-filter-grid compact">
              <label>
                <span>Search</span>
                <div className="field-with-icon">
                  <Search size={17} />
                  <input
                    type="text"
                    placeholder="Invoice, PNR, passenger, ticket, sector..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>Airline</span>
                <select value={airlineFilter} onChange={(event) => setAirlineFilter(event.target.value)}>
                  <option value="">All airlines</option>
                  {filterOptions.airlines.map((airline) => <option key={airline} value={airline}>{airline}</option>)}
                </select>
              </label>
              <label>
                <span>Payment</span>
                <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
                  <option value="">All payments</option>
                  {filterOptions.paymentStatuses.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Alert</span>
                <select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}>
                  <option value="">All alerts</option>
                  {filterOptions.alerts.map((alert) => <option key={alert} value={alert}>{alert.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
            </div>

            <div className="booking-table-actions">
              <div className="table-meta">
                <span><strong>{filteredBookings.length}</strong> of <strong>{normalizedBookings.length}</strong> bookings</span>
                <span>{activeColumns.length} visible columns, `PNR_N` hidden in app</span>
              </div>
              <div className="booking-action-group">
                <button className="btn btn-secondary btn-sm" type="button" onClick={resetFilters}>Reset</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowColumns((value) => !value)}>
                  <SlidersHorizontal size={15} />
                  Columns
                </button>
                <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
                  <Download size={15} />
                  Export
                </button>
              </div>
            </div>

            {showColumns && (
              <div className="column-panel">
                {TABLE_COLUMNS.map((column) => (
                  <label key={column.key}>
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(column.key)}
                      onChange={() => toggleColumn(column.key)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="card table-card">
            <div className="table-scroll">
              <table className="data-table dense-table booking-ledger-table">
                <thead>
                  <tr>
                    {activeColumns.map((column) => (
                      <th key={column.key}>
                        <button type="button" onClick={() => handleSort(column.key)}>
                          {column.label}
                          <ArrowUpDown size={13} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBookings.map((booking) => (
                    <tr key={booking.id}>
                      {activeColumns.map((column) => (
                        <td key={column.key} title={formatCell(booking, column.key)}>
                          {column.key === 'payment_status' || column.key === 'alert' || column.key === 'ticket_status' ? (
                            <span className={`badge ${String(booking[column.key]).toLowerCase()}`}>
                              {formatCell(booking, column.key)}
                            </span>
                          ) : column.key === 'refund_flag' ? (
                            <input type="checkbox" checked={booking.refund_flag} readOnly />
                          ) : column.key === 'pax_type' ? (
                            <span className={`pax-chip ${booking.pax_type.toLowerCase()}`}>
                              {formatCell(booking, column.key)}
                            </span>
                          ) : (
                            formatCell(booking, column.key)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filteredBookings.length === 0 && (
                    <tr>
                      <td colSpan={activeColumns.length} className="empty-table-cell">No bookings found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'ADD' && renderBookingForm()}

      {activeTab === 'CRYPTIC' && (
        <div className="grid-2">
          <div className="card">
            <h3>Cryptic / Raw Booking Entry</h3>
            <p style={{ color: 'var(--zinc-500)', marginBottom: 16 }}>
              Paste airline, email, WhatsApp, or GDS-style text. Parsed values populate the same manual booking form.
            </p>
            <textarea
              className="cryptic-textarea"
              value={crypticText}
              onChange={(event) => setCrypticText(event.target.value)}
              placeholder="Paste raw booking details here..."
            />
            <div className="form-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setCrypticText('')}>Clear</button>
              <button className="btn btn-primary" type="button" onClick={handleCrypticParse}>Parse to Manual Form</button>
            </div>
          </div>
          <div className="card auto-preview-card">
            <h3>Target Schema</h3>
            <div className="schema-list">
              {FORM_FIELDS.map((field) => <span key={field.key}>{field.label}</span>)}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'UPLOAD' && (
        <div className="grid-2">
          <div className="card">
            <h3>Upload Ticket PDF</h3>
            <p style={{ color: 'var(--zinc-500)', marginBottom: 20 }}>
              Upload a PDF ticket. Extracted values populate the same manual booking fields before saving.
            </p>
            <div className="upload-dropzone" onClick={() => document.getElementById('pdfInput').click()}>
              <UploadCloud size={48} color="var(--zinc-400)" style={{ marginBottom: 10 }} />
              <h4>Click or Drag & Drop PDF</h4>
              <p>Only .pdf files are supported</p>
              <input id="pdfInput" type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handlePdfUpload} />
            </div>
            {pdfStatus === 'processing' && <p style={{ marginTop: 20, color: 'var(--coral)' }}>Extracting text... please wait.</p>}
            {pdfStatus === 'success' && <p style={{ marginTop: 20, color: 'var(--success)' }}>Extracted values were added to the manual form.</p>}
            {pdfStatus === 'error' && <p style={{ marginTop: 20, color: '#FF3B30' }}>Failed to extract data. Is it a valid PDF?</p>}
          </div>
          {renderBookingForm()}
        </div>
      )}
    </div>
  );
}
