// Payment verification workflow: statuses, per-method field definitions, and
// the ledger posting rule. A payment record existing is not the same as a
// payment being confirmed — only VERIFIED payments whose method status is
// eligible may affect balances, collections, and ledgers.
//
// Records created before this workflow have no verification_status; they are
// grandfathered as VERIFIED so historical ledgers do not change.

export const VERIFICATION_STATUSES = ['PENDING_UPLOAD', 'TO_BE_VERIFIED', 'VERIFIED'];

export const VERIFICATION_LABELS = {
  PENDING_UPLOAD: 'Pending Upload',
  TO_BE_VERIFIED: 'To Be Verified',
  VERIFIED: 'Verified',
};

export const PAYMENT_DIRECTIONS = ['RECEIVED', 'PAID'];

export const PARTY_TYPES = ['CUSTOMER', 'AGENT', 'SUPPLIER'];

export const PAYMENT_CURRENCIES = ['EUR', 'INR', 'USD', 'GBP'];

export const LEDGER_POSTING_STATUSES = [
  'PENDING_VERIFICATION',
  'READY_TO_POST',
  'POSTED',
  'NOT_ELIGIBLE',
  'REVERSED',
];

export const CASHBOXES = [
  ['ROME_HQ_CASHBOX', 'Rome HQ Cashbox'],
  ['ROME_STOREFRONT_CASHBOX', 'Rome Storefront Cashbox'],
  ['INDIA_OFFICE_CASHBOX', 'India Office Cashbox'],
];

export const BANK_ACCOUNTS = [
  ['REVOLUT_EUR', 'Revolut EUR'],
  ['INTESA_SANPAOLO', 'Intesa Sanpaolo'],
  ['HDFC_INDIA', 'HDFC India'],
];

export const POS_TERMINALS = [
  ['ROME_POS_01', 'Rome POS 01'],
  ['ROME_POS_02', 'Rome POS 02'],
  ['STOREFRONT_POS', 'Storefront POS'],
];

const CARD_NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'OTHER'];

// Per-method transaction fields shown under the general payment fields.
// type: text | number | date | datetime | email | select
// required: boolean or (record) => boolean; label: string or (record) => string
export const METHOD_FIELDS = {
  CASH: [
    { key: 'cash_handled_by', label: (r) => (r.payment_direction === 'PAID' ? 'Cash Paid By' : 'Cash Received By'), type: 'text', required: true },
    { key: 'cashbox_id', label: 'Cash Location / Cashbox', type: 'select', options: CASHBOXES, required: true },
  ],
  BANK_TRANSFER: [
    { key: 'bank_transaction_reference', label: 'Bank Transaction Reference / TRN / UTR', type: 'text', required: true },
    { key: 'bank_party_name', label: (r) => (r.payment_direction === 'PAID' ? 'Beneficiary Name' : 'Sender Name'), type: 'text', required: true },
    { key: 'internal_bank_account_id', label: (r) => (r.payment_direction === 'PAID' ? 'Paid From (Bank Account)' : 'Received Into (Bank Account)'), type: 'select', options: BANK_ACCOUNTS, optionsSource: 'BANK_ACCOUNTS', required: true },
    { key: 'external_account_reference', label: 'Sender IBAN / Account Number', type: 'text' },
    { key: 'bank_name', label: 'Sender Bank Name', type: 'text' },
    { key: 'bank_transaction_date', label: 'Transaction Date', type: 'date', required: true },
    { key: 'value_date', label: 'Value Date', type: 'date' },
    { key: 'bank_description', label: 'Bank Description / Transfer Narrative', type: 'text' },
  ],
  CREDIT_CARD: [
    { key: 'card_transaction_id', label: 'Transaction ID', type: 'text', required: true },
    { key: 'card_processor', label: 'Card Processor / Acquirer', type: 'select', options: ['REVOLUT', 'STRIPE', 'NEXI', 'SUMUP', 'OTHER'], required: true },
    { key: 'card_network', label: 'Card Network', type: 'select', options: CARD_NETWORKS },
    { key: 'card_last_four', label: 'Card Last 4 Digits', type: 'text', pattern: /^\d{4}$/, patternHint: 'exactly 4 digits' },
    { key: 'authorization_code', label: 'Authorization Code', type: 'text' },
    { key: 'card_transaction_date', label: 'Transaction Date', type: 'datetime', required: true },
    { key: 'gross_amount', label: 'Gross Amount', type: 'number', required: true },
    { key: 'processing_fee', label: 'Processing Fee', type: 'number' },
    { key: 'settlement_status', label: 'Settlement Status', type: 'select', options: ['AUTHORIZED', 'PENDING', 'SETTLED', 'FAILED', 'REVERSED', 'CHARGEBACK'], required: true },
    { key: 'settlement_date', label: 'Settlement Date', type: 'date', required: (r) => r.settlement_status === 'SETTLED' },
  ],
  UPI: [
    { key: 'upi_transaction_id', label: 'UPI Transaction ID / UTR', type: 'text', required: true },
    { key: 'upi_party_name', label: (r) => (r.payment_direction === 'PAID' ? 'Beneficiary Name' : 'Payer Name'), type: 'text', required: true },
    { key: 'payer_upi_id', label: 'Payer UPI ID', type: 'text' },
    { key: 'internal_upi_account_id', label: (r) => (r.payment_direction === 'PAID' ? 'Paying UPI Account' : 'Receiving UPI Account'), type: 'text', required: true },
    { key: 'upi_provider', label: 'UPI Provider / Application', type: 'select', options: ['GOOGLE_PAY', 'PHONEPE', 'PAYTM', 'BHIM', 'BANK_UPI', 'OTHER'] },
    { key: 'upi_transaction_date', label: 'Transaction Date', type: 'datetime', required: true },
    { key: 'payment_status', label: 'Payment Status', type: 'select', options: ['SUCCESS', 'PENDING', 'FAILED', 'REVERSED'], required: true },
  ],
  CHEQUE: [
    { key: 'cheque_number', label: 'Cheque Number', type: 'text', required: true },
    { key: 'cheque_date', label: 'Cheque Date', type: 'date', required: true },
    { key: 'cheque_drawer_name', label: 'Drawer / Account Holder Name', type: 'text', required: true },
    { key: 'cheque_bank_name', label: 'Bank Name', type: 'text', required: true },
    { key: 'cheque_bank_branch', label: 'Branch Name', type: 'text' },
    { key: 'deposit_account_id', label: 'Deposit Account', type: 'select', options: BANK_ACCOUNTS, optionsSource: 'BANK_ACCOUNTS' },
    { key: 'deposit_date', label: 'Deposit Date', type: 'date' },
    { key: 'cheque_status', label: 'Cheque Status', type: 'select', options: ['RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'], required: true },
    { key: 'cheque_cleared_date', label: 'Cleared Date', type: 'date', required: (r) => r.cheque_status === 'CLEARED' },
    { key: 'cheque_bounce_reason', label: 'Bounce Reason', type: 'text', required: (r) => r.cheque_status === 'BOUNCED' },
  ],
  POS_TERMINAL: [
    { key: 'pos_terminal_id', label: 'POS Terminal', type: 'select', options: POS_TERMINALS, required: true },
    { key: 'terminal_id', label: 'Terminal ID', type: 'text' },
    { key: 'pos_transaction_reference', label: 'Transaction ID / STAN / RRN', type: 'text', required: true },
    { key: 'authorization_code', label: 'Authorization Code', type: 'text' },
    { key: 'card_type', label: 'Card Type', type: 'select', options: ['CREDIT', 'DEBIT', 'PREPAID', 'UNKNOWN'] },
    { key: 'card_network', label: 'Card Network', type: 'select', options: CARD_NETWORKS },
    { key: 'card_last_four', label: 'Card Last 4 Digits', type: 'text', pattern: /^\d{4}$/, patternHint: 'exactly 4 digits' },
    { key: 'pos_transaction_date', label: 'Transaction Date', type: 'datetime', required: true },
    { key: 'gross_amount', label: 'Gross Amount', type: 'number', required: true },
    { key: 'processing_fee', label: 'Processing Fee', type: 'number' },
    { key: 'settlement_batch_number', label: 'Batch Number / Settlement Number', type: 'text' },
    { key: 'settlement_status', label: 'Settlement Status', type: 'select', options: ['AUTHORIZED', 'SETTLEMENT_PENDING', 'SETTLED', 'FAILED', 'REVERSED', 'CHARGEBACK'], required: true },
    { key: 'settlement_date', label: 'Settlement Date', type: 'date', required: (r) => r.settlement_status === 'SETTLED' },
  ],
  ONLINE_PAYMENT: [
    { key: 'payment_gateway', label: 'Payment Gateway', type: 'select', options: ['REVOLUT', 'STRIPE', 'PAYPAL', 'NEXI', 'OTHER'], required: true },
    { key: 'gateway_transaction_id', label: 'Gateway Transaction ID', type: 'text', required: true },
    { key: 'order_reference', label: 'Order ID / Payment Link Reference', type: 'text' },
    { key: 'payer_name', label: 'Payer Name', type: 'text' },
    { key: 'payer_email', label: 'Payer Email', type: 'email' },
    { key: 'gateway_transaction_date', label: 'Transaction Date', type: 'datetime', required: true },
    { key: 'gross_amount', label: 'Gross Amount', type: 'number', required: true },
    { key: 'processing_fee', label: 'Gateway Fee', type: 'number' },
    { key: 'payment_status', label: 'Payment Status', type: 'select', options: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED', 'REVERSED', 'CHARGEBACK'], required: true },
    { key: 'settlement_status', label: 'Settlement Status', type: 'select', options: ['NOT_SETTLED', 'SETTLEMENT_PENDING', 'SETTLED'] },
    { key: 'settlement_date', label: 'Settlement Date', type: 'date', required: (r) => r.settlement_status === 'SETTLED' },
  ],
};

// DEBIT_CARD uses the same fields as CREDIT_CARD plus an automatic card_type.
METHOD_FIELDS.DEBIT_CARD = METHOD_FIELDS.CREDIT_CARD;

export function methodFieldsFor(method) {
  return METHOD_FIELDS[method] || [];
}

// Overrides the static `options` of any field that draws from a live source
// (e.g. the configurable bank accounts) with the provided [value, label] list.
// Falls back to the field's built-in options when no live options exist, so
// the form still works before the dynamic list has loaded.
export function withFieldOptions(fields, sources = {}) {
  return fields.map((field) => {
    if (!field.optionsSource) return field;
    const dynamic = sources[field.optionsSource];
    if (!dynamic || !dynamic.length) return field;
    return { ...field, options: dynamic };
  });
}

// Turns stored bank-account records into [value, label] option pairs for the
// payment dropdowns. Active accounts only; the id is the stored value so the
// payment keeps referencing the same account after the list changes.
export function bankAccountOptions(bankAccounts = []) {
  return bankAccounts
    .filter((account) => account && account.id && account.active !== false)
    .map((account) => {
      const label = account.currency ? `${account.label} (${account.currency})` : account.label;
      return [account.id, label || account.id];
    });
}

export function fieldLabel(field, record = {}) {
  return typeof field.label === 'function' ? field.label(record) : field.label;
}

export function fieldRequired(field, record = {}) {
  return typeof field.required === 'function' ? field.required(record) : Boolean(field.required);
}

// The key transaction reference for a payment, used for display and
// duplicate detection.
export function transactionReference(payment = {}) {
  return payment.bank_transaction_reference
    || payment.card_transaction_id
    || payment.upi_transaction_id
    || payment.pos_transaction_reference
    || payment.gateway_transaction_id
    || payment.cheque_number
    || payment.manual_receipt_no
    || payment.receipt_ref
    || '';
}

// Legacy records store payment_direction AGENT_IN / SUPPLIER_OUT; new records
// store RECEIVED / PAID plus party_type. Both shapes are recognised here.
export function isSupplierPayment(payment = {}) {
  return payment.payment_direction === 'SUPPLIER_OUT' || payment.party_type === 'SUPPLIER';
}

// Money coming in against a PNR (customer/agent side of the ledger). PAID
// directions (e.g. money returned to a customer) never increase paid totals.
export function isCustomerLedgerPayment(payment = {}) {
  if (isSupplierPayment(payment)) return false;
  const direction = payment.payment_direction || 'RECEIVED';
  return direction === 'RECEIVED' || direction === 'AGENT_IN';
}

export function displayDirection(payment = {}) {
  if (payment.payment_direction === 'SUPPLIER_OUT') return 'PAID';
  if (payment.payment_direction === 'AGENT_IN') return 'RECEIVED';
  return payment.payment_direction || 'RECEIVED';
}

export function normalizeVerificationStatus(payment = {}) {
  // Pre-workflow records carry no verification_status: grandfathered VERIFIED.
  return payment.verification_status || 'VERIFIED';
}

export function getLedgerPostingStatus(payment = {}) {
  const method = payment.payment_method || payment.payment_mode || '';

  if (['REVERSED', 'CHARGEBACK'].includes(payment.settlement_status)) return 'REVERSED';
  if (['REVERSED', 'CHARGEBACK'].includes(payment.payment_status)) return 'REVERSED';
  if (payment.settlement_status === 'FAILED') return 'NOT_ELIGIBLE';
  if (['FAILED', 'EXPIRED', 'REFUNDED'].includes(payment.payment_status)) return 'NOT_ELIGIBLE';
  if (method === 'CHEQUE' && ['BOUNCED', 'CANCELLED'].includes(payment.cheque_status)) return 'NOT_ELIGIBLE';

  if (normalizeVerificationStatus(payment) !== 'VERIFIED') return 'PENDING_VERIFICATION';

  // Verified but the money has not landed yet: keep the verification, hold
  // the ledger posting until the method status becomes eligible.
  if (method === 'CHEQUE' && payment.cheque_status !== 'CLEARED') return 'READY_TO_POST';
  if (['UPI', 'ONLINE_PAYMENT'].includes(method) && payment.payment_status && payment.payment_status !== 'SUCCESS') return 'READY_TO_POST';

  return 'POSTED';
}

export function isPostedPayment(payment = {}) {
  return getLedgerPostingStatus(payment) === 'POSTED';
}

export function postedPayments(payments = []) {
  return payments.filter(isPostedPayment);
}

// Auto-generated payment reference: RCPT-000001 for money in, PAY-000001 for
// money out, continuing from the highest existing number.
export function nextPaymentReference(payments = [], direction = 'RECEIVED') {
  const prefix = direction === 'PAID' || direction === 'SUPPLIER_OUT' ? 'PAY' : 'RCPT';
  const highest = payments.reduce((max, payment) => {
    const match = String(payment.payment_reference || '').match(/^(RCPT|PAY)-(\d+)$/);
    return match && match[1] === prefix ? Math.max(max, Number(match[2])) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(6, '0')}`;
}

// Changing any of these on a VERIFIED payment reverses its ledger effect and
// sends it back to the verification queue.
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

// Stamps identifying who recorded the payment (set once, on create).
export function withRecordedBy(payment, user) {
  return {
    ...payment,
    recorded_by_user_id: user?.id || null,
    recorded_by: user?.name || user?.email || payment.received_by || '',
    recorded_by_role: user?.role || 'ADMIN',
  };
}

// Applies a verification decision and recomputes the posting status.
export function withVerification(payment, user, verified) {
  const next = { ...payment };
  if (verified) {
    next.verification_status = 'VERIFIED';
    next.verified_by_user_id = user?.id || null;
    next.verified_by = user?.name || user?.email || '';
    next.verified_at = new Date().toISOString();
  } else {
    next.verification_status = 'TO_BE_VERIFIED';
    next.verified_by_user_id = null;
    next.verified_by = '';
    next.verified_at = null;
  }
  next.ledger_posting_status = getLedgerPostingStatus(next);
  return next;
}

// Required-field and format checks for the method-specific section. Used both
// when recording a payment and again before verification.
export function methodFieldProblems(payment = {}) {
  const problems = [];
  const method = payment.payment_method || payment.payment_mode || '';

  methodFieldsFor(method).forEach((field) => {
    const value = payment[field.key];
    if (fieldRequired(field, payment) && (value === undefined || value === null || String(value).trim() === '')) {
      problems.push(`${fieldLabel(field, payment)} is required.`);
    }
    if (field.pattern && value && !field.pattern.test(String(value).trim())) {
      problems.push(`${fieldLabel(field, payment)} must be ${field.patternHint}.`);
    }
  });

  return problems;
}

// Pre-verification checks: required method fields, eligible method status,
// duplicate transaction references. Returns a list of blocking problems.
export function verificationProblems(payment = {}, allPayments = []) {
  const method = payment.payment_method || payment.payment_mode || '';
  const problems = methodFieldProblems(payment);

  if (['FAILED', 'REVERSED', 'CHARGEBACK'].includes(payment.settlement_status)) {
    problems.push(`Settlement status is ${payment.settlement_status} — this transaction cannot be verified.`);
  }
  if (['FAILED', 'EXPIRED', 'REVERSED', 'CHARGEBACK', 'REFUNDED'].includes(payment.payment_status)) {
    problems.push(`Payment status is ${payment.payment_status} — this transaction cannot be verified.`);
  }
  if (['UPI', 'ONLINE_PAYMENT'].includes(method) && payment.payment_status && !['SUCCESS'].includes(payment.payment_status)) {
    problems.push(`Payment status must be SUCCESS before verification (currently ${payment.payment_status}).`);
  }
  if (method === 'CHEQUE' && ['BOUNCED', 'CANCELLED'].includes(payment.cheque_status)) {
    problems.push(`Cheque status is ${payment.cheque_status} — this cheque cannot be verified.`);
  }

  const reference = transactionReference(payment);
  if (reference) {
    const duplicate = allPayments.find((other) => (
      other.id !== payment.id
      && transactionReference(other) === reference
      && (other.payment_method || other.payment_mode) === method
    ));
    if (duplicate) {
      problems.push(`Possible duplicate: ${duplicate.payment_reference || duplicate.id} uses the same ${method.replace(/_/g, ' ')} reference (${reference}).`);
    }
  }

  return problems;
}
