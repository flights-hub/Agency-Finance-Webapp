import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizationHttpError,
  loadBookingGroupByRef,
  persistDateChangeFinalization,
} from './amendmentFinalization.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

const originalSegments = [{
  id: 'outbound',
  label: 'Outbound',
  connections: [{
    id: 'original-flight',
    airline: 'QR',
    flight_number: '100',
    departure_city: 'FCO',
    arrival_city: 'DEL',
    departure_date: '2026-07-20',
    arrival_date: '2026-07-20',
    departure_time: '10:00',
    arrival_time: '18:00',
  }],
}];

const replacementSegments = [{
  id: 'outbound',
  label: 'Outbound',
  connections: [{
    id: 'replacement-flight',
    airline: 'AI',
    flight_number: '138',
    departure_city: 'FCO',
    arrival_city: 'DEL',
    departure_date: '2026-07-25',
    arrival_date: '2026-07-25',
    departure_time: '11:00',
    arrival_time: '19:00',
  }],
}];

const group = [
  {
    id: 'p1',
    booking_ref: 'BOOK-1',
    invoice_no: 'INV-1',
    passenger_name: 'Ada Lovelace',
    pnr: 'ABC123',
    ticket_no: 'OLD-1',
    flight_segments: clone(originalSegments),
  },
  {
    id: 'p2',
    booking_ref: 'BOOK-1',
    invoice_no: 'INV-1',
    passenger_name: 'Grace Hopper',
    pnr: 'ABC123',
    ticket_no: 'OLD-2',
    flight_segments: clone(originalSegments),
  },
];

const draft = {
  id: 'amd-1',
  amendment_type: 'DATE_CHANGE',
  status: 'CUSTOMER_APPROVED',
  booking_ref: 'BOOK-1',
  application_scope: 'PNR_WIDE',
  travel_direction: 'OUTBOUND',
  selected_passenger_ids: [],
  original_itinerary: { outbound: clone(originalSegments), inbound: [] },
  replacement_itinerary: { outbound: clone(replacementSegments), inbound: [] },
  passenger_reissues: [
    {
      booking_id: 'p1',
      passenger_name: 'Ada Lovelace',
      old_pnr: 'ABC123',
      new_pnr: 'ABC123',
      old_ticket_no: 'OLD-1',
      new_ticket_no: 'NEW-1',
    },
    {
      booking_id: 'p2',
      passenger_name: 'Grace Hopper',
      old_pnr: 'ABC123',
      new_pnr: 'ABC123',
      old_ticket_no: 'OLD-2',
      new_ticket_no: 'NEW-2',
    },
  ],
};

const actor = { id: 'u1', name: 'Ops User' };
const finalizedAt = '2026-07-12T14:00:00.000Z';

test('persists all changed booking rows before the completed amendment', async () => {
  const calls = [];
  const result = await persistDateChangeFinalization({
    draft: clone(draft),
    actor,
    finalizedAt,
    repository: {
      loadBookingGroup: async () => clone(group),
      loadAmendment: async () => null,
      saveBooking: async (row) => {
        calls.push(`booking:${row.id}`);
        return { ...row, persisted: true };
      },
      saveAmendment: async (record) => {
        calls.push(`amendment:${record.id}`);
        return { ...record, persisted: true };
      },
    },
  });

  assert.deepEqual(calls, ['booking:p1', 'booking:p2', `amendment:${result.amendment.id}`]);
  assert.equal(result.amendment.status, 'COMPLETED');
  assert.equal(result.amendment.persisted, true);
  assert.deepEqual(result.bookings.map((row) => row.persisted), [true, true]);
});

test('does not save the amendment when a booking write rejects', async () => {
  let amendmentSaves = 0;
  await assert.rejects(
    persistDateChangeFinalization({
      draft: clone(draft),
      actor,
      finalizedAt,
      repository: {
        loadBookingGroup: async () => clone(group),
        loadAmendment: async () => null,
        saveBooking: async () => { throw new Error('booking write failed'); },
        saveAmendment: async (record) => {
          amendmentSaves += 1;
          return record;
        },
      },
    }),
    /booking write failed/,
  );

  assert.equal(amendmentSaves, 0);
});

test('returns an existing completed amendment and current group without saving again', async () => {
  const completed = { ...clone(draft), status: 'COMPLETED', finalized_at: finalizedAt };
  const calls = [];
  const result = await persistDateChangeFinalization({
    draft: clone(draft),
    actor,
    finalizedAt,
    repository: {
      loadAmendment: async (id) => {
        calls.push(`load-amendment:${id}`);
        return completed;
      },
      loadBookingGroup: async (bookingRef) => {
        calls.push(`load-bookings:${bookingRef}`);
        return clone(group);
      },
      saveBooking: async () => { throw new Error('must not save booking'); },
      saveAmendment: async () => { throw new Error('must not save amendment'); },
    },
  });

  assert.deepEqual(calls, ['load-amendment:amd-1', 'load-bookings:BOOK-1']);
  assert.deepEqual(result, { amendment: completed, bookings: group });
});

test('rejects a completed amendment retry for a different submitted booking reference', async () => {
  const completed = { ...clone(draft), status: 'COMPLETED', finalized_at: finalizedAt };
  const calls = [];

  await assert.rejects(
    persistDateChangeFinalization({
      draft: { ...clone(draft), booking_ref: 'BOOK-OTHER' },
      actor,
      finalizedAt,
      repository: {
        loadAmendment: async () => completed,
        loadBookingGroup: async () => {
          calls.push('load-bookings');
          return clone(group);
        },
        saveBooking: async () => { throw new Error('must not save booking'); },
        saveAmendment: async () => { throw new Error('must not save amendment'); },
      },
    }),
    (error) => error.status === 409 && /booking reference/i.test(error.message),
  );

  assert.deepEqual(calls, []);
});

test('returns the complete group while persisting only rows whose content changed', async () => {
  const passengerDraft = {
    ...clone(draft),
    application_scope: 'SELECTED_PASSENGERS',
    selected_passenger_ids: ['p1'],
    passenger_reissues: [clone(draft.passenger_reissues[0])],
  };
  const savedIds = [];

  const result = await persistDateChangeFinalization({
    draft: passengerDraft,
    actor,
    finalizedAt,
    repository: {
      loadBookingGroup: async () => clone(group),
      loadAmendment: async () => null,
      saveBooking: async (row) => {
        savedIds.push(row.id);
        return row;
      },
      saveAmendment: async (record) => record,
    },
  });

  assert.deepEqual(savedIds, ['p1']);
  assert.equal(result.bookings.length, 2);
  assert.equal(result.bookings[0].ticket_no, 'NEW-1');
  assert.deepEqual(result.bookings[1], group[1]);
});

test('loads a booking group through a PostgREST query scoped to its generated booking reference', async () => {
  const paths = [];
  const rows = [
    { id: 'p1', data: { booking_ref: 'BOOK-1', passenger_name: 'Ada Lovelace' } },
    { id: 'p2', data: { invoice_no: 'BOOK-1', passenger_name: 'Grace Hopper' } },
  ];

  const result = await loadBookingGroupByRef('BOOK-1', async (path) => {
    paths.push(path);
    return rows;
  });

  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/rest\/v1\/bookings\?/);
  assert.match(paths[0], /data->>booking_ref\.eq\.BOOK-1/);
  assert.match(paths[0], /data->>invoice_no\.eq\.BOOK-1/);
  assert.doesNotMatch(paths[0], /bookings\?select=id,data&order=/);
  assert.deepEqual(result, [
    { id: 'p1', booking_ref: 'BOOK-1', passenger_name: 'Ada Lovelace' },
    { id: 'p2', invoice_no: 'BOOK-1', passenger_name: 'Grace Hopper' },
  ]);
});

test('redacts upstream details while preserving deliberate finalization statuses', () => {
  const upstream = new Error('column booking_ref does not exist');
  upstream.status = 403;
  upstream.data = { hint: 'internal database detail' };
  const redacted = finalizationHttpError(upstream);

  assert.equal(redacted.status, 500);
  assert.equal(redacted.message, 'Unable to finalize amendment.');
  assert.equal(redacted.data, undefined);

  for (const status of [400, 401, 403, 409]) {
    const deliberate = new Error(`safe ${status}`);
    deliberate.status = status;
    assert.equal(finalizationHttpError(deliberate), deliberate);
  }

  const unexpected = finalizationHttpError(new Error('unexpected internal detail'));
  assert.equal(unexpected.status, 500);
  assert.equal(unexpected.message, 'Unable to finalize amendment.');
});

test('classifies domain validation failures as bad requests', async () => {
  const invalid = clone(draft);
  invalid.replacement_itinerary.outbound = [];

  await assert.rejects(
    persistDateChangeFinalization({
      draft: invalid,
      actor,
      finalizedAt,
      repository: {
        loadAmendment: async () => null,
        loadBookingGroup: async () => clone(group),
        saveBooking: async () => { throw new Error('must not save booking'); },
        saveAmendment: async () => { throw new Error('must not save amendment'); },
      },
    }),
    (error) => error.status === 400 && /replacement itinerary/i.test(error.message),
  );
});

test('classifies stale booking state as a conflict', async () => {
  const staleGroup = clone(group);
  staleGroup[0].ticket_no = 'THIRD-STATE';

  await assert.rejects(
    persistDateChangeFinalization({
      draft: clone(draft),
      actor,
      finalizedAt,
      repository: {
        loadAmendment: async () => null,
        loadBookingGroup: async () => staleGroup,
        saveBooking: async () => { throw new Error('must not save booking'); },
        saveAmendment: async () => { throw new Error('must not save amendment'); },
      },
    }),
    (error) => error.status === 409 && /stale/i.test(error.message),
  );
});
