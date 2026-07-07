import { useEffect, useMemo, useState } from 'react';
import { rememberPayment, savePayment } from '../helpers/storage';
import { api } from '../helpers/api';
import { createPaymentEntry, createSupplierPaymentEntry, getBookingLedger, numeric, PAYMENT_MODES } from '../helpers/calculations';
import { extractPaymentProof, validatePaymentProofFile } from '../helpers/paymentProofs';
import { mergePaymentProofDraft } from '../helpers/paymentProofParser';
import {
  displayDirection,
  fieldLabel,
  fieldRequired,
  financialFieldsChanged,
  getLedgerPostingStatus,
  isSupplierPayment,
  methodFieldProblems,
  methodFieldsFor,
  nextPaymentReference,
  normalizeVerificationStatus,
  PARTY_TYPES,
  PAYMENT_CURRENCIES,
  PAYMENT_DIRECTIONS,
  withRecordedBy,
  withVerification,
} from '../helpers/paymentVerification';
import { canVerifyPayments } from '../helpers/access';
import { formatCurrency } from '../helpers/format';
import { FileText, Loader2, Paperclip, RotateCcw, RotateCw, ScanText, ZoomIn, ZoomOut } from 'lucide-react';

const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const EMPTY_FORM = {
  payment_date: new Date().toISOString().split('T')[0],
  payment_direction: 'RECEIVED',
  party_type: 'CUSTOMER',
  party_name: '',
  pnr: '',
  ticket_id: '',
  amount_paid: '',
  transaction_currency: 'EUR',
  payment_method: 'BANK_TRANSFER',
  verification_status: 'TO_BE_VERIFIED',
  receipt_ref: '',
  remarks: '',
  verification_notes: '',
  attachment: null,
};

// One input in the method-specific section, driven by METHOD_FIELDS config.
function MethodFieldInput({ field, record, onChange }) {
  const label = fieldLabel(field, record);
  const required = fieldRequired(field, record);
  const value = record[field.key] ?? '';
  const labelText = `${label}${required ? ' *' : ''}`;

  if (field.type === 'select') {
    return (
      <label>
        <span>{labelText}</span>
        <select value={value} onChange={(event) => onChange(field.key, event.target.value)}>
          <option value="">Select...</option>
          {field.options.map((option) => {
            const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option.replace(/_/g, ' ')];
            return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
          })}
        </select>
      </label>
    );
  }

  const inputType = field.type === 'datetime' ? 'datetime-local' : field.type;
  return (
    <label>
      <span>{labelText}</span>
      <input
        type={inputType}
        value={value}
        min={field.type === 'number' ? '0' : undefined}
        step={field.type === 'number' ? '0.01' : undefined}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
    </label>
  );
}

// Full payment record form with the verification workflow: general fields,
// method-specific transaction fields, payment proof, and verification status.
// Used by the Payments page and the booking detail "Add Payment" action.
//
// Props:
// - user: logged-in user (drives recorded-by stamps and verify rights)
// - bookings / payments: full collections for fare totals and references
// - editingPayment: existing record to edit, or null to create
// - lockedPnr: preset the form to a customer payment for this PNR
// - onClose(), onSaved(record)
export default function PaymentRecordModal({ user, bookings = [], payments = [], editingPayment = null, lockedPnr = '', onClose, onSaved }) {
  const canVerify = canVerifyPayments(user);

  const [form, setForm] = useState(() => {
    if (editingPayment) {
      return {
        ...EMPTY_FORM,
        ...editingPayment,
        payment_method: editingPayment.payment_method || editingPayment.payment_mode || 'BANK_TRANSFER',
        payment_direction: displayDirection(editingPayment) === 'PAID' ? 'PAID' : 'RECEIVED',
        party_type: editingPayment.party_type || (isSupplierPayment(editingPayment) ? 'SUPPLIER' : 'CUSTOMER'),
        party_name: editingPayment.party_name || editingPayment.supplier_name || '',
        verification_status: normalizeVerificationStatus(editingPayment),
        amount_paid: String(editingPayment.amount_paid ?? ''),
        attachment: editingPayment.attachment || null,
      };
    }
    return { ...EMPTY_FORM, pnr: lockedPnr || '', party_type: 'CUSTOMER' };
  });
  const [proofFile, setProofFile] = useState(null);
  const [proofOcr, setProofOcr] = useState(editingPayment?.payment_proof_ocr || null);
  const [proofStatus, setProofStatus] = useState('');
  const [proofPreviewUrl, setProofPreviewUrl] = useState(editingPayment?.attachment?.data_url || '');
  const [proofZoom, setProofZoom] = useState(1);
  const [proofRotation, setProofRotation] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!proofFile) return undefined;
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    setProofZoom(1);
    setProofRotation(0);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const bookingLedger = useMemo(() => getBookingLedger(bookings, payments), [bookings, payments]);
  const pnrOptions = bookingLedger.filter((booking) => booking.pnr_n === 1);

  // Party suggestions per party type, from the data this user can see.
  const partyOptions = useMemo(() => {
    const customers = new Set();
    const agents = new Set();
    const suppliers = new Set();
    bookings.forEach((booking) => {
      [booking.bill_to_name, booking.passenger_name].filter(Boolean).forEach((name) => customers.add(name));
      [booking.booked_by, booking.agent_issued_by].filter(Boolean).forEach((name) => agents.add(name));
      [booking.supplier_name, booking.supplier, booking.airline].filter(Boolean).forEach((name) => suppliers.add(name));
      (booking.supplier_segments || []).forEach((segment) => segment.supplier_name && suppliers.add(segment.supplier_name));
    });
    return {
      CUSTOMER: [...customers].sort(),
      AGENT: [...agents].sort(),
      SUPPLIER: [...suppliers].sort(),
    };
  }, [bookings]);

  const methodFields = methodFieldsFor(form.payment_method);
  const hasGrossAmount = methodFields.some((field) => field.key === 'gross_amount');
  const grossAmount = numeric(form.gross_amount) || numeric(form.amount_paid);
  const netSettlement = grossAmount - numeric(form.processing_fee);

  const ticketOptions = useMemo(() => {
    if (form.party_type !== 'CUSTOMER' || !form.pnr) return [];
    const normalized = form.pnr.replace(/[^a-z0-9]/gi, '').toUpperCase();
    return bookings
      .filter((booking) => (booking.pnr || '').replace(/[^a-z0-9]/gi, '').toUpperCase() === normalized)
      .map((booking) => ({ id: booking.ticket_no || booking.id, label: `${booking.passenger_name || 'Passenger'}${booking.ticket_no ? ` · ${booking.ticket_no}` : ''}` }));
  }, [bookings, form.party_type, form.pnr]);

  const selectedPreview = useMemo(() => {
    if (form.party_type !== 'CUSTOMER') return null;
    return createPaymentEntry(
      { ...form, amount_paid: numeric(form.amount_paid), received_by: user?.name || 'Finance Desk' },
      bookings,
      payments,
    );
  }, [bookings, form, payments, user]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const proofMeta = form.payment_proof || editingPayment?.payment_proof || null;
  const proofAttachment = proofFile || form.attachment || null;
  const proofName = proofFile?.name || proofMeta?.file_name || proofAttachment?.name || '';
  const proofType = proofFile?.type || proofMeta?.content_type || proofAttachment?.type || '';
  const hasProofPreview = Boolean(proofPreviewUrl);
  const hasExistingProof = Boolean(proofMeta || proofAttachment);
  const proofConfidence = proofOcr?.confidence;
  const proofConfidenceLabel = Number.isFinite(Number(proofConfidence)) ? `${Number(proofConfidence).toFixed(1)}%` : '';
  const extractedReference = proofOcr?.extracted?.bank_transaction_reference
    || proofOcr?.extracted?.upi_transaction_id
    || proofOcr?.extracted?.pos_transaction_reference
    || proofOcr?.extracted?.gateway_transaction_id
    || proofOcr?.extracted?.cheque_number
    || '';

  const handleAttachment = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const problem = validatePaymentProofFile(file);
    if (problem || !ATTACHMENT_TYPES.includes(file.type) || file.size > ATTACHMENT_MAX_BYTES) {
      alert(problem || 'Payment proof must be a JPG, PNG, or PDF file smaller than 10 MB.');
      return;
    }
    setProofFile(file);
    setProofOcr(null);
    updateForm('attachment', {
      name: file.name,
      type: file.type,
      size: file.size,
      storage: 'pending-r2-upload',
    });
    setProofStatus('Reading proof locally...');

    try {
      const ocr = await extractPaymentProof(file);
      setProofOcr(ocr);
      setForm((current) => mergePaymentProofDraft(current, ocr.extracted));
      setProofStatus(ocr.warnings?.length
        ? `OCR finished with ${ocr.warnings.length} field warning${ocr.warnings.length === 1 ? '' : 's'}`
        : 'OCR fields detected');
    } catch (error) {
      console.error('Payment proof OCR failed:', error);
      setProofStatus('Proof selected; OCR could not read enough text');
    }
  };

  // Assembles the stored payment record from the form. Method-specific fields
  // are copied from the form, and derived values (net settlement, card type,
  // reference) are filled in.
  const buildRecord = () => {
    const amount = numeric(form.amount_paid);
    const methodValues = {};
    methodFields.forEach((field) => {
      methodValues[field.key] = form[field.key] ?? '';
    });
    if (form.payment_method === 'CREDIT_CARD') methodValues.card_type = 'CREDIT';
    if (form.payment_method === 'DEBIT_CARD') methodValues.card_type = 'DEBIT';
    if (hasGrossAmount) {
      methodValues.gross_amount = numeric(form.gross_amount) || amount;
      methodValues.processing_fee = numeric(form.processing_fee);
      methodValues.net_settlement = methodValues.gross_amount - methodValues.processing_fee;
    }

    const shared = {
      ...methodValues,
      payment_date: form.payment_date,
      payment_direction: form.payment_direction,
      party_type: form.party_type,
      // Customer payments take the party name from the booking's lead
      // passenger; there is no manual customer field in the form.
      party_name: form.party_type === 'CUSTOMER' ? '' : form.party_name,
      ticket_id: form.party_type === 'CUSTOMER' ? form.ticket_id : '',
      transaction_currency: form.transaction_currency,
      payment_mode: form.payment_method,
      payment_method: form.payment_method,
      receipt_ref: form.receipt_ref,
      remarks: form.remarks,
      verification_notes: form.verification_notes,
      attachment: proofFile ? null : form.attachment,
      payment_proof: form.payment_proof || editingPayment?.payment_proof || null,
      payment_proof_ocr: proofOcr || form.payment_proof_ocr || null,
      received_by: user?.name || user?.email || 'Finance Desk',
    };

    if (form.party_type === 'SUPPLIER') {
      return {
        ...createSupplierPaymentEntry({
          payment_date: form.payment_date,
          supplier_name: form.party_name,
          amount_paid: amount,
          payment_mode: form.payment_method,
          receipt_ref: form.receipt_ref,
          received_by: shared.received_by,
          remarks: form.remarks,
        }),
        ...shared,
        amount_paid: amount,
        transaction_amount: amount,
        payment_direction: 'SUPPLIER_OUT',
        payment_reference: nextPaymentReference(payments, 'PAID'),
      };
    }

    if (form.party_type === 'CUSTOMER') {
      return createPaymentEntry({ ...shared, pnr: form.pnr, amount_paid: amount }, bookings, payments);
    }

    // AGENT party: a settlement payment from/to an agent, not tied to a PNR.
    return {
      ...shared,
      pnr: '',
      amount_paid: amount,
      transaction_amount: amount,
      passenger_name: form.party_name,
      payment_reference: nextPaymentReference(payments, form.payment_direction),
      verification_status: 'TO_BE_VERIFIED',
    };
  };

  const uploadProofAndSave = async (record) => {
    const paymentId = record.id || editingPayment?.id || crypto.randomUUID();
    const upload = await api.createPaymentProofUpload(paymentId, {
      fileName: proofFile.name,
      contentType: proofFile.type,
      size: proofFile.size,
      record: {
        ...record,
        id: paymentId,
        attachment: null,
        verification_status: 'PENDING_UPLOAD',
      },
    });

    const response = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': proofFile.type },
      body: proofFile,
    });
    if (!response.ok) throw new Error(`R2 upload failed (${response.status})`);

    const completed = await api.completePaymentProofUpload(paymentId, {
      proofId: upload.proof.id,
      record: {
        ...record,
        id: paymentId,
        attachment: null,
        payment_proof: upload.proof,
      },
      ocr: proofOcr,
    });

    return rememberPayment(completed.record);
  };

  const handleSave = async () => {
    if (saving) return;
    const amount = numeric(form.amount_paid);
    const problems = [];
    if (!form.payment_date) problems.push('Payment date is required.');
    if (!amount || amount <= 0) problems.push('Enter a positive payment amount.');
    if (form.party_type === 'CUSTOMER' && !form.pnr) problems.push('Select a PNR for customer payments.');
    if (form.party_type !== 'CUSTOMER' && !form.party_name.trim()) problems.push(`Select the ${form.party_type.toLowerCase()} this payment belongs to.`);

    const candidate = buildRecord();
    problems.push(...methodFieldProblems(candidate));
    if (problems.length) {
      alert(problems.join('\n'));
      return;
    }

    let record = candidate;

    if (editingPayment) {
      // Keep identity, submission stamps, and instalment history of the
      // original record; only overwrite what the form controls.
      record = { ...editingPayment, ...candidate, id: editingPayment.id, payment_reference: editingPayment.payment_reference || candidate.payment_reference };
      const wasVerified = normalizeVerificationStatus(editingPayment) === 'VERIFIED';
      const changedFinancials = financialFieldsChanged(editingPayment, record);
      if (wasVerified && changedFinancials) {
        // Financial change reverses the ledger effect and requires re-verification.
        record = withVerification(record, user, false);
        alert('Financial fields changed: the payment was reset to To Be Verified and removed from the ledger until it is verified again.');
      } else if (canVerify && form.verification_status === 'VERIFIED' && !wasVerified) {
        record = withVerification(record, user, true);
      } else if (!wasVerified) {
        record = withVerification(record, user, false);
      } else {
        record.ledger_posting_status = getLedgerPostingStatus(record);
      }
    } else {
      record = withRecordedBy(record, user);
      record = withVerification(record, user, canVerify && form.verification_status === 'VERIFIED');
    }

    try {
      setSaving(true);
      setProofStatus(proofFile ? 'Uploading proof evidence...' : proofStatus);
      const saved = proofFile ? await uploadProofAndSave(record) : savePayment(record);
      onSaved?.(saved);
    } catch (error) {
      console.error('Unable to save payment:', error);
      alert(error.message || 'Unable to save payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="card modal-card modal-card-wide" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <h3>{editingPayment ? 'Edit Payment' : lockedPnr ? `Record Payment · ${lockedPnr}` : 'Record Payment'}</h3>

        <div className="payment-proof-layout">
          <aside className="payment-proof-panel">
            <div className="payment-proof-header">
              <span>Payment Proof</span>
              {proofConfidenceLabel && (
                <strong>
                  <ScanText size={14} />
                  OCR {proofConfidenceLabel}
                </strong>
              )}
            </div>

            <div className="payment-proof-viewer">
              {hasProofPreview && proofType === 'application/pdf' ? (
                <embed
                  src={proofPreviewUrl}
                  type="application/pdf"
                  className="payment-proof-pdf"
                  style={{
                    transform: `scale(${proofZoom}) rotate(${proofRotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                />
              ) : hasProofPreview ? (
                <img
                  src={proofPreviewUrl}
                  alt="Payment proof"
                  className="payment-proof-image"
                  style={{
                    transform: `scale(${proofZoom}) rotate(${proofRotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                />
              ) : (
                <div className="payment-proof-empty">
                  <FileText size={34} />
                  <strong>{hasExistingProof ? 'Secure proof attached' : 'Original receipt'}</strong>
                  <span>{hasExistingProof ? 'Saved proof can be opened from verification.' : 'Upload JPG, PNG, or PDF'}</span>
                </div>
              )}
            </div>

            <div className="payment-proof-controls" aria-label="Payment proof viewer controls">
              <button type="button" className="icon-button" title="Zoom out" onClick={() => setProofZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))} disabled={!hasProofPreview}>
                <ZoomOut size={16} />
              </button>
              <span>{Math.round(proofZoom * 100)}%</span>
              <button type="button" className="icon-button" title="Zoom in" onClick={() => setProofZoom((value) => Math.min(2.5, Number((value + 0.1).toFixed(2))))} disabled={!hasProofPreview}>
                <ZoomIn size={16} />
              </button>
              <button type="button" className="icon-button" title="Rotate left" onClick={() => setProofRotation((value) => value - 90)} disabled={!hasProofPreview}>
                <RotateCcw size={16} />
              </button>
              <button type="button" className="icon-button" title="Rotate right" onClick={() => setProofRotation((value) => value + 90)} disabled={!hasProofPreview}>
                <RotateCw size={16} />
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setProofZoom(1); setProofRotation(0); }} disabled={!hasProofPreview}>
                Reset
              </button>
            </div>

            <label className="payment-proof-upload">
              <span>Payment Proof (JPG, PNG, PDF)</span>
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleAttachment} />
            </label>

            {(proofName || proofStatus || hasExistingProof || proofOcr) && (
              <div className="payment-proof-meta">
                {proofName && (
                  <div>
                    <span>Original</span>
                    <strong>{proofName}</strong>
                  </div>
                )}
                {proofMeta?.id && (
                  <div>
                    <span>Proof ID</span>
                    <strong>{proofMeta.id}</strong>
                  </div>
                )}
                {proofMeta?.created_by_user_id && (
                  <div>
                    <span>Uploaded by</span>
                    <strong>{proofMeta.created_by_user_id}</strong>
                  </div>
                )}
                {proofStatus && (
                  <div>
                    <span>OCR</span>
                    <strong>{proofStatus}</strong>
                  </div>
                )}
                {proofOcr?.extracted?.amount_paid && (
                  <div>
                    <span>Detected amount</span>
                    <strong>{formatCurrency(proofOcr.extracted.amount_paid, proofOcr.extracted.transaction_currency || form.transaction_currency)}</strong>
                  </div>
                )}
                {proofOcr?.extracted && (
                  <div>
                    <span>Detected reference</span>
                    <strong>{extractedReference || '-'}</strong>
                  </div>
                )}
              </div>
            )}

            {form.attachment && (
              <button
                className="btn btn-secondary btn-sm payment-proof-remove"
                type="button"
                onClick={() => {
                  setProofFile(null);
                  setProofOcr(null);
                  setProofStatus('');
                  setProofZoom(1);
                  setProofRotation(0);
                  setProofPreviewUrl('');
                  updateForm('attachment', null);
                  updateForm('payment_proof', null);
                }}
              >
                <Paperclip size={14} />
                Remove Proof
              </button>
            )}
          </aside>

          <section className="payment-details-panel">
        <div className="modal-form-grid">
          <label>
            <span>Payment Date *</span>
            <input type="date" value={form.payment_date} onChange={(event) => updateForm('payment_date', event.target.value)} />
          </label>
          <label>
            <span>Payment Direction *</span>
            <select
              value={form.party_type === 'SUPPLIER' ? 'PAID' : form.payment_direction}
              disabled={form.party_type === 'SUPPLIER' || Boolean(lockedPnr)}
              onChange={(event) => updateForm('payment_direction', event.target.value)}
            >
              {PAYMENT_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}
            </select>
          </label>
          <label>
            <span>Party Type *</span>
            <select value={form.party_type} disabled={Boolean(lockedPnr)} onChange={(event) => updateForm('party_type', event.target.value)}>
              {PARTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          {form.party_type !== 'CUSTOMER' && (
            <label>
              <span>{form.party_type === 'AGENT' ? 'Agent *' : 'Supplier *'}</span>
              <input
                list="payment-party-options"
                value={form.party_name}
                onChange={(event) => updateForm('party_name', event.target.value)}
                placeholder={`Search ${form.party_type.toLowerCase()}...`}
              />
              <datalist id="payment-party-options">
                {(partyOptions[form.party_type] || []).map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
          )}
          {form.party_type === 'CUSTOMER' && (
            <label>
              <span>PNR *</span>
              <select value={form.pnr} disabled={Boolean(lockedPnr)} onChange={(event) => updateForm('pnr', event.target.value)}>
                <option value="">Select PNR</option>
                {pnrOptions.map((booking) => (
                  <option key={booking.id} value={booking.pnr}>
                    {booking.pnr} - {booking.passenger_name} (Due: {formatCurrency(booking.balance_due)})
                  </option>
                ))}
                {lockedPnr && !pnrOptions.some((booking) => booking.pnr === lockedPnr) && (
                  <option value={lockedPnr}>{lockedPnr}</option>
                )}
              </select>
            </label>
          )}
          {form.party_type === 'CUSTOMER' && ticketOptions.length > 0 && (
            <label>
              <span>Passenger / Ticket (optional)</span>
              <select value={form.ticket_id} onChange={(event) => updateForm('ticket_id', event.target.value)}>
                <option value="">PNR level</option>
                {ticketOptions.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.label}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>Amount *</span>
            <input type="number" value={form.amount_paid} onChange={(event) => updateForm('amount_paid', event.target.value)} min="0" step="0.01" />
          </label>
          <label>
            <span>Currency *</span>
            <select value={form.transaction_currency} onChange={(event) => updateForm('transaction_currency', event.target.value)}>
              {PAYMENT_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
          <label>
            <span>Payment Method *</span>
            <select value={form.payment_method} onChange={(event) => updateForm('payment_method', event.target.value)}>
              {PAYMENT_MODES.filter((mode) => mode !== 'AUTO_DEBIT').map((mode) => (
                <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Verification Status *</span>
            {canVerify ? (
              <select value={form.verification_status} onChange={(event) => updateForm('verification_status', event.target.value)}>
                <option value="TO_BE_VERIFIED">To Be Verified</option>
                <option value="VERIFIED">Verified</option>
              </select>
            ) : (
              <input value="To Be Verified" readOnly disabled title="Only users with the Verify payments permission can verify." />
            )}
          </label>
        </div>

        <h4 style={{ margin: '14px 0 6px' }}>{form.payment_method.replace(/_/g, ' ')} details</h4>
        <div className="modal-form-grid">
          {methodFields.map((field) => (
            <MethodFieldInput key={field.key} field={field} record={form} onChange={updateForm} />
          ))}
          {hasGrossAmount && (
            <label>
              <span>Net Settlement (auto)</span>
              <input value={formatCurrency(netSettlement)} readOnly disabled />
            </label>
          )}
        </div>

        <div className="modal-form-grid" style={{ marginTop: '10px' }}>
          <label className="span-2">
            <span>Notes</span>
            <input value={form.remarks} onChange={(event) => updateForm('remarks', event.target.value)} />
          </label>
        </div>
          </section>
        </div>

        <div className="auto-preview-list compact-preview">
          <div><span>Payment Ref</span><strong>{editingPayment ? (form.payment_reference || '-') : nextPaymentReference(payments, form.party_type === 'SUPPLIER' ? 'PAID' : form.payment_direction)}</strong></div>
          {selectedPreview && (
            <>
              <div><span>Instalment Type</span><strong>{selectedPreview.instalment_type || '-'}</strong></div>
              <div><span>Cumulative Paid</span><strong>{formatCurrency(selectedPreview.cumulative_paid)}</strong></div>
              <div><span>Remaining Balance</span><strong>{formatCurrency(selectedPreview.remaining_balance)}</strong></div>
            </>
          )}
          <div><span>Ledger Effect</span><strong>{(canVerify && form.verification_status === 'VERIFIED') ? 'Posts on save (if eligible)' : 'None until verified'}</strong></div>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 size={15} />}
            {saving ? 'Saving...' : editingPayment ? 'Save Changes' : canVerify && form.verification_status === 'VERIFIED' ? 'Save & Verify' : 'Submit Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
