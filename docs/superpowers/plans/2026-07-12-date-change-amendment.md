# Date-Change Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the current amendment modal so employees can finalize PNR-wide or passenger-wise outbound/inbound date changes, apply complete replacement itineraries and GDS reissue identifiers to bookings, preserve before/after history, and post costs on the finalization date.

**Architecture:** Add two browser/server-safe domain modules: one for stable Booking ID and PNR aliases, and one for date-change snapshot, validation, application, and timeline formatting. The React modal will edit those domain records; a dedicated authenticated API endpoint will recompute and persist booking updates before saving the completed amendment, and Booking Detail/finance matching will resolve records through `booking_ref` and PNR history.

**Tech Stack:** React 19, Node.js ESM and built-in test runner, Vite 5, existing Node HTTP API, Supabase PostgREST JSONB finance tables, CSS.

## Global Constraints

- Reuse the current `AmendmentCaseModal` and preserve the existing input-driven quote section.
- Introduce no flight, GDS, schedule, availability, fare, ticket, or minimum-connection-time retrieval API.
- Keep `booking_ref` immutable and use it as the internal Booking ID across PNR splits.
- Date changes support `PNR_WIDE` or `SELECTED_PASSENGERS` and `OUTBOUND`, `INBOUND`, or `BOTH`.
- A direction contains one or more connections and must store all current booking flight fields.
- A finalized date change stores immutable original/replacement itineraries and old/new PNR and ticket mappings.
- **Confirm Amendment** finalizes a date change directly as `COMPLETED`; date changes have no separate Mark Completed step.
- Only completed date changes post to the ledger, using `finalized_at`.
- No new Supabase table or public Data API exposure is required; reuse existing JSONB tables and server-side service-role access.

---

## File Structure

- Create `src/helpers/bookingIdentity.js`: stable Booking ID, current/historical PNR alias, and record-to-booking matching.
- Create `src/helpers/bookingIdentity.test.js`: alias and stable-reference regression tests.
- Create `src/helpers/dateChangeAmendments.js`: snapshots, direction normalization, connection duration, validation, idempotent application, and timeline formatting.
- Create `src/helpers/dateChangeAmendments.test.js`: complete date-change domain tests.
- Create `server/amendmentFinalization.js`: awaited persistence orchestration with completed amendment written last.
- Create `server/amendmentFinalization.test.js`: persistence order, retry, and validation tests.
- Create `src/components/DateChangeItineraryEditor.jsx`: current-layer original/replacement journey editor.
- Modify `src/components/AmendmentCaseModal.jsx`: scope, passenger reissues, editor, finalization, and legacy normalization.
- Modify `src/helpers/api.js`: finalization request.
- Modify `src/helpers/storage.js`: update local cache only after successful server finalization.
- Modify `server/index.js`: authenticated finalization route and audit entry.
- Modify `src/helpers/ledger.js` and `src/helpers/ledger.test.js`: historical PNR matching and completion-only posting.
- Modify `src/helpers/calculations.js`: group customer payments by stable Booking ID/PNR aliases.
- Modify `server/financeAccess.js` and `server/financeScope.test.js`: keep scoped finance records visible after PNR splits.
- Modify `src/components/PaymentRecordModal.jsx`: stamp `booking_ref`/`booking_id` on customer payments.
- Modify `src/pages/BookingDetail.jsx`: stable record filters, richer servicing/timeline display, and new current itinerary after finalization.
- Modify `src/index.css`: responsive itinerary comparison and reissue mapping styles.

---

### Task 1: Stable Booking Identity and PNR History

**Files:**
- Create: `src/helpers/bookingIdentity.js`
- Create: `src/helpers/bookingIdentity.test.js`

**Interfaces:**
- Produces: `normalizeBookingPnr(value) -> string`
- Produces: `bookingPnrAliases(booking) -> string[]`
- Produces: `groupPnrAliases(bookings) -> string[]`
- Produces: `stableBookingRef(booking) -> string`
- Produces: `recordMatchesBookingGroup(record, group) -> boolean`
- Produces: `bookingMatchesRecord(booking, record) -> boolean`

- [ ] **Step 1: Write failing alias and record-matching tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingPnrAliases,
  groupPnrAliases,
  recordMatchesBookingGroup,
} from './bookingIdentity.js';

const group = [
  { id: 'p1', booking_ref: 'INV-1', pnr: 'NEW111', pnr_history: ['OLD111'] },
  { id: 'p2', booking_ref: 'INV-1', pnr: 'OLD111' },
];

test('bookingPnrAliases includes current and historical PNRs once', () => {
  assert.deepEqual(bookingPnrAliases(group[0]), ['NEW111', 'OLD111']);
  assert.deepEqual(groupPnrAliases(group), ['NEW111', 'OLD111']);
});

test('recordMatchesBookingGroup prefers permanent booking ref and falls back to PNR history', () => {
  assert.equal(recordMatchesBookingGroup({ booking_ref: 'INV-1', pnr: 'OTHER' }, group), true);
  assert.equal(recordMatchesBookingGroup({ pnr: 'OLD111' }, group), true);
  assert.equal(recordMatchesBookingGroup({ booking_id: 'p1' }, group), true);
  assert.equal(recordMatchesBookingGroup({ pnr: 'NOPE' }, group), false);
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `node --test src/helpers/bookingIdentity.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `bookingIdentity.js`.

- [ ] **Step 3: Implement the minimal stable-identity helpers**

```js
export function normalizeBookingPnr(value = '') {
  return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function stableBookingRef(booking = {}) {
  return String(booking.booking_ref || booking.invoice_no || '');
}

export function bookingPnrAliases(booking = {}) {
  return [...new Set([booking.pnr, ...(booking.pnr_history || [])]
    .map(normalizeBookingPnr)
    .filter(Boolean))];
}

export function groupPnrAliases(bookings = []) {
  return [...new Set(bookings.flatMap(bookingPnrAliases))];
}

export function bookingMatchesRecord(booking = {}, record = {}) {
  const bookingRef = stableBookingRef(booking);
  if (record.booking_ref && bookingRef && String(record.booking_ref) === bookingRef) return true;
  if (record.booking_id && String(record.booking_id) === String(booking.id)) return true;
  const pnr = normalizeBookingPnr(record.pnr);
  return Boolean(pnr && bookingPnrAliases(booking).includes(pnr));
}

export function recordMatchesBookingGroup(record = {}, group = []) {
  return group.some((booking) => bookingMatchesRecord(booking, record));
}
```

- [ ] **Step 4: Run the identity tests**

Run: `node --test src/helpers/bookingIdentity.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the identity helper**

```bash
git add src/helpers/bookingIdentity.js src/helpers/bookingIdentity.test.js
git commit -m "Add stable booking identity helpers"
```

---

### Task 2: Date-Change Domain Model

**Files:**
- Create: `src/helpers/dateChangeAmendments.js`
- Create: `src/helpers/dateChangeAmendments.test.js`

**Interfaces:**
- Consumes: `bookingPnrAliases`, `stableBookingRef`
- Produces: `isDateChangeType(type) -> boolean`
- Produces: `normalizeDateChange(type, explicitDirection) -> { amendmentType, direction }`
- Produces: `snapshotItinerary(booking) -> { outbound, inbound }`
- Produces: `createPassengerReissues(group, selectedIds, existing) -> array`
- Produces: `connectionDuration(connection) -> string`
- Produces: `validateDateChangeFinalization(amendment, group) -> string[]`
- Produces: `applyDateChangeAmendment(amendment, group, { actor, finalizedAt }) -> { amendment, bookings }`
- Produces: `amendmentTimelineSummary(amendment) -> string`

- [ ] **Step 1: Write failing tests for snapshots, direction changes, passenger scope, PNR splits, validation, idempotency, and summaries**

Use fixtures with one shared `booking_ref`, two passenger rows, outbound connections `FCO-DOH-DEL`, and inbound connections `DEL-DOH-FCO`. Assert:

```js
test('outbound passenger-wise finalization preserves inbound and the unselected passenger', () => {
  const result = applyDateChangeAmendment(amendment, group, {
    actor: 'Ops User',
    finalizedAt: '2026-07-12T14:00:00.000Z',
  });
  const changed = result.bookings.find((row) => row.id === 'p1');
  const unchanged = result.bookings.find((row) => row.id === 'p2');

  assert.equal(result.amendment.status, 'COMPLETED');
  assert.equal(result.amendment.finalized_at, '2026-07-12T14:00:00.000Z');
  assert.equal(changed.pnr, 'SPLIT9');
  assert.deepEqual(changed.pnr_history, ['ABC123']);
  assert.equal(changed.ticket_no, 'NEW-TKT-1');
  assert.deepEqual(changed.flight_segments[1], group[0].flight_segments[1]);
  assert.deepEqual(unchanged, group[1]);
});

test('both-direction finalization replaces any number of connections', () => {
  const result = applyDateChangeAmendment(bothDirections, group, context);
  assert.equal(result.bookings[0].flight_segments[0].connections.length, 1);
  assert.equal(result.bookings[0].flight_segments[1].connections.length, 3);
  assert.equal(result.bookings[0].outbound_date, '2026-08-01');
  assert.equal(result.bookings[0].inbound_date, '2026-08-20');
});

test('validation rejects discontinuous routes, impossible chronology, and duplicate tickets', () => {
  const errors = validateDateChangeFinalization(invalidAmendment, group);
  assert.ok(errors.some((error) => error.includes('does not connect')));
  assert.ok(errors.some((error) => error.includes('after departure')));
  assert.ok(errors.some((error) => error.includes('duplicate')));
});

test('retry accepts rows already at the intended final state without duplicating history', () => {
  const first = applyDateChangeAmendment(amendment, group, context);
  const retry = applyDateChangeAmendment(amendment, first.bookings, context);
  assert.deepEqual(retry.bookings, first.bookings);
  assert.deepEqual(retry.bookings[0].pnr_history, ['ABC123']);
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `node --test src/helpers/dateChangeAmendments.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement direction normalization and snapshots**

```js
const LEGACY_DIRECTIONS = {
  OUTBOUND_DATE_CHANGE: 'OUTBOUND',
  INBOUND_DATE_CHANGE: 'INBOUND',
  BOTH_DATE_CHANGE: 'BOTH',
};

export function isDateChangeType(type) {
  return type === 'DATE_CHANGE' || Boolean(LEGACY_DIRECTIONS[type]);
}

export function normalizeDateChange(type, explicitDirection = '') {
  return {
    amendmentType: isDateChangeType(type) ? 'DATE_CHANGE' : type,
    direction: explicitDirection || LEGACY_DIRECTIONS[type] || 'OUTBOUND',
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

export function snapshotItinerary(booking = {}) {
  const segments = clone(booking.flight_segments || []);
  const inboundIndex = segments.findIndex((segment) => /return|inbound/i.test(`${segment.id} ${segment.label}`));
  if (inboundIndex >= 0) return { outbound: segments.slice(0, inboundIndex), inbound: segments.slice(inboundIndex) };
  if (booking.inbound_date && segments.length > 1) return { outbound: segments.slice(0, 1), inbound: segments.slice(1) };
  return { outbound: segments, inbound: [] };
}
```

- [ ] **Step 4: Implement validation and application**

Implement `validateDateChangeFinalization` so it checks scope, affected row membership, selected direction presence, eight required connection fields, chronology, route continuity, inbound-after-outbound, new ticket presence/uniqueness/change, and stale rows. Implement `applyDateChangeAmendment` so it:

```js
const completed = {
  ...amendment,
  amendment_type: 'DATE_CHANGE',
  status: 'COMPLETED',
  finalized_at: finalizedAt,
  finalized_by: actor,
  confirmed_at: amendment.confirmed_at || finalizedAt,
  confirmed_by: amendment.confirmed_by || actor,
  updated_at: finalizedAt,
};
```

For each affected row, accept either the original or already-applied final state, merge selected direction arrays, derive `airline`, `sector`, `outbound_date`, `inbound_date`, `onward_date`, and `return_date`, update PNR/ticket, and deduplicate `pnr_history`. Throw an error containing all validation messages before returning any mutation.

- [ ] **Step 5: Run the date-change tests**

Run: `node --test src/helpers/dateChangeAmendments.test.js`

Expected: all domain tests PASS.

- [ ] **Step 6: Commit the domain model**

```bash
git add src/helpers/dateChangeAmendments.js src/helpers/dateChangeAmendments.test.js
git commit -m "Add date change amendment domain model"
```

---

### Task 3: Awaited Server Finalization

**Files:**
- Create: `server/amendmentFinalization.js`
- Create: `server/amendmentFinalization.test.js`
- Modify: `server/index.js`
- Modify: `src/helpers/api.js`
- Modify: `src/helpers/storage.js`

**Interfaces:**
- Consumes: `applyDateChangeAmendment(amendment, group, context)`
- Produces: `persistDateChangeFinalization({ draft, actor, repository, finalizedAt }) -> Promise<{ amendment, bookings }>`
- Produces API: `POST /api/amendments/finalize`
- Produces client: `api.finalizeAmendment(record)`
- Produces storage: `finalizeAmendment(record) -> Promise<record>`

- [ ] **Step 1: Write a failing persistence-order test**

```js
test('persists all booking rows before the completed amendment', async () => {
  const calls = [];
  const result = await persistDateChangeFinalization({
    draft,
    actor: { id: 'u1', name: 'Ops User' },
    finalizedAt: '2026-07-12T14:00:00.000Z',
    repository: {
      loadBookingGroup: async () => group,
      loadAmendment: async () => null,
      saveBooking: async (row) => { calls.push(`booking:${row.id}`); return row; },
      saveAmendment: async (record) => { calls.push(`amendment:${record.id}`); return record; },
    },
  });
  assert.deepEqual(calls, ['booking:p1', 'booking:p2', `amendment:${result.amendment.id}`]);
});
```

Also test that a booking write rejection prevents `saveAmendment`, and an existing completed amendment returns without another save.

- [ ] **Step 2: Run and confirm the missing-module failure**

Run: `node --test server/amendmentFinalization.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement persistence orchestration**

```js
export async function persistDateChangeFinalization({ draft, actor, repository, finalizedAt }) {
  const existing = draft.id ? await repository.loadAmendment(draft.id) : null;
  if (existing?.status === 'COMPLETED') {
    return { amendment: existing, bookings: await repository.loadBookingGroup(existing.booking_ref) };
  }
  const group = await repository.loadBookingGroup(draft.booking_ref);
  const result = applyDateChangeAmendment(draft, group, {
    actor: actor.name || actor.email,
    finalizedAt,
  });
  const bookings = [];
  for (const booking of result.bookings) bookings.push(await repository.saveBooking(booking));
  const amendment = await repository.saveAmendment(result.amendment);
  return { amendment, bookings };
}
```

- [ ] **Step 4: Add the authenticated API route**

In `server/index.js`, require write permission for both `bookings` and `amendments`, load only rows whose generated `booking_ref` matches the submitted internal Booking ID, build the repository with `getFinanceRow`/`upsertFinanceRow`, call the service with a server timestamp, write an `finalize_date_change_amendment` audit entry, and return `{ amendment, bookings }`. Reject missing `booking_ref`, malformed scope, or validation errors with 400; reject stale state with 409.

Route before the generic finance matcher:

```js
if (req.method === 'POST' && path === '/api/amendments/finalize') {
  return handleFinalizeAmendment(req, res);
}
```

- [ ] **Step 5: Add client API and cache update**

```js
// api.js
finalizeAmendment: (record) => request('/api/amendments/finalize', {
  method: 'POST',
  body: { amendment: record },
}),

// storage.js
export async function finalizeAmendment(amendment) {
  const result = await api.finalizeAmendment(amendment);
  result.bookings.forEach((booking) => save(STORAGE_KEYS.BOOKINGS, booking, { sync: false }));
  return save(STORAGE_KEYS.AMENDMENTS, result.amendment, { sync: false });
}
```

- [ ] **Step 6: Run server and domain tests**

Run: `node --test server/amendmentFinalization.test.js src/helpers/dateChangeAmendments.test.js`

Expected: PASS.

- [ ] **Step 7: Commit persistence**

```bash
git add server/amendmentFinalization.js server/amendmentFinalization.test.js server/index.js src/helpers/api.js src/helpers/storage.js
git commit -m "Finalize date changes through the finance API"
```

---

### Task 4: Replacement Itinerary Editor

**Files:**
- Create: `src/components/DateChangeItineraryEditor.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `{ original, replacement, direction, disabled, onChange }`
- Consumes: `connectionDuration(connection)`
- Produces: complete outbound/inbound replacement snapshots through `onChange(next)`

- [ ] **Step 1: Build the presentation component around tested domain operations**

Render one section for each selected direction. Each section contains a read-only original journey and editable replacement cards. Every replacement connection renders airline, flight number, departure/arrival airport, dates, times, terminals, calculated duration, and both baggage fields. Provide **Add connection** and **Remove connection** controls; the final remaining connection cannot be removed.

Use immutable updates:

```js
const updateConnection = (directionKey, segmentIndex, connectionIndex, key, value) => {
  const next = structuredClone(replacement);
  const connection = next[directionKey][segmentIndex].connections[connectionIndex];
  connection[key] = value;
  connection.duration = connectionDuration(connection);
  onChange(next);
};
```

- [ ] **Step 2: Add responsive current-layer styles**

Add `.date-change-comparison`, `.date-change-journey`, `.date-change-connection-grid`, `.reissue-mapping-table`, and mobile rules under the existing servicing styles. Use existing colors, border variables, input sizes, and buttons; do not redesign the quote section.

- [ ] **Step 3: Verify compilation**

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 4: Commit the editor**

```bash
git add src/components/DateChangeItineraryEditor.jsx src/index.css
git commit -m "Add replacement itinerary editor"
```

---

### Task 5: Map Date Changes Into the Current Amendment Modal

**Files:**
- Modify: `src/components/AmendmentCaseModal.jsx`

**Interfaces:**
- Consumes: date-change domain helpers and `finalizeAmendment`
- Consumes: `DateChangeItineraryEditor`
- Preserves: non-date amendment behavior and input-driven quote fields

- [ ] **Step 1: Normalize new and legacy date-change form state**

Add state for `application_scope`, `travel_direction`, `original_itinerary`, `replacement_itinerary`, `selected_passenger_ids`, and `passenger_reissues`. Initialize new cases from the booking group; initialize existing cases from stored snapshots; normalize three legacy direction-specific types without rewriting them on view.

- [ ] **Step 2: Render scope and passenger selection**

For `DATE_CHANGE`, replace segment-only selection with PNR-wide/passenger-wise controls. PNR-wide auto-selects every row. Passenger-wise uses the existing passenger chips. Derive affected tickets from selected passenger rows and retain the legacy `affected_*` arrays for compatibility.

- [ ] **Step 3: Render itinerary and reissue layers above the existing quote**

Mount `DateChangeItineraryEditor` after Amendment scope. Render one mapping row per affected passenger with read-only original PNR/ticket and editable new PNR/ticket/reissue reference. New PNR defaults to original. Keep the screenshot-approved quote markup and field order unchanged below these additions.

- [ ] **Step 4: Persist drafts/quotes without applying them**

Extend `buildRecord(status)` with `id: existing?.id || crypto.randomUUID()`, `booking_ref`, scope, direction, snapshots, reissues, and selected rows. `Save Draft`, `Create Quote`, and `Customer Approved` still call `saveAmendment` and never change bookings or the ledger.

- [ ] **Step 5: Finalize only from Confirm Amendment**

Make `saveWithStatus` async. For a date change requested as `CONFIRMED`, validate the candidate, set a `saving` guard, await `finalizeAmendment(candidate)`, and close only on success. Display the server validation/persistence error inside the modal. The server supplies `COMPLETED` and finalization stamps. Hide **Mark Completed** for date changes; preserve it for non-date cases.

- [ ] **Step 6: Run targeted tests, lint, and build**

Run:

```bash
node --test src/helpers/dateChangeAmendments.test.js
npx eslint src/components/AmendmentCaseModal.jsx src/components/DateChangeItineraryEditor.jsx
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit modal integration**

```bash
git add src/components/AmendmentCaseModal.jsx
git commit -m "Map date reissues into amendment cases"
```

---

### Task 6: Preserve Payments and Ledger Across PNR Splits

**Files:**
- Modify: `src/helpers/ledger.js`
- Modify: `src/helpers/ledger.test.js`
- Modify: `src/helpers/calculations.js`
- Modify: `src/components/PaymentRecordModal.jsx`
- Modify: `server/financeAccess.js`
- Modify: `server/financeScope.test.js`

**Interfaces:**
- Consumes: Booking ID/PNR alias helpers
- Produces: old-PNR payments and service cases continue resolving to the same booking/account

- [ ] **Step 1: Add failing ledger regressions**

```js
test('payment on historical PNR stays on the booking account after passenger split', () => {
  const booking = {
    id: 'p1', booking_ref: 'INV-1', pnr: 'NEW111', pnr_history: ['OLD111'],
    bill_to_type: 'AGENT', bill_to_name: 'Agency A', fare_sold: 500,
  };
  const payment = verifiedPayment({ id: 'pay1', pnr: 'OLD111', amount_paid: 200 });
  const model = buildFinanceModel({ bookings: [booking], payments: [payment] });
  assert.equal(model.accounts.get('agent:agency a').payments[0].id, 'pay1');
});

test('date change posts only when completed and uses finalized date', () => {
  const draftModel = buildFinanceModel({ bookings: [booking], amendments: [{ ...amendment, status: 'CONFIRMED' }] });
  assert.equal(draftModel.accountList[0].ledger.some((entry) => entry.reference_id === amendment.id), false);
  const completedModel = buildFinanceModel({
    bookings: [booking],
    amendments: [{ ...amendment, status: 'COMPLETED', finalized_at: '2026-07-12T14:00:00.000Z' }],
  });
  const entry = completedModel.accountList[0].ledger.find((item) => item.reference_id === amendment.id);
  assert.equal(entry.entry_date, '2026-07-12');
});
```

Add a server finance-scope test showing an agent can still see a payment/case whose PNR is in a scoped booking's `pnr_history` or whose `booking_ref` matches.

- [ ] **Step 2: Run and verify the expected failures**

Run: `node --test src/helpers/ledger.test.js server/financeScope.test.js`

Expected: failures for historical-PNR matching and confirmed date-change posting.

- [ ] **Step 3: Make ledger and server scoping alias-aware**

Update `groupBookingsByPnr` so each booking is indexed under current and historical aliases. Update server scoped PNR sets similarly and add a `booking_ref` match to payments, refunds, amendments, cancellations, and allocations. Preserve role and permission checks.

Change date-change posting semantics:

```js
export function isAmendmentPosted(amendment = {}) {
  if (isDateChangeType(amendment.amendment_type)) return amendment.status === 'COMPLETED';
  return ['CONFIRMED', 'COMPLETED'].includes(amendment.status);
}

function amendmentPostingDate(amendment = {}) {
  const stamp = amendment.finalized_at || amendment.completed_at || amendment.confirmed_at
    || amendment.approved_at || amendment.updated_at || amendment.created_at;
  return String(stamp || '').slice(0, 10);
}
```

- [ ] **Step 4: Group booking/payment calculations by stable identity**

In customer booking/payment ledger functions, use `booking_ref` as the canonical group key when present and map payments by their explicit `booking_ref` or by the booking found through PNR aliases. Preserve supplier payment scope behavior.

- [ ] **Step 5: Stamp future customer payments with stable identity**

When `PaymentRecordModal` builds a customer payment, find the selected booking through current/historical PNR aliases and include:

```js
booking_ref: relatedBooking?.booking_ref || relatedBooking?.invoice_no || '',
booking_id: relatedBooking?.id || '',
```

- [ ] **Step 6: Re-run finance tests**

Run: `node --test src/helpers/ledger.test.js server/financeScope.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit finance identity changes**

```bash
git add src/helpers/ledger.js src/helpers/ledger.test.js src/helpers/calculations.js src/components/PaymentRecordModal.jsx server/financeAccess.js server/financeScope.test.js
git commit -m "Preserve finance history across PNR splits"
```

---

### Task 7: One-Screen Booking Audit and Activity Timeline

**Files:**
- Modify: `src/pages/BookingDetail.jsx`
- Modify: `src/index.css`
- Modify: `src/helpers/dateChangeAmendments.test.js`

**Interfaces:**
- Consumes: `recordMatchesBookingGroup`, `groupPnrAliases`, `amendmentTimelineSummary`
- Produces: stable Booking ID audit display after split/finalization

- [ ] **Step 1: Add a failing timeline-summary assertion**

```js
test('timeline summary includes scope, direction, PNR split, and ticket reissue', () => {
  assert.match(amendmentTimelineSummary(completed), /Passenger-wise/);
  assert.match(amendmentTimelineSummary(completed), /Outbound/);
  assert.match(amendmentTimelineSummary(completed), /ABC123 → SPLIT9/);
  assert.match(amendmentTimelineSummary(completed), /OLD-TKT-1 → NEW-TKT-1/);
});
```

- [ ] **Step 2: Run and verify the summary failure**

Run: `node --test src/helpers/dateChangeAmendments.test.js`

Expected: FAIL until summary output contains all four audit elements.

- [ ] **Step 3: Make Booking Detail filters stable**

Replace current-PNR-only filters with `recordMatchesBookingGroup`. Build `groupPnrs` from `groupPnrAliases`, so old and new PNR payments remain visible. Keep grouping by `booking_ref`.

- [ ] **Step 4: Enrich the servicing card and timeline**

For completed date changes, show scope, direction, affected passengers, old/new PNR, old/new ticket, compact itinerary before/after, charge/credit, finalizing employee, and `finalized_at`. The Manage action opens the completed case read-only with both full snapshots.

- [ ] **Step 5: Verify tests and build**

Run:

```bash
node --test src/helpers/dateChangeAmendments.test.js src/helpers/ledger.test.js
npx eslint src/pages/BookingDetail.jsx src/helpers/dateChangeAmendments.js
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit audit view**

```bash
git add src/pages/BookingDetail.jsx src/index.css src/helpers/dateChangeAmendments.test.js
git commit -m "Show date reissue history on booking timeline"
```

---

### Task 8: Full Verification and Browser Walkthrough

**Files:**
- Modify only files needed to correct verification findings.

**Interfaces:**
- Verifies all acceptance criteria from `docs/superpowers/specs/2026-07-12-date-change-amendment-design.md`.

- [ ] **Step 1: Run all Node tests**

Run: `node --test src/helpers/*.test.js server/*.test.js`

Expected: 0 failures.

- [ ] **Step 2: Run changed-file lint**

Run:

```bash
npx eslint \
  server/index.js server/amendmentFinalization.js server/amendmentFinalization.test.js server/financeAccess.js server/financeScope.test.js \
  src/components/AmendmentCaseModal.jsx src/components/DateChangeItineraryEditor.jsx src/components/PaymentRecordModal.jsx \
  src/helpers/api.js src/helpers/storage.js src/helpers/bookingIdentity.js src/helpers/bookingIdentity.test.js \
  src/helpers/dateChangeAmendments.js src/helpers/dateChangeAmendments.test.js src/helpers/ledger.js src/helpers/ledger.test.js \
  src/helpers/calculations.js src/pages/BookingDetail.jsx
```

Expected: 0 errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: Vite exits 0. The existing large-chunk advisory is acceptable.

- [ ] **Step 4: Start the app and perform a browser walkthrough**

Run: `node server/dev.js`

Walk through:

1. Open a roundtrip Booking Detail with two passengers.
2. Create passenger-wise outbound date change.
3. Add a two-connection replacement and complete all required fields.
4. Enter a new PNR and new ticket for only one passenger.
5. Save Draft and verify booking/ledger remain unchanged.
6. Reopen, create quote, and verify quote-only timeline state.
7. Confirm Amendment and verify status becomes Completed.
8. Verify only selected passenger's PNR, ticket, and outbound itinerary changed.
9. Verify inbound and unselected passenger remained unchanged.
10. Verify old/new snapshots and mappings appear in Activity timeline.
11. Verify the amendment amount posts on the finalization date.
12. Verify earlier old-PNR payments and later new-PNR payments appear together.

- [ ] **Step 5: Check final repository state**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors; only intended implementation files are changed or committed.
