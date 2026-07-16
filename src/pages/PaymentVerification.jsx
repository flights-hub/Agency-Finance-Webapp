import { useMemo, useState } from 'react';
import { getPayments, getBookings, savePayment } from '../helpers/storage';
import { api } from '../helpers/api';
import { numeric } from '../helpers/calculations';
import {
  displayDirection,
  fieldLabel,
  getLedgerPostingStatus,
  isSupplierPayment,
  methodFieldsFor,
  normalizeVerificationStatus,
  transactionReference,
  VERIFICATION_LABELS,
  verificationProblems,
  withVerification,
} from '../helpers/paymentVerification';
import { useAuth } from '../AuthContext';
import { formatCurrency } from '../helpers/format';
import { BadgeCheck, Eye, Loader2, Paperclip, Search, ShieldAlert } from 'lucide-react';

const QUEUE_COLUMNS = [
  ['payment_reference', 'Payment Ref'],
  ['payment_date', 'Payment Date'],
  ['submitted_date', 'Submitted'],
  ['party_type_display', 'Party Type'],
  ['pnr', 'PNR'],
  ['amount_paid', 'Amount'],
  ['transaction_currency', 'Currency'],
  ['payment_method_display', 'Payment Method'],
  ['transaction_ref', 'Transaction Ref'],
  ['recorded_by_display', 'Submitted By'],
  ['recorded_by_role', 'Role'],
  ['proof', 'Proof'],
  ['verification_status', 'Verification'],
];

function isToday(isoDateTime) {
  return String(isoDateTime || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function formatOcrConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return '-';
  return `${(confidence <= 1 ? confidence * 100 : confidence).toFixed(1)}%`;
}

export default function PaymentVerification() {
  const { user } = useAuth();
  const [payments, setPayments] = useState(() => getPayments());
  const [bookings] = useState(() => getBookings());
  const [statusFilter, setStatusFilter] = useState('TO_BE_VERIFIED');
  const [search, setSearch] = useState('');
  const [viewTarget, setViewTarget] = useState(null);
  const [proofPreview, setProofPreview] = useState({ loading: false, url: '', error: '' });
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verifyNotes, setVerifyNotes] = useState('');

  const rows = useMemo(() => payments.map((payment) => ({
    ...payment,
    amount_paid: numeric(payment.amount_paid),
    verification_status: normalizeVerificationStatus(payment),
    ledger_posting_status: getLedgerPostingStatus(payment),
    submitted_date: String(payment.created_at || payment.payment_date || '').slice(0, 10),
    party_type_display: payment.party_type || (isSupplierPayment(payment) ? 'SUPPLIER' : 'CUSTOMER'),
    party_display: payment.party_name || payment.supplier_name || payment.passenger_name || '',
    payment_method_display: String(payment.payment_method || payment.payment_mode || '').replace(/_/g, ' '),
    transaction_ref: transactionReference(payment),
    recorded_by_display: payment.recorded_by || payment.received_by || '',
    direction_display: displayDirection(payment),
  })), [payments]);

  const pending = rows.filter((row) => row.verification_status === 'TO_BE_VERIFIED');
  const verifiedToday = rows.filter((row) => row.verification_status === 'VERIFIED' && isToday(row.verified_at));
  const pendingAmount = pending.reduce((sum, row) => sum + row.amount_paid, 0);
  const agentSubmitted = pending.filter((row) => row.recorded_by_role === 'AGENT');
  const withProof = pending.filter((row) => row.attachment || row.payment_proof);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => (!statusFilter || row.verification_status === statusFilter)
        && (!query || ['payment_reference', 'pnr', 'party_display', 'transaction_ref', 'recorded_by_display', 'remarks']
          .some((key) => String(row[key] || '').toLowerCase().includes(query))))
      .sort((a, b) => String(b.submitted_date || '').localeCompare(String(a.submitted_date || '')));
  }, [rows, search, statusFilter]);

  const openVerify = (row) => {
    const original = payments.find((payment) => payment.id === row.id);
    if (!original) return;
    setVerifyTarget(original);
    setVerifyNotes(original.verification_notes || '');
  };

  const openView = async (row) => {
    setViewTarget(row);
    setProofPreview({ loading: false, url: '', error: '' });
    if (!row.payment_proof?.id) return;

    setProofPreview({ loading: true, url: '', error: '' });
    try {
      const result = await api.paymentProofViewUrl(row.id, row.payment_proof.id);
      setProofPreview({ loading: false, url: result.url, error: '' });
    } catch (error) {
      setProofPreview({ loading: false, url: '', error: error.message || 'Unable to generate proof view URL.' });
    }
  };

  const handleVerify = () => {
    if (!verifyTarget) return;
    const problems = verificationProblems(verifyTarget, payments);
    const blocking = problems.filter((problem) => !problem.startsWith('Possible duplicate'));
    const duplicates = problems.filter((problem) => problem.startsWith('Possible duplicate'));
    if (blocking.length) {
      alert(`Cannot verify this payment:\n${blocking.join('\n')}`);
      return;
    }
    if (duplicates.length && !window.confirm(`${duplicates.join('\n')}\n\nVerify anyway?`)) return;

    const verified = withVerification({ ...verifyTarget, verification_notes: verifyNotes }, user, true);
    savePayment(verified);
    setPayments(getPayments());
    setVerifyTarget(null);
    setVerifyNotes('');
    alert(verified.ledger_posting_status === 'POSTED'
      ? 'Payment verified and posted to ledger.'
      : 'Payment verified. It will post to the ledger once the transaction status becomes eligible.');
  };

  // Every method-specific field with a value, for the detail view.
  const detailFields = (payment) => {
    const method = payment.payment_method || payment.payment_mode || '';
    return methodFieldsFor(method)
      .map((field) => [fieldLabel(field, payment), payment[field.key]])
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  };

  const pnrBalance = (payment) => {
    if (!payment.pnr) return null;
    const normalized = String(payment.pnr).replace(/[^a-z0-9]/gi, '').toUpperCase();
    const fare = bookings
      .filter((booking) => String(booking.pnr || '').replace(/[^a-z0-9]/gi, '').toUpperCase() === normalized)
      .reduce((sum, booking) => sum + numeric(booking.fare_sold), 0);
    return fare || null;
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <div>
          <h1>Payment Verification</h1>
          <p>Review submitted payments, confirm them against proofs and bank records, and post them to the ledger.</p>
        </div>
      </header>

      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          ['To Be Verified', pending.length, `${filteredRows.length} in view`],
          ['Verified Today', verifiedToday.length, 'since midnight'],
          ['Amount Pending Verification', formatCurrency(pendingAmount), 'zero ledger effect'],
          ['Agent Submitted', agentSubmitted.length, 'awaiting review'],
          ['Proof Attached', withProof.length, 'of pending payments'],
        ].map(([label, value, hint]) => (
          <div className="card" key={label} style={{ padding: '14px' }}>
            <span style={{ fontSize: '12px', color: 'var(--ink-500, #6b7280)' }}>{label}</span>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{value}</div>
            <small style={{ color: 'var(--ink-500, #6b7280)' }}>{hint}</small>
          </div>
        ))}
      </div>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ref, PNR, party, transaction..." />
            </div>
          </label>
          <label>
            <span>Verification Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="PENDING_UPLOAD">Pending Upload</option>
              <option value="TO_BE_VERIFIED">To Be Verified</option>
              <option value="VERIFIED">Verified</option>
              <option value="">All</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table dense-table">
            <thead>
              <tr>
                {QUEUE_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  {QUEUE_COLUMNS.map(([key]) => (
                    <td key={key}>
                      {key === 'amount_paid' ? formatCurrency(row.amount_paid)
                        : key === 'proof' ? (row.attachment || row.payment_proof ? <Paperclip size={14} /> : '')
                          : key === 'verification_status' ? (
                            <span className={`badge ${row.verification_status === 'VERIFIED' ? 'badge-pass' : 'badge-warn'}`}>
                              {VERIFICATION_LABELS[row.verification_status]}
                            </span>
                          )
                            : String(row[key] || '').replace(/_/g, ' ')}
                    </td>
                  ))}
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="icon-button" type="button" title="View payment" onClick={() => openView(row)}>
                        <Eye size={15} />
                      </button>
                      {row.verification_status === 'TO_BE_VERIFIED' && (
                        <button className="icon-button" type="button" title="Verify payment" onClick={() => openVerify(row)}>
                          <BadgeCheck size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td className="empty-table-cell" colSpan={QUEUE_COLUMNS.length + 1}>
                    {statusFilter === 'TO_BE_VERIFIED' ? 'No payments waiting for verification.' : 'No payments found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewTarget && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3>Payment {viewTarget.payment_reference || viewTarget.id}</h3>
            <div className="auto-preview-list compact-preview">
              <div><span>Date</span><strong>{viewTarget.payment_date}</strong></div>
              <div><span>Direction</span><strong>{viewTarget.direction_display}</strong></div>
              <div><span>Party</span><strong>{viewTarget.party_type_display} · {viewTarget.party_display || '-'}</strong></div>
              {viewTarget.pnr && <div><span>PNR</span><strong>{viewTarget.pnr}{pnrBalance(viewTarget) ? ` (fare ${formatCurrency(pnrBalance(viewTarget))})` : ''}</strong></div>}
              <div><span>Amount</span><strong>{formatCurrency(viewTarget.amount_paid)} {viewTarget.transaction_currency || 'EUR'}</strong></div>
              <div><span>Method</span><strong>{viewTarget.payment_method_display}</strong></div>
              {detailFields(viewTarget).map(([label, value]) => (
                <div key={label}><span>{label}</span><strong>{String(value).replace(/_/g, ' ')}</strong></div>
              ))}
              <div><span>Submitted By</span><strong>{viewTarget.recorded_by_display || '-'} ({viewTarget.recorded_by_role || '-'})</strong></div>
              <div><span>Verification</span><strong>{VERIFICATION_LABELS[viewTarget.verification_status]}</strong></div>
              <div><span>Ledger Posting</span><strong>{String(viewTarget.ledger_posting_status).replace(/_/g, ' ')}</strong></div>
              {viewTarget.verified_by && <div><span>Verified By</span><strong>{viewTarget.verified_by} · {String(viewTarget.verified_at || '').slice(0, 16).replace('T', ' ')}</strong></div>}
              {viewTarget.verification_notes && <div><span>Verification Notes</span><strong>{viewTarget.verification_notes}</strong></div>}
              {viewTarget.remarks && <div><span>Notes</span><strong>{viewTarget.remarks}</strong></div>}
            </div>

            {(viewTarget.attachment || viewTarget.payment_proof) && (
              <div style={{ marginTop: '12px' }}>
                <h4 style={{ marginBottom: '6px' }}>Payment Proof · {viewTarget.payment_proof?.file_name || viewTarget.attachment?.name}</h4>
                {proofPreview.loading && (
                  <p style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    <Loader2 size={14} /> Preparing secure proof link...
                  </p>
                )}
                {proofPreview.error && <p style={{ color: '#DC2626', fontSize: '13px' }}>{proofPreview.error}</p>}
                {(proofPreview.url || viewTarget.attachment?.data_url) && (
                  (viewTarget.payment_proof?.content_type || viewTarget.attachment?.type) === 'application/pdf' ? (
                    <embed
                      src={proofPreview.url || viewTarget.attachment.data_url}
                      type="application/pdf"
                      style={{ width: '100%', height: '420px', borderRadius: '8px' }}
                    />
                  ) : (
                    <img
                      src={proofPreview.url || viewTarget.attachment.data_url}
                      alt="Payment proof"
                      style={{ maxWidth: '100%', borderRadius: '8px' }}
                    />
                  )
                )}
                {viewTarget.payment_proof_ocr?.extracted && (
                  <div className="auto-preview-list compact-preview" style={{ marginTop: '10px' }}>
                    <div><span>OCR Engine</span><strong>{viewTarget.payment_proof_ocr.engine || '-'}</strong></div>
                    <div><span>OCR Confidence</span><strong>{formatOcrConfidence(viewTarget.payment_proof_ocr.confidence)}</strong></div>
                    <div>
                      <span>OCR Reference</span>
                      <strong>
                        {viewTarget.payment_proof_ocr.extracted.bank_transaction_reference
                          || viewTarget.payment_proof_ocr.extracted.upi_transaction_id
                          || viewTarget.payment_proof_ocr.extracted.pos_transaction_reference
                          || viewTarget.payment_proof_ocr.extracted.gateway_transaction_id
                          || viewTarget.payment_proof_ocr.extracted.cheque_number
                          || '-'}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => { setViewTarget(null); setProofPreview({ loading: false, url: '', error: '' }); }}>Close</button>
              {viewTarget.verification_status === 'TO_BE_VERIFIED' && (
                <button className="btn btn-primary" onClick={() => { openVerify(viewTarget); setViewTarget(null); }}>
                  <BadgeCheck size={15} /> Verify Payment
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {verifyTarget && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '480px' }}>
            <h3>Verify Payment</h3>
            <div className="auto-preview-list compact-preview">
              <div><span>Payment Ref</span><strong>{verifyTarget.payment_reference || verifyTarget.id}</strong></div>
              <div><span>Amount</span><strong>{formatCurrency(verifyTarget.amount_paid)} {verifyTarget.transaction_currency || 'EUR'}</strong></div>
              <div><span>Method</span><strong>{String(verifyTarget.payment_method || verifyTarget.payment_mode || '').replace(/_/g, ' ')}</strong></div>
              <div><span>Transaction Ref</span><strong>{transactionReference(verifyTarget) || '-'}</strong></div>
              <div><span>Submitted By</span><strong>{verifyTarget.recorded_by || verifyTarget.received_by || '-'} ({verifyTarget.recorded_by_role || '-'})</strong></div>
            </div>
            <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', margin: '10px 0' }}>
              <ShieldAlert size={15} />
              Confirm the amount, transaction reference, and receiving account before verifying. Verifying posts this payment to the ledger.
            </p>
            <label style={{ display: 'block' }}>
              <span>Verification Notes</span>
              <textarea
                rows={3}
                style={{ width: '100%' }}
                value={verifyNotes}
                onChange={(event) => setVerifyNotes(event.target.value)}
                placeholder="e.g. Confirmed in Revolut / matched bank statement"
              />
            </label>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setVerifyTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleVerify}>
                <BadgeCheck size={15} /> Verify Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
