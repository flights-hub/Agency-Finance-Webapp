import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePaymentProofDraft, parsePaymentProofText } from './paymentProofParser.js';

test('parsePaymentProofText extracts bank transfer proof fields', () => {
  const result = parsePaymentProofText(`
    Payment successful
    Amount EUR 1,245.50
    Transaction Reference TRN982736451
    Sender Name Mario Rossi
    Account Number IT60X0542811101000000123456
    Date 07/07/2026
  `);

  assert.equal(result.extracted.payment_method, 'BANK_TRANSFER');
  assert.equal(result.extracted.amount_paid, 1245.5);
  assert.equal(result.extracted.transaction_currency, 'EUR');
  assert.equal(result.extracted.payment_date, '2026-07-07');
  assert.equal(result.extracted.bank_transaction_reference, 'TRN982736451');
  assert.equal(result.extracted.bank_party_name, 'Mario Rossi');
});

test('parsePaymentProofText extracts UPI proof fields', () => {
  const result = parsePaymentProofText(`
    UPI payment received
    Total ₹ 5000.00
    UTR: 627181928372
    Payer Name RAHUL SHARMA
  `);

  assert.equal(result.extracted.payment_method, 'UPI');
  assert.equal(result.extracted.amount_paid, 5000);
  assert.equal(result.extracted.transaction_currency, 'INR');
  assert.equal(result.extracted.upi_transaction_id, '627181928372');
  assert.equal(result.extracted.upi_party_name, 'RAHUL SHARMA');
});

test('mergePaymentProofDraft preserves fields edited while OCR is running', () => {
  const form = {
    party_type: 'SUPPLIER',
    party_name: 'Current Supplier',
    supplier_id: 'supplier-1',
    payment_date: '2026-07-08',
    payment_method: 'BANK_TRANSFER',
    transaction_currency: 'EUR',
    amount_paid: '',
  };
  const extracted = {
    payment_date: '2026-07-07',
    payment_method: 'UPI',
    transaction_currency: 'INR',
    amount_paid: 5000,
  };

  const merged = mergePaymentProofDraft(form, extracted, {
    protectedFields: ['payment_method'],
    overwriteFields: ['payment_date', 'payment_method', 'transaction_currency'],
  });

  assert.equal(merged.party_type, 'SUPPLIER');
  assert.equal(merged.party_name, 'Current Supplier');
  assert.equal(merged.supplier_id, 'supplier-1');
  assert.equal(merged.payment_date, '2026-07-07');
  assert.equal(merged.payment_method, 'BANK_TRANSFER');
  assert.equal(merged.transaction_currency, 'INR');
  assert.equal(merged.amount_paid, '5000');
});
