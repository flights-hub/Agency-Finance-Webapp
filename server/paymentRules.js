// Server-side port of the payment verification rules in
// src/helpers/paymentVerification.js. The API enforces them so a modified
// client can never verify a payment or keep a verified status through a
// financial edit without the verify_payments permission.

// Mirrors TERMINAL_VERIFICATION_STATUSES in src/helpers/paymentVerification.js.
export const TERMINAL_VERIFICATION_STATUSES = ['UPLOAD_FAILED'];

export const FINANCIAL_FIELDS = [
  'payment_date',
  'payment_direction',
  'party_type',
  'party_id',
  'party_name',
  'pnr',
  'ticket_id',
  'amount_paid',
  'transaction_amount',
  'transaction_currency',
  'payment_mode',
  'payment_method',
  'cash_handled_by',
  'cashbox_id',
  'bank_transaction_reference',
  'internal_bank_account_id',
  'card_transaction_id',
  'upi_transaction_id',
  'internal_upi_account_id',
  'pos_transaction_reference',
  'gateway_transaction_id',
  'cheque_number',
  'cheque_status',
  'payment_status',
  'settlement_status',
  'settlement_date',
  'gross_amount',
  'processing_fee',
  'supplier_name',
  'supplier_payment_scope',
];

export function financialFieldsChanged(before = {}, after = {}) {
  return FINANCIAL_FIELDS.some((key) => String(before[key] ?? '') !== String(after[key] ?? ''));
}

export function getLedgerPostingStatus(payment = {}) {
  const method = payment.payment_method || payment.payment_mode || '';

  if (['REVERSED', 'CHARGEBACK'].includes(payment.settlement_status)) return 'REVERSED';
  if (['REVERSED', 'CHARGEBACK'].includes(payment.payment_status)) return 'REVERSED';
  if (payment.settlement_status === 'FAILED') return 'NOT_ELIGIBLE';
  if (['FAILED', 'EXPIRED', 'REFUNDED'].includes(payment.payment_status)) return 'NOT_ELIGIBLE';
  if (method === 'CHEQUE' && ['BOUNCED', 'CANCELLED'].includes(payment.cheque_status)) return 'NOT_ELIGIBLE';

  const verification = payment.verification_status || 'VERIFIED';
  // Proof upload never landed: terminal, never awaiting verification.
  if (TERMINAL_VERIFICATION_STATUSES.includes(verification)) return 'NOT_ELIGIBLE';
  if (verification !== 'VERIFIED') return 'PENDING_VERIFICATION';

  if (method === 'CHEQUE' && payment.cheque_status !== 'CLEARED') return 'READY_TO_POST';
  if (['UPI', 'ONLINE_PAYMENT'].includes(method) && payment.payment_status && payment.payment_status !== 'SUCCESS') return 'READY_TO_POST';

  return 'POSTED';
}

export function canVerifyPayments(user) {
  if (!user || ['AGENT', 'SUPPLIER'].includes(user.role)) return false;
  return user.role === 'ADMIN' || (user.permissions || []).includes('verify_payments');
}

// Applies the verification workflow to an incoming payment record before it
// is persisted. Returns the record to store plus what happened, so the caller
// can audit verification transitions.
export function enforcePaymentRules(user, incoming, existing = null) {
  const record = { ...incoming };
  const verifier = canVerifyPayments(user);
  const wasVerified = existing ? (existing.verification_status || 'VERIFIED') === 'VERIFIED' : false;

  // Records created before the verification workflow carry no status and are
  // grandfathered as VERIFIED; an edit that does not state a status keeps the
  // record's effective status instead of silently un-verifying it.
  if (!record.verification_status) {
    record.verification_status = existing ? (existing.verification_status || 'VERIFIED') : 'TO_BE_VERIFIED';
  }

  if (user.role === 'AGENT' && existing) {
    if (existing.recorded_by_user_id !== user.id) {
      const error = new Error('Agents can only edit payments they submitted.');
      error.status = 403;
      throw error;
    }
    if (wasVerified) {
      const error = new Error('This payment is verified and can no longer be edited.');
      error.status = 403;
      throw error;
    }
  }

  if (wasVerified && !verifier && financialFieldsChanged(existing, record)) {
    const error = new Error('Editing a verified payment requires the verify payments permission.');
    error.status = 403;
    throw error;
  }

  // Submission stamps are set by the server, never trusted from the client.
  if (!existing) {
    record.recorded_by_user_id = user.id;
    record.recorded_by = user.name || user.email || '';
    record.recorded_by_role = user.role;
  } else {
    record.recorded_by_user_id = existing.recorded_by_user_id ?? user.id;
    record.recorded_by = existing.recorded_by || user.name || user.email || '';
    record.recorded_by_role = existing.recorded_by_role || user.role;
  }

  const wantsVerified = record.verification_status === 'VERIFIED';
  const changedFinancials = existing ? financialFieldsChanged(existing, record) : false;

  let action = null;
  if (wasVerified && changedFinancials) {
    // Any financial change reverses the ledger effect and requires re-verification.
    action = 'unverified_by_edit';
    setUnverified(record);
  } else if (wantsVerified && !verifier) {
    setUnverified(record);
  } else if (wantsVerified && !wasVerified) {
    action = 'verified';
    record.verification_status = 'VERIFIED';
    record.verified_by_user_id = user.id;
    record.verified_by = user.name || user.email || '';
    record.verified_at = new Date().toISOString();
  } else if (wantsVerified && wasVerified) {
    // Keep the original verifier stamps.
    record.verified_by_user_id = existing.verified_by_user_id;
    record.verified_by = existing.verified_by;
    record.verified_at = existing.verified_at;
  } else {
    if (wasVerified) action = 'unverified';
    setUnverified(record);
  }

  record.ledger_posting_status = getLedgerPostingStatus(record);
  return { record, action };
}

function setUnverified(record) {
  record.verification_status = 'TO_BE_VERIFIED';
  record.verified_by_user_id = null;
  record.verified_by = '';
  record.verified_at = null;
}
