import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amendmentTimelineSummary,
  applyDateChangeAmendment,
  connectionDuration,
  createPassengerReissues,
  isDateChangeType,
  normalizeDateChange,
  snapshotItinerary,
  validateDateChangeFinalization,
} from './dateChangeAmendments.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

const connection = (id, overrides = {}) => ({
  id,
  airline: 'QR',
  flight_number: '100',
  departure_city: 'FCO',
  arrival_city: 'DOH',
  departure_date: '2026-07-20',
  arrival_date: '2026-07-20',
  departure_time: '10:00',
  arrival_time: '17:00',
  departure_terminal: '1',
  arrival_terminal: '2',
  duration: '7h 0m',
  check_in_baggage: '25 KG',
  cabin_baggage: '7 KG',
  ...overrides,
});

const originalSegments = [
  {
    id: 'outbound',
    label: 'Outbound',
    connections: [
      connection('out-1'),
      connection('out-2', {
        flight_number: '570',
        departure_city: 'DOH',
        arrival_city: 'DEL',
        departure_time: '20:00',
        arrival_date: '2026-07-21',
        arrival_time: '02:00',
        duration: '6h 0m',
      }),
    ],
  },
  {
    id: 'inbound',
    label: 'Inbound',
    connections: [
      connection('in-1', {
        flight_number: '571',
        departure_city: 'DEL',
        arrival_city: 'DOH',
        departure_date: '2026-07-30',
        arrival_date: '2026-07-30',
        departure_time: '04:00',
        arrival_time: '06:00',
        duration: '2h 0m',
      }),
      connection('in-2', {
        flight_number: '101',
        departure_city: 'DOH',
        arrival_city: 'FCO',
        departure_date: '2026-07-30',
        arrival_date: '2026-07-30',
        departure_time: '09:00',
        arrival_time: '14:00',
        duration: '5h 0m',
      }),
    ],
  },
];

const group = [
  {
    id: 'p1',
    booking_ref: 'BOOK-1',
    invoice_no: 'INV-1',
    passenger_name: 'Ada Lovelace',
    pnr: 'ABC123',
    pnr_history: [],
    ticket_no: 'OLD-TKT-1',
    airline: 'QR',
    sector: 'FCO-DEL',
    outbound_date: '2026-07-20',
    inbound_date: '2026-07-30',
    onward_date: '2026-07-20',
    return_date: '2026-07-30',
    flight_segments: clone(originalSegments),
  },
  {
    id: 'p2',
    booking_ref: 'BOOK-1',
    invoice_no: 'INV-1',
    passenger_name: 'Grace Hopper',
    pnr: 'ABC123',
    ticket_no: 'OLD-TKT-2',
    airline: 'QR',
    sector: 'FCO-DEL',
    outbound_date: '2026-07-20',
    inbound_date: '2026-07-30',
    onward_date: '2026-07-20',
    return_date: '2026-07-30',
    flight_segments: clone(originalSegments),
  },
];

const originalItinerary = snapshotItinerary(group[0]);

const replacementOutbound = [{
  id: 'outbound',
  label: 'Outbound',
  connections: [
    connection('new-out-1', {
      airline: 'TK',
      flight_number: '1862',
      departure_city: 'FCO',
      arrival_city: 'IST',
      departure_date: '2026-07-25',
      arrival_date: '2026-07-25',
      departure_time: '09:00',
      arrival_time: '13:00',
      duration: 'manually entered',
    }),
    connection('new-out-2', {
      airline: 'TK',
      flight_number: '716',
      departure_city: 'IST',
      arrival_city: 'DEL',
      departure_date: '2026-07-25',
      arrival_date: '2026-07-26',
      departure_time: '15:00',
      arrival_time: '00:30',
      duration: 'manually entered',
    }),
  ],
}];

const amendment = {
  id: 'amd-1',
  amendment_no: 'AMD-001',
  amendment_type: 'DATE_CHANGE',
  status: 'CUSTOMER_APPROVED',
  booking_ref: 'BOOK-1',
  application_scope: 'SELECTED_PASSENGERS',
  travel_direction: 'OUTBOUND',
  selected_passenger_ids: ['p1'],
  original_itinerary: clone(originalItinerary),
  replacement_itinerary: {
    outbound: clone(replacementOutbound),
    inbound: clone(originalItinerary.inbound),
  },
  passenger_reissues: [{
    booking_id: 'p1',
    passenger_name: 'Ada Lovelace',
    old_pnr: 'ABC123',
    new_pnr: 'SPLIT9',
    old_ticket_no: 'OLD-TKT-1',
    new_ticket_no: 'NEW-TKT-1',
    reissue_reference: 'WAIVER-9',
  }],
  remarks: 'Customer accepted the new dates.',
};

const context = {
  actor: 'Ops User',
  finalizedAt: '2026-07-12T14:00:00.000Z',
};

test('date-change types normalize legacy directions without changing other amendment types', () => {
  assert.equal(isDateChangeType('DATE_CHANGE'), true);
  assert.equal(isDateChangeType('OUTBOUND_DATE_CHANGE'), true);
  assert.equal(isDateChangeType('NAME_CORRECTION'), false);
  assert.deepEqual(normalizeDateChange('INBOUND_DATE_CHANGE'), {
    amendmentType: 'DATE_CHANGE',
    direction: 'INBOUND',
  });
  assert.deepEqual(normalizeDateChange('DATE_CHANGE', 'BOTH'), {
    amendmentType: 'DATE_CHANGE',
    direction: 'BOTH',
  });
  assert.deepEqual(normalizeDateChange('NAME_CORRECTION'), {
    amendmentType: 'NAME_CORRECTION',
    direction: 'OUTBOUND',
  });
});

test('snapshotItinerary splits outbound and inbound groups into an immutable clone', () => {
  const snapshot = snapshotItinerary(group[0]);

  assert.equal(snapshot.outbound.length, 1);
  assert.equal(snapshot.inbound.length, 1);
  assert.notEqual(snapshot.outbound[0], group[0].flight_segments[0]);
  snapshot.outbound[0].connections[0].flight_number = 'CHANGED';
  assert.equal(group[0].flight_segments[0].connections[0].flight_number, '100');
});

test('snapshotItinerary falls back to the first segment as outbound for legacy round trips', () => {
  const booking = {
    inbound_date: '2026-09-10',
    flight_segments: [
      { id: 'leg-1', label: 'Leg 1', connections: [] },
      { id: 'leg-2', label: 'Leg 2', connections: [] },
      { id: 'leg-3', label: 'Leg 3', connections: [] },
    ],
  };

  assert.deepEqual(snapshotItinerary(booking), {
    outbound: [booking.flight_segments[0]],
    inbound: booking.flight_segments.slice(1),
  });
});

test('createPassengerReissues scopes mappings and preserves existing reissue input', () => {
  const result = createPassengerReissues(group, ['p2'], [{
    booking_id: 'p2',
    passenger_name: 'Grace Hopper',
    old_pnr: 'ABC123',
    new_pnr: 'SPLIT8',
    old_ticket_no: 'OLD-TKT-2',
    new_ticket_no: 'NEW-TKT-2',
    reissue_reference: 'REF-2',
  }]);

  assert.deepEqual(result, [{
    booking_id: 'p2',
    passenger_name: 'Grace Hopper',
    old_pnr: 'ABC123',
    new_pnr: 'SPLIT8',
    old_ticket_no: 'OLD-TKT-2',
    new_ticket_no: 'NEW-TKT-2',
    reissue_reference: 'REF-2',
  }]);
  assert.deepEqual(createPassengerReissues(group, ['p1'], []), [{
    booking_id: 'p1',
    passenger_name: 'Ada Lovelace',
    old_pnr: 'ABC123',
    new_pnr: 'ABC123',
    old_ticket_no: 'OLD-TKT-1',
    new_ticket_no: '',
    reissue_reference: '',
  }]);
});

test('connectionDuration derives a local elapsed duration and rejects impossible times', () => {
  assert.equal(connectionDuration(connection('duration', {
    departure_date: '2026-08-01',
    departure_time: '10:15',
    arrival_date: '2026-08-01',
    arrival_time: '12:45',
  })), '2h 30m');
  assert.equal(connectionDuration(connection('invalid-duration', {
    departure_time: '12:45',
    arrival_time: '10:15',
  })), '');
  assert.equal(connectionDuration({}), '');
});

test('outbound passenger-wise finalization preserves inbound and the unselected passenger', () => {
  const source = clone(group);
  const result = applyDateChangeAmendment(amendment, group, {
    actor: 'Ops User',
    finalizedAt: '2026-07-12T14:00:00.000Z',
  });
  const changed = result.bookings.find((row) => row.id === 'p1');
  const unchanged = result.bookings.find((row) => row.id === 'p2');

  assert.equal(result.amendment.status, 'COMPLETED');
  assert.equal(result.amendment.amendment_type, 'DATE_CHANGE');
  assert.equal(result.amendment.finalized_at, '2026-07-12T14:00:00.000Z');
  assert.equal(result.amendment.finalized_by, 'Ops User');
  assert.equal(result.amendment.confirmed_at, '2026-07-12T14:00:00.000Z');
  assert.equal(changed.booking_ref, 'BOOK-1');
  assert.equal(changed.pnr, 'SPLIT9');
  assert.deepEqual(changed.pnr_history, ['ABC123']);
  assert.equal(changed.ticket_no, 'NEW-TKT-1');
  assert.equal(changed.airline, 'TK');
  assert.equal(changed.sector, 'FCO-DEL');
  assert.equal(changed.outbound_date, '2026-07-25');
  assert.equal(changed.onward_date, '2026-07-25');
  assert.equal(changed.inbound_date, '2026-07-30');
  assert.equal(changed.return_date, '2026-07-30');
  assert.equal(changed.flight_segments[0].connections[0].duration, '4h 0m');
  assert.deepEqual(changed.flight_segments[1], group[0].flight_segments[1]);
  assert.deepEqual(unchanged, group[1]);
  assert.deepEqual(group, source);
});

test('inbound PNR-wide finalization changes every passenger and preserves outbound', () => {
  const inboundReplacement = [{
    id: 'inbound',
    label: 'Inbound',
    connections: [connection('new-in-direct', {
      airline: 'AI',
      flight_number: '137',
      departure_city: 'DEL',
      arrival_city: 'FCO',
      departure_date: '2026-08-15',
      arrival_date: '2026-08-15',
      departure_time: '03:00',
      arrival_time: '12:00',
    })],
  }];
  const inboundAmendment = {
    ...clone(amendment),
    id: 'amd-2',
    application_scope: 'PNR_WIDE',
    travel_direction: 'INBOUND',
    selected_passenger_ids: [],
    replacement_itinerary: {
      outbound: clone(originalItinerary.outbound),
      inbound: inboundReplacement,
    },
    passenger_reissues: createPassengerReissues(group, ['p1', 'p2'], []).map((mapping, index) => ({
      ...mapping,
      new_ticket_no: `NEW-TKT-${index + 1}`,
    })),
  };

  const result = applyDateChangeAmendment(inboundAmendment, group, context);

  assert.equal(result.bookings.length, 2);
  assert.equal(result.bookings[0].ticket_no, 'NEW-TKT-1');
  assert.equal(result.bookings[1].ticket_no, 'NEW-TKT-2');
  assert.deepEqual(result.bookings[0].flight_segments[0], group[0].flight_segments[0]);
  assert.equal(result.bookings[0].flight_segments[1].connections.length, 1);
  assert.equal(result.bookings[0].outbound_date, '2026-07-20');
  assert.equal(result.bookings[0].inbound_date, '2026-08-15');
});

test('both-direction finalization replaces any number of connections', () => {
  const directOutbound = [{
    id: 'outbound',
    label: 'Outbound',
    connections: [connection('direct-out', {
      airline: 'AI',
      flight_number: '138',
      departure_city: 'FCO',
      arrival_city: 'DEL',
      departure_date: '2026-08-01',
      arrival_date: '2026-08-02',
      departure_time: '21:00',
      arrival_time: '08:00',
    })],
  }];
  const threeConnectionInbound = [{
    id: 'inbound',
    label: 'Inbound',
    connections: [
      connection('three-in-1', {
        airline: 'EK',
        flight_number: '511',
        departure_city: 'DEL',
        arrival_city: 'DXB',
        departure_date: '2026-08-20',
        arrival_date: '2026-08-20',
        departure_time: '04:00',
        arrival_time: '06:00',
      }),
      connection('three-in-2', {
        airline: 'EK',
        flight_number: '209',
        departure_city: 'DXB',
        arrival_city: 'ATH',
        departure_date: '2026-08-20',
        arrival_date: '2026-08-20',
        departure_time: '08:00',
        arrival_time: '12:00',
      }),
      connection('three-in-3', {
        airline: 'AZ',
        flight_number: '721',
        departure_city: 'ATH',
        arrival_city: 'FCO',
        departure_date: '2026-08-20',
        arrival_date: '2026-08-20',
        departure_time: '14:00',
        arrival_time: '16:00',
      }),
    ],
  }];
  const bothDirections = {
    ...clone(amendment),
    travel_direction: 'BOTH',
    replacement_itinerary: {
      outbound: directOutbound,
      inbound: threeConnectionInbound,
    },
  };

  const result = applyDateChangeAmendment(bothDirections, group, context);
  assert.equal(result.bookings[0].flight_segments[0].connections.length, 1);
  assert.equal(result.bookings[0].flight_segments[1].connections.length, 3);
  assert.equal(result.bookings[0].outbound_date, '2026-08-01');
  assert.equal(result.bookings[0].inbound_date, '2026-08-20');
});

test('validation rejects discontinuous routes, impossible chronology, and duplicate tickets', () => {
  const invalidAmendment = {
    ...clone(amendment),
    application_scope: 'PNR_WIDE',
    selected_passenger_ids: ['p1', 'p2'],
    passenger_reissues: [
      { ...clone(amendment.passenger_reissues[0]), new_pnr: 'ABC123', new_ticket_no: 'DUPLICATE' },
      {
        booking_id: 'p2',
        passenger_name: 'Grace Hopper',
        old_pnr: 'ABC123',
        new_pnr: 'ABC123',
        old_ticket_no: 'OLD-TKT-2',
        new_ticket_no: 'DUPLICATE',
        reissue_reference: '',
      },
    ],
  };
  invalidAmendment.replacement_itinerary.outbound[0].connections[0].arrival_time = '08:00';
  invalidAmendment.replacement_itinerary.outbound[0].connections[1].departure_city = 'DXB';

  const errors = validateDateChangeFinalization(invalidAmendment, group);
  assert.ok(errors.some((error) => error.includes('does not connect')));
  assert.ok(errors.some((error) => error.includes('after departure')));
  assert.ok(errors.some((error) => error.includes('duplicate')));
});

test('validation checks scope, required fields, booking membership, and stale rows', () => {
  const invalid = {
    ...clone(amendment),
    selected_passenger_ids: [],
    passenger_reissues: [{
      booking_id: 'outside-row',
      passenger_name: 'Outside Passenger',
      old_pnr: 'OTHER',
      new_pnr: 'OTHER',
      old_ticket_no: 'OLD-OUTSIDE',
      new_ticket_no: '',
    }],
  };
  invalid.replacement_itinerary.outbound[0].connections[0].airline = '';

  const errors = validateDateChangeFinalization(invalid, group);
  assert.ok(errors.some((error) => error.includes('selected passenger')));
  assert.ok(errors.some((error) => error.includes('affected booking')));
  assert.ok(errors.some((error) => error.includes('Airline')));

  const staleGroup = clone(group);
  staleGroup[0].ticket_no = 'THIRD-TICKET';
  const staleErrors = validateDateChangeFinalization(amendment, staleGroup);
  assert.ok(staleErrors.some((error) => error.includes('stale')));
});

test('application throws all validation errors without mutating the booking group', () => {
  const invalid = clone(amendment);
  invalid.passenger_reissues[0].new_ticket_no = '';
  invalid.replacement_itinerary.outbound = [];
  const before = clone(group);

  assert.throws(
    () => applyDateChangeAmendment(invalid, group, context),
    (error) => error.message.includes('replacement itinerary') && error.message.includes('new ticket'),
  );
  assert.deepEqual(group, before);
});

[
  ['missing', { finalizedAt: context.finalizedAt }],
  ['blank', { actor: '   ', finalizedAt: context.finalizedAt }],
].forEach(([description, invalidContext]) => {
  test(`application rejects a ${description} finalization actor without mutating bookings`, () => {
    const before = clone(group);

    assert.throws(
      () => applyDateChangeAmendment(amendment, group, invalidContext),
      /Finalization actor is required/,
    );
    assert.deepEqual(group, before);
  });
});

[
  ['missing', { actor: context.actor }, /Finalization time is required/],
  ['invalid', { actor: context.actor, finalizedAt: 'not-a-timestamp' }, /valid ISO timestamp/],
].forEach(([description, invalidContext, expectedError]) => {
  test(`application rejects a ${description} finalization time without mutating bookings`, () => {
    const before = clone(group);

    assert.throws(
      () => applyDateChangeAmendment(amendment, group, invalidContext),
      expectedError,
    );
    assert.deepEqual(group, before);
  });
});

[
  ['invalid date', 'departure_date', '2026-02-30', 'Departure date is invalid'],
  ['invalid time', 'arrival_time', '17:7x', 'Arrival time is invalid'],
].forEach(([description, field, value, expectedError]) => {
  test(`validation rejects a non-empty ${description}`, () => {
    const invalid = clone(amendment);
    invalid.replacement_itinerary.outbound[0].connections[0][field] = value;

    const errors = validateDateChangeFinalization(invalid, group);
    assert.ok(errors.some((error) => error.includes(expectedError)), errors.join('\n'));
  });
});

test("validation rejects a new ticket already held by an unaffected booking row", () => {
  const collision = clone(amendment);
  collision.passenger_reissues[0].new_ticket_no = group[1].ticket_no;

  const errors = validateDateChangeFinalization(collision, group);
  assert.ok(errors.some((error) => error.includes('unaffected booking row p2')), errors.join('\n'));
});

test('application persists an inferred stable booking reference on the completed amendment', () => {
  const withoutBookingRef = clone(amendment);
  delete withoutBookingRef.booking_ref;

  const result = applyDateChangeAmendment(withoutBookingRef, group, context);

  assert.equal(result.amendment.booking_ref, 'BOOK-1');
});

test('retry accepts original and intended-final rows without duplicating PNR history', () => {
  const pnrWide = {
    ...clone(amendment),
    application_scope: 'PNR_WIDE',
    selected_passenger_ids: ['p1', 'p2'],
    passenger_reissues: [
      clone(amendment.passenger_reissues[0]),
      {
        booking_id: 'p2',
        passenger_name: 'Grace Hopper',
        old_pnr: 'ABC123',
        new_pnr: 'ABC123',
        old_ticket_no: 'OLD-TKT-2',
        new_ticket_no: 'NEW-TKT-2',
        reissue_reference: '',
      },
    ],
  };
  const first = applyDateChangeAmendment(pnrWide, group, context);
  const retry = applyDateChangeAmendment(pnrWide, first.bookings, context);
  assert.deepEqual(retry.bookings, first.bookings);
  assert.deepEqual(retry.bookings[0].pnr_history, ['ABC123']);

  const partial = [first.bookings[0], group[1]];
  const completedRetry = applyDateChangeAmendment(pnrWide, partial, context);
  assert.deepEqual(completedRetry.bookings, first.bookings);

  const stale = clone(partial);
  stale[1].flight_segments[0].connections[0].flight_number = 'THIRD-STATE';
  assert.throws(() => applyDateChangeAmendment(pnrWide, stale, context), /stale/);
});

test('route continuity compares airport values case-insensitively', () => {
  const mixedCase = clone(amendment);
  mixedCase.replacement_itinerary.outbound[0].connections[0].arrival_city = 'ist';
  mixedCase.replacement_itinerary.outbound[0].connections[1].departure_city = 'IST';

  assert.deepEqual(validateDateChangeFinalization(mixedCase, group), []);
});

test('timeline summary includes scope, direction, passenger, PNR split, and ticket reissue', () => {
  const summary = amendmentTimelineSummary({
    ...amendment,
    status: 'COMPLETED',
    finalized_by: 'Ops User',
    finalized_at: context.finalizedAt,
  });

  assert.match(summary, /Passenger-wise/);
  assert.match(summary, /Outbound/);
  assert.match(summary, /Ada Lovelace/);
  assert.match(summary, /ABC123 → SPLIT9/);
  assert.match(summary, /OLD-TKT-1 → NEW-TKT-1/);
});

test('timeline summary includes each unique PNR mapping once without losing passengers or tickets', () => {
  const summary = amendmentTimelineSummary({
    ...clone(amendment),
    passenger_reissues: [
      {
        booking_id: 'p1',
        passenger_name: 'Ada Lovelace',
        old_pnr: 'ABC123',
        new_pnr: 'NEW999',
        old_ticket_no: 'OLD-TKT-1',
        new_ticket_no: 'NEW-TKT-1',
      },
      {
        booking_id: 'p2',
        passenger_name: 'Grace Hopper',
        old_pnr: 'ABC123',
        new_pnr: 'NEW999',
        old_ticket_no: 'OLD-TKT-2',
        new_ticket_no: 'NEW-TKT-2',
      },
      {
        booking_id: 'p3',
        passenger_name: 'Katherine Johnson',
        old_pnr: 'ABC123',
        new_pnr: 'ABC123',
        old_ticket_no: 'OLD-TKT-3',
        new_ticket_no: 'NEW-TKT-3',
      },
    ],
  });

  assert.equal(summary.split('ABC123 → NEW999').length - 1, 1);
  assert.equal(summary.split('ABC123 → ABC123').length - 1, 1);
  assert.match(summary, /Ada Lovelace, Grace Hopper, Katherine Johnson/);
  assert.match(summary, /OLD-TKT-1 → NEW-TKT-1/);
  assert.match(summary, /OLD-TKT-2 → NEW-TKT-2/);
  assert.match(summary, /OLD-TKT-3 → NEW-TKT-3/);
});

test('timeline summary distinguishes same-route flight and time changes with compact connection details', () => {
  const originalConnection = connection('original', {
    airline: 'AZ',
    flight_number: '100',
    departure_city: 'FCO',
    arrival_city: 'DEL',
    departure_date: '2026-08-01',
    arrival_date: '2026-08-01',
    departure_time: '10:00',
    arrival_time: '12:00',
  });
  const replacementConnection = connection('replacement', {
    airline: 'AZ',
    flight_number: '900',
    departure_city: 'FCO',
    arrival_city: 'DEL',
    departure_date: '2026-08-01',
    arrival_date: '2026-08-01',
    departure_time: '18:00',
    arrival_time: '20:00',
  });
  const summary = amendmentTimelineSummary({
    ...clone(amendment),
    original_itinerary: {
      outbound: [{ label: 'Outbound', connections: [originalConnection] }],
      inbound: [],
    },
    replacement_itinerary: {
      outbound: [{ label: 'Outbound', connections: [replacementConnection] }],
      inbound: [],
    },
  });

  assert.match(
    summary,
    /Outbound: FCO-DEL 2026-08-01 · AZ100 10:00–12:00 → FCO-DEL 2026-08-01 · AZ900 18:00–20:00/,
  );
});

test('timeline summary keeps multi-connection flight and time details readable', () => {
  const summary = amendmentTimelineSummary(amendment);

  assert.match(
    summary,
    /FCO-DOH-DEL 2026-07-20 · QR100 10:00–17:00, QR570 20:00–02:00/,
  );
  assert.match(
    summary,
    /FCO-IST-DEL 2026-07-25 · TK1862 09:00–13:00, TK716 15:00–00:30/,
  );
});
