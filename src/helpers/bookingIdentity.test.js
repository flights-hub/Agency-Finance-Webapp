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
