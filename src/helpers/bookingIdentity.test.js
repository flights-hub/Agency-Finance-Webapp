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

test('recordMatchesBookingGroup rejects a conflicting permanent booking ref despite shared PNR history', () => {
  const bookA = [
    { id: 'a1', booking_ref: 'BOOK-A', pnr: 'CURRENT-A', pnr_history: ['SHARED-OLD'] },
  ];

  assert.equal(recordMatchesBookingGroup({
    booking_ref: 'BOOK-B',
    pnr: 'SHARED-OLD',
  }, bookA), false);
});

test('recordMatchesBookingGroup rejects an outside booking row ID despite shared PNR history', () => {
  const bookA = [
    { id: 'a1', booking_ref: 'BOOK-A', pnr: 'CURRENT-A', pnr_history: ['SHARED-OLD'] },
  ];

  assert.equal(recordMatchesBookingGroup({
    booking_id: 'b1',
    pnr: 'SHARED-OLD',
  }, bookA), false);
});
