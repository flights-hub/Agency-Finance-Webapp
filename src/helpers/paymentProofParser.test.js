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
    Total \u20b9 5000.00
    UTR: 627181928372
    Payer Name RAHUL SHARMA
  `);

  assert.equal(result.extracted.payment_method, 'UPI');
  assert.equal(result.extracted.amount_paid, 5000);
  assert.equal(result.extracted.transaction_currency, 'INR');
  assert.equal(result.extracted.upi_transaction_id, '627181928372');
  assert.equal(result.extracted.upi_party_name, 'RAHUL SHARMA');
});

test('parsePaymentProofText extracts PostePay SEPA receipt fields', () => {
  const result = parsePaymentProofText(`
    CONFERMA BONIFICO SEPA ISTANTANEO
    Gentile AMIT KUMAR DHAKA,
    di seguito le riportiamo gli estremi del Bonifico SEPA Istantaneo da lei effettuato il giorno 05/07/2026 alle ore 16:52:50
    ORDINANTE
    IBAN Carta Postepay di addebito: IT42U3608105138278587078603
    Intestazione: AMIT KUMAR DHAKA
    BENEFICIARIO
    IBAN: IT76F0538703248000049403789
    Intestazione: GHAI TRAVELS S.R.L.
    BIC banca destinataria: BPMOIT22XXX
    Denominazione della banca: BPER BANCA S.P.A.
    Paese di residenza: IT
    DATI BONIFICO SEPA ISTANTANEO
    Codice riferimento: CCTX00000355835215
    Data valuta addebito: 2026-07-05T14:52:24.783Z
    Importo bonifico: e 400.00
    Commissioni: e 1,00
    Totale: e 401,00
    Comunicazioni al Beneficiario: BIGLIETTO AEREO
  `);

  assert.equal(result.extracted.payment_method, 'BANK_TRANSFER');
  assert.equal(result.extracted.amount_paid, 400);
  assert.equal(result.extracted.transaction_currency, 'EUR');
  assert.equal(result.extracted.payment_date, '2026-07-05');
  assert.equal(result.extracted.bank_transaction_date, '2026-07-05');
  assert.equal(result.extracted.value_date, '2026-07-05');
  assert.equal(result.extracted.bank_transaction_reference, 'CCTX00000355835215');
  assert.equal(result.extracted.bank_party_name, 'AMIT KUMAR DHAKA');
  assert.equal(result.extracted.external_account_reference, 'IT42U3608105138278587078603');
  assert.equal(result.extracted.bank_name, 'PostePay');
  assert.equal(result.extracted.bank_description, 'BIGLIETTO AEREO');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.confidence, 100);
});

test('parsePaymentProofText extracts ICICI image receipt fields', () => {
  const result = parsePaymentProofText(`
    ICICI Bank
    Paid successfully!
    \u20b9 20,000.00
    To Bipasha Aviation Services P
    ICICI Bank Limited
    1511 0500 0344
    From Jaspreet Kaur
    ICICI Bank \u2022\u2022\u2022\u2022 3848 Savings a/c
    Paid at 01:05 PM, 01 Jul '26 IST
    Tr. ID: FG17381651
  `);

  assert.equal(result.extracted.payment_method, 'BANK_TRANSFER');
  assert.equal(result.extracted.amount_paid, 20000);
  assert.equal(result.extracted.transaction_currency, 'INR');
  assert.equal(result.extracted.payment_date, '2026-07-01');
  assert.equal(result.extracted.bank_transaction_date, '2026-07-01');
  assert.equal(result.extracted.value_date, '2026-07-01');
  assert.equal(result.extracted.bank_transaction_reference, 'FG17381651');
  assert.equal(result.extracted.bank_party_name, 'Jaspreet Kaur');
  assert.equal(result.extracted.external_account_reference, '3848');
  assert.equal(result.extracted.bank_name, 'ICICI Bank Limited');
  assert.equal(result.extracted.bank_description, 'Bipasha Aviation Services P');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.confidence, 100);
});

test('parsePaymentProofText extracts Indian UPI screenshot fields', () => {
  const result = parsePaymentProofText(`
    Payment successful
    \u20b9 15,000.00
    Paid to BIPASHA AVIATION SERVICES PRIVATE LIMITED
    Banking name BIPASHA AVIATION SERVICES
    UPI transaction ID 520418987654
    Paid at 12:14 PM, 01 Jul '26 IST
  `);

  assert.equal(result.extracted.payment_method, 'UPI');
  assert.equal(result.extracted.amount_paid, 15000);
  assert.equal(result.extracted.transaction_currency, 'INR');
  assert.equal(result.extracted.payment_date, '2026-07-01');
  assert.equal(result.extracted.upi_transaction_id, '520418987654');
  assert.equal(result.extracted.bank_description, '');
});

test('parsePaymentProofText extracts Italian mobile bonifico screenshot fields', () => {
  const result = parsePaymentProofText(`
    Bonifico eseguito
    L'importo di 235,00 € per GHAI TRAVELS S.R.L. è stato eseguito da BANCA FINECO.
    CRO/TRN: 1301261839274877
    01 luglio 2026
  `);

  assert.equal(result.extracted.payment_method, 'BANK_TRANSFER');
  assert.equal(result.extracted.amount_paid, 235);
  assert.equal(result.extracted.transaction_currency, 'EUR');
  assert.equal(result.extracted.payment_date, '2026-07-01');
  assert.equal(result.extracted.bank_transaction_reference, '1301261839274877');
});

test('parsePaymentProofText extracts Mooney receipt fields', () => {
  const result = parsePaymentProofText(`
    mooney RICEVUTA
    BONIFICO
    IMPORTO TOT. 400,00 EUR
    TID 0009703008036
    Data 07 luglio 2026
  `);

  assert.equal(result.extracted.payment_method, 'BANK_TRANSFER');
  assert.equal(result.extracted.amount_paid, 400);
  assert.equal(result.extracted.transaction_currency, 'EUR');
  assert.equal(result.extracted.payment_date, '2026-07-07');
  assert.equal(result.extracted.bank_transaction_reference, '0009703008036');
});

test('parsePaymentProofText reads a Mooney tabacchi bonifico receipt (day-first date, TRN over TID)', () => {
  const result = parsePaymentProofText(`
    mooney T-BONIFICO
    RICEVUTA DI PAGAMENTO
    TRN: 26070519561174014803200
    Beneficiario: GHAI TRAVELS S R L
    IBAN: IT76F0538703248000049403789
    IMPORTO TOT.: € 385,90
    Importo bonifico: € 380,00
    Commissioni: € 5,90
    TID: 000007032568657
    PE8807I Data: 05/07/2026 19:56:44
  `);

  assert.equal(result.extracted.payment_method, 'BANK_TRANSFER');
  // Record the net "Importo bonifico" (380,00), not the 385,90 total that
  // bundles the 5,90 commission we never track.
  assert.equal(result.extracted.amount_paid, 380);
  assert.equal(result.extracted.transaction_currency, 'EUR');
  // 05/07/2026 is 5 July, not 7 May.
  assert.equal(result.extracted.payment_date, '2026-07-05');
  // Prefer the transfer TRN, not the terminal TID.
  assert.equal(result.extracted.bank_transaction_reference, '26070519561174014803200');
});

test('parsePaymentProofText records the net transfer, excluding commission, on garbled OCR', () => {
  // Real Tesseract output for a photographed Mooney receipt: labels are
  // mangled ("IMPORTO TOT." -> "RTO TOT.") and stray numbers (address "20",
  // phone) would otherwise be mistaken for the amount. We record the net
  // bonifico (380,00), never the 385,90 total that includes the 5,90 fee.
  const result = parsePaymentProofText(`
    money T-BONIEICO
    CAPUA (CE) VIA DUOMO 20, 81043
    TRN : 260705195611
    Beneficiarig, : jie 3533938799
    RTO TOT. : € 385,90
    Importe bonifico: € 380,00
    Commissioni: € 5,90
    PEBEOTL Data: 05/07/202619:56:44
  `);

  assert.equal(result.extracted.amount_paid, 380);
  assert.equal(result.extracted.transaction_currency, 'EUR');
  assert.equal(result.extracted.payment_date, '2026-07-05');
});

test('parsePaymentProofText nets out commission even when the bonifico label is unreadable', () => {
  // If only the total and "Commissioni" survive OCR, subtract the fee.
  const result = parsePaymentProofText(`
    RTO TOT. : € 385,90
    xxxxx: € 5,90
    Commissioni € 5,90
  `);

  assert.equal(result.extracted.amount_paid, 380);
  assert.equal(result.extracted.transaction_currency, 'EUR');
});

test('mergePaymentProofDraft replaces the default payment date with extracted proof date', () => {
  const today = new Date().toISOString().split('T')[0];
  const result = mergePaymentProofDraft(
    { payment_date: today, amount_paid: '', payment_method: 'BANK_TRANSFER', transaction_currency: 'EUR' },
    { payment_date: '2026-07-05', amount_paid: 400, transaction_currency: 'INR', bank_transaction_date: '2026-07-05' },
  );

  assert.equal(result.payment_date, '2026-07-05');
  assert.equal(result.bank_transaction_date, '2026-07-05');
  assert.equal(result.amount_paid, '400');
  assert.equal(result.transaction_currency, 'INR');
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
