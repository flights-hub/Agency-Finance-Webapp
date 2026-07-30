import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('invoice numbers use a daily three digit sequence', () => {
  assert.equal(calculations.getInvoiceNo(0, '2026-07-29'), 'INV290726001');
  assert.equal(calculations.getInvoiceNo(9, '2026-07-29'), 'INV290726010');
});

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

test('payment ledger preserves only explicit passenger data for an ambiguous group-only payment', () => {
  const payments = calculations.getPaymentLedger(bookings, [
    {
      id: 'group-only-blank',
      booking_ref: 'SHARED-REF',
      payment_date: '2026-07-04',
      payment_direction: 'RECEIVED',
      party_type: 'CUSTOMER',
      amount_paid: 10,
    },
    {
      id: 'group-only-explicit',
      booking_ref: 'SHARED-REF',
      passenger_name: 'Recorded Passenger',
      payment_date: '2026-07-05',
      payment_direction: 'RECEIVED',
      party_type: 'CUSTOMER',
      amount_paid: 10,
    },
  ]);

  assert.deepEqual(payments.map((payment) => payment.passenger_name), ['', 'Recorded Passenger']);
});

test('payment ledger backfills the passenger from an exactly resolved row', () => {
  const [payment] = calculations.getPaymentLedger(bookings, [{
    id: 'exact-row',
    booking_ref: 'SHARED-REF',
    booking_id: 'p2',
    payment_date: '2026-07-04',
    payment_direction: 'RECEIVED',
    party_type: 'CUSTOMER',
    amount_paid: 10,
  }]);

  assert.equal(payment.passenger_name, 'Passenger Two');
});

test('multi-passenger opening payment stays on the shared booking reference without row identity', () => {
  const savedRows = [
    {
      id: 'new-p1', booking_ref: 'NEW-SHARED-REF', pnr: 'NEW-CURRENT',
      passenger_name: 'New Passenger One', bill_to_type: 'AGENT', bill_to_name: 'Agency Blue', fare_sold: 500,
    },
    {
      id: 'new-p2', booking_ref: 'NEW-SHARED-REF', pnr: 'NEW-CURRENT',
      passenger_name: 'New Passenger Two', bill_to_type: 'AGENT', bill_to_name: 'Agency Blue', fare_sold: 300,
    },
  ];
  const openingPayment = calculations.createPaymentEntry({
    payment_date: '2026-07-13',
    pnr: savedRows[0].pnr,
    booking_ref: savedRows[0].booking_ref,
    party_type: savedRows[0].bill_to_type,
    party_name: savedRows[0].bill_to_name,
    amount_paid: 200,
    payment_mode: 'CASH',
  }, savedRows);

  assert.equal(openingPayment.verification_status, 'TO_BE_VERIFIED');
  assert.equal(calculations.getBookingLedger(savedRows, [openingPayment])[0].total_paid, 0);

  const postedOpeningPayment = {
    ...openingPayment,
    verification_status: 'VERIFIED',
    ledger_posting_status: 'POSTED',
  };
  const bookingLedger = calculations.getBookingLedger(savedRows, [postedOpeningPayment]);
  const [paymentLedger] = calculations.getPaymentLedger(savedRows, [postedOpeningPayment]);

  assert.deepEqual(bookingLedger.map((booking) => booking.total_paid), [200, null]);
  assert.deepEqual(bookingLedger.map((booking) => booking.balance_due), [600, null]);
  assert.equal(paymentLedger.total_fare, 800);
  assert.equal(paymentLedger.cumulative_paid, 200);
  assert.equal(paymentLedger.remaining_balance, 600);
  assert.equal(paymentLedger.booking_id, '');
  assert.equal(paymentLedger.booking_ref, 'NEW-SHARED-REF');
  assert.equal(paymentLedger.party_type, 'AGENT');
  assert.equal(paymentLedger.party_name, 'Agency Blue');

  const bookingsSource = readFileSync(new URL('../pages/Bookings.jsx', import.meta.url), 'utf8');
  const openingPaymentCall = bookingsSource.match(
    /const initialPayment = createPaymentEntry\(\{([\s\S]*?)\}, \[\.\.\.bookings, \.\.\.savedRows\], payments\);/,
  )?.[1] || '';
  assert.match(openingPaymentCall, /booking_ref:\s*savedRows\[0\]\.booking_ref\s*\|\|\s*savedRows\[0\]\.invoice_no,/);
  assert.match(openingPaymentCall, /party_type:\s*savedRows\[0\]\.bill_to_type,/);
  assert.match(openingPaymentCall, /party_name:\s*savedRows\[0\]\.bill_to_name,/);
  assert.doesNotMatch(openingPaymentCall, /booking_id:/);
});
