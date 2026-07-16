import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFinanceRecordInvariant,
  saveVersionedFinanceRecord,
} from './financeRecordInvariants.js';

const check = (collection, incoming, existing = null) => (
  assertFinanceRecordInvariant({ collection, incoming, existing })
);

test('generic amendment writes cannot create or finalize a modern date change', () => {
  for (const status of ['FINALIZING', 'CONFIRMED', 'COMPLETED']) {
    assert.throws(
      () => check('amendments', { id: 'a1', amendment_type: 'DATE_CHANGE', status }),
      /finalize endpoint/i,
    );
  }
  assert.doesNotThrow(() => check('amendments', {
    id: 'a1', amendment_type: 'DATE_CHANGE', status: 'QUOTED', booking_ref: 'BOOK-1',
  }));
  assert.doesNotThrow(() => check('amendments', {
    id: 'a2', amendment_type: 'NAME_CHANGE', status: 'CONFIRMED', booking_ref: 'BOOK-1',
  }));
});

test('versioned booking updates couple invariant validation to physical updated_at CAS', async () => {
  const calls = [];
  const existingRow = {
    id: 'p1',
    data: { id: 'ignored-json-id', booking_ref: 'BOOK-1', passenger_name: 'Ada' },
    updated_at: '2026-07-12T10:00:00.000Z',
  };
  const record = { id: 'p1', booking_ref: 'BOOK-1', passenger_name: 'Ada L.' };

  const saved = await saveVersionedFinanceRecord({
    collection: 'bookings',
    record,
    existingRow,
    userId: 'u1',
    request: async (path, options) => {
      calls.push({ path, options });
      return [{ id: 'p1', data: { booking_ref: 'BOOK-1', passenger_name: 'Ada L.' } }];
    },
  });

  assert.match(calls[0].path, /id=eq\.p1/);
  assert.match(calls[0].path, /updated_at=eq\.2026-07-12T10%3A00%3A00\.000Z/);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(calls[0].options.body, {
    data: { booking_ref: 'BOOK-1', passenger_name: 'Ada L.' },
  });
  assert.deepEqual(saved, record);
});

test('versioned generic writes reject a stale zero-row update instead of overwriting finalization', async () => {
  await assert.rejects(
    saveVersionedFinanceRecord({
      collection: 'amendments',
      record: {
        id: 'a1', amendment_type: 'DATE_CHANGE', status: 'DRAFT', booking_ref: 'BOOK-1',
      },
      existingRow: {
        id: 'a1',
        data: { amendment_type: 'DATE_CHANGE', status: 'DRAFT', booking_ref: 'BOOK-1' },
        updated_at: 'version-before-finalizing',
      },
      userId: 'u1',
      request: async () => [],
    }),
    (error) => error.status === 409 && /changed.*refresh/i.test(error.message),
  );
});

test('versioned inserts rely on the database conflict and do not swallow upstream errors', async () => {
  const upstream = new Error('network unavailable');
  upstream.status = 503;
  await assert.rejects(
    saveVersionedFinanceRecord({
      collection: 'bookings',
      record: { id: 'new-p1', booking_ref: 'BOOK-1' },
      existingRow: null,
      userId: 'u1',
      request: async () => { throw upstream; },
    }),
    (error) => error === upstream,
  );
});

test('generic writes reject every mutation of a completed or finalizing modern date change', () => {
  for (const status of ['FINALIZING', 'COMPLETED']) {
    assert.throws(
      () => check(
        'amendments',
        { id: 'a1', amendment_type: 'DATE_CHANGE', status, booking_ref: 'BOOK-1' },
        { id: 'a1', amendment_type: 'DATE_CHANGE', status, booking_ref: 'BOOK-1' },
      ),
      /dedicated finalization/i,
    );
  }
});

test('existing amendment booking reference cannot be changed or removed', () => {
  const existing = { id: 'a1', amendment_type: 'NAME_CHANGE', status: 'DRAFT', booking_ref: 'BOOK-1' };
  assert.throws(() => check('amendments', { ...existing, booking_ref: 'BOOK-2' }, existing), /booking reference/i);
  assert.throws(() => check('amendments', { ...existing, booking_ref: '' }, existing), /booking reference/i);
  assert.doesNotThrow(() => check('amendments', { ...existing, remarks: 'updated' }, existing));
});

test('generic date-change draft saves cannot replace the original audit baseline or creation stamps', () => {
  const existing = {
    id: 'a1',
    amendment_type: 'DATE_CHANGE',
    status: 'DRAFT',
    booking_ref: 'BOOK-1',
    original_itinerary: { outbound: [{ id: 'original' }], inbound: [] },
    created_at: '2026-07-01T10:00:00.000Z',
    created_by: 'Original User',
  };
  assert.doesNotThrow(() => check('amendments', { ...existing, remarks: 'safe draft update' }, existing));
  assert.throws(
    () => check('amendments', {
      ...existing,
      original_itinerary: { outbound: [{ id: 'tampered' }], inbound: [] },
    }, existing),
    /original itinerary/i,
  );
  assert.throws(() => check('amendments', { ...existing, created_by: 'Other' }, existing), /creation stamps/i);
  assert.throws(
    () => check('amendments', { ...existing, amendment_type: 'NAME_CHANGE', status: 'CONFIRMED' }, existing),
    /amendment type/i,
  );
});

test('existing date-change scope edits cannot move to a different itinerary cohort', () => {
  const original = {
    outbound: [{
      id: 'outbound',
      connections: [{
        airline: 'AZ', flight_number: '100', departure_city: 'FCO', arrival_city: 'DEL',
        departure_date: '2026-07-20', arrival_date: '2026-07-20',
        departure_time: '10:00', arrival_time: '18:00',
      }],
    }],
    inbound: [],
  };
  const existing = {
    id: 'a1', amendment_type: 'DATE_CHANGE', status: 'DRAFT', booking_ref: 'BOOK-1',
    application_scope: 'SELECTED_PASSENGERS', selected_passenger_ids: ['p1'],
    original_itinerary: original,
  };
  const moved = { ...existing, selected_passenger_ids: ['p2'] };
  const bookingGroup = [
    { id: 'p1', booking_ref: 'BOOK-1', flight_segments: original.outbound },
    {
      id: 'p2', booking_ref: 'BOOK-1',
      flight_segments: [{
        ...original.outbound[0],
        connections: [{ ...original.outbound[0].connections[0], flight_number: '999' }],
      }],
    },
  ];

  assert.throws(
    () => assertFinanceRecordInvariant({
      collection: 'amendments', incoming: moved, existing, bookingGroup,
    }),
    /new amendment case/i,
  );
  assert.doesNotThrow(() => assertFinanceRecordInvariant({
    collection: 'amendments', incoming: existing, existing, bookingGroup,
  }));
});

test('existing booking keeps a nonempty booking reference while a legacy row can receive one once', () => {
  const existing = { id: 'p1', booking_ref: 'BOOK-1', passenger_name: 'Ada' };
  assert.throws(() => check('bookings', { ...existing, booking_ref: 'BOOK-2' }, existing), /booking reference/i);
  assert.throws(() => check('bookings', { id: 'p1', passenger_name: 'Ada' }, existing), /booking reference/i);
  assert.doesNotThrow(() => check('bookings', { ...existing, passenger_name: 'Ada L.' }, existing));
  assert.doesNotThrow(() => check('bookings', { id: 'legacy', booking_ref: 'BOOK-1' }, { id: 'legacy' }));
});
