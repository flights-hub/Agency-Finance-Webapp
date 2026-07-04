import test from 'node:test';
import assert from 'node:assert/strict';
import { enforcePaymentRules, getLedgerPostingStatus, canVerifyPayments, financialFieldsChanged } from './paymentRules.js';

const admin = { id: 'admin-1', name: 'Admin', email: 'admin@x', role: 'ADMIN', permissions: [] };
const employeeVerifier = { id: 'emp-1', name: 'Emp', email: 'emp@x', role: 'EMPLOYEE', permissions: ['record_payments', 'verify_payments'] };
const employee = { id: 'emp-2', name: 'Emp2', email: 'emp2@x', role: 'EMPLOYEE', permissions: ['record_payments'] };
const agent = { id: 'agent-1', name: 'Agent', email: 'agent@x', role: 'AGENT', permissions: ['record_payments'] };

test('payment verification enforcement', () => {
  // Verifier detection
  assert.equal(canVerifyPayments(admin), true);
  assert.equal(canVerifyPayments(employeeVerifier), true);
  assert.equal(canVerifyPayments(employee), false);
  assert.equal(canVerifyPayments(agent), false);

  // Agent submission is always forced to TO_BE_VERIFIED, stamps set server-side
  const agentSubmit = enforcePaymentRules(agent, {
    amount_paid: 5000, payment_method: 'BANK_TRANSFER', verification_status: 'VERIFIED',
    recorded_by_user_id: 'spoofed', verified_by_user_id: 'spoofed',
  }, null);
  assert.equal(agentSubmit.record.verification_status, 'TO_BE_VERIFIED');
  assert.equal(agentSubmit.record.ledger_posting_status, 'PENDING_VERIFICATION');
  assert.equal(agentSubmit.record.recorded_by_user_id, 'agent-1');
  assert.equal(agentSubmit.record.recorded_by_role, 'AGENT');
  assert.equal(agentSubmit.record.verified_by_user_id, null);

  // Verifier verifies: stamps verified_by / verified_at, posts to ledger
  const stored = { ...agentSubmit.record, id: 'p1' };
  const verified = enforcePaymentRules(admin, { ...stored, verification_status: 'VERIFIED' }, stored);
  assert.equal(verified.action, 'verified');
  assert.equal(verified.record.verification_status, 'VERIFIED');
  assert.equal(verified.record.verified_by_user_id, 'admin-1');
  assert.ok(verified.record.verified_at);
  assert.equal(verified.record.ledger_posting_status, 'POSTED');
  // Original submitter stamps preserved
  assert.equal(verified.record.recorded_by_user_id, 'agent-1');

  // Financial edit to a verified payment resets verification and clears stamps
  const financialEdit = enforcePaymentRules(admin, { ...verified.record, amount_paid: 4500 }, verified.record);
  assert.equal(financialEdit.action, 'unverified_by_edit');
  assert.equal(financialEdit.record.verification_status, 'TO_BE_VERIFIED');
  assert.equal(financialEdit.record.verified_by_user_id, null);
  assert.equal(financialEdit.record.verified_at, null);
  assert.equal(financialEdit.record.ledger_posting_status, 'PENDING_VERIFICATION');

  // Non-financial edit keeps the verified status and original verifier
  const notesEdit = enforcePaymentRules(admin, { ...verified.record, remarks: 'called the bank' }, verified.record);
  assert.equal(notesEdit.action, null);
  assert.equal(notesEdit.record.verification_status, 'VERIFIED');
  assert.equal(notesEdit.record.verified_by_user_id, 'admin-1');
  assert.equal(notesEdit.record.ledger_posting_status, 'POSTED');

  // Employee without verify_payments cannot verify
  const employeeAttempt = enforcePaymentRules(employee, { ...stored, verification_status: 'VERIFIED' }, stored);
  assert.equal(employeeAttempt.record.verification_status, 'TO_BE_VERIFIED');

  // Employee without verify_payments cannot financially edit a verified payment
  assert.throws(
    () => enforcePaymentRules(employee, { ...verified.record, amount_paid: 1 }, verified.record),
    /verify payments permission/,
  );

  // Agent cannot edit someone else's payment or any verified payment
  assert.throws(
    () => enforcePaymentRules(agent, { ...stored, recorded_by_user_id: 'other' }, { ...stored, recorded_by_user_id: 'other' }),
    /only edit payments they submitted/,
  );
  assert.throws(
    () => enforcePaymentRules(agent, { ...verified.record }, verified.record),
    /no longer be edited/,
  );

  // Legacy records (no verification_status) stay grandfathered as VERIFIED on edit
  const legacy = { id: 'old1', amount_paid: 200, payment_mode: 'CASH', recorded_by_user_id: 'admin-1' };
  const legacyEdit = enforcePaymentRules(admin, { ...legacy, remarks: 'note' }, legacy);
  assert.equal(legacyEdit.record.verification_status, 'VERIFIED');
  assert.equal(legacyEdit.record.ledger_posting_status, 'POSTED');

  console.log('Payment verification enforcement checks passed');
});

test('ledger posting status per payment method', () => {
  // Unverified never posts
  assert.equal(getLedgerPostingStatus({ verification_status: 'TO_BE_VERIFIED' }), 'PENDING_VERIFICATION');
  // Legacy record with no status is grandfathered
  assert.equal(getLedgerPostingStatus({ payment_mode: 'CASH' }), 'POSTED');

  // Cheque: only CLEARED posts; verified-but-uncleared is READY_TO_POST; bounced never
  const cheque = { verification_status: 'VERIFIED', payment_method: 'CHEQUE' };
  assert.equal(getLedgerPostingStatus({ ...cheque, cheque_status: 'RECEIVED' }), 'READY_TO_POST');
  assert.equal(getLedgerPostingStatus({ ...cheque, cheque_status: 'DEPOSITED' }), 'READY_TO_POST');
  assert.equal(getLedgerPostingStatus({ ...cheque, cheque_status: 'CLEARED' }), 'POSTED');
  assert.equal(getLedgerPostingStatus({ ...cheque, cheque_status: 'BOUNCED' }), 'NOT_ELIGIBLE');
  assert.equal(getLedgerPostingStatus({ payment_method: 'CHEQUE', verification_status: 'TO_BE_VERIFIED', cheque_status: 'BOUNCED' }), 'NOT_ELIGIBLE');

  // Card / POS: FAILED, REVERSED, CHARGEBACK block posting even when verified
  const card = { verification_status: 'VERIFIED', payment_method: 'CREDIT_CARD' };
  assert.equal(getLedgerPostingStatus({ ...card, settlement_status: 'SETTLED' }), 'POSTED');
  assert.equal(getLedgerPostingStatus({ ...card, settlement_status: 'AUTHORIZED' }), 'POSTED');
  assert.equal(getLedgerPostingStatus({ ...card, settlement_status: 'FAILED' }), 'NOT_ELIGIBLE');
  assert.equal(getLedgerPostingStatus({ ...card, settlement_status: 'REVERSED' }), 'REVERSED');
  assert.equal(getLedgerPostingStatus({ ...card, settlement_status: 'CHARGEBACK' }), 'REVERSED');

  // UPI / online: only SUCCESS posts
  const upi = { verification_status: 'VERIFIED', payment_method: 'UPI' };
  assert.equal(getLedgerPostingStatus({ ...upi, payment_status: 'SUCCESS' }), 'POSTED');
  assert.equal(getLedgerPostingStatus({ ...upi, payment_status: 'PENDING' }), 'READY_TO_POST');
  assert.equal(getLedgerPostingStatus({ ...upi, payment_status: 'FAILED' }), 'NOT_ELIGIBLE');
  assert.equal(getLedgerPostingStatus({ ...upi, payment_status: 'REVERSED' }), 'REVERSED');
  const online = { verification_status: 'VERIFIED', payment_method: 'ONLINE_PAYMENT' };
  assert.equal(getLedgerPostingStatus({ ...online, payment_status: 'EXPIRED' }), 'NOT_ELIGIBLE');
  assert.equal(getLedgerPostingStatus({ ...online, payment_status: 'SUCCESS' }), 'POSTED');

  // Financial-change detection ignores non-financial fields
  assert.equal(financialFieldsChanged({ amount_paid: 100 }, { amount_paid: 100, remarks: 'x' }), false);
  assert.equal(financialFieldsChanged({ amount_paid: 100 }, { amount_paid: 90 }), true);
  assert.equal(financialFieldsChanged({ cheque_status: 'RECEIVED' }, { cheque_status: 'CLEARED' }), true);

  console.log('Ledger posting status checks passed');
});
