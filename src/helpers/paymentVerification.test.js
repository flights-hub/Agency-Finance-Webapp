import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPaymentReference } from './paymentVerification.js';

test('payment references use a daily three digit sequence per direction', () => {
  const payments = [
    { payment_reference: 'RCPT290726001' },
    { payment_reference: 'RCPT290726002' },
    { payment_reference: 'RCPT280726099' },
    { payment_reference: 'PAY290726004' },
    { payment_reference: 'RCPT-000250' },
  ];

  assert.equal(nextPaymentReference(payments, 'RECEIVED', '2026-07-29'), 'RCPT290726003');
  assert.equal(nextPaymentReference(payments, 'PAID', '2026-07-29'), 'PAY290726005');
  assert.equal(nextPaymentReference(payments, 'RECEIVED', '2026-07-30'), 'RCPT300726001');
});
