export const PAYMENT_PROOF_PARSER_VERSION = 'payment-proof-v1';

const CURRENCY_SYMBOLS = {
  '€': 'EUR',
  eur: 'EUR',
  '₹': 'INR',
  inr: 'INR',
  '$': 'USD',
  usd: 'USD',
  '£': 'GBP',
  gbp: 'GBP',
};

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function moneyNumber(value) {
  const raw = String(value || '').replace(/[^\d.,-]/g, '');
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  const integer = decimalIndex === -1 ? raw : raw.slice(0, decimalIndex);
  const decimals = decimalIndex === -1 ? '' : raw.slice(decimalIndex + 1);
  const normalized = `${integer.replace(/[.,]/g, '')}${decimals ? `.${decimals.replace(/[^\d]/g, '')}` : ''}`;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return date.toISOString().slice(0, 10);
}

function parseDate(text) {
  const value = String(text || '');
  let match = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    return isoDate(Number(match[3]), first > 12 ? second : first, first > 12 ? first : second);
  }

  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  match = value.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (match) return isoDate(Number(match[3]), months[match[2].toLowerCase()], Number(match[1]));
  return '';
}

function detectMethod(text) {
  const upper = text.toUpperCase();
  if (/\b(UPI|UTR|PHONEPE|PAYTM|BHIM|GOOGLE PAY|GPAY)\b/.test(upper)) return 'UPI';
  if (/\b(CARD|VISA|MASTERCARD|AMEX|AUTH(?:ORIZATION)? CODE|POS|TERMINAL|STAN|RRN)\b/.test(upper)) return 'POS_TERMINAL';
  if (/\b(STRIPE|PAYPAL|PAYMENT LINK|GATEWAY|REVOLUT PAY)\b/.test(upper)) return 'ONLINE_PAYMENT';
  if (/\b(CHEQUE|CHECK)\b/.test(upper)) return 'CHEQUE';
  if (/\b(CASH)\b/.test(upper)) return 'CASH';
  if (/\b(BANK|IBAN|TRN|TRANSFER|BENEFICIARY|SENDER|ACCOUNT)\b/.test(upper)) return 'BANK_TRANSFER';
  return '';
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compact(match[1]).replace(/[.,;:]+$/, '');
  }
  return '';
}

function extractAmountAndCurrency(text) {
  const amountWindow = text.match(/\b(?:amount|paid|total|totale|importo|settled|received)\b(.{0,80})/i)?.[1] || text;
  const labelled = amountWindow.match(/(EUR|INR|USD|GBP|€|₹|\$|£)\s*([-+]?\d[\d.,]*)/i)
    || amountWindow.match(/([-+]?\d[\d.,]*)\s*(EUR|INR|USD|GBP|€|₹|\$|£)/i)
    || amountWindow.match(/\b([-+]?\d[\d.,]*)\b/i);
  const fallback = text.match(/(EUR|INR|USD|GBP|€|₹|\$|£)\s*([-+]?\d[\d.,]*)/i)
    || text.match(/([-+]?\d[\d.,]*)\s*(EUR|INR|USD|GBP|€|₹|\$|£)/i);
  const match = labelled || fallback;
  if (!match) return {};

  const firstIsCurrency = CURRENCY_SYMBOLS[String(match[1] || '').toLowerCase()];
  const token = firstIsCurrency ? match[2] : match[1];
  const currencyToken = (firstIsCurrency ? match[1] : match[2] || '').toLowerCase();
  return {
    amount_paid: moneyNumber(token),
    transaction_currency: CURRENCY_SYMBOLS[currencyToken] || currencyToken.toUpperCase() || '',
  };
}

function cleanPartyName(value) {
  return compact(value).replace(/\b(?:account|iban|date|amount|total|transaction|txn|utr|trn|rrn|stan)\b.*$/i, '').trim();
}

export function parsePaymentProofText(rawText) {
  const text = compact(rawText);
  const method = detectMethod(text);
  const amount = extractAmountAndCurrency(text);
  const transactionRef = firstMatch(text, [
    /\b(?:transaction|txn|payment|bank|gateway)\s*(?:id|ref(?:erence)?|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{4,})/i,
    /\b(?:utr|trn|rrn|stan|auth(?:orization)? code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,})/i,
    /\b([A-Z]{2,}\d{6,}[A-Z0-9]*)\b/,
  ]);
  const payer = cleanPartyName(firstMatch(text, [
    /\b(?:sender|payer|from|customer)\s*(?:name)?\s*[:#-]?\s*([A-Z][A-Z .'-]{2,80})\b/i,
  ]));
  const account = firstMatch(text, [
    /\b(?:account|iban)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9*]{4,34})/i,
  ]);

  const extracted = {
    ...amount,
    payment_method: method,
    payment_date: parseDate(text),
    bank_transaction_reference: method === 'BANK_TRANSFER' ? transactionRef : '',
    upi_transaction_id: method === 'UPI' ? transactionRef : '',
    pos_transaction_reference: method === 'POS_TERMINAL' ? transactionRef : '',
    gateway_transaction_id: method === 'ONLINE_PAYMENT' ? transactionRef : '',
    cheque_number: method === 'CHEQUE' ? transactionRef : '',
    bank_party_name: method === 'BANK_TRANSFER' ? payer : '',
    upi_party_name: method === 'UPI' ? payer : '',
    payer_name: method === 'ONLINE_PAYMENT' ? payer : '',
    external_account_reference: method === 'BANK_TRANSFER' ? account : '',
  };

  const warnings = [];
  if (!text) warnings.push('NO_TEXT');
  if (!extracted.amount_paid) warnings.push('AMOUNT_NOT_FOUND');
  if (!transactionRef) warnings.push('REFERENCE_NOT_FOUND');
  if (!method) warnings.push('METHOD_NOT_DETECTED');

  return {
    parser_version: PAYMENT_PROOF_PARSER_VERSION,
    raw_text: rawText || '',
    extracted,
    warnings,
    confidence: Math.max(0, 1 - warnings.length * 0.2),
    status: text ? 'EXTRACTED' : 'NO_TEXT',
  };
}

export function mergePaymentProofDraft(form, extracted = {}) {
  const next = { ...form };
  Object.entries(extracted).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (key === 'amount_paid' && Number(value) <= 0) return;
    if (next[key] === undefined || next[key] === null || String(next[key]).trim() === '') {
      next[key] = key === 'amount_paid' ? String(value) : value;
    }
  });
  if (extracted.payment_method) next.payment_method = extracted.payment_method;
  if (extracted.payment_date && !form.payment_date) next.payment_date = extracted.payment_date;
  return next;
}
