import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizationFingerprint,
  finalizationHttpError,
  isUniqueConstraintConflict,
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

test('only actual Supabase uniqueness conflicts are classified as competing inserts', () => {
  assert.equal(isUniqueConstraintConflict({ status: 409 }), false);
  assert.equal(isUniqueConstraintConflict({ data: { code: '23505' } }), true);
  assert.equal(isUniqueConstraintConflict({ status: 409, data: { code: '23503' } }), false);
  assert.equal(isUniqueConstraintConflict({ status: 503, data: { code: 'PGRST000' } }), false);
  assert.equal(isUniqueConstraintConflict(new Error('network failure')), false);
});

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
  const canonicalDraft = {
    ...clone(draft),
    passenger_reissues: draft.passenger_reissues.map((mapping) => ({
      ...clone(mapping),
      reissue_reference: mapping.reissue_reference || '',
    })),
  };
  const completed = {
    ...canonicalDraft,
    status: 'COMPLETED',
    finalized_at: finalizedAt,
    finalization_fingerprint: finalizationFingerprint(canonicalDraft),
  };
  const calls = [];
  const result = await persistDateChangeFinalization({
    draft: clone(canonicalDraft),
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
    { id: 'p1', data: { booking_ref: 'BOOK-1', passenger_name: 'Ada Lovelace' }, updated_at: 'v1' },
    { id: 'p2', data: { invoice_no: 'BOOK-1', passenger_name: 'Grace Hopper' }, updated_at: 'v2' },
  ];

  const result = await loadBookingGroupByRef('BOOK-1', async (path) => {
    paths.push(path);
    return rows;
  });

  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/rest\/v1\/bookings\?select=id,data,updated_at/);
  assert.match(paths[0], /data->>booking_ref\.eq\.BOOK-1/);
  assert.match(paths[0], /data->>invoice_no\.eq\.BOOK-1/);
  assert.doesNotMatch(paths[0], /bookings\?select=id,data&order=/);
  assert.deepEqual(result, [
    { id: 'p1', booking_ref: 'BOOK-1', passenger_name: 'Ada Lovelace', _version: 'v1' },
    { id: 'p2', invoice_no: 'BOOK-1', passenger_name: 'Grace Hopper', _version: 'v2' },
  ]);
});

test('booking writes are deterministic, versioned, and a stale row prevents amendment completion', async () => {
  const versionedGroup = clone(group).map((row, index) => ({ ...row, _version: `booking-v${index + 1}` }));
  const saves = [];
  let completed = false;

  await assert.rejects(
    persistDateChangeFinalization({
      draft: clone(draft),
      actor,
      finalizedAt,
      repository: {
        loadBookingGroup: async () => versionedGroup,
        loadAmendment: async () => null,
        claimFinalization: async (record) => ({ ...record, _version: 'lease-v1' }),
        saveBooking: async (row, version) => {
          saves.push([row.id, version]);
          return row.id === 'p2' ? null : { ...row, _version: 'saved-v1' };
        },
        completeFinalization: async () => { completed = true; },
      },
    }),
    (error) => error.status === 409 && /booking.*changed|refresh/i.test(error.message),
  );

  assert.deepEqual(saves, [['p1', 'booking-v1'], ['p2', 'booking-v2']]);
  assert.equal(completed, false);
});

test('existing amendment id must be an open date-change lifecycle case', async () => {
  for (const existing of [
    { ...clone(draft), amendment_type: 'NAME_CHANGE', status: 'DRAFT', _version: 'v1' },
    { ...clone(draft), status: 'REJECTED', _version: 'v1' },
    { ...clone(draft), status: 'CANCELLED', _version: 'v1' },
  ]) {
    await assert.rejects(
      persistDateChangeFinalization({
        draft: clone(draft),
        actor,
        finalizedAt,
        repository: {
          loadAmendment: async () => clone(existing),
          loadBookingGroup: async () => { throw new Error('must not load bookings'); },
        },
      }),
      (error) => error.status === 409 && /open date-change|cannot be finalized/i.test(error.message),
    );
  }
});

test('existing modern or legacy date-change ids reject a submitted non-date type before claiming', async () => {
  for (const storedType of ['DATE_CHANGE', 'OUTBOUND_DATE_CHANGE']) {
    let claimed = false;
    await assert.rejects(
      persistDateChangeFinalization({
        draft: { ...clone(draft), amendment_type: 'NAME_CHANGE' },
        actor,
        finalizedAt,
        repository: {
          loadAmendment: async () => ({
            ...clone(draft), amendment_type: storedType, status: 'QUOTED', _version: 'v1',
          }),
          loadBookingGroup: async () => { throw new Error('must not load bookings'); },
          claimFinalization: async () => { claimed = true; },
        },
      }),
      (error) => error.status === 409 && /date-change/i.test(error.message),
    );
    assert.equal(claimed, false);
  }
});

test('recognized submitted legacy type is canonicalized before a modern date-change claim', async () => {
  let placeholder;
  const result = await persistDateChangeFinalization({
    draft: { ...clone(draft), amendment_type: 'INBOUND_DATE_CHANGE' },
    actor,
    finalizedAt,
    repository: {
      loadAmendment: async () => ({ ...clone(draft), status: 'QUOTED', _version: 'v1' }),
      loadBookingGroup: async () => clone(group),
      claimFinalization: async (record) => {
        placeholder = clone(record);
        return { ...record, _version: 'lease-v2' };
      },
      saveBooking: async (row) => row,
      completeFinalization: async (record) => record,
    },
  });

  assert.equal(placeholder.amendment_type, 'DATE_CHANGE');
  assert.equal(result.amendment.amendment_type, 'DATE_CHANGE');
});

test('an open direction-specific legacy date-change id may be converted through finalization', async () => {
  const existing = {
    ...clone(draft),
    amendment_type: 'OUTBOUND_DATE_CHANGE',
    status: 'QUOTED',
    _version: 'legacy-v1',
  };
  let placeholder;
  const result = await persistDateChangeFinalization({
    draft: clone(draft),
    actor,
    finalizedAt,
    repository: {
      loadAmendment: async () => clone(existing),
      loadBookingGroup: async () => clone(group),
      claimFinalization: async (record) => {
        placeholder = clone(record);
        return { ...record, _version: 'lease-v2' };
      },
      saveBooking: async (row) => row,
      completeFinalization: async (record) => record,
    },
  });

  assert.equal(placeholder.amendment_type, 'DATE_CHANGE');
  assert.equal(result.amendment.amendment_type, 'DATE_CHANGE');
  assert.equal(result.amendment.status, 'COMPLETED');
});

test('an existing draft cannot move to passengers outside its immutable original itinerary', async () => {
  const divergent = clone(group);
  divergent[1].flight_segments[0].connections[0].flight_number = 'OTHER-BASELINE';
  const existing = {
    ...clone(draft),
    application_scope: 'SELECTED_PASSENGERS',
    selected_passenger_ids: ['p1'],
    passenger_reissues: [clone(draft.passenger_reissues[0])],
    _version: 'v1',
  };
  const moved = {
    ...clone(existing),
    selected_passenger_ids: ['p2'],
    passenger_reissues: [{
      booking_id: 'p2', new_pnr: 'ABC123', new_ticket_no: 'NEW-2', reissue_reference: '',
    }],
  };

  await assert.rejects(
    persistDateChangeFinalization({
      draft: moved,
      actor,
      finalizedAt,
      repository: {
        loadAmendment: async () => clone(existing),
        loadBookingGroup: async () => divergent,
        claimFinalization: async () => { throw new Error('must not claim'); },
      },
    }),
    (error) => error.status === 409 && /new amendment case/i.test(error.message),
  );
});

test('matching FINALIZING request acquires a recovery lease and reconciles remaining original rows', async () => {
  const initial = clone(draft);
  const fingerprint = finalizationFingerprint({
    ...initial,
    passenger_reissues: initial.passenger_reissues.map((mapping) => ({ ...mapping, reissue_reference: '' })),
  });
  const firstApplied = (await persistDateChangeFinalization({
    draft: initial,
    actor,
    finalizedAt,
    repository: {
      loadAmendment: async () => null,
      loadBookingGroup: async () => clone(group),
      saveBooking: async (row) => row,
      saveAmendment: async (record) => record,
    },
  })).bookings;
  const partial = [firstApplied[0], { ...clone(group[1]), _version: 'booking-v2' }];
  partial[0]._version = 'booking-v1-final';
  const finalizing = {
    ...clone(draft),
    passenger_reissues: draft.passenger_reissues.map((mapping) => ({ ...clone(mapping), reissue_reference: '' })),
    status: 'FINALIZING',
    finalization_fingerprint: fingerprint,
    _version: 'lock-v1',
  };
  const calls = [];

  const result = await persistDateChangeFinalization({
    draft: clone(draft),
    actor,
    finalizedAt: '2026-07-12T14:05:00.000Z',
    repository: {
      loadAmendment: async () => clone(finalizing),
      loadBookingGroup: async () => clone(partial),
      claimFinalization: async (record, version, options) => {
        calls.push(['lease', version, options]);
        return { ...record, _version: 'lock-v2' };
      },
      saveBooking: async (row, version) => {
        calls.push(['booking', row.id, version]);
        return { ...row, _version: 'booking-v3' };
      },
      completeFinalization: async (record, version) => {
        calls.push(['complete', version]);
        return record;
      },
    },
  });

  assert.equal(result.amendment.status, 'COMPLETED');
  assert.deepEqual(calls, [
    ['lease', 'lock-v1', { recovery: true }],
    ['booking', 'p2', 'booking-v2'],
    ['complete', 'lock-v2'],
  ]);
});

test('matching concurrent FINALIZING retries allow only one physical lease CAS winner', async () => {
  const canonicalDraft = {
    ...clone(draft),
    passenger_reissues: draft.passenger_reissues.map((mapping) => ({ ...clone(mapping), reissue_reference: '' })),
  };
  const existing = {
    ...clone(canonicalDraft),
    status: 'FINALIZING',
    finalization_fingerprint: finalizationFingerprint(canonicalDraft),
    _version: 'lock-v1',
  };
  let leased = false;
  let completions = 0;
  const repository = {
    loadAmendment: async () => clone(existing),
    loadBookingGroup: async () => clone(group).map((row, index) => ({ ...row, _version: `b${index}` })),
    claimFinalization: async (record) => {
      if (leased) return null;
      leased = true;
      return { ...record, _version: 'lock-v2' };
    },
    saveBooking: async (row) => row,
    completeFinalization: async (record) => { completions += 1; return record; },
  };

  const results = await Promise.allSettled([
    persistDateChangeFinalization({ draft: clone(draft), actor, finalizedAt, repository }),
    persistDateChangeFinalization({ draft: clone(draft), actor, finalizedAt, repository }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(completions, 1);
});

test('matching recovery rejects an identical final state owned by a different amendment', async () => {
  const canonicalA = {
    ...clone(draft),
    id: 'amd-owner-a',
    passenger_reissues: draft.passenger_reissues.map((mapping) => ({
      ...clone(mapping), reissue_reference: mapping.reissue_reference || '',
    })),
  };
  const versionedGroup = clone(group).map((row, index) => ({ ...row, _version: `original-v${index}` }));
  let finalizingA;
  await assert.rejects(
    persistDateChangeFinalization({
      draft: clone(canonicalA),
      actor,
      finalizedAt,
      repository: {
        loadAmendment: async () => null,
        loadBookingGroup: async () => clone(versionedGroup),
        claimFinalization: async (record) => {
          finalizingA = { ...clone(record), _version: 'lease-a1' };
          return finalizingA;
        },
        saveBooking: async () => { throw new Error('failure before any booking write'); },
        completeFinalization: async () => { throw new Error('must not complete A'); },
      },
    }),
    /failure before any booking write/,
  );
  assert.equal(finalizingA.status, 'FINALIZING');

  const canonicalB = { ...clone(canonicalA), id: 'amd-owner-b' };
  const finalizedB = await persistDateChangeFinalization({
    draft: canonicalB,
    actor,
    finalizedAt,
    repository: {
      loadAmendment: async () => null,
      loadBookingGroup: async () => clone(versionedGroup),
      claimFinalization: async (record) => ({ ...record, _version: 'lease-b2' }),
      saveBooking: async (row) => row,
      completeFinalization: async (record) => record,
    },
  });
  assert.equal(finalizedB.amendment.status, 'COMPLETED');
  assert.ok(finalizedB.bookings.every((row) => row.last_date_change_amendment_id === 'amd-owner-b'));

  let claimedA = false;
  let completedA = false;
  await assert.rejects(
    persistDateChangeFinalization({
      draft: clone(canonicalA),
      actor,
      finalizedAt: '2026-07-12T15:00:00.000Z',
      repository: {
        loadAmendment: async () => clone(finalizingA),
        loadBookingGroup: async () => clone(finalizedB.bookings).map((row, index) => ({
          ...row, _version: `final-b-v${index}`,
        })),
        claimFinalization: async () => { claimedA = true; },
        saveBooking: async () => { throw new Error('must not rewrite B-owned booking'); },
        completeFinalization: async () => { completedA = true; },
      },
    }),
    (error) => error.status === 409 && /stale|different amendment/i.test(error.message),
  );
  assert.equal(claimedA, false);
  assert.equal(completedA, false);
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

  const nonUniqueConflict = new Error('foreign key conflict');
  nonUniqueConflict.status = 409;
  nonUniqueConflict.data = { code: '23503', detail: 'internal relation' };
  const redactedConflict = finalizationHttpError(nonUniqueConflict);
  assert.equal(redactedConflict.status, 500);
  assert.equal(redactedConflict.message, 'Unable to finalize amendment.');
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
  staleGroup[0].flight_segments[0].connections[0].flight_number = 'THIRD-STATE';

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

test('existing draft is bound to its booking and immutable audit baseline', async () => {
  const existing = {
    ...clone(draft),
    _version: 'v1',
    created_at: '2026-07-01T10:00:00.000Z',
    created_by: 'Original User',
  };
  const tampered = clone(draft);
  tampered.original_itinerary.outbound[0].connections[0].flight_number = 'TAMPERED';
  tampered.created_at = '2099-01-01T00:00:00.000Z';
  tampered.created_by = 'Attacker';
  tampered.passenger_reissues[0].passenger_name = 'Fake Name';
  tampered.passenger_reissues[0].old_pnr = 'FAKEPNR';
  tampered.passenger_reissues[0].old_ticket_no = 'FAKE-TICKET';

  let claimed;
  const result = await persistDateChangeFinalization({
    draft: tampered,
    actor,
    finalizedAt,
    repository: {
      loadAmendment: async () => clone(existing),
      loadBookingGroup: async () => clone(group),
      claimFinalization: async (record) => { claimed = clone(record); return true; },
      saveBooking: async (row) => row,
      completeFinalization: async (record) => record,
    },
  });

  assert.deepEqual(claimed.original_itinerary, existing.original_itinerary);
  assert.equal(result.amendment.created_at, existing.created_at);
  assert.equal(result.amendment.created_by, existing.created_by);
  assert.equal(result.amendment.passenger_reissues[0].passenger_name, 'Ada Lovelace');
  assert.equal(result.amendment.passenger_reissues[0].old_pnr, 'ABC123');
  assert.equal(result.amendment.passenger_reissues[0].old_ticket_no, 'OLD-1');
});

test('existing draft id cannot be reused across bookings', async () => {
  await assert.rejects(
    persistDateChangeFinalization({
      draft: { ...clone(draft), booking_ref: 'BOOK-OTHER' },
      actor,
      finalizedAt,
      repository: {
        loadAmendment: async () => ({ ...clone(draft), _version: 'v1' }),
        loadBookingGroup: async () => { throw new Error('must not load bookings'); },
        claimFinalization: async () => { throw new Error('must not claim'); },
      },
    }),
    (error) => error.status === 409 && /booking reference/i.test(error.message),
  );
});

test('completed retries require the same finalization fingerprint', async () => {
  const canonicalDraft = {
    ...clone(draft),
    passenger_reissues: draft.passenger_reissues.map((mapping) => ({
      ...clone(mapping),
      reissue_reference: mapping.reissue_reference || '',
    })),
  };
  const fingerprint = finalizationFingerprint(canonicalDraft);
  const completed = {
    ...clone(canonicalDraft),
    status: 'COMPLETED',
    finalized_at: finalizedAt,
    finalization_fingerprint: fingerprint,
  };
  const repository = {
    loadAmendment: async () => clone(completed),
    loadBookingGroup: async () => clone(group),
  };
  const same = await persistDateChangeFinalization({ draft: clone(canonicalDraft), actor, finalizedAt, repository });
  assert.equal(same.amendment.finalization_fingerprint, fingerprint);

  await assert.rejects(
    persistDateChangeFinalization({
      draft: { ...clone(canonicalDraft), remarks: 'divergent request' },
      actor,
      finalizedAt,
      repository,
    }),
    (error) => error.status === 409 && /different finalization request/i.test(error.message),
  );
});

test('concurrent divergent finalizations allow only one booking and amendment write set', async () => {
  let lock = null;
  let reads = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  const bookingWrites = [];
  const amendmentWrites = [];
  const repository = {
    loadAmendment: async () => {
      reads += 1;
      if (reads === 2) releaseReads();
      await bothRead;
      return null;
    },
    loadBookingGroup: async () => clone(group),
    claimFinalization: async (record) => {
      if (lock) return false;
      lock = clone(record);
      return true;
    },
    saveBooking: async (row) => { bookingWrites.push(`${lock.finalization_fingerprint}:${row.id}`); return row; },
    completeFinalization: async (record) => { amendmentWrites.push(record.finalization_fingerprint); return record; },
  };
  const first = persistDateChangeFinalization({ draft: clone(draft), actor, finalizedAt, repository });
  const second = persistDateChangeFinalization({
    draft: { ...clone(draft), remarks: 'divergent', replacement_itinerary: {
      ...clone(draft.replacement_itinerary),
      outbound: clone(draft.replacement_itinerary.outbound).map((segment) => ({
        ...segment,
        connections: segment.connections.map((item) => ({ ...item, flight_number: '999' })),
      })),
    } },
    actor,
    finalizedAt,
    repository,
  });

  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(new Set(bookingWrites.map((value) => value.split(':')[0])).size, 1);
  assert.equal(amendmentWrites.length, 1);
});

test('different amendment ids overlapping the same passenger cannot both complete', async () => {
  const rowVersions = new Map(group.map((row) => [row.id, 'booking-v1']));
  const storedRows = new Map(group.map((row) => [row.id, clone(row)]));
  let groupReads = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  const completedIds = [];
  const repository = {
    loadAmendment: async () => null,
    loadBookingGroup: async () => {
      const snapshot = group.map((row) => ({ ...clone(storedRows.get(row.id)), _version: rowVersions.get(row.id) }));
      groupReads += 1;
      if (groupReads === 2) releaseReads();
      await bothRead;
      return snapshot;
    },
    claimFinalization: async (record) => ({ ...record, _version: `lease-${record.id}` }),
    saveBooking: async (row, expectedVersion) => {
      if (rowVersions.get(row.id) !== expectedVersion) return null;
      const nextVersion = `${expectedVersion}-saved`;
      rowVersions.set(row.id, nextVersion);
      storedRows.set(row.id, clone(row));
      return { ...row, _version: nextVersion };
    },
    completeFinalization: async (record) => {
      completedIds.push(record.id);
      return record;
    },
  };

  const results = await Promise.allSettled([
    persistDateChangeFinalization({ draft: { ...clone(draft), id: 'amd-overlap-1' }, actor, finalizedAt, repository }),
    persistDateChangeFinalization({ draft: { ...clone(draft), id: 'amd-overlap-2' }, actor, finalizedAt, repository }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(completedIds.length, 1);
});
