import { extractTextFromFile } from './pdfParser';
import { parsePaymentProofText } from './paymentProofParser';

export const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;

export function validatePaymentProofFile(file) {
  if (!file) return 'Select a payment proof file.';
  if (!PAYMENT_PROOF_TYPES.includes(file.type)) return 'Payment proof must be a JPG, PNG, or PDF file.';
  if (file.size > PAYMENT_PROOF_MAX_BYTES) return 'Payment proof must be smaller than 10 MB.';
  return '';
}

export async function extractPaymentProof(file) {
  const rawText = await extractTextFromFile(file, { purpose: 'payment-proof' });
  const parsed = parsePaymentProofText(rawText);
  return {
    ...parsed,
    engine: 'local-browser-ocr',
  };
}
