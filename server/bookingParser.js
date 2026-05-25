import { AIRLINES } from '../src/data/airlines.js';
import { AIRPORTS } from '../src/data/airports.js';

const MONTH_INDEX = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const SYSTEM_REMARKS = [
  /CONF\*FORMAT:[A-Z]+/i,
  /CONF\*LANG:[A-Z]{2}/i,
  /THIS\s+PNR\s+IS\s+ASSOCIATED/i,
];

const MEAL_CODES = new Set(['CHML', 'BBML', 'HNML', 'VGML', 'KSML', 'MOML', 'DBML', 'LFML', 'SPML']);
const COMMON_AIRLINE_NAMES = [
  ['EMIRATES', 'EK'],
  ['OMAN AIR', 'WY'],
  ['TURKISH AIRLINES', 'TK'],
  ['ITA AIRWAYS', 'AZ'],
  ['QATAR AIRWAYS', 'QR'],
  ['ETIHAD AIRWAYS', 'EY'],
  ['AIR INDIA EXPRESS', 'IX'],
  ['AIR INDIA', 'AI'],
  ['INDIGO', '6E'],
  ['LUFTHANSA', 'LH'],
  ['AIR FRANCE', 'AF'],
  ['KLM', 'KL'],
  ['BRITISH AIRWAYS', 'BA'],
];

function cleanText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\r/g, '\n');
}

function compactSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function money(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : '';
}

function parseDdMmm(value, fallbackYear = new Date().getFullYear()) {
  const match = String(value || '').toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})?$/);
  if (!match || MONTH_INDEX[match[2]] === undefined) return null;
  const yy = match[3] ? Number(match[3]) : null;
  return {
    day: Number(match[1]),
    month: MONTH_INDEX[match[2]],
    year: yy === null ? fallbackYear : (yy <= 30 ? 2000 + yy : 1900 + yy),
  };
}

function isoDate(parts) {
  if (!parts) return '';
  const date = new Date(Date.UTC(parts.year, parts.month, parts.day));
  if (
    date.getUTCFullYear() !== parts.year
    || date.getUTCMonth() !== parts.month
    || date.getUTCDate() !== parts.day
  ) return '';
  return date.toISOString().slice(0, 10);
}

function parseDdMmmIso(value, fallbackYear) {
  return isoDate(parseDdMmm(value, fallbackYear));
}

function parsePdfDate(value, fallbackYear = new Date().getFullYear()) {
  const raw = String(value || '').toUpperCase().trim();
  const numeric = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const yearValue = Number(numeric[3]);
    const year = numeric[3].length === 2 ? 2000 + yearValue : yearValue;
    return isoDate({ day: Number(numeric[1]), month: Number(numeric[2]) - 1, year });
  }

  const named = raw.match(/\b(\d{1,2})\s+([A-Z]{3,9})\s+(\d{2,4})\b/);
  if (named) {
    const monthKey = named[2].slice(0, 3);
    if (MONTH_INDEX[monthKey] !== undefined) {
      const yearValue = Number(named[3]);
      const year = named[3].length === 2 ? 2000 + yearValue : yearValue;
      return isoDate({ day: Number(named[1]), month: MONTH_INDEX[monthKey], year });
    }
  }

  const match = raw.match(/(?:[A-Z]{3}\s+)?(\d{1,2})([A-Z]{3})(\d{2,4})?/);
  if (!match || MONTH_INDEX[match[2]] === undefined) return '';
  const year = match[3]
    ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]))
    : fallbackYear;
  return isoDate({ day: Number(match[1]), month: MONTH_INDEX[match[2]], year });
}

function hhmm(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  const match = raw.match(/^(\d{1,2})[:.](\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return raw;
  let hour = Number(match[1]);
  if (match[3]) {
    const meridiem = match[3].toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function addDaysIso(value, days) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  return `+${digits}`;
}

function emailFromCtce(local, domain) {
  if (!local || !domain) return '';
  return `${local}@${domain}`.replace(/\/\//g, '@').toLowerCase();
}

function splitGdsName(value) {
  const [lastName, firstName = ''] = compactSpaces(value).split('/');
  return {
    last_name: lastName || '',
    first_name: firstName || '',
    passenger_name: lastName && firstName ? `${lastName}/${firstName}` : compactSpaces(value),
  };
}

function splitPdfName(value) {
  const tokens = compactSpaces(value).toUpperCase().split(' ').filter(Boolean);
  if (tokens.length < 2) {
    return { last_name: tokens[0] || '', first_name: '', passenger_name: tokens[0] || '' };
  }
  const lastName = tokens[tokens.length - 1];
  const firstName = tokens.slice(0, -1).join(' ');
  return {
    last_name: lastName,
    first_name: firstName,
    passenger_name: `${lastName}/${firstName}`,
  };
}

function createPassenger(fields) {
  return {
    seq_no: fields.seq_no,
    p_ref: fields.p_ref || fields.seq_no,
    title: fields.title || '',
    last_name: fields.last_name || '',
    first_name: fields.first_name || '',
    passenger_name: fields.passenger_name || '',
    pax_type: fields.pax_type || 'ADT',
    dob: fields.dob || '',
    gender: '',
    doc_type: '',
    doc_number: '',
    doc_country: '',
    doc_expiry: '',
    nationality: '',
    infant_of_p_ref: null,
    ticket_no: '',
    ticket_format: '',
    fare_issued: '',
    currency: '',
    ticket_issue_date: '',
    ticket_endorsement: '',
    previous_ticket_no: '',
    ticket_status: 'PENDING',
    seats: [],
    baggage: [],
    meal_code: '',
    special_services: [],
    mobile: '',
    contact_email: '',
    warnings: [],
    ...fields,
  };
}

function airlineExists(code) {
  return AIRLINES.some((airline) => airline.code === code);
}

function airportExists(code) {
  return AIRPORTS.some((airport) => airport.code === code);
}

function airportByText(value) {
  const raw = compactSpaces(value);
  if (!raw) return '';
  const directCode = raw.toUpperCase().match(/\b[A-Z]{3}\b/);
  if (directCode && airportExists(directCode[0])) return directCode[0];

  const query = raw
    .replace(/\b(Apt|Airport|International|Intl|Terminal:\d+|Terminal)\b/gi, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!query) return '';

  const match = AIRPORTS.find((airport) => {
    const city = airport.city.toLowerCase();
    const name = airport.name.toLowerCase();
    const simplifiedName = name.replace(/\b(airport|international|intl)\b/g, '').replace(/\s+/g, ' ').trim();
    const search = airport.search.toLowerCase();
    return city === query
      || name === query
      || search.includes(query)
      || query.includes(city)
      || (simplifiedName.length >= 4 && query.includes(simplifiedName));
  });
  return match?.code || '';
}

function airportMentions(value) {
  const raw = String(value || '');
  const upper = raw.toUpperCase();
  const mentions = [];

  for (const match of upper.matchAll(/\b[A-Z]{3}\b/g)) {
    if (airportExists(match[0])) mentions.push({ code: match[0], index: match.index, score: 0 });
  }

  const haystack = compactSpaces(raw).toLowerCase();
  for (const airport of AIRPORTS) {
    const candidates = [airport.name, airport.city]
      .map((item) => String(item || '').toLowerCase())
      .filter((item) => item.length >= 4);
    for (const candidate of candidates) {
      const index = haystack.indexOf(candidate);
      if (index >= 0) {
        mentions.push({ code: airport.code, index, score: candidate.length });
        break;
      }
    }
  }

  return uniqueBy(
    mentions.sort((a, b) => a.index - b.index || b.score - a.score),
    (mention) => `${mention.code}-${mention.index}`,
  );
}

function airlineByText(value) {
  const raw = compactSpaces(value).toUpperCase();
  if (!raw) return '';
  const code = raw.match(/\b[A-Z0-9]{2}\b/);
  if (code && airlineExists(code[0])) return code[0];
  const named = COMMON_AIRLINE_NAMES.find(([name]) => raw.includes(name));
  if (named) return named[1];
  const airline = AIRLINES.find((item) => raw.includes(String(item.airlineName || '').toUpperCase()));
  return airline?.code || '';
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pdfDateMatches(value) {
  return [...String(value || '').toUpperCase().matchAll(/\b(?:[A-Z]{3}\s+)?\d{1,2}[A-Z]{3}(?:\d{2,4})?\b|\b\d{1,2}\s+[A-Z]{3,9}\s+\d{2,4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g)]
    .map((match) => match[0])
    .filter((match) => parsePdfDate(match));
}

function pdfTimeMatches(value) {
  return [...String(value || '').matchAll(/\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s*[AP]M)?\b|\b(?:[01]\d|2[0-3])[0-5]\d\b/gi)]
    .map((match) => hhmm(match[0]));
}

function extractPdfTickets(text, currentYear) {
  const tickets = [];
  const patterns = [
    /(?:ELECTRONIC\s+TICKET|E-?TICKET|ETKT|TICKET\s*(?:NO|NUMBER)?|TKT)[:\s#-]*(\d{10,14})(?:\s+(\d{1,2}[A-Z]{3}\d{2,4}|\d{1,2}\s+[A-Z]{3,9}\s+\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}))?/g,
    /\b(\d{10,14})\b\s*(?:ISSUED|ISSUE|DATE)?\s*(\d{1,2}[A-Z]{3}\d{2,4}|\d{1,2}\s+[A-Z]{3,9}\s+\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})?/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      tickets.push({
        ticket_no: match[1],
        ticket_issue_date: parsePdfDate(match[2], currentYear),
      });
    }
  }

  return uniqueBy(tickets, (ticket) => ticket.ticket_no);
}

function flightTokenMatches(text) {
  const matches = [];
  for (const match of text.matchAll(/\b([A-Z0-9]{2})\s*(\d{2,4})\b/g)) {
    if (airlineExists(match[1])) matches.push({ index: match.index, airline: match[1], flight_number: match[2] });
  }
  for (const [name, code] of COMMON_AIRLINE_NAMES) {
    const pattern = new RegExp(`\\b${name}\\s+(\\d{2,4})\\b`, 'g');
    for (const match of text.matchAll(pattern)) {
      matches.push({ index: match.index, airline: code, flight_number: match[1] });
    }
  }
  return uniqueBy(matches.sort((a, b) => a.index - b.index), (match) => `${match.airline}-${match.flight_number}-${match.index}`);
}

function createPdfSegment(fields) {
  return {
    segment_ref: fields.segment_ref,
    airline: fields.airline || '',
    flight_number: fields.flight_number || '',
    booking_class: fields.booking_class || '',
    cabin_class: fields.cabin_class || '',
    departure_city: fields.departure_city || '',
    arrival_city: fields.arrival_city || '',
    departure_date: fields.departure_date || '',
    arrival_date: fields.arrival_date || fields.departure_date || '',
    departure_time: fields.departure_time || '',
    arrival_time: fields.arrival_time || '',
    departure_terminal: fields.departure_terminal || '',
    arrival_terminal: fields.arrival_terminal || '',
    check_in_baggage: fields.check_in_baggage || '',
    cabin_baggage: fields.cabin_baggage || '',
  };
}

function extractPdfSegments(text, currentYear) {
  const segments = [];

  for (const match of text.matchAll(/(?:\b([A-Z0-9]{2})\s*)?(\d{2,4})\s+([A-Z][A-Z\s,]+?(?:APT)?)\s+(?:[A-Z]{2,3}\s+)?([A-Z]{3}\s+\d{1,2}[A-Z]{3}(?:\d{2})?)\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s+([A-Z][A-Z\s,]+?(?:APT)?)\s+(?:[A-Z]{2,3}\s+)?([A-Z]{3}\s+\d{1,2}[A-Z]{3}(?:\d{2})?)\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)(?:\s+([A-Z])\s+([A-Z]))?/g)) {
    segments.push(createPdfSegment({
      segment_ref: segments.length + 1,
      airline: match[1] || '',
      flight_number: match[2],
      booking_class: match[9] || '',
      cabin_class: match[10] || '',
      departure_city: airportByText(match[3]) || airportByText(match[4]),
      arrival_city: airportByText(match[6]) || airportByText(match[7]),
      departure_date: parsePdfDate(match[4], currentYear),
      arrival_date: parsePdfDate(match[7], currentYear),
      departure_time: hhmm(match[5]),
      arrival_time: hhmm(match[8]),
    }));
  }

  for (const flight of flightTokenMatches(text)) {
    const window = text.slice(flight.index, flight.index + 600);
    const codes = airportMentions(window).map((mention) => mention.code);
    const dates = pdfDateMatches(window);
    const times = pdfTimeMatches(window);
    if (codes.length >= 2 && !segments.some((segment) => segment.airline === flight.airline && segment.flight_number === flight.flight_number)) {
      segments.push(createPdfSegment({
        segment_ref: segments.length + 1,
        airline: flight.airline,
        flight_number: flight.flight_number,
        departure_city: codes[0],
        arrival_city: codes[1],
        departure_date: parsePdfDate(dates[0], currentYear),
        arrival_date: parsePdfDate(dates[1] || dates[0], currentYear),
        departure_time: times[0] || '',
        arrival_time: times[1] || '',
      }));
    }
  }

  if (!segments.length) {
    const route = text.match(/\b([A-Z]{3})\s*(?:-|\/|TO)\s*([A-Z]{3})\b/);
    const flight = flightTokenMatches(text)[0];
    const dates = pdfDateMatches(text);
    const times = pdfTimeMatches(text);
    if (route && airportExists(route[1]) && airportExists(route[2])) {
      segments.push(createPdfSegment({
        segment_ref: 1,
        airline: flight?.airline || airlineByText(text),
        flight_number: flight?.flight_number || '',
        departure_city: route[1],
        arrival_city: route[2],
        departure_date: parsePdfDate(dates[0], currentYear),
        arrival_date: parsePdfDate(dates[1] || dates[0], currentYear),
        departure_time: times[0] || '',
        arrival_time: times[1] || '',
      }));
    }
  }

  if (!segments.length) {
    const airports = airportMentions(text).map((mention) => mention.code);
    const dates = pdfDateMatches(text);
    const times = pdfTimeMatches(text);
    const flight = flightTokenMatches(text)[0];
    if (airports.length >= 2) {
      segments.push(createPdfSegment({
        segment_ref: 1,
        airline: flight?.airline || airlineByText(text),
        flight_number: flight?.flight_number || '',
        departure_city: airports[0],
        arrival_city: airports[1],
        departure_date: parsePdfDate(dates[0], currentYear),
        arrival_date: parsePdfDate(dates[1] || dates[0], currentYear),
        departure_time: times[0] || '',
        arrival_time: times[1] || '',
      }));
    }
  }

  return uniqueBy(segments, (segment) => [
    segment.airline,
    segment.flight_number,
    segment.departure_city,
    segment.arrival_city,
    segment.departure_date,
    segment.departure_time,
  ].join('-'));
}

function joinWrappedFaLines(text) {
  const lines = cleanText(text).split('\n');
  const joined = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1] || '';
    if (
      /(\d{3}-\d{10}\/ET[A-Z]{2}\/[A-Z]{3}[\d.]+\/\d{2}[A-Z]{3}\d{2}\/[A-Z0-9]+\/\d{6})\s*$/.test(current)
      && /^\s{6,}(\d{2}\/S[\d-]+(?:\/P\d+)?)\s*$/.test(next)
    ) {
      joined.push(`${current.trim()}${next.trim()}`);
      index += 1;
    } else {
      joined.push(current);
    }
  }

  return joined.join('\n');
}

function deriveRoute(segments) {
  if (!segments.length) {
    return { sector: '', outbound_date: '', inbound_date: '', trip_type: 'ONE_WAY', ow_rt: 'OW' };
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const returnStartIndex = segments.findIndex((segment, index) => (
    index > 0 && segment.arrival_city === first.departure_city
  ));
  const isRoundtrip = returnStartIndex > 0;
  const outboundEnd = isRoundtrip ? segments[Math.max(0, returnStartIndex - 1)] : last;
  const inboundStart = isRoundtrip ? segments[returnStartIndex] : null;

  return {
    sector: [first.departure_city, outboundEnd.arrival_city].filter(Boolean).join('-'),
    outbound_date: first.departure_date || '',
    inbound_date: inboundStart?.departure_date || '',
    trip_type: isRoundtrip ? 'ROUNDTRIP' : 'ONE_WAY',
    ow_rt: isRoundtrip ? 'RT' : 'OW',
  };
}

function mapDrafts({ source, pnr, bookingDate, passengers, segments, supplierName, remarks, linkedPnr, warnings }) {
  const route = deriveRoute(segments);
  const firstSegment = segments[0] || {};
  const drafts = passengers.map((passenger, index) => {
    const rowWarnings = [...(passenger.warnings || [])];
    const blocking = [];

    if (!pnr) blocking.push('PNR');
    if (!passenger.passenger_name) blocking.push('Passenger Name');
    if (!firstSegment.airline) blocking.push('Airline');
    if (firstSegment.airline && !airlineExists(firstSegment.airline)) rowWarnings.push(`UNRESOLVED_AIRLINE:${firstSegment.airline}`);
    for (const segment of segments) {
      if (segment.departure_city && !airportExists(segment.departure_city)) rowWarnings.push(`UNRESOLVED_AIRPORT:${segment.departure_city}`);
      if (segment.arrival_city && !airportExists(segment.arrival_city)) rowWarnings.push(`UNRESOLVED_AIRPORT:${segment.arrival_city}`);
    }
    if (source === 'PDF' && !passenger.fare_issued) rowWarnings.push('FARE_REQUIRED');

    return {
      booking_date: bookingDate || new Date().toISOString().slice(0, 10),
      passenger_name: passenger.passenger_name,
      pax_type: passenger.pax_type || 'ADT',
      pax_count: 1,
      mobile: passenger.mobile || '',
      contact_email: passenger.contact_email || '',
      airline: firstSegment.airline || '',
      pnr,
      ticket_no: passenger.ticket_no || '',
      sector: route.sector,
      outbound_date: route.outbound_date,
      inbound_date: route.inbound_date,
      trip_type: route.trip_type,
      ow_rt: route.ow_rt,
      fare_sold: '',
      selling_price_per_pax: '',
      fare_issued: passenger.fare_issued || '',
      buying_price_per_pax: passenger.fare_issued || '',
      currency: passenger.currency || '',
      booked_by: '',
      agent_issued_by: '',
      remarks: [remarks, linkedPnr ? `Linked PNR: ${linkedPnr}` : ''].filter(Boolean).join(' | '),
      refund_flag: false,
      supplier_name: supplierName || '',
      supplier: supplierName || '',
      ticket_issue_date: passenger.ticket_issue_date || '',
      ticket_endorsement: passenger.ticket_endorsement || '',
      previous_ticket_no: passenger.previous_ticket_no || '',
      ticket_status: passenger.ticket_status || (passenger.ticket_no ? 'TICKETED' : 'PENDING'),
      dob: passenger.dob || '',
      gender: passenger.gender || '',
      doc_type: passenger.doc_type || '',
      doc_number: passenger.doc_number || '',
      doc_country: passenger.doc_country || '',
      doc_expiry: passenger.doc_expiry || '',
      nationality: passenger.nationality || '',
      infant_of: passenger.infant_of_p_ref || '',
      seat_info: passenger.seats,
      baggage: passenger.baggage,
      meal_code: passenger.meal_code || '',
      flight_segments: segments.map((segment, segmentIndex) => ({
        id: `parsed-${segmentIndex + 1}`,
        label: segmentIndex === 0 ? 'Onward' : `Leg ${segmentIndex + 1}`,
        connections: [segment],
      })),
      validation: {
        blocking,
        warnings: [...new Set(rowWarnings)],
      },
      parser_source: source,
      parser_row: index + 1,
    };
  });

  return {
    drafts,
    warnings: [...new Set(warnings)],
    meta: {
      source,
      pnr,
      passengerCount: passengers.length,
      ticketCount: passengers.filter((passenger) => passenger.ticket_no).length,
      segmentCount: segments.length,
      confidence: drafts.length && pnr ? 'high' : 'medium',
    },
    raw: { passengers, segments, pnr, bookingDate, supplierName, remarks, linkedPnr },
  };
}

export function parseCrypticBooking(input, provider = 'auto') {
  const text = joinWrappedFaLines(input).toUpperCase();
  const lines = text.split('\n');
  const warnings = [];

  const headerMatch = text.match(/^RP\/[A-Z0-9]{8,10}\/[A-Z0-9]{8,10}\s+[A-Z]{2}\/[A-Z]{2}\s+\d{2}[A-Z]{3}\d{2}\/\d{4}Z\s+([A-Z0-9]{6})/m)
    || text.match(/(?:RECORD\s+LOCATOR|PNR)[:\s]+([A-Z0-9]{6})/);
  const pnr = headerMatch?.[1] || '';
  const bookingDateMatch = text.match(/\b(\d{2}[A-Z]{3}\d{2})\/(\d{4})Z\b/);
  const bookingDate = parseDdMmmIso(bookingDateMatch?.[1]);
  const fallbackYear = bookingDate ? Number(bookingDate.slice(0, 4)) : new Date().getFullYear();

  const apMatch = text.match(/^\s*\d+\s+AP\s+([A-Z]{3})\s+(.+?)\s+-\s+(.+?)\s+-\s+([A-Z])$/m);
  const supplierName = apMatch?.[3] && apMatch[3] !== 'TBA' ? compactSpaces(apMatch[3]) : '';

  const passengers = [];
  const passengerByRef = new Map();
  const nameElementRegex = /(\d+)\.([A-Z]+\/[A-Z]+(?:\s+[A-Z]+)?(?:\((?:CHD|INF)\/\d{2}[A-Z]{3}\d{2}\))?)/g;
  for (const match of text.matchAll(nameElementRegex)) {
    const parsed = match[0].match(/^(\d+)\.(([A-Z]+)\/(([A-Z]+)(?:\s+([A-Z]+))?)(?:\((CHD|INF)\/(\d{2}[A-Z]{3}\d{2})\))?)$/);
    if (!parsed) continue;
    const passenger = createPassenger({
      seq_no: Number(parsed[1]),
      p_ref: Number(parsed[1]),
      last_name: parsed[3],
      first_name: parsed[4],
      passenger_name: `${parsed[3]}/${parsed[4]}`,
      pax_type: parsed[7] || 'ADT',
      dob: parseDdMmmIso(parsed[8], fallbackYear),
    });
    passengers.push(passenger);
    passengerByRef.set(passenger.p_ref, passenger);
  }

  for (const line of lines) {
    const inft = line.match(/^\s*\d+\s+SSR\s+INFT?\s+[A-Z]{2}\s+(?:HK\d+\s+)?([A-Z]+\/[A-Z]+(?:\s+[A-Z]+)?)\s+(\d{2}[A-Z]{3}\d{2})(?:\/P(\d+))?/);
    if (inft) {
      const exists = passengers.some((passenger) => passenger.passenger_name === inft[1]);
      if (!exists) {
        const names = splitGdsName(inft[1]);
        const passenger = createPassenger({
          seq_no: Math.max(0, ...passengers.map((item) => item.seq_no || 0)) + 1,
          p_ref: Math.max(0, ...passengers.map((item) => item.seq_no || 0)) + 1,
          ...names,
          pax_type: 'INF',
          dob: parseDdMmmIso(inft[2], fallbackYear),
          infant_of_p_ref: inft[3] ? Number(inft[3]) : null,
        });
        passengers.push(passenger);
        passengerByRef.set(passenger.p_ref, passenger);
      }
    }
  }

  const segments = [];
  for (const line of lines) {
    const segment = line.match(/^\s*(\d+)\s+([A-Z]{2,3})\s+(\d{1,4})\s+([A-Z])(?:\s+[A-Z])?\s+(\d{2}[A-Z]{3})(?:\s+(\d))?\s+([A-Z]{3})([A-Z]{3})\s+([A-Z]{2})(\d+)?\s+(?:\d+\s+)?(\d{4})\s+(\d{4})/)
      || line.match(/^\s*(\d+)\s+([A-Z]{2})(\d{3,4})([A-Z])(?:\s+[A-Z])?\s+(\d{2}[A-Z]{3})(?:\s+(\d))?\s+([A-Z]{3})([A-Z]{3})\s+([A-Z]{2})(\d+)?\s+(?:\d+\s+)?(\d{4})\s+(\d{4})/)
      || line.match(/^\s*(\d+)\s+([A-Z]{2})(\d{3,4})\s+([A-Z])(?:\s+[A-Z])?\s+(\d{2}[A-Z]{3})(?:\s+(\d))?\s+([A-Z]{3})([A-Z]{3})\s+([A-Z]{2})(\d+)?\s+(?:\d+\s+)?(\d{4})\s+(\d{4})/);
    if (!segment) continue;
    const departureDate = parseDdMmmIso(segment[5], fallbackYear);
    const departureTime = hhmm(segment[11]);
    const arrivalTime = hhmm(segment[12]);
    const arrivalDate = departureTime > arrivalTime ? addDaysIso(departureDate, 1) : departureDate;
    const key = `${segment[2]}${segment[3]}-${segment[5]}-${segment[7]}-${segment[8]}`;
    if (segments.some((item) => item.key === key)) continue;
    segments.push({
      key,
      segment_ref: Number(segment[1]),
      airline: segment[2],
      flight_number: segment[3],
      booking_class: segment[4],
      departure_city: segment[7],
      arrival_city: segment[8],
      departure_date: departureDate,
      arrival_date: arrivalDate,
      departure_time: departureTime,
      arrival_time: arrivalTime,
      departure_terminal: '',
      arrival_terminal: '',
      check_in_baggage: '',
      cabin_baggage: '',
      segment_status: segment[9],
    });
  }

  for (const line of lines) {
    const chld = line.match(/^\s*\d+\s+SSR\s+CHLD\s+[A-Z]{2}\s+HK\d+\s+(\d{2}[A-Z]{3}\d{2})(?:\/P(\d+))?/);
    if (chld) {
      const passenger = chld[2] ? passengerByRef.get(Number(chld[2])) : passengers.find((item) => item.dob === parseDdMmmIso(chld[1], fallbackYear));
      if (passenger) {
        passenger.pax_type = 'CHD';
        passenger.dob = parseDdMmmIso(chld[1], fallbackYear);
      }
    }

    const ctcm = line.match(/^\s*\d+\s+SSR\s+CTCM\s+[A-Z]{2}\s+HK\d+\s+([\d]+)/);
    if (ctcm) {
      const target = passengers.find((item) => item.pax_type === 'ADT') || passengers[0];
      if (target) target.mobile = normalizePhone(ctcm[1]);
    }

    const ctce = line.match(/^\s*\d+\s+SSR\s+CTCE\s+[A-Z]{2}\s+HK\d+\s+([A-Z0-9._%+-]+)\/\/([A-Z0-9.-]+)/);
    if (ctce) {
      const target = passengers.find((item) => item.pax_type === 'ADT') || passengers[0];
      if (target) target.contact_email = emailFromCtce(ctce[1], ctce[2]);
    }

    const docs = line.match(/^\s*\d+\s+SSR\s+DOCS\s+[A-Z]{2}\s+HK\d+\s+([A-Z])\/([A-Z]{3})\/([A-Z0-9]+)\/([A-Z]{3})\/(\d{2}[A-Z]{3}\d{2})\/([MFX])\/(\d{2}[A-Z]{3}\d{2})\/([A-Z]+)\/([A-Z]+)(?:\/P(\d+))?/);
    if (docs) {
      const passenger = docs[10] ? passengerByRef.get(Number(docs[10])) : passengers.find((item) => item.last_name === docs[8]);
      if (passenger) {
        passenger.doc_type = docs[1];
        passenger.doc_country = docs[2];
        passenger.doc_number = docs[3];
        passenger.nationality = docs[4];
        passenger.dob = parseDdMmmIso(docs[5], fallbackYear);
        passenger.gender = docs[6];
        passenger.doc_expiry = parseDdMmmIso(docs[7], fallbackYear);
      }
    }

    const meal = line.match(/^\s*\d+\s+SSR\s+([A-Z]{4})\s+[A-Z]{2}\s+[A-Z]{2}\d*(?:\/S(\d+))?(?:\/P(\d+))?/);
    if (meal && MEAL_CODES.has(meal[1])) {
      const targets = meal[3] ? [passengerByRef.get(Number(meal[3]))] : passengers;
      targets.filter(Boolean).forEach((passenger) => {
        passenger.meal_code = meal[1];
      });
    }

    const seat = line.match(/^\s*\d+\s+SSR\s+SEAT\s+[A-Z]{2}\s+[A-Z]{2}\d+\s+([0-9]{1,3}[A-Z])\/P(\d+)/);
    if (seat) {
      const passenger = passengerByRef.get(Number(seat[2]));
      if (passenger) passenger.seats.push({ seat_number: seat[1], seat_status: 'Confirmed' });
    }
  }

  const faPassengerRefs = new Set();
  for (const line of lines) {
    const fa = line.match(/^\s*\d+\s+FA\s+PAX\s+(\d{3}-\d{10})\/ET([A-Z]{2})\/([A-Z]{3})([\d.]+)\/(\d{2}[A-Z]{3}\d{2})\/([A-Z0-9]+)\/(\d{8})(?:\/S([\d-]+))?(?:\/P(\d+))?/);
    if (!fa) continue;
    const passenger = fa[9] ? passengerByRef.get(Number(fa[9])) : (passengers.length === 1 ? passengers[0] : null);
    if (!passenger) {
      warnings.push('AMBIGUOUS_FA_LINE');
      continue;
    }
    passenger.ticket_no = fa[1];
    passenger.ticket_format = 'GDS';
    passenger.ticket_endorsement = fa[2];
    passenger.currency = fa[3];
    passenger.fare_issued = money(fa[4]);
    passenger.ticket_issue_date = parseDdMmmIso(fa[5], fallbackYear);
    passenger.ticket_status = 'TICKETED';
    faPassengerRefs.add(passenger.p_ref);
  }

  for (const line of lines) {
    const fhe = line.match(/^\s*\d+\s+FHE\s+PAX\s+(\d{3}-\d{10})(?:.*\/P(\d+))?/);
    if (fhe) {
      const passenger = fhe[2] ? passengerByRef.get(Number(fhe[2])) : passengers[0];
      if (passenger) passenger.previous_ticket_no = fhe[1];
    }

    const fb = line.match(/^\s*\d+\s+FB\s+PAX\s+(\d+)\s+TTP\/(?:T(\d+)\/)?RT\s+OK(?:\s+ETICKET\/S([\d-]+)(?:\/P([\d-]+))?)?/);
    if (fb) {
      const refs = fb[4]
        ? fb[4].split('-').map(Number)
        : passengers.map((passenger) => passenger.p_ref);
      passengers.forEach((passenger) => {
        if (!fb[4] || refs.includes(passenger.p_ref) || (refs.length === 2 && passenger.p_ref >= refs[0] && passenger.p_ref <= refs[1])) {
          passenger.ticket_status = 'TICKETED';
        }
      });
    }
  }

  if (passengers.length && faPassengerRefs.size && faPassengerRefs.size !== passengers.length) warnings.push('TICKET_COUNT_MISMATCH');

  const remarkParts = [];
  let linkedPnr = '';
  for (const line of lines) {
    const remark = line.match(/^\s*\d+\s+RMZ?\s+(.+)$/);
    if (!remark) continue;
    const textValue = compactSpaces(remark[1]);
    const linked = textValue.match(/ASSOCIATED\s+WITH\s+PNR\s+NO\s*[.\s]*([A-Z0-9]{6})/);
    if (linked) linkedPnr = linked[1];
    if (!SYSTEM_REMARKS.some((pattern) => pattern.test(textValue))) remarkParts.push(textValue);
  }

  if (!passengers.length) warnings.push('No passenger names were detected.');
  if (!segments.length) warnings.push('No flight segments were detected.');
  if (!pnr) warnings.push('No record locator was detected.');

  return {
    ...mapDrafts({
      source: 'CRYPTIC',
      pnr,
      bookingDate,
      passengers,
      segments,
      supplierName,
      remarks: remarkParts.join(' | '),
      linkedPnr,
      warnings,
    }),
    provider,
  };
}

export function parsePdfBooking(input) {
  const original = cleanText(input);
  const text = original.toUpperCase();
  const warnings = [];
  const currentYear = new Date().getFullYear();
  const pnr = (text.match(/(?:RECORD\s+LOCATOR|PNR|BOOKING\s+REF|LOCATOR|REFERENCE)[:\s]+([A-Z0-9]{6})/) || [])[1] || '';
  const passengers = [];
  const passengerByName = new Map();

  for (const match of text.matchAll(/\b(MR|MRS|MS|MISS|MSTR)\s+([A-Z]+(?:\s+[A-Z]+)*)\s+\((ADT|CHD|INF)\)/g)) {
    const names = splitPdfName(match[2]);
    if (passengerByName.has(names.passenger_name)) continue;
    const passenger = createPassenger({
      seq_no: passengers.length + 1,
      p_ref: passengers.length + 1,
      title: match[1],
      ...names,
      pax_type: match[3],
      ticket_format: 'PDF',
    });
    passengers.push(passenger);
    passengerByName.set(passenger.passenger_name, passenger);
  }

  for (const match of text.matchAll(/(?:INFANT\s*-\s*CONFIRMED\s+)?([A-Z]+\/[A-Z]+)\s+(\d{2}[A-Z]{3}\d{2})/g)) {
    if (passengerByName.has(match[1])) continue;
    const names = splitGdsName(match[1]);
    const passenger = createPassenger({
      seq_no: passengers.length + 1,
      p_ref: passengers.length + 1,
      ...names,
      pax_type: 'INF',
      dob: parseDdMmmIso(match[2], currentYear),
      ticket_format: 'PDF',
    });
    passengers.push(passenger);
    passengerByName.set(passenger.passenger_name, passenger);
  }

  const tickets = extractPdfTickets(text, currentYear);
  tickets.forEach((ticket, index) => {
    const passenger = passengers[index];
    if (!passenger) return;
    passenger.ticket_no = ticket.ticket_no;
    passenger.ticket_issue_date = ticket.ticket_issue_date;
    passenger.ticket_status = 'TICKETED';
    passenger.warnings.push('FARE_REQUIRED');
  });

  const endorsement = (text.match(/ENDORSEMENTS?:\s+(.+)$/m) || [])[1];
  if (endorsement) passengers.forEach((passenger) => {
    passenger.ticket_endorsement = compactSpaces(endorsement);
  });

  let segments = extractPdfSegments(text, currentYear);

  if (segments.length && !segments[0].airline) {
    const carrier = flightTokenMatches(text)[0];
    const airline = carrier?.airline || airlineByText(text);
    if (airline) {
      segments[0].airline = airline;
      segments[0].flight_number ||= carrier?.flight_number || '';
    }
  }
  segments = uniqueBy(segments, (segment) => [
    segment.airline,
    segment.flight_number,
    segment.departure_city,
    segment.arrival_city,
    segment.departure_date,
    segment.departure_time,
  ].join('-'));

  const seats = [...text.matchAll(/SEAT\s+([0-9]{1,3}[A-Z])\s*-\s*(CONFIRMED|PENDING|REQUEST)/g)];
  seats.forEach((match, index) => {
    const passenger = passengers[index % Math.max(1, passengers.length)];
    if (passenger) passenger.seats.push({ segment_ref: 1, seat_number: match[1], seat_status: match[2] });
  });

  const baggageMatches = [
    ...text.matchAll(/CHECKED\s+BAG\s+ALLOWANCE\s+(\d+\s*KG|\d+\s*PC)[\s\n\s]+CARRY\s+ON\s+BAG\s+ALLOWANCE\s+(\d+\s*PC|\d+\s*KG)/g),
    ...text.matchAll(/(?:CHECK(?:ED)?(?:-|\s*)IN|BAGGAGE|BAG)\s*(?:ALLOWANCE)?[:\s-]*(\d+\s*KG|\d+\s*PC).*?(?:CABIN|CARRY\s+ON|HAND)\s*(?:BAG(?:GAGE)?|ALLOWANCE)?[:\s-]*(\d+\s*KG|\d+\s*PC)/g),
  ];
  for (const match of baggageMatches) {
    passengers.forEach((passenger) => {
      passenger.baggage.push({ route: '', check_in_baggage: compactSpaces(match[1]), cabin_baggage: compactSpaces(match[2]) });
    });
    if (segments[0]) {
      segments[0].check_in_baggage ||= compactSpaces(match[1]);
      segments[0].cabin_baggage ||= compactSpaces(match[2]);
    }
  }

  if (!passengers.length) warnings.push('No passenger names were detected.');
  if (!pnr) warnings.push('No record locator was detected.');
  if (!tickets.length) warnings.push('NO_TICKET_FOUND');
  if (!segments.length) warnings.push('NO_SEGMENTS_FOUND');
  if ((passengers.length || pnr) && !segments.some((segment) => segment.departure_city && segment.arrival_city)) warnings.push('NO_ROUTE_FIELDS_FOUND');
  if (segments.length && (!segments[0].departure_date || !segments[0].departure_time || !segments[0].airline || !segments[0].flight_number)) {
    warnings.push('PARTIAL_ROUTE_ONLY');
  }

  return mapDrafts({
    source: 'PDF',
    pnr,
    bookingDate: tickets[0]?.ticket_issue_date || new Date().toISOString().slice(0, 10),
    passengers,
    segments,
    supplierName: '',
    remarks: 'Parsed from ticket PDF',
    linkedPnr: '',
    warnings,
  });
}

export function parseBookingText({ text, source = 'CRYPTIC', provider = 'auto' }) {
  const normalizedSource = String(source || 'CRYPTIC').toUpperCase();
  if (normalizedSource === 'PDF') return parsePdfBooking(text);
  return parseCrypticBooking(text, provider);
}
