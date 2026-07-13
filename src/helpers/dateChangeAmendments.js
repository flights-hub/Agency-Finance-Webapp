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

const FINANCIAL_FIELDS = [
  'fare_difference',
  'supplier_change_fee',
  'flyforsure_service_fee',
  'agent_markup',
  'tax_difference',
  'other_charges',
];

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

function dateParts(date) {
  const match = text(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;

  return { year, month, day };
}

function timeParts(time) {
  const match = text(time).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

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
  const parsedDate = dateParts(date);
  const parsedTime = timeParts(time);
  if (!parsedDate || !parsedTime) return null;

  const { year, month, day } = parsedDate;
  const { hour, minute, second } = parsedTime;
  const value = Date.UTC(year, month - 1, day, hour, minute, second);
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

function canonicalSnapshot(booking = {}) {
  const snapshot = snapshotItinerary(booking);
  return {
    outbound: withCalculatedDurations(snapshot.outbound),
    inbound: withCalculatedDurations(snapshot.inbound),
  };
}

export function selectCompatibleItinerary(group = [], selectedIds = []) {
  const selected = new Set(selectedIds.map(idKey));
  const rows = group.filter((row) => selected.has(idKey(row.id)));
  const snapshot = rows.length ? canonicalSnapshot(rows[0]) : { outbound: [], inbound: [] };
  const incompatibleIds = rows
    .slice(1)
    .filter((row) => !sameValue(canonicalSnapshot(row), snapshot))
    .map((row) => idKey(row.id));
  return {
    snapshot: clone(snapshot),
    compatible: incompatibleIds.length === 0,
    incompatibleIds,
  };
}

function intendedItinerary(amendment = {}, baseItinerary = amendment.original_itinerary || {}) {
  const original = baseItinerary || {};
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

function sameItinerary(left = {}, right = {}) {
  return sameValue(left.outbound || [], right.outbound || [])
    && sameValue(left.inbound || [], right.inbound || []);
}

export function itinerarySnapshotsEqual(left = {}, right = {}) {
  const canonical = (itinerary) => ({
    outbound: withCalculatedDurations(itinerary?.outbound || []),
    inbound: withCalculatedDurations(itinerary?.inbound || []),
  });
  return sameItinerary(canonical(left), canonical(right));
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

    [
      ['departure_date', 'Departure date', dateParts],
      ['arrival_date', 'Arrival date', dateParts],
      ['departure_time', 'Departure time', timeParts],
      ['arrival_time', 'Arrival time', timeParts],
    ].forEach(([key, label, parse]) => {
      if (text(connection[key]) && !parse(connection[key])) {
        errors.push(`${directionLabel} connection ${index + 1}: ${label} is invalid.`);
      }
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
  const currentItinerary = canonicalSnapshot(row);
  const originalItinerary = {
    outbound: withCalculatedDurations(amendment.original_itinerary?.outbound || []),
    inbound: withCalculatedDurations(amendment.original_itinerary?.inbound || []),
  };
  const finalItinerary = intendedItinerary(amendment, originalItinerary);
  const oldPnr = pnrKey(mapping.old_pnr);
  const newPnr = pnrKey(effectiveNewPnr(mapping));
  const currentPnr = pnrKey(row.pnr);
  const currentTicket = text(row.ticket_no);
  const oldTicket = text(mapping.old_ticket_no);
  const newTicket = text(mapping.new_ticket_no);

  const original = currentPnr === oldPnr
    && currentTicket === oldTicket
    && sameItinerary(currentItinerary, originalItinerary);
  const historyContainsOldPnr = oldPnr === newPnr || bookingPnrAliases(row).includes(oldPnr);
  const final = currentPnr === newPnr
    && currentTicket === newTicket
    && historyContainsOldPnr
    && sameItinerary(currentItinerary, finalItinerary);

  return { original, final };
}

function finalStateOwnedBy(row, amendment, options = {}) {
  const amendmentId = text(options.amendmentId || amendment.id);
  const fingerprint = text(options.finalizationFingerprint);
  return Boolean(amendmentId && fingerprint)
    && text(row.last_date_change_amendment_id) === amendmentId
    && text(row.last_date_change_fingerprint) === fingerprint;
}

export function validateDateChangeFinalization(amendment = {}, group = [], {
  allowPartialRecovery = false,
  amendmentId = '',
  finalizationFingerprint = '',
} = {}) {
  const errors = [];
  const scope = amendment.application_scope;
  const eligible = eligibleRows(amendment, group);
  const selectedIds = selectedPassengerIds(amendment);
  const affected = affectedRows(amendment, group);
  const affectedIds = new Set(affected.map((row) => idKey(row.id)));
  const eligibleIds = new Set(eligible.map((row) => idKey(row.id)));
  const mappings = amendment.passenger_reissues || [];
  const mappingsById = mappingByBookingId(amendment);
  const unaffectedTickets = new Map(group
    .filter((row) => !affectedIds.has(idKey(row.id)))
    .map((row) => [ticketKey(row.ticket_no), idKey(row.id)])
    .filter(([ticket]) => ticket));

  if (affected.length > 1) {
    const compatibility = selectCompatibleItinerary(affected, affected.map((row) => row.id));
    if (!compatibility.compatible && !allowPartialRecovery) {
      errors.push('Affected passengers do not share one compatible itinerary cohort; finalize them passenger-wise.');
    }
  }

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
    if (selectedDirections.includes('inbound')) {
      affected.forEach((row) => {
        if (!canonicalSnapshot(row).inbound.length) {
          errors.push(`Booking row ${idKey(row.id)} has no inbound itinerary for this date change.`);
        }
      });
    }
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
      if (unaffectedTickets.has(newTicket)) {
        errors.push(
          `New ticket number ${text(mapping.new_ticket_no)} is already used by unaffected booking row ${unaffectedTickets.get(newTicket)}.`,
        );
      }
      seenTickets.add(newTicket);
    }

    const state = rowState(row, mapping, amendment);
    const ownedFinal = state.final && finalStateOwnedBy(row, amendment, {
      amendmentId,
      finalizationFingerprint,
    });
    if (!state.original && !(allowPartialRecovery && ownedFinal)) {
      errors.push(`Booking row ${bookingId} is stale; refresh and review it before finalizing.`);
    }
  });

  return [...new Set(errors)];
}

function normalizedFinancials(amendment = {}) {
  const values = {};
  const errors = [];
  FINANCIAL_FIELDS.forEach((field) => {
    const raw = amendment[field];
    const value = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`${field.replace(/_/g, ' ')} must be a finite financial value.`);
    } else if (field !== 'fare_difference' && value < 0) {
      errors.push(`${field.replace(/_/g, ' ')} cannot be negative.`);
    } else {
      values[field] = Math.round((value + Number.EPSILON) * 100) / 100;
    }
  });
  if (errors.length) throw new Error(errors.join('\n'));
  const total = FINANCIAL_FIELDS.reduce((sum, field) => sum + values[field], 0);
  return {
    ...values,
    total_financial_impact: Math.round((total + Number.EPSILON) * 100) / 100,
  };
}

function validateFinalizationContext(context = {}) {
  const errors = [];
  const actor = text(context.actor);
  const finalizedAt = text(context.finalizedAt);
  const amendmentId = text(context.amendmentId);
  const fingerprint = text(context.finalizationFingerprint);

  if (!actor) errors.push('Finalization actor is required.');
  if (!amendmentId) errors.push('Finalization amendment ID is required.');
  if (!fingerprint) errors.push('Finalization fingerprint is required.');
  if (!finalizedAt) {
    errors.push('Finalization time is required.');
  } else {
    const match = finalizedAt.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
    );
    if (
      !match
      || !dateParts(match[1])
      || !timeParts(match[2])
      || Number.isNaN(Date.parse(finalizedAt))
    ) errors.push('Finalization time must be a valid ISO timestamp.');
  }

  return errors;
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
  const errors = [
    ...validateDateChangeFinalization(amendment, group, {
      allowPartialRecovery: context.allowPartialRecovery === true,
      amendmentId: context.amendmentId,
      finalizationFingerprint: context.finalizationFingerprint,
    }),
    ...validateFinalizationContext(context),
  ];
  if (errors.length) throw new Error(errors.join('\n'));

  const financials = normalizedFinancials(amendment);

  const actor = text(context.actor);
  const finalizedAt = text(context.finalizedAt);
  const amendmentId = text(context.amendmentId);
  const fingerprint = text(context.finalizationFingerprint);
  const mappings = mappingByBookingId(amendment);
  const affectedIds = new Set(affectedRows(amendment, group).map((row) => idKey(row.id)));
  const baseItinerary = {
    outbound: withCalculatedDurations(amendment.original_itinerary?.outbound || []),
    inbound: withCalculatedDurations(amendment.original_itinerary?.inbound || []),
  };
  const finalItinerary = intendedItinerary(amendment, baseItinerary);
  const derived = deriveItineraryFields(finalItinerary);
  const completedReissues = (amendment.passenger_reissues || []).map((mapping) => ({
    ...clone(mapping),
    new_pnr: effectiveNewPnr(mapping),
  }));

  const completed = {
    ...clone(amendment),
    amendment_type: 'DATE_CHANGE',
    booking_ref: targetBookingRef(amendment, group),
    ...financials,
    replacement_itinerary: clone(finalItinerary),
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
    if (
      context.allowPartialRecovery === true
      && rowState(row, mapping, amendment).final
      && finalStateOwnedBy(row, amendment, {
        amendmentId,
        finalizationFingerprint: fingerprint,
      })
    ) return row;

    return {
      ...row,
      ...derived,
      pnr: effectiveNewPnr(mapping),
      pnr_history: updatedPnrHistory(row, mapping),
      ticket_no: text(mapping.new_ticket_no),
      flight_segments: clone(itinerarySegments(finalItinerary)),
      last_date_change_amendment_id: amendmentId,
      last_date_change_fingerprint: fingerprint,
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
  const connectionDetails = connections.map((connection) => {
    const flight = `${text(connection.airline)}${text(connection.flight_number)}`;
    const times = [text(connection.departure_time), text(connection.arrival_time)]
      .filter(Boolean)
      .join('–');
    return [flight, times].filter(Boolean).join(' ');
  }).filter(Boolean).join(', ');
  return [
    [route, departureDate].filter(Boolean).join(' '),
    connectionDetails,
  ].filter(Boolean).join(' · ');
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
  const seenPnrChanges = new Set();
  const pnrChanges = mappings.flatMap((mapping) => {
    const oldPnr = text(mapping.old_pnr);
    const newPnr = effectiveNewPnr(mapping);
    if (!oldPnr && !newPnr) return [];
    const key = `${pnrKey(oldPnr)}→${pnrKey(newPnr)}`;
    if (seenPnrChanges.has(key)) return [];
    seenPnrChanges.add(key);
    return `${oldPnr || '-'} → ${newPnr || '-'}`;
  });
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
