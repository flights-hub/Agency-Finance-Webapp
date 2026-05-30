import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getBookings, getPayments, saveBooking, savePayment } from '../helpers/storage';
import {
  PAYMENT_MODES,
  createPaymentEntry,
  daysBetween,
  getAlertLevel,
  getBookingLedger,
  getPaymentStatus,
} from '../helpers/calculations';
import { extractTextFromPDF } from '../helpers/pdfParser';
import { api } from '../helpers/api';
import { useAuth } from '../AuthContext';
import { canCreateBookings, canExport, filterBookingsForUser, filterRecordsForUser } from '../helpers/access';
import { AIRLINES } from '../data/airlines';
import { AIRPORTS } from '../data/airports';
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

const PAX_TYPES = [
  ['ADT', 'Adult'],
  ['CHD', 'Child'],
  ['INF', 'Infant'],
];

const PAX_LABELS = Object.fromEntries(PAX_TYPES);

const pricingRowId = (type, index) => `${type}-${index + 1}`;

const createPricingRow = (type = 'ADT', index = 0, values = {}) => ({
  id: values.id || pricingRowId(type, index),
  pax_type: type,
  passenger_name: '',
  ticket_no: '',
  buying_price: '',
  selling_price: '',
  ...values,
});

const EMPTY_FORM = {
  booking_date: new Date().toISOString().split('T')[0],
  bill_to_type: 'AGENT',
  bill_to_name: '',
  custom_bill_to_name: '',
  trip_type: 'ONE_WAY',
  departure_city: '',
  arrival_city: '',
  onward_date: '',
  return_date: '',
  supplier_mode: 'SINGLE',
  supplier_name: '',
  supplier_pnr: '',
  amount_paid: '',
  payment_mode: 'CASH',
  passengers: {
    ADT: 1,
    CHD: 0,
    INF: 0,
  },
  pricing_rows: [createPricingRow('ADT', 0)],
  supplier_segments: [
    { id: 'onward', label: 'Onward', supplier_name: '', pnr: '', buying_price: '' },
  ],
  flight_segments: [
    {
      id: 'onward',
      label: 'Onward',
      connections: [
        {
          id: 'onward-1',
          airline: '',
          flight_number: '',
          departure_city: '',
          arrival_city: '',
          departure_date: '',
          arrival_date: '',
          departure_time: '',
          arrival_time: '',
          departure_terminal: '',
          arrival_terminal: '',
          duration: '',
          check_in_baggage: '',
          cabin_baggage: '',
        },
      ],
    },
  ],
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

const TRIP_TYPES = [
  ['ONE_WAY', 'One Way'],
  ['ROUNDTRIP', 'Roundtrip'],
  ['MULTICITY', 'Multicity'],
];

const createConnection = (segmentId, index = 0) => ({
  id: `${segmentId}-${Date.now()}-${index}`,
  airline: '',
  flight_number: '',
  departure_city: '',
  arrival_city: '',
  departure_date: '',
  arrival_date: '',
  departure_time: '',
  arrival_time: '',
  departure_terminal: '',
  arrival_terminal: '',
  duration: '',
  check_in_baggage: '',
  cabin_baggage: '',
});

const createFlightSegment = (label, id = label.toLowerCase().replace(/\s+/g, '-')) => ({
  id,
  label,
  connections: [createConnection(id)],
});

const createSupplierSegment = (label, id = label.toLowerCase().replace(/\s+/g, '-')) => ({
  id,
  label,
  supplier_name: '',
  pnr: '',
  buying_price: '',
});

function normalizeParsedAirport(value) {
  const code = parseAirportCode(value);
  return code || value || '';
}

function normalizeParsedAirline(value) {
  return String(value || '').trim().toUpperCase();
}

function parsedConnection(segment, index) {
  return withAutoDuration({
    id: `parsed-${index + 1}`,
    airline: normalizeParsedAirline(segment.airline),
    flight_number: segment.flight_number || '',
    departure_city: normalizeParsedAirport(segment.departure_city),
    arrival_city: normalizeParsedAirport(segment.arrival_city),
    departure_date: segment.departure_date || '',
    arrival_date: segment.arrival_date || segment.departure_date || '',
    departure_time: segment.departure_time || '',
    arrival_time: segment.arrival_time || '',
    departure_terminal: segment.departure_terminal || '',
    arrival_terminal: segment.arrival_terminal || '',
    duration: '',
    check_in_baggage: segment.check_in_baggage || '',
    cabin_baggage: segment.cabin_baggage || '',
  });
}

function splitConnectionsByTrip(connections, tripType) {
  if (tripType !== 'ROUNDTRIP' || connections.length < 2) {
    return [{ id: 'onward', label: 'Onward', connections }];
  }

  const firstDeparture = connections[0].departure_city;
  const lastArrival = connections[connections.length - 1]?.arrival_city;
  const routeCities = [firstDeparture, ...connections.map((connection) => connection.arrival_city)].filter(Boolean);
  let returnIndex = -1;

  if (routeCities.length === connections.length + 1 && lastArrival === firstDeparture) {
    for (let index = 1; index < routeCities.length - 1; index += 1) {
      const outboundPath = routeCities.slice(0, index);
      const returnPath = routeCities.slice(index + 1);
      if (returnPath.join('|') === outboundPath.reverse().join('|')) {
        returnIndex = index;
        break;
      }
    }
  }

  if (returnIndex < 0) {
    returnIndex = connections.findIndex((connection, index) => (
      index > 0 && connection.arrival_city === firstDeparture
    ));
  }

  if (returnIndex <= 0) return [{ id: 'onward', label: 'Onward', connections }];

  return [
    { id: 'onward', label: 'Onward', connections: connections.slice(0, returnIndex) },
    { id: 'return', label: 'Return', connections: connections.slice(returnIndex) },
  ];
}

function parsedCounts(passengers) {
  return PAX_TYPES.reduce((result, [type]) => ({
    ...result,
    [type]: Math.max(type === 'ADT' ? 1 : 0, passengers.filter((passenger) => (passenger.pax_type || 'ADT') === type).length),
  }), {});
}

function pricingRowsFromCounts(passengerCounts, currentRows = []) {
  return PAX_TYPES.flatMap(([type]) => {
    const count = Math.max(0, Number(passengerCounts[type] || 0));
    const existingRows = currentRows.filter((row) => row.pax_type === type);

    return Array.from({ length: count }, (_, index) => createPricingRow(type, index, existingRows[index]));
  });
}

function pricingRowsFromParsedPassengers(passengers, drafts, currentRows = []) {
  const byName = new Map(
    drafts
      .filter((draft) => draft.passenger_name)
      .map((draft) => [draft.passenger_name, draft]),
  );
  const typeIndexes = {};

  return passengers.map((passenger, index) => {
    const type = passenger.pax_type || 'ADT';
    const typeIndex = typeIndexes[type] || 0;
    typeIndexes[type] = typeIndex + 1;
    const draft = byName.get(passenger.passenger_name) || drafts[index] || {};
    const current = currentRows.filter((row) => row.pax_type === type)[typeIndex] || {};
    const buyingPrice = passenger.fare_issued || draft.buying_price_per_pax || draft.fare_issued || current.buying_price || '';

    return createPricingRow(type, typeIndex, {
      passenger_name: passenger.passenger_name || draft.passenger_name || current.passenger_name || '',
      ticket_no: passenger.ticket_no || draft.ticket_no || current.ticket_no || '',
      buying_price: buyingPrice ? String(buyingPrice) : '',
      selling_price: current.selling_price || draft.selling_price_per_pax || '',
    });
  });
}

function hasUsefulPdfDetails(result) {
  const firstDraft = result.drafts?.[0] || {};
  const firstSegment = result.raw?.segments?.[0] || {};
  return Boolean(
    firstDraft.ticket_no
    || firstDraft.airline
    || firstDraft.sector
    || firstDraft.outbound_date
    || firstSegment.airline
    || firstSegment.flight_number
    || firstSegment.departure_city
    || firstSegment.arrival_city
  );
}

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

const CRYPTIC_DRAFT_FIELDS = [
  { key: 'passenger_name', label: 'Passenger Name', required: true },
  { key: 'pnr', label: 'PNR', required: true },
  { key: 'airline', label: 'Airline', required: true },
  { key: 'sector', label: 'Sector' },
  { key: 'outbound_date', label: 'Outbound Date', input: 'date' },
  { key: 'inbound_date', label: 'Inbound Date', input: 'date' },
  { key: 'fare_sold', label: 'Fare Sold', input: 'number', required: true },
  { key: 'fare_issued', label: 'Fare Issued', input: 'number' },
  { key: 'ticket_no', label: 'Ticket No' },
  { key: 'booked_by', label: 'Booked By' },
  { key: 'agent_issued_by', label: 'Agent Issued By' },
  { key: 'remarks', label: 'Remarks' },
];

const moneyKeys = new Set(['fare_sold', 'fare_issued', 'profit', 'total_paid', 'balance_due']);
const durationInputKeys = new Set(['departure_city', 'arrival_city', 'departure_date', 'departure_time', 'arrival_time']);
const AIRPORT_TIMEZONES = {
  ATQ: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata',
  DEL: 'Asia/Kolkata',
  DXB: 'Asia/Dubai',
  FCO: 'Europe/Rome',
  JFK: 'America/New_York',
  LHR: 'Europe/London',
  MXP: 'Europe/Rome',
  ROM: 'Europe/Rome',
  SIN: 'Asia/Singapore',
  VCE: 'Europe/Rome',
};
const DATE_PATTERNS = [
  /(?:^|\D)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/,
  /(?:^|\D)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\D|$)/,
  /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/,
  /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/,
];
const TIME_PATTERN = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/;
const AIRPORT_CODE_PATTERN = /\b[A-Z]{3}\b/;
const MONTH_LOOKUP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function numeric(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeDateParts(year, month, day) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseDateParts(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let match = raw.match(DATE_PATTERNS[0]);
  if (match) return normalizeDateParts(Number(match[1]), Number(match[2]), Number(match[3]));

  match = raw.match(DATE_PATTERNS[1]);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    return normalizeDateParts(year, month, day);
  }

  match = raw.match(DATE_PATTERNS[2]);
  if (match) return normalizeDateParts(Number(match[3]), MONTH_LOOKUP[match[2].toLowerCase()], Number(match[1]));

  match = raw.match(DATE_PATTERNS[3]);
  if (match) return normalizeDateParts(Number(match[3]), MONTH_LOOKUP[match[1].toLowerCase()], Number(match[2]));

  return null;
}

function parseTimeParts(value) {
  const match = String(value || '').match(TIME_PATTERN);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function parseAirportCode(value) {
  const raw = String(value || '').toUpperCase();
  const parenthesizedCode = raw.match(/\(([A-Z]{3})\)/);
  if (parenthesizedCode) return parenthesizedCode[1];

  const match = raw.match(AIRPORT_CODE_PATTERN);
  return match ? match[0] : '';
}

function getTimeZoneParts(timeZone, utcMillis) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMillis));

  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
}

function zonedDateTimeToUtc(date, time, timeZone) {
  const targetUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  let utcMillis = targetUtc;

  for (let index = 0; index < 4; index += 1) {
    const parts = getTimeZoneParts(timeZone, utcMillis);
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const nextUtcMillis = utcMillis + (targetUtc - zonedAsUtc);
    if (nextUtcMillis === utcMillis) break;
    utcMillis = nextUtcMillis;
  }

  return utcMillis;
}

function addDays(date, days) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function calculateConnectionDuration(connection) {
  const departureDate = parseDateParts(connection.departure_date);
  const departureTime = parseTimeParts(connection.departure_time);
  const arrivalTime = parseTimeParts(connection.arrival_time);
  const departureCode = parseAirportCode(connection.departure_city);
  const arrivalCode = parseAirportCode(connection.arrival_city);
  const departureZone = AIRPORT_TIMEZONES[departureCode];
  const arrivalZone = AIRPORT_TIMEZONES[arrivalCode];

  if (
    !departureDate
    || !departureTime
    || !arrivalTime
    || !departureZone
    || !arrivalZone
    || departureCode === arrivalCode
  ) {
    return '';
  }

  const departureUtc = zonedDateTimeToUtc(departureDate, departureTime, departureZone);
  let arrivalUtc = zonedDateTimeToUtc(departureDate, arrivalTime, arrivalZone);

  while (arrivalUtc <= departureUtc) {
    arrivalUtc = zonedDateTimeToUtc(addDays(departureDate, 1), arrivalTime, arrivalZone);
  }

  const totalMinutes = Math.round((arrivalUtc - departureUtc) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function withAutoDuration(connection) {
  return {
    ...connection,
    duration: calculateConnectionDuration(connection),
  };
}

function invoiceNumber(index) {
  return `INV-${String(index + 1).padStart(5, '0')}`;
}

function normalizePnr(value = '') {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normalizeAirportQuery(value = '') {
  return value.trim().toLowerCase();
}

function getAirportMatches(value, limit = 8) {
  const query = normalizeAirportQuery(value);
  if (!query) return AIRPORTS.slice(0, limit);

  return AIRPORTS
    .map((airport) => {
      const code = airport.code.toLowerCase();
      const city = airport.city.toLowerCase();
      const name = airport.name.toLowerCase();
      let rank = 99;

      if (code === query) rank = 0;
      else if (city === query) rank = 1;
      else if (code.startsWith(query)) rank = 2;
      else if (city.startsWith(query)) rank = 3;
      else if (name.includes(query)) rank = 4;
      else if (airport.search.includes(query)) rank = 5;

      return { airport, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.airport.city.localeCompare(b.airport.city) || a.airport.code.localeCompare(b.airport.code))
    .slice(0, limit)
    .map((item) => item.airport);
}

function normalizeAirlineQuery(value = '') {
  return value.trim().toLowerCase();
}

function getAirlineMatches(value, limit = 8) {
  const query = normalizeAirlineQuery(value);
  if (!query) return AIRLINES.slice(0, limit);

  return AIRLINES
    .map((airline) => {
      const code = airline.code.toLowerCase();
      const name = airline.airlineName.toLowerCase();
      const alliance = airline.alliance.toLowerCase();
      const hubAirports = airline.hubAirports.toLowerCase();
      let rank = 99;

      if (code === query) rank = 0;
      else if (name === query) rank = 1;
      else if (code.startsWith(query)) rank = 2;
      else if (name.startsWith(query)) rank = 3;
      else if (name.includes(query)) rank = 4;
      else if (alliance.includes(query) || hubAirports.includes(query)) rank = 5;
      else if (airline.search.includes(query)) rank = 6;

      return { airline, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((a, b) => (
      a.rank - b.rank
      || Number(b.airline.isActive) - Number(a.airline.isActive)
      || a.airline.airlineName.localeCompare(b.airline.airlineName)
      || a.airline.code.localeCompare(b.airline.code)
    ))
    .slice(0, limit)
    .map((item) => item.airline);
}

function AirportAutocomplete({ label, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const matches = getAirportMatches(value);

  const selectAirport = (airport) => {
    onChange(airport.label);
    setIsOpen(false);
  };

  return (
    <label className="airport-autocomplete-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        autoComplete="off"
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
      />
      {isOpen && matches.length > 0 && (
        <div className="airport-suggestions" role="listbox">
          {matches.map((airport) => (
            <button
              key={airport.code}
              type="button"
              className="airport-suggestion"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectAirport(airport)}
            >
              <strong>{airport.label}</strong>
              <span>{airport.detail}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function AirlineAutocomplete({ label, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const matches = getAirlineMatches(value);

  const selectAirline = (airline) => {
    onChange(airline.label);
    setIsOpen(false);
  };

  return (
    <label className="airport-autocomplete-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        autoComplete="off"
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
      />
      {isOpen && matches.length > 0 && (
        <div className="airport-suggestions" role="listbox">
          {matches.map((airline) => (
            <button
              key={`${airline.code}-${airline.airlineName}-${airline.detail}`}
              type="button"
              className="airport-suggestion"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectAirline(airline)}
            >
              <strong>{airline.label}</strong>
              <span>{airline.detail || airline.code}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
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
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const allowBookingEntry = canCreateBookings(user);
  const allowExport = canExport(user);
  const [activeTab, setActiveTab] = useState('LIST');
  const [bookings, setBookings] = useState(() => getBookings());
  const [payments, setPayments] = useState(() => getPayments());
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [usersNotice, setUsersNotice] = useState('');
  const [formValues, setFormValues] = useState(EMPTY_FORM);
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [airlineFilter, setAirlineFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [alertFilter, setAlertFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(DEFAULT_COLUMNS));
  const [sortKey, setSortKey] = useState('sl');
  const [sortDir, setSortDir] = useState('asc');
  const [pdfStatus, setPdfStatus] = useState('');
  const [crypticText, setCrypticText] = useState('');
  const [crypticProvider, setCrypticProvider] = useState('auto');
  const [crypticStatus, setCrypticStatus] = useState('idle');
  const [crypticError, setCrypticError] = useState('');
  const [crypticWarnings, setCrypticWarnings] = useState([]);
  const [crypticMeta, setCrypticMeta] = useState(null);
  const [crypticDrafts, setCrypticDrafts] = useState([]);

  useEffect(() => {
    const query = searchParams.get('search');
    if (query !== null) {
      setSearch(query);
      setActiveTab('LIST');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!allowBookingEntry && activeTab !== 'LIST') {
      setActiveTab('LIST');
    }
  }, [activeTab, allowBookingEntry]);

  useEffect(() => {
    if (!allowBookingEntry) return;

    let isMounted = true;
    setUsersNotice('');
    api.listUsers()
      .then((data) => {
        if (!isMounted) return;
        setRegisteredUsers(data.users || []);
      })
      .catch((error) => {
        if (!isMounted) return;
        setRegisteredUsers([]);
        setUsersNotice(`Registered agents and suppliers could not be loaded: ${error.message}`);
      });

    return () => {
      isMounted = false;
    };
  }, [allowBookingEntry]);

  const scopedBookings = useMemo(() => filterBookingsForUser(user, bookings), [bookings, user]);
  const scopedPayments = useMemo(
    () => filterRecordsForUser(user, payments, 'payments', { bookings: scopedBookings }),
    [payments, scopedBookings, user],
  );
  const normalizedBookings = useMemo(
    () => getBookingLedger(scopedBookings, scopedPayments),
    [scopedBookings, scopedPayments],
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

  const agentOptions = useMemo(
    () => registeredUsers
      .filter((item) => item.role === 'AGENT' && item.status !== 'SUSPENDED')
      .map((item) => item.name || item.email)
      .filter(Boolean),
    [registeredUsers],
  );

  const supplierOptions = useMemo(
    () => registeredUsers
      .filter((item) => item.role === 'SUPPLIER' && item.status !== 'SUSPENDED')
      .map((item) => item.name || item.email)
      .filter(Boolean),
    [registeredUsers],
  );

  const employeeOptions = useMemo(() => {
    const staffRoles = new Set(['ADMIN', 'EMPLOYEE']);
    const userEmployees = registeredUsers
      .filter((item) => staffRoles.has(item.role) && item.status !== 'SUSPENDED')
      .map((item) => item.name || item.email)
      .filter(Boolean);
    const bookingEmployees = bookings.flatMap((booking) => [booking.booked_by, booking.agent_issued_by]).filter(Boolean);
    return [...new Set([...userEmployees, ...bookingEmployees])];
  }, [bookings, registeredUsers]);

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

  const updateRouteAirport = (key, value) => {
    setFormValues((current) => {
      const flightSegments = current.flight_segments.map((segment, segmentIndex) => {
        const isDeparture = key === 'departure_city' && segmentIndex === 0;
        const isArrival = key === 'arrival_city' && segmentIndex === current.flight_segments.length - 1;
        if (!isDeparture && !isArrival) return segment;

        const targetConnectionIndex = isDeparture ? 0 : segment.connections.length - 1;
        return {
          ...segment,
          connections: segment.connections.map((connection, connectionIndex) => (
            connectionIndex === targetConnectionIndex ? withAutoDuration({ ...connection, [key]: value }) : connection
          )),
        };
      });

      return { ...current, [key]: value, flight_segments: flightSegments };
    });
  };

  const segmentTemplatesForTrip = (tripType) => {
    if (tripType === 'ROUNDTRIP') return [
      createFlightSegment('Onward', 'onward'),
      createFlightSegment('Return', 'return'),
    ];
    return [createFlightSegment('Onward', 'onward')];
  };

  const supplierSegmentsForTrip = (tripType) => {
    if (tripType === 'ROUNDTRIP') return [
      createSupplierSegment('Onward', 'onward'),
      createSupplierSegment('Return', 'return'),
    ];
    return [createSupplierSegment('Onward', 'onward')];
  };

  const updateTripType = (tripType) => {
    setFormValues((current) => ({
      ...current,
      trip_type: tripType,
      return_date: tripType === 'ONE_WAY' ? '' : current.return_date,
      supplier_mode: tripType === 'ONE_WAY' ? 'SINGLE' : current.supplier_mode,
      flight_segments: tripType === 'MULTICITY' ? segmentTemplatesForTrip('ONE_WAY') : segmentTemplatesForTrip(tripType),
      supplier_segments: tripType === 'MULTICITY' ? supplierSegmentsForTrip('ONE_WAY') : supplierSegmentsForTrip(tripType),
    }));
  };

  const updatePassengerCount = (type, value) => {
    setFormValues((current) => {
      const passengers = {
        ...current.passengers,
        [type]: Math.max(0, Number(value || 0)),
      };

      return {
        ...current,
        passengers,
        pricing_rows: pricingRowsFromCounts(passengers, current.pricing_rows || []),
      };
    });
  };

  const updatePricingRow = (rowId, key, value) => {
    setFormValues((current) => ({
      ...current,
      pricing_rows: (current.pricing_rows || []).map((row) => (
        row.id === rowId ? { ...row, [key]: value } : row
      )),
    }));
  };

  const updateFlightSegment = (segmentIndex, connectionIndex, key, value) => {
    setFormValues((current) => ({
      ...current,
      flight_segments: current.flight_segments.map((segment, index) => (
        index !== segmentIndex ? segment : {
          ...segment,
          connections: segment.connections.map((connection, cIndex) => {
            if (cIndex !== connectionIndex || key === 'duration') return connection;
            const nextConnection = { ...connection, [key]: value };
            return durationInputKeys.has(key) ? withAutoDuration(nextConnection) : nextConnection;
          }),
        }
      )),
    }));
  };

  const addConnection = (segmentIndex) => {
    setFormValues((current) => ({
      ...current,
      flight_segments: current.flight_segments.map((segment, index) => (
        index !== segmentIndex ? segment : {
          ...segment,
          connections: [...segment.connections, createConnection(segment.id, segment.connections.length)],
        }
      )),
    }));
  };

  const addMulticityLeg = () => {
    setFormValues((current) => {
      const nextNumber = current.flight_segments.length + 1;
      const id = `leg-${nextNumber}`;
      return {
        ...current,
        flight_segments: [...current.flight_segments, createFlightSegment(`Leg ${nextNumber}`, id)],
        supplier_segments: [...current.supplier_segments, createSupplierSegment(`Leg ${nextNumber}`, id)],
      };
    });
  };

  const updateSupplierSegment = (segmentIndex, key, value) => {
    setFormValues((current) => ({
      ...current,
      supplier_segments: current.supplier_segments.map((segment, index) => (
        index === segmentIndex ? { ...segment, [key]: value } : segment
      )),
    }));
  };

  const resetForm = () => {
    setFormValues(EMPTY_FORM);
  };

  const applyParsedBookingToManualForm = (result, source) => {
    const drafts = result.drafts || [];
    const passengers = result.raw?.passengers?.length
      ? result.raw.passengers
      : drafts.map((draft) => ({
        passenger_name: draft.passenger_name,
        pax_type: draft.pax_type || 'ADT',
        ticket_no: draft.ticket_no || '',
        fare_issued: draft.fare_issued || draft.buying_price_per_pax || '',
        mobile: draft.mobile || '',
        contact_email: draft.contact_email || '',
      }));
    const segments = result.raw?.segments || [];
    const firstDraft = drafts[0] || {};
    const firstSegment = segments[0] || {};
    const parsedTripType = firstDraft.trip_type || (firstDraft.inbound_date ? 'ROUNDTRIP' : 'ONE_WAY');
    const tripType = parsedTripType === 'RT' ? 'ROUNDTRIP' : parsedTripType;
    const connections = segments.length
      ? segments.map((segment, index) => parsedConnection(segment, index))
      : (firstDraft.flight_segments || []).flatMap((segment) => (
        (segment.connections || []).map((connection, index) => parsedConnection(connection, index))
      ));
    const flightSegments = connections.length ? splitConnectionsByTrip(connections, tripType) : EMPTY_FORM.flight_segments;
    const firstConnection = flightSegments[0]?.connections[0] || {};
    const lastSegment = flightSegments[flightSegments.length - 1] || flightSegments[0];
    const lastConnection = lastSegment?.connections[lastSegment.connections.length - 1] || firstConnection;
    const sectorParts = String(firstDraft.sector || '').split('-').map((part) => part.trim()).filter(Boolean);
    const parsedDeparture = firstSegment.departure_city || firstConnection.departure_city || sectorParts[0] || firstDraft.departure_city;
    const routeArrivalConnection = tripType === 'ROUNDTRIP'
      ? flightSegments[0]?.connections[flightSegments[0].connections.length - 1] || lastConnection
      : lastConnection;
    const parsedArrival = routeArrivalConnection.arrival_city || firstSegment.arrival_city || sectorParts[1] || firstDraft.arrival_city;
    const supplierName = firstDraft.supplier_name || result.raw?.supplierName || '';
    const supplierPnr = firstDraft.pnr || result.meta?.pnr || result.raw?.pnr || '';
    const remarks = [
      firstDraft.remarks,
      source === 'PDF' ? 'Parsed from ticket PDF' : 'Parsed from cryptic PNR',
      result.warnings?.length ? `Warnings: ${result.warnings.join(', ')}` : '',
    ].filter(Boolean).join(' | ');

    setFormValues((current) => ({
      ...current,
      booking_date: firstDraft.booking_date || current.booking_date,
      trip_type: tripType || current.trip_type,
      departure_city: normalizeParsedAirport(parsedDeparture),
      arrival_city: normalizeParsedAirport(parsedArrival),
      onward_date: firstConnection.departure_date || firstDraft.outbound_date || current.onward_date,
      return_date: tripType === 'ONE_WAY' ? '' : (firstDraft.inbound_date || current.return_date),
      supplier_mode: 'SINGLE',
      supplier_name: supplierName || current.supplier_name,
      supplier_pnr: supplierPnr || current.supplier_pnr,
      passengers: parsedCounts(passengers),
      pricing_rows: pricingRowsFromParsedPassengers(passengers, drafts, current.pricing_rows || []),
      supplier_segments: [{ id: 'single', label: 'Single Supplier', supplier_name: supplierName, pnr: supplierPnr, buying_price: '' }],
      flight_segments: flightSegments,
      passenger_name: firstDraft.passenger_name || current.passenger_name,
      pax_type: firstDraft.pax_type || current.pax_type,
      mobile: firstDraft.mobile || passengers.find((passenger) => passenger.mobile)?.mobile || current.mobile,
      airline: firstDraft.airline || firstConnection.airline || current.airline,
      pnr: supplierPnr || current.pnr,
      ticket_no: firstDraft.ticket_no || current.ticket_no,
      sector: [normalizeParsedAirport(parsedDeparture), normalizeParsedAirport(parsedArrival)].filter(Boolean).join('-') || firstDraft.sector,
      outbound_date: firstConnection.departure_date || firstDraft.outbound_date || current.outbound_date,
      inbound_date: firstDraft.inbound_date || current.inbound_date,
      fare_issued: source === 'PDF' ? current.fare_issued : (firstDraft.fare_issued || current.fare_issued),
      buying_price_per_pax: source === 'PDF' ? current.buying_price_per_pax : (firstDraft.buying_price_per_pax || current.buying_price_per_pax),
      supplier: supplierName || current.supplier,
      remarks,
      parsed_passenger_rows: drafts,
    }));
  };

  const selectedBillTo = formValues.bill_to_name === '__CUSTOM__'
    ? formValues.custom_bill_to_name.trim()
    : formValues.bill_to_name.trim();

  const selectedPaxRows = (formValues.pricing_rows || []).map((row, index) => ({
    ...row,
    type: row.pax_type || 'ADT',
    label: PAX_LABELS[row.pax_type] || row.pax_type || `Passenger ${index + 1}`,
  }));

  const primarySupplierSegment = formValues.supplier_mode === 'MULTI'
    ? formValues.supplier_segments.find((segment) => segment.pnr || segment.supplier_name) || formValues.supplier_segments[0]
    : { supplier_name: formValues.supplier_name, pnr: formValues.supplier_pnr };

  const createManualBookingRows = () => {
    const primaryConnection = formValues.flight_segments[0]?.connections[0] || {};
    const lastSegment = formValues.flight_segments[formValues.flight_segments.length - 1];
    const lastConnection = lastSegment?.connections[lastSegment.connections.length - 1] || primaryConnection;
    const sector = [
      formValues.departure_city || primaryConnection.departure_city,
      formValues.arrival_city || lastConnection.arrival_city,
    ].filter(Boolean).join('-');
    const airline = primaryConnection.airline || '';
    const pnr = primarySupplierSegment?.pnr || '';
    const supplierName = primarySupplierSegment?.supplier_name || '';

    return selectedPaxRows.map((row, index) => {
      const fareSold = numeric(row.selling_price);
      const fareIssued = numeric(row.buying_price);
      return makeBookingPayload({
        ...formValues,
        passenger_name: row.passenger_name,
        pax_type: row.type,
        pax_count: 1,
        buying_price_per_pax: numeric(row.buying_price),
        selling_price_per_pax: numeric(row.selling_price),
        bill_to_type: formValues.bill_to_name === '__CUSTOM__' ? 'CUSTOMER' : 'AGENT',
        bill_to_name: selectedBillTo,
        booked_by: formValues.booked_by || selectedBillTo,
        airline,
        pnr,
        ticket_no: row.ticket_no.trim(),
        sector,
        outbound_date: formValues.onward_date || primaryConnection.departure_date,
        inbound_date: formValues.trip_type === 'ONE_WAY' ? '' : formValues.return_date,
        fare_sold: fareSold,
        fare_issued: fareIssued,
        supplier_name: supplierName,
        supplier: supplierName,
        supplier_segments: formValues.supplier_mode === 'MULTI'
          ? formValues.supplier_segments
          : [{ id: 'single', label: 'Single Supplier', supplier_name: supplierName, pnr, buying_price: '' }],
        flight_segments: formValues.flight_segments,
      }, bookings.length + index);
    });
  };

  const handleSaveBooking = () => {
    if (!selectedBillTo) {
      alert('Choose who this booking is billed to.');
      return;
    }

    if (!selectedPaxRows.length) {
      alert('Enter at least one passenger.');
      return;
    }

    const missingPax = selectedPaxRows.find((row) => !row.passenger_name || !numeric(row.buying_price) || !numeric(row.selling_price));
    if (missingPax) {
      alert(`Complete passenger name, buying price, and selling price for ${missingPax.label}.`);
      return;
    }

    if (!primarySupplierSegment?.supplier_name || !primarySupplierSegment?.pnr) {
      alert('Choose a supplier and enter a PNR.');
      return;
    }

    if (formValues.supplier_mode === 'MULTI') {
      const incompleteSupplier = formValues.supplier_segments.find((segment) => !segment.supplier_name || !segment.pnr);
      if (incompleteSupplier) {
        alert('Complete supplier and PNR for each journey section.');
        return;
      }
    }

    const firstConnection = formValues.flight_segments[0]?.connections[0];
    if (!firstConnection?.airline || !firstConnection?.flight_number || !firstConnection?.departure_city || !firstConnection?.arrival_city) {
      alert('Complete at least the first flight connection: airline, flight number, departure city, and arrival city.');
      return;
    }

    const bookingRows = createManualBookingRows();
    const savedRows = bookingRows.map((booking) => saveBooking(booking));

    if (numeric(formValues.amount_paid) > 0) {
      savePayment(createPaymentEntry({
        payment_date: formValues.booking_date,
        pnr: savedRows[0].pnr,
        amount_paid: numeric(formValues.amount_paid),
        payment_mode: formValues.payment_mode,
        receipt_ref: '',
        received_by: formValues.agent_issued_by || 'Finance Desk',
        remarks: formValues.remarks,
      }, [...bookings, ...savedRows], payments));
    }

    refreshBookings();
    resetForm();
    setPdfStatus('');
    setCrypticText('');
    setActiveTab('LIST');
  };

  const resetCrypticParse = () => {
    setCrypticDrafts([]);
    setCrypticWarnings([]);
    setCrypticMeta(null);
    setCrypticError('');
    setCrypticStatus('idle');
  };

  const switchBookingTab = (tab) => {
    if (tab !== 'LIST' && !allowBookingEntry) return;
    setActiveTab(tab);
    setCrypticError('');
    setCrypticWarnings([]);
    if (tab !== 'UPLOAD') setPdfStatus('');
    if (tab === 'CRYPTIC' || tab === 'UPLOAD') {
      setCrypticDrafts([]);
      setCrypticMeta(null);
    }
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
    if (!allowExport) return;
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

  const handlePdfUpload = async (event) => {
    if (!allowBookingEntry) return;
    const file = event.target.files[0];
    if (!file) return;

    setPdfStatus('processing');
    setCrypticError('');
    setCrypticWarnings([]);
    setCrypticDrafts([]);
    setCrypticMeta(null);

    try {
      const text = await extractTextFromPDF(file);
      if (!text.trim()) throw new Error('No selectable text was found in this PDF.');
      const result = await api.parseBookingText(text, 'PDF');
      setCrypticDrafts(result.drafts || []);
      setCrypticWarnings(result.warnings || []);
      applyParsedBookingToManualForm(result, 'PDF');
      console.info('PDF parser diagnostics', {
        meta: result.meta,
        warnings: result.warnings,
        raw: result.raw,
        textPreview: text.slice(0, 1200),
      });
      setCrypticMeta({
        source: result.meta?.source || 'PDF',
        provider: result.provider,
        confidence: result.confidence,
        count: result.drafts?.length || 0,
        pnr: result.meta?.pnr || '',
        ticketCount: result.meta?.ticketCount || 0,
      });
      if (!hasUsefulPdfDetails(result)) {
        setCrypticError('PDF parsed only passenger and PNR. Route, flight, or ticket details were not found in the extracted text.');
        setPdfStatus('error');
        return;
      }
      setPdfStatus('success');
    } catch (err) {
      console.error(err);
      setCrypticError(err.message || 'Unable to parse ticket PDF.');
      setPdfStatus('error');
    } finally {
      event.target.value = '';
    }
  };

  const handleCrypticParse = async () => {
    setCrypticError('');
    setCrypticWarnings([]);
    setCrypticDrafts([]);
    setCrypticMeta(null);
    setPdfStatus('');
    setCrypticStatus('processing');

    try {
      const result = await api.parseBookingText(crypticText, 'CRYPTIC', crypticProvider);
      setCrypticDrafts(result.drafts || []);
      setCrypticWarnings(result.warnings || []);
      applyParsedBookingToManualForm(result, 'CRYPTIC');
      setCrypticMeta({
        source: result.meta?.source || 'CRYPTIC',
        provider: result.provider,
        confidence: result.confidence,
        count: result.drafts?.length || 0,
        pnr: result.meta?.pnr || '',
        ticketCount: result.meta?.ticketCount || 0,
      });
      setCrypticStatus('success');
    } catch (err) {
      setCrypticDrafts([]);
      setCrypticMeta(null);
      setCrypticError(err.message || 'Unable to parse raw booking text.');
      setCrypticStatus('error');
    }
  };

  const updateCrypticDraft = (index, key, value) => {
    setCrypticDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, [key]: value } : draft
    )));
  };

  const draftMissingFields = (draft) => [
    !draft.passenger_name ? 'Passenger Name' : '',
    !draft.pnr ? 'PNR' : '',
    !draft.airline ? 'Airline' : '',
    !numeric(draft.fare_sold) ? 'Fare Sold' : '',
    ...(draft.validation?.blocking || []),
  ].filter(Boolean);

  const saveCrypticDrafts = () => {
    if (!allowBookingEntry) return;
    const invalidRows = crypticDrafts
      .map((draft, index) => ({ index, missing: draftMissingFields(draft) }))
      .filter((row) => row.missing.length);

    if (!crypticDrafts.length) {
      setCrypticError('Parse a PNR before saving draft rows.');
      return;
    }

    if (invalidRows.length) {
      setCrypticError(`Complete required fields before saving: ${invalidRows.map((row) => `row ${row.index + 1} (${row.missing.join(', ')})`).join('; ')}.`);
      return;
    }

    crypticDrafts.forEach((draft, index) => {
      saveBooking(makeBookingPayload(draft, bookings.length + index));
    });
    refreshBookings();
    setCrypticText('');
    resetCrypticParse();
    setActiveTab('LIST');
  };

  const renderParsedDraftReview = () => (
    <div className="card cryptic-review-card">
      <h3>Parsed Booking Drafts</h3>
      {crypticError && <div className="notice error">{crypticError}</div>}
      {crypticWarnings.length > 0 && (
        <div className="notice">
          {crypticWarnings.join(' ')}
        </div>
      )}
      {crypticDrafts.length > 0 ? (
        <>
          <div className="table-scroll">
            <table className="data-table dense-table draft-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {CRYPTIC_DRAFT_FIELDS.map((field) => (
                    <th key={field.key}>{field.label}{field.required ? ' *' : ''}</th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {crypticDrafts.map((draft, index) => {
                  const missing = [...new Set(draftMissingFields(draft))];
                  const warnings = draft.validation?.warnings || [];
                  return (
                    <tr key={`${draft.pnr}-${index}`}>
                      <td>{index + 1}</td>
                      {CRYPTIC_DRAFT_FIELDS.map((field) => (
                        <td key={field.key}>
                          <input
                            type={field.input || 'text'}
                            value={draft[field.key] ?? ''}
                            onChange={(event) => updateCrypticDraft(index, field.key, event.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        {missing.length ? (
                          <span className="badge overdue">{missing.join(', ')}</span>
                        ) : warnings.length ? (
                          <span className="badge warning">{warnings.join(', ')}</span>
                        ) : (
                          <span className="badge settled">Ready</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="btn btn-secondary" type="button" onClick={resetCrypticParse}>Discard Drafts</button>
            <button className="btn btn-primary" type="button" onClick={saveCrypticDrafts}>Save All Rows</button>
          </div>
        </>
      ) : (
        <p style={{ color: 'var(--zinc-500)', marginTop: 14 }}>
          Parsed rows will appear here for review before anything is saved.
        </p>
      )}
    </div>
  );

  const renderBookingForm = () => (
    <div className="manual-booking-stack">
      <div className="card manual-section-card">
        <div className="manual-section-head">
          <div>
            <h3>Manual Booking Entry</h3>
            <p>Billing, route, pricing, supplier, flight, and payment details.</p>
          </div>
        </div>
        {usersNotice && <div className="notice">{usersNotice}</div>}
        <div className="manual-grid">
          <label>
            <span>Bill To *</span>
            <select value={formValues.bill_to_name} onChange={(event) => updateForm('bill_to_name', event.target.value)}>
              <option value="">Select agent/customer</option>
              {agentOptions.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
              <option value="__CUSTOM__">Typed customer</option>
            </select>
          </label>
          {formValues.bill_to_name === '__CUSTOM__' && (
            <label>
              <span>Customer Name *</span>
              <input value={formValues.custom_bill_to_name} onChange={(event) => updateForm('custom_bill_to_name', event.target.value)} />
            </label>
          )}
          <label>
            <span>Booking Date</span>
            <input type="date" value={formValues.booking_date} onChange={(event) => updateForm('booking_date', event.target.value)} />
          </label>
          <div className="manual-trip-inline">
            {TRIP_TYPES.map(([value, label]) => (
              <label key={value}>
                <input type="radio" checked={formValues.trip_type === value} onChange={() => updateTripType(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card manual-section-card">
        <div className="manual-section-head">
          <h3>Route & Passengers</h3>
        </div>
        <div className="route-passenger-row">
          <AirportAutocomplete
            label="Departure City *"
            value={formValues.departure_city}
            onChange={(value) => updateRouteAirport('departure_city', value)}
          />
          <AirportAutocomplete
            label="Arrival City *"
            value={formValues.arrival_city}
            onChange={(value) => updateRouteAirport('arrival_city', value)}
          />
          <label>
            <span>Onward Date *</span>
            <input type="date" value={formValues.onward_date} onChange={(event) => updateForm('onward_date', event.target.value)} />
          </label>
          <label>
            <span>Return Date</span>
            <input
              type="date"
              value={formValues.return_date}
              disabled={formValues.trip_type === 'ONE_WAY'}
              onChange={(event) => updateForm('return_date', event.target.value)}
            />
          </label>
          {PAX_TYPES.map(([type, label]) => (
            <label key={type}>
              <span>{label}</span>
              <input type="number" min="0" value={formValues.passengers[type]} onChange={(event) => updatePassengerCount(type, event.target.value)} />
            </label>
          ))}
        </div>
      </div>

      <div className="card manual-section-card">
        <div className="manual-section-head">
          <h3>Pricing & Supplier</h3>
        </div>
        <div className="pricing-table">
          <div className="pricing-row pricing-head">
            <span>Type</span>
            <span>Passenger Name *</span>
            <span>Ticket Number</span>
            <span>Buying / Pax *</span>
            <span>Selling / Pax *</span>
          </div>
          {(formValues.pricing_rows || []).map((row) => {
            const label = PAX_LABELS[row.pax_type] || row.pax_type;
            return (
              <div className="pricing-row" key={row.id}>
                <strong>{label}</strong>
                <input value={row.passenger_name} onChange={(event) => updatePricingRow(row.id, 'passenger_name', event.target.value)} />
                <input value={row.ticket_no} onChange={(event) => updatePricingRow(row.id, 'ticket_no', event.target.value)} />
                <input type="number" min="0" value={row.buying_price} onChange={(event) => updatePricingRow(row.id, 'buying_price', event.target.value)} />
                <input type="number" min="0" value={row.selling_price} onChange={(event) => updatePricingRow(row.id, 'selling_price', event.target.value)} />
              </div>
            );
          })}
        </div>

        {formValues.trip_type !== 'ONE_WAY' && (
          <div className="manual-radio-row supplier-mode-row">
            {[
              ['SINGLE', 'Single Supplier'],
              ['MULTI', 'Multi Supplier'],
            ].map(([value, label]) => (
              <label key={value}>
                <input type="radio" checked={formValues.supplier_mode === value} onChange={() => updateForm('supplier_mode', value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}

        {formValues.supplier_mode === 'SINGLE' ? (
          <div className="manual-grid">
            <label>
              <span>Supplier *</span>
              <select value={formValues.supplier_name} onChange={(event) => updateForm('supplier_name', event.target.value)}>
                <option value="">Select supplier</option>
                {supplierOptions.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
              </select>
            </label>
            <label>
              <span>PNR *</span>
              <input value={formValues.supplier_pnr} onChange={(event) => updateForm('supplier_pnr', event.target.value.toUpperCase())} />
            </label>
          </div>
        ) : (
          <div className="supplier-segment-grid">
            {formValues.supplier_segments.map((segment, index) => (
              <div className="supplier-segment-card" key={segment.id}>
                <strong>{segment.label}</strong>
                <label>
                  <span>Supplier *</span>
                  <select value={segment.supplier_name} onChange={(event) => updateSupplierSegment(index, 'supplier_name', event.target.value)}>
                    <option value="">Select supplier</option>
                    {supplierOptions.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                  </select>
                </label>
                <label>
                  <span>PNR *</span>
                  <input value={segment.pnr} onChange={(event) => updateSupplierSegment(index, 'pnr', event.target.value.toUpperCase())} />
                </label>
                <label>
                  <span>Buying Allocation</span>
                  <input type="number" min="0" value={segment.buying_price} onChange={(event) => updateSupplierSegment(index, 'buying_price', event.target.value)} />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card manual-section-card">
        <div className="manual-section-head">
          <h3>Flight Details</h3>
          {formValues.trip_type === 'MULTICITY' && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={addMulticityLeg}>
              <Plus size={15} /> Add Leg
            </button>
          )}
        </div>
        <div className="flight-segment-stack">
          {formValues.flight_segments.map((segment, segmentIndex) => (
            <section className="flight-segment-card" key={segment.id}>
              <div className="flight-segment-head">
                <span>{segment.label}</span>
                <button className="icon-button" type="button" onClick={() => addConnection(segmentIndex)} aria-label={`Add connection to ${segment.label}`}>
                  <Plus size={17} />
                </button>
              </div>
              {segment.connections.map((connection, connectionIndex) => (
                <div className="connection-grid" key={connection.id}>
                  {[
                    ['airline', 'Airline *', 'airline'],
                    ['flight_number', 'Flight Number *'],
                    ['departure_city', 'Departure City *', 'airport'],
                    ['arrival_city', 'Arrival City *', 'airport'],
                    ['departure_date', 'Departure Date', null, 'date'],
                    ['arrival_date', 'Arrival Date', null, 'date'],
                    ['departure_time', 'Departure Time', null, 'time'],
                    ['arrival_time', 'Arrival Time', null, 'time'],
                    ['departure_terminal', 'Departure Terminal'],
                    ['arrival_terminal', 'Arrival Terminal'],
                    ['duration', 'Duration'],
                    ['check_in_baggage', 'Check-in Baggage'],
                    ['cabin_baggage', 'Cabin Baggage'],
                  ].map(([key, label, inputKind, type]) => (
                    inputKind === 'airport' ? (
                      <AirportAutocomplete
                        key={key}
                        label={label}
                        value={connection[key]}
                        onChange={(value) => updateFlightSegment(segmentIndex, connectionIndex, key, value)}
                      />
                    ) : inputKind === 'airline' ? (
                      <AirlineAutocomplete
                        key={key}
                        label={label}
                        value={connection[key]}
                        onChange={(value) => updateFlightSegment(segmentIndex, connectionIndex, key, value)}
                      />
                    ) : (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          type={type || 'text'}
                          value={connection[key]}
                          readOnly={key === 'duration'}
                          onChange={(event) => updateFlightSegment(segmentIndex, connectionIndex, key, event.target.value)}
                        />
                      </label>
                    )
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>

      <div className="grid-2 booking-entry-grid">
        <div className="card manual-section-card">
          <h3>Contact & Payment</h3>
          <div className="booking-form-grid">
            <label>
              <span>Mobile</span>
              <input value={formValues.mobile} onChange={(event) => updateForm('mobile', event.target.value)} />
            </label>
            <label>
              <span>Booked By</span>
              <select value={formValues.booked_by} onChange={(event) => updateForm('booked_by', event.target.value)}>
                <option value="">Select employee</option>
                {employeeOptions.map((employee) => <option key={employee} value={employee}>{employee}</option>)}
              </select>
            </label>
            <label>
              <span>Issued By</span>
              <select value={formValues.agent_issued_by} onChange={(event) => updateForm('agent_issued_by', event.target.value)}>
                <option value="">Select employee</option>
                {employeeOptions.map((employee) => <option key={employee} value={employee}>{employee}</option>)}
              </select>
            </label>
            <label>
              <span>Mode of Payment</span>
              <select value={formValues.payment_mode} onChange={(event) => updateForm('payment_mode', event.target.value)}>
                {PAYMENT_MODES.filter((mode) => mode !== 'AUTO_DEBIT').map((mode) => (
                  <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Amount Paid</span>
              <input type="number" min="0" value={formValues.amount_paid} onChange={(event) => updateForm('amount_paid', event.target.value)} />
            </label>
            <label className="span-2">
              <span>Remarks</span>
              <textarea value={formValues.remarks} onChange={(event) => updateForm('remarks', event.target.value)} rows={4} />
            </label>
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
              <span>Rows To Save</span>
              <strong>{selectedPaxRows.length}</strong>
            </div>
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
          <p>
            {allowBookingEntry
              ? 'Canonical booking ledger with manual fields, auto calculations, PDF extraction, and cryptic entry.'
              : 'Scoped booking ledger with search, filters, payment status, and ticket history.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {allowBookingEntry && (
            <>
              <button className={`btn ${activeTab === 'ADD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchBookingTab('ADD')}>
                <Plus size={16} /> Manual
              </button>
              <button className={`btn ${activeTab === 'CRYPTIC' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchBookingTab('CRYPTIC')}>
                <FileText size={16} /> Cryptic
              </button>
              <button className={`btn ${activeTab === 'UPLOAD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchBookingTab('UPLOAD')}>
                <UploadCloud size={16} /> Upload PDF
              </button>
            </>
          )}
          <button className={`btn ${activeTab === 'LIST' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => switchBookingTab('LIST')}>
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
                {allowExport && (
                  <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
                    <Download size={15} />
                    Export
                  </button>
                )}
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

      {allowBookingEntry && activeTab === 'ADD' && renderBookingForm()}

      {allowBookingEntry && activeTab === 'CRYPTIC' && (
        <div className="manual-booking-stack">
          <div className="grid-2 cryptic-entry-grid">
          <div className="card">
            <h3>Cryptic / Raw Booking Entry</h3>
            <p style={{ color: 'var(--zinc-500)', marginBottom: 16 }}>
              Paste airline, email, WhatsApp, or GDS-style text. Parsed PNR values become reviewable booking drafts.
            </p>
            <label className="provider-select">
              <span>Provider</span>
              <select value={crypticProvider} onChange={(event) => setCrypticProvider(event.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="amadeus">Amadeus</option>
                <option value="sabre">Sabre</option>
              </select>
            </label>
            <textarea
              className="cryptic-textarea"
              value={crypticText}
              onChange={(event) => {
                setCrypticText(event.target.value);
                if (crypticStatus !== 'idle') resetCrypticParse();
              }}
              placeholder="Paste raw PNR details here..."
            />
            <div className="form-actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setCrypticText('');
                  resetCrypticParse();
                }}
              >
                Clear
              </button>
              <button className="btn btn-primary" type="button" onClick={handleCrypticParse} disabled={crypticStatus === 'processing'}>
                {crypticStatus === 'processing' ? 'Parsing...' : 'Parse PNR'}
              </button>
            </div>
          </div>
          <div className="card auto-preview-card">
            <h3>Parser Status</h3>
            {crypticMeta ? (
              <div className="auto-preview-list">
                <div><span>Source</span><strong>{crypticMeta.source || 'CRYPTIC'}</strong></div>
                <div><span>Provider</span><strong>{crypticMeta.provider?.toUpperCase()}</strong></div>
                <div><span>Confidence</span><strong>{String(crypticMeta.confidence || '-').replace(/_/g, ' ')}</strong></div>
                <div><span>PNR</span><strong>{crypticMeta.pnr || '-'}</strong></div>
                <div><span>Draft Rows</span><strong>{crypticMeta.count}</strong></div>
                <div><span>Tickets</span><strong>{crypticMeta.ticketCount}</strong></div>
              </div>
            ) : (
              <div className="schema-list">
                {FORM_FIELDS.map((field) => <span key={field.key}>{field.label}</span>)}
              </div>
            )}
          </div>

          {renderParsedDraftReview()}
          </div>
          {renderBookingForm()}
        </div>
      )}

      {allowBookingEntry && activeTab === 'UPLOAD' && (
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
