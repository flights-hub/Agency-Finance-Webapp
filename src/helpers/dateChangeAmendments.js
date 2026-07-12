import { bookingPnrAliases, stableBookingRef } from './bookingIdentity.js';

const LEGACY_DIRECTIONS = {
  OUTBOUND_DATE_CHANGE: 'OUTBOUND',
  INBOUND_DATE_CHANGE: 'INBOUND',
  BOTH_DATE_CHANGE: 'BOTH',
};

const DIRECTION_KEYS = {
  OUTBOUND: ['outbound'],
  INBOUND: ['inbound'],
  BOTH: ['outbound', 'inbound'],
};

const REQUIRED_CONNECTION_FIELDS = [
  ['airline', 'Airline'],
  ['flight_number', 'Flight number'],
  ['departure_city', 'Departure airport'],
  ['arrival_city', 'Arrival airport'],
  ['departure_date', 'Departure date'],
  ['arrival_date', 'Arrival date'],
  ['departure_time', 'Departure time'],
  ['arrival_time', 'Arrival time'],
];

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const text = (value) => String(value ?? '').trim();
const idKey = (value) => String(value ?? '');
const ticketKey = (value) => text(value).toUpperCase();
const airportKey = (value) => text(value).toUpperCase();
const pnrKey = (value) => bookingPnrAliases({ pnr: value })[0] || '';

export function isDateChangeType(type) {
  return type === 'DATE_CHANGE' || Boolean(LEGACY_DIRECTIONS[type]);
}

export function normalizeDateChange(type, explicitDirection = '') {
  return {
    amendmentType: isDateChangeType(type) ? 'DATE_CHANGE' : type,
    direction: explicitDirection || LEGACY_DIRECTIONS[type] || 'OUTBOUND',
  };
}

export function snapshotItinerary(booking = {}) {
  const segments = clone(booking.flight_segments || []);
  const inboundIndex = segments.findIndex((segment) => /return|inbound/i.test(`${segment.id} ${segment.label}`));
  if (inboundIndex >= 0) return { outbound: segments.slice(0, inboundIndex), inbound: segments.slice(inboundIndex) };
  if (booking.inbound_date && segments.length > 1) return { outbound: segments.slice(0, 1), inbound: segments.slice(1) };
  return { outbound: segments, inbound: [] };
}

export function createPassengerReissues(group = [], selectedIds = [], existing = []) {
  const selected = new Set(selectedIds.map(idKey));
  const existingById = new Map(existing.map((mapping) => [idKey(mapping.booking_id), mapping]));

  return group
    .filter((row) => selected.has(idKey(row.id)))
    .map((row) => {
      const prior = existingById.get(idKey(row.id)) || {};
      const oldPnr = prior.old_pnr ?? row.pnr ?? '';
      const oldTicket = prior.old_ticket_no ?? row.ticket_no ?? '';

      return {
        booking_id: row.id,
        passenger_name: prior.passenger_name ?? row.passenger_name ?? '',
        old_pnr: oldPnr,
        new_pnr: text(prior.new_pnr) || oldPnr,
        old_ticket_no: oldTicket,
        new_ticket_no: prior.new_ticket_no ?? '',
        reissue_reference: prior.reissue_reference ?? '',
      };
    });
}

function dateTimeValue(date, time) {
  const dateMatch = text(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = text(time).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  const value = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(value);

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
    || parsed.getUTCSeconds() !== second
  ) return null;

  return value;
}

export function connectionDuration(connection = {}) {
  const departure = dateTimeValue(connection.departure_date, connection.departure_time);
  const arrival = dateTimeValue(connection.arrival_date, connection.arrival_time);
  if (departure === null || arrival === null || arrival <= departure) return '';

  const totalMinutes = Math.round((arrival - departure) / 60000);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

function directionKeys(amendment = {}) {
  const { direction } = normalizeDateChange(amendment.amendment_type, amendment.travel_direction);
  return DIRECTION_KEYS[direction] || [];
}

function flattenConnections(segments = []) {
  return segments.flatMap((segment) => Array.isArray(segment?.connections) ? segment.connections : []);
}

function withCalculatedDurations(segments = []) {
  return clone(segments).map((segment) => ({
    ...segment,
    connections: (segment.connections || []).map((connection) => ({
      ...connection,
      duration: connectionDuration(connection),
    })),
  }));
}

function intendedItinerary(amendment = {}) {
  const original = amendment.original_itinerary || {};
  const replacement = amendment.replacement_itinerary || {};
  const selected = new Set(directionKeys(amendment));

  return {
    outbound: selected.has('outbound')
      ? withCalculatedDurations(replacement.outbound || [])
      : clone(original.outbound || []),
    inbound: selected.has('inbound')
      ? withCalculatedDurations(replacement.inbound || [])
      : clone(original.inbound || []),
  };
}

function itinerarySegments(itinerary = {}) {
  return [...(itinerary.outbound || []), ...(itinerary.inbound || [])];
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
}

function targetBookingRef(amendment, group) {
  return text(amendment.booking_ref) || text(stableBookingRef(group[0] || {}));
}

function eligibleRows(amendment, group) {
  const targetRef = targetBookingRef(amendment, group);
  if (!targetRef) return [...group];
  return group.filter((row) => text(stableBookingRef(row)) === targetRef);
}

function selectedPassengerIds(amendment) {
  return [...new Set((amendment.selected_passenger_ids || []).map(idKey).filter(Boolean))];
}

function affectedRows(amendment, group) {
  const eligible = eligibleRows(amendment, group);
  if (amendment.application_scope === 'PNR_WIDE') return eligible;
  const selected = new Set(selectedPassengerIds(amendment));
  return eligible.filter((row) => selected.has(idKey(row.id)));
}

function mappingByBookingId(amendment) {
  const mappings = amendment.passenger_reissues || [];
  return new Map(mappings.map((mapping) => [idKey(mapping.booking_id), mapping]));
}

function effectiveNewPnr(mapping = {}) {
  return text(mapping.new_pnr) || text(mapping.old_pnr);
}

function validateConnectionSequence(directionKey, segments, errors) {
  const directionLabel = directionKey === 'outbound' ? 'Outbound' : 'Inbound';
  const connections = flattenConnections(segments);
  if (!segments.length || !connections.length) {
    errors.push(`${directionLabel} replacement itinerary requires at least one connection.`);
    return;
  }

  connections.forEach((connection, index) => {
    REQUIRED_CONNECTION_FIELDS.forEach(([key, label]) => {
      if (!text(connection[key])) errors.push(`${directionLabel} connection ${index + 1}: ${label} is required.`);
    });

    const departure = dateTimeValue(connection.departure_date, connection.departure_time);
    const arrival = dateTimeValue(connection.arrival_date, connection.arrival_time);
    if (departure !== null && arrival !== null && arrival <= departure) {
      errors.push(`${directionLabel} connection ${index + 1}: arrival must be after departure.`);
    }

    if (index === 0) return;
    const previous = connections[index - 1];
    if (
      airportKey(previous.arrival_city)
      && airportKey(connection.departure_city)
      && airportKey(previous.arrival_city) !== airportKey(connection.departure_city)
    ) {
      errors.push(`${directionLabel} connection ${index} does not connect to connection ${index + 1}.`);
    }

    const previousArrival = dateTimeValue(previous.arrival_date, previous.arrival_time);
    if (previousArrival !== null && departure !== null && departure < previousArrival) {
      errors.push(`${directionLabel} connection ${index + 1} departs before the previous connection arrives.`);
    }
  });
}

function validateInboundAfterOutbound(amendment, errors) {
  const itinerary = intendedItinerary(amendment);
  const outbound = flattenConnections(itinerary.outbound);
  const inbound = flattenConnections(itinerary.inbound);
  if (!outbound.length || !inbound.length) return;

  const outboundEnd = outbound[outbound.length - 1];
  const inboundStart = inbound[0];
  const outboundArrival = dateTimeValue(outboundEnd.arrival_date, outboundEnd.arrival_time);
  const inboundDeparture = dateTimeValue(inboundStart.departure_date, inboundStart.departure_time);
  if (outboundArrival !== null && inboundDeparture !== null && inboundDeparture < outboundArrival) {
    errors.push('Inbound journey must begin after the outbound journey ends.');
  }
}

function rowState(row, mapping, amendment) {
  const originalSegments = itinerarySegments(amendment.original_itinerary || {});
  const finalSegments = itinerarySegments(intendedItinerary(amendment));
  const oldPnr = pnrKey(mapping.old_pnr);
  const newPnr = pnrKey(effectiveNewPnr(mapping));
  const currentPnr = pnrKey(row.pnr);
  const currentTicket = text(row.ticket_no);
  const oldTicket = text(mapping.old_ticket_no);
  const newTicket = text(mapping.new_ticket_no);

  const original = currentPnr === oldPnr
    && currentTicket === oldTicket
    && sameValue(row.flight_segments || [], originalSegments);
  const historyContainsOldPnr = oldPnr === newPnr || bookingPnrAliases(row).includes(oldPnr);
  const final = currentPnr === newPnr
    && currentTicket === newTicket
    && historyContainsOldPnr
    && sameValue(row.flight_segments || [], finalSegments);

  return { original, final };
}

export function validateDateChangeFinalization(amendment = {}, group = []) {
  const errors = [];
  const scope = amendment.application_scope;
  const eligible = eligibleRows(amendment, group);
  const selectedIds = selectedPassengerIds(amendment);
  const affected = affectedRows(amendment, group);
  const affectedIds = new Set(affected.map((row) => idKey(row.id)));
  const eligibleIds = new Set(eligible.map((row) => idKey(row.id)));
  const mappings = amendment.passenger_reissues || [];
  const mappingsById = mappingByBookingId(amendment);

  if (scope !== 'PNR_WIDE' && scope !== 'SELECTED_PASSENGERS') {
    errors.push('Application scope must be PNR-wide or selected passengers.');
  } else if (scope === 'PNR_WIDE' && !eligible.length) {
    errors.push('PNR-wide scope must resolve at least one affected booking row.');
  } else if (scope === 'SELECTED_PASSENGERS' && !selectedIds.length) {
    errors.push('Select at least one selected passenger.');
  }

  if (scope === 'SELECTED_PASSENGERS') {
    selectedIds.forEach((bookingId) => {
      if (!eligibleIds.has(bookingId)) {
        errors.push(`Selected passenger ${bookingId} is not an affected booking under this Booking ID.`);
      }
    });
  }

  const selectedDirections = directionKeys(amendment);
  if (!selectedDirections.length) {
    errors.push('Travel direction must be OUTBOUND, INBOUND, or BOTH.');
  } else {
    selectedDirections.forEach((directionKey) => {
      validateConnectionSequence(directionKey, amendment.replacement_itinerary?.[directionKey] || [], errors);
    });
    validateInboundAfterOutbound(amendment, errors);
  }

  const seenMappings = new Set();
  mappings.forEach((mapping) => {
    const bookingId = idKey(mapping.booking_id);
    if (seenMappings.has(bookingId)) errors.push(`Passenger ${bookingId} has a duplicate reissue mapping.`);
    seenMappings.add(bookingId);
    if (!affectedIds.has(bookingId)) {
      errors.push(`Reissue mapping ${bookingId || '(missing ID)'} does not correspond to an affected booking row.`);
    }
  });

  const seenTickets = new Set();
  affected.forEach((row) => {
    const bookingId = idKey(row.id);
    const mapping = mappingsById.get(bookingId);
    if (!mapping) {
      errors.push(`Affected passenger ${bookingId} requires a passenger reissue mapping and new ticket number.`);
      return;
    }

    const newTicket = ticketKey(mapping.new_ticket_no);
    if (!newTicket) {
      errors.push(`Affected passenger ${bookingId} requires a new ticket number.`);
    } else {
      if (newTicket === ticketKey(mapping.old_ticket_no)) {
        errors.push(`Affected passenger ${bookingId}'s new ticket number must differ from the old ticket number.`);
      }
      if (seenTickets.has(newTicket)) errors.push(`New ticket number ${text(mapping.new_ticket_no)} is duplicate.`);
      seenTickets.add(newTicket);
    }

    const state = rowState(row, mapping, amendment);
    if (!state.original && !state.final) {
      errors.push(`Booking row ${bookingId} is stale; refresh and review it before finalizing.`);
    }
  });

  return [...new Set(errors)];
}

function deduplicatePnrHistory(history = []) {
  const seen = new Set();
  return history.filter((value) => {
    const key = pnrKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updatedPnrHistory(row, mapping) {
  const history = [...(row.pnr_history || [])];
  const oldPnr = text(mapping.old_pnr);
  const newPnr = effectiveNewPnr(mapping);
  if (pnrKey(oldPnr) !== pnrKey(newPnr)) history.push(oldPnr);
  return deduplicatePnrHistory(history);
}

function deriveItineraryFields(itinerary) {
  const outbound = flattenConnections(itinerary.outbound);
  const inbound = flattenConnections(itinerary.inbound);
  const firstOutbound = outbound[0] || {};
  const lastOutbound = outbound[outbound.length - 1] || firstOutbound;
  const firstInbound = inbound[0] || {};
  const outboundDate = text(firstOutbound.departure_date);
  const inboundDate = text(firstInbound.departure_date);

  return {
    airline: text(firstOutbound.airline),
    sector: [text(firstOutbound.departure_city), text(lastOutbound.arrival_city)].filter(Boolean).join('-'),
    outbound_date: outboundDate,
    inbound_date: inboundDate,
    onward_date: outboundDate,
    return_date: inboundDate,
  };
}

export function applyDateChangeAmendment(amendment = {}, group = [], context = {}) {
  const errors = validateDateChangeFinalization(amendment, group);
  if (errors.length) throw new Error(errors.join('\n'));

  const { actor, finalizedAt } = context;
  const mappings = mappingByBookingId(amendment);
  const affectedIds = new Set(affectedRows(amendment, group).map((row) => idKey(row.id)));
  const finalItinerary = intendedItinerary(amendment);
  const derived = deriveItineraryFields(finalItinerary);
  const completedReissues = (amendment.passenger_reissues || []).map((mapping) => ({
    ...clone(mapping),
    new_pnr: effectiveNewPnr(mapping),
  }));

  const completed = {
    ...clone(amendment),
    amendment_type: 'DATE_CHANGE',
    passenger_reissues: completedReissues,
    status: 'COMPLETED',
    finalized_at: finalizedAt,
    finalized_by: actor,
    confirmed_at: amendment.confirmed_at || finalizedAt,
    confirmed_by: amendment.confirmed_by || actor,
    updated_at: finalizedAt,
  };

  const bookings = group.map((row) => {
    const bookingId = idKey(row.id);
    if (!affectedIds.has(bookingId)) return row;
    const mapping = mappings.get(bookingId);

    return {
      ...row,
      ...derived,
      pnr: effectiveNewPnr(mapping),
      pnr_history: updatedPnrHistory(row, mapping),
      ticket_no: text(mapping.new_ticket_no),
      flight_segments: clone(itinerarySegments(finalItinerary)),
    };
  });

  return { amendment: completed, bookings };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function journeySummary(segments = []) {
  const connections = flattenConnections(segments);
  if (!connections.length) return 'No itinerary';
  const route = [
    text(connections[0].departure_city),
    ...connections.map((connection) => text(connection.arrival_city)),
  ].filter(Boolean).join('-');
  const departureDate = text(connections[0].departure_date);
  return [route, departureDate].filter(Boolean).join(' ');
}

export function amendmentTimelineSummary(amendment = {}) {
  const scope = amendment.application_scope === 'PNR_WIDE' ? 'PNR-wide' : 'Passenger-wise';
  const direction = normalizeDateChange(amendment.amendment_type, amendment.travel_direction).direction;
  const directionLabel = {
    OUTBOUND: 'Outbound',
    INBOUND: 'Inbound',
    BOTH: 'Both directions',
  }[direction] || direction;
  const mappings = amendment.passenger_reissues || [];
  const passengers = unique(mappings.map((mapping) => text(mapping.passenger_name)));
  const pnrChanges = mappings
    .filter((mapping) => pnrKey(mapping.old_pnr) !== pnrKey(effectiveNewPnr(mapping)))
    .map((mapping) => `${text(mapping.old_pnr)} → ${effectiveNewPnr(mapping)}`);
  const ticketChanges = mappings
    .filter((mapping) => text(mapping.old_ticket_no) || text(mapping.new_ticket_no))
    .map((mapping) => `${text(mapping.old_ticket_no) || '-'} → ${text(mapping.new_ticket_no) || '-'}`);
  const itineraryChanges = directionKeys(amendment).map((directionKey) => {
    const label = directionKey === 'outbound' ? 'Outbound' : 'Inbound';
    const before = journeySummary(amendment.original_itinerary?.[directionKey] || []);
    const after = journeySummary(amendment.replacement_itinerary?.[directionKey] || []);
    return `${label}: ${before} → ${after}`;
  });

  return [
    scope,
    directionLabel,
    passengers.join(', '),
    ...pnrChanges,
    ...ticketChanges,
    ...itineraryChanges,
  ].filter(Boolean).join(' · ');
}
