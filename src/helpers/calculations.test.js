import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});
const calculations = await vite.ssrLoadModule('/src/helpers/calculations.js');

after(async () => vite.close());

const bookings = [
  {
    id: 'p1', booking_ref: 'SHARED-REF', pnr: 'P1-CURRENT', pnr_history: ['P1-OLD', 'SHARED-OLD'],
    ticket_no: 'P1-TICKET', passenger_name: 'Passenger One', fare_sold: 500,
  },
  {
    id: 'p2', booking_ref: 'SHARED-REF', pnr: 'P2-CURRENT', pnr_history: ['P2-OLD', 'SHARED-OLD'],
    ticket_no: 'P2-TICKET', passenger_name: 'Passenger Two', fare_sold: 300,
  },
];

function entry(overrides) {
  return calculations.createPaymentEntry({
    payment_date: '2026-07-04',
    pnr: 'SHARED-OLD',
    amount_paid: 10,
    payment_mode: 'CASH',
    ...overrides,
  }, bookings);
}

test('finance row resolution requires exact or uniquely matching booking identity', () => {
  const exactEntries = [
    entry({ booking_id: 'p1' }),
    entry({ ticket_id: 'P2-TICKET' }),
    entry({ pnr: 'P1-CURRENT' }),
    entry({ pnr: 'P2-OLD' }),
  ];
  assert.deepEqual(exactEntries.map((payment) => payment.booking_id), ['p1', 'p2', 'p1', 'p2']);

  const ambiguousLegacy = entry({ party_name: 'Legacy fallback' });
  assert.equal(ambiguousLegacy.booking_ref, '');
  assert.equal(ambiguousLegacy.booking_id, '');
  assert.equal(ambiguousLegacy.total_fare, 0);
  assert.equal(ambiguousLegacy.party_name, 'Legacy fallback');

  const groupOnly = entry({ booking_ref: 'SHARED-REF', pnr: '', party_name: 'Group fallback' });
  assert.equal(groupOnly.booking_ref, 'SHARED-REF');
  assert.equal(groupOnly.booking_id, '');
  assert.equal(groupOnly.total_fare, 800);
  assert.equal(groupOnly.party_name, 'Group fallback');

  const unknownRef = entry({ booking_ref: 'UNKNOWN-REF', pnr: 'P1-CURRENT' });
  assert.equal(unknownRef.booking_ref, 'UNKNOWN-REF');
  assert.equal(unknownRef.booking_id, '');
  assert.equal(unknownRef.total_fare, 0);
});
