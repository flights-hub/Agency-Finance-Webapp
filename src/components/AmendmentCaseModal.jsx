// Amendment case modal (servicing spec §3–§7). An amendment is a CASE with a
// lifecycle, not an instant edit: DRAFT and QUOTED never touch the ledger;
// CONFIRMED posts the input-driven financial impact (charge or credit) through
// the finance model. All amounts are entered by the employee — nothing is
// hardcoded.

import { useMemo, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { formatCurrency } from '../helpers/format';
import { saveAmendment } from '../helpers/storage';
import {
  AMENDMENT_TYPES,
  AMENDMENT_CASE_STATUSES,
  amendmentTotalImpact,
  bookingCounterparty,
  isAmendmentPosted,
  nextAmendmentNumber,
  numeric,
} from '../helpers/ledger';
import AffectedItemsPicker, { bookingGroupOptions, selectedItems, readAttachment } from './AffectedItemsPicker';

const FINANCIAL_FIELDS = [
  ['fare_difference', 'Fare Difference (±)'],
  ['supplier_change_fee', 'Airline / Supplier Change Fee'],
  ['flyforsure_service_fee', 'FlyforSure Service Fee'],
  ['agent_markup', 'Agent Markup'],
  ['tax_difference', 'Tax Difference'],
  ['other_charges', 'Other Charges'],
];

export default function AmendmentCaseModal({ user, booking, group, amendments, existing = null, onClose, onSaved }) {
  const options = useMemo(() => bookingGroupOptions(group), [group]);
  const posted = existing ? isAmendmentPosted(existing) : false;
  const closed = existing ? ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(existing.status) : false;

  const [form, setForm] = useState(() => existing ? {
    amendment_type: existing.amendment_type || 'DATE_CHANGE',
    new_outbound_date: existing.requested_changes?.new_outbound_date || '',
    new_inbound_date: existing.requested_changes?.new_inbound_date || '',
    new_passenger_name: existing.requested_changes?.new_passenger_name || '',
    remarks: existing.remarks || '',
    fare_difference: existing.fare_difference ?? '',
    supplier_change_fee: existing.supplier_change_fee ?? '',
    flyforsure_service_fee: existing.flyforsure_service_fee ?? '',
    agent_markup: existing.agent_markup ?? '',
    tax_difference: existing.tax_difference ?? '',
    other_charges: existing.other_charges ?? '',
    other_charge_description: existing.other_charge_description || '',
    supplier_quote_reference: existing.supplier_quote_reference || '',
    internal_notes: existing.internal_notes || '',
    evidence_document: existing.evidence_document || null,
  } : {
    amendment_type: 'DATE_CHANGE',
    new_outbound_date: '',
    new_inbound_date: '',
    new_passenger_name: '',
    remarks: '',
    fare_difference: '',
    supplier_change_fee: '',
    flyforsure_service_fee: '',
    agent_markup: '',
    tax_difference: '',
    other_charges: '',
    other_charge_description: '',
    supplier_quote_reference: '',
    internal_notes: '',
    evidence_document: null,
  });
  const [affected, setAffected] = useState(() => ({
    passengers: existing?.affected_passengers?.map((p) => p.id) || [],
    tickets: existing?.affected_tickets?.map((t) => t.id) || [],
    segments: existing?.affected_segments?.map((s) => s.id) || [],
  }));
  const [error, setError] = useState('');

  const update = (key, value) => { setForm((c) => ({ ...c, [key]: value })); setError(''); };

  const total = amendmentTotalImpact(form);
  const party = bookingCounterparty(booking);
  const actor = user?.name || user?.email || '';

  const validate = (needsFinancials) => {
    if (!form.amendment_type) return 'Amendment type is required.';
    if (!affected.passengers.length) return 'Select at least one affected passenger.';
    if (options.tickets.length && !affected.tickets.length) return 'Select at least one affected ticket.';
    if (!form.remarks.trim()) return 'Amendment remarks are required.';
    if (needsFinancials) {
      const fees = ['supplier_change_fee', 'flyforsure_service_fee', 'agent_markup', 'tax_difference', 'other_charges'];
      if (fees.some((key) => numeric(form[key]) < 0)) return 'Fee values cannot be negative (only the fare difference may be).';
    }
    return '';
  };

  const buildRecord = (status) => {
    const now = new Date().toISOString();
    return {
      ...(existing || {}),
      amendment_number: existing?.amendment_number || nextAmendmentNumber(amendments),
      booking_id: existing?.booking_id || booking.id,
      pnr: existing?.pnr || booking.pnr,
      ticket_no: selectedItems(options.tickets, affected.tickets)[0]?.id || existing?.ticket_no || booking.ticket_no || '',
      passenger_name: selectedItems(options.passengers, affected.passengers)[0]?.label || booking.passenger_name || '',
      counterparty_type: party.type,
      counterparty_name: party.name,
      amendment_type: form.amendment_type,
      currency: 'EUR',
      fare_difference: numeric(form.fare_difference),
      supplier_change_fee: numeric(form.supplier_change_fee),
      flyforsure_service_fee: numeric(form.flyforsure_service_fee),
      agent_markup: numeric(form.agent_markup),
      tax_difference: numeric(form.tax_difference),
      other_charges: numeric(form.other_charges),
      other_charge_description: form.other_charge_description,
      total_financial_impact: total,
      supplier_quote_reference: form.supplier_quote_reference,
      evidence_document: form.evidence_document,
      remarks: form.remarks,
      internal_notes: form.internal_notes,
      requested_changes: {
        current_outbound_date: booking.outbound_date || '',
        new_outbound_date: form.new_outbound_date,
        current_inbound_date: booking.inbound_date || '',
        new_inbound_date: form.new_inbound_date,
        current_passenger_name: booking.passenger_name || '',
        new_passenger_name: form.new_passenger_name,
      },
      affected_passengers: selectedItems(options.passengers, affected.passengers),
      affected_tickets: selectedItems(options.tickets, affected.tickets).map(({ id, label }) => ({ id, label })),
      affected_segments: selectedItems(options.segments, affected.segments),
      status,
      created_by: existing?.created_by || actor,
      created_at: existing?.created_at || now,
      updated_at: now,
      ...(status === 'CONFIRMED' && !existing?.confirmed_at ? { confirmed_by: actor, confirmed_at: now } : {}),
      ...(status === 'COMPLETED' && !existing?.completed_at ? { completed_at: now } : {}),
    };
  };

  const saveWithStatus = (status, { needsFinancials = false } = {}) => {
    const problem = validate(needsFinancials || status === 'CONFIRMED');
    if (problem) { setError(problem); return; }
    saveAmendment(buildRecord(status));
    onSaved();
  };

  // Status transition (no field edits) for already-posted or quoted cases.
  const transition = (status) => {
    const now = new Date().toISOString();
    saveAmendment({
      ...existing,
      status,
      updated_at: now,
      ...(status === 'CONFIRMED' && !existing.confirmed_at ? { confirmed_by: actor, confirmed_at: now } : {}),
      ...(status === 'COMPLETED' && !existing.completed_at ? { completed_at: now } : {}),
    });
    onSaved();
  };

  const status = existing?.status || 'DRAFT';
  const financialsLocked = posted || closed;

  return (
    <div className="modal-backdrop allocation-backdrop">
      <div className="card modal-card modal-card-wide servicing-modal">
        <div className="allocation-modal-head">
          <div>
            <h3>
              {existing ? `Amendment ${existing.amendment_number || ''}` : 'Request Amendment'}
              {existing && <span className="badge badge-info" style={{ marginLeft: 8 }}>{status.replace(/_/g, ' ')}</span>}
            </h3>
            <p className="allocation-subtitle">
              {party.type} · {party.name} · PNR {booking.pnr || '-'} · Draft and quoted amendments never change the ledger; posting happens on confirmation.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <h4 className="servicing-section-title">Amendment scope</h4>
        <div className="modal-form-grid">
          <label>
            <span>Amendment Type *</span>
            <select value={form.amendment_type} disabled={financialsLocked} onChange={(e) => update('amendment_type', e.target.value)}>
              {AMENDMENT_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <AffectedItemsPicker
          options={options}
          value={affected}
          onChange={(next) => { setAffected(next); setError(''); }}
          disabled={financialsLocked}
          required={{ passengers: true, tickets: options.tickets.length > 0, segments: false }}
        />

        <h4 className="servicing-section-title">Requested change</h4>
        <div className="modal-form-grid">
          <label>
            <span>Current Outbound Date</span>
            <input value={booking.outbound_date || '-'} readOnly disabled />
          </label>
          <label>
            <span>New Outbound Date</span>
            <input type="date" value={form.new_outbound_date} disabled={financialsLocked} onChange={(e) => update('new_outbound_date', e.target.value)} />
          </label>
          <label>
            <span>Current Inbound Date</span>
            <input value={booking.inbound_date || '-'} readOnly disabled />
          </label>
          <label>
            <span>New Inbound Date</span>
            <input type="date" value={form.new_inbound_date} disabled={financialsLocked} onChange={(e) => update('new_inbound_date', e.target.value)} />
          </label>
          <label>
            <span>Current Passenger Name</span>
            <input value={booking.passenger_name || '-'} readOnly disabled />
          </label>
          <label>
            <span>New Passenger Name</span>
            <input value={form.new_passenger_name} disabled={financialsLocked} onChange={(e) => update('new_passenger_name', e.target.value)} />
          </label>
          <label className="span-2">
            <span>Amendment Remarks *</span>
            <textarea rows={2} value={form.remarks} onChange={(e) => update('remarks', e.target.value)} />
          </label>
        </div>

        <h4 className="servicing-section-title">Amendment quote (input-driven)</h4>
        <div className="modal-form-grid">
          <label>
            <span>Currency</span>
            <input value="EUR" readOnly disabled />
          </label>
          {FINANCIAL_FIELDS.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="number"
                step="0.01"
                min={key === 'fare_difference' ? undefined : '0'}
                value={form[key]}
                disabled={financialsLocked}
                onChange={(e) => update(key, e.target.value)}
                placeholder="0.00"
              />
            </label>
          ))}
          <label>
            <span>Other Charge Description</span>
            <input value={form.other_charge_description} disabled={financialsLocked} onChange={(e) => update('other_charge_description', e.target.value)} />
          </label>
          <label>
            <span>Supplier Quote Reference</span>
            <input value={form.supplier_quote_reference} disabled={financialsLocked} onChange={(e) => update('supplier_quote_reference', e.target.value)} />
          </label>
          <label>
            <span><Upload size={12} style={{ marginRight: 4 }} />Quote Evidence / Screenshot</span>
            {form.evidence_document ? (
              <span className="attachment-name">
                {form.evidence_document.name}
                {!financialsLocked && (
                  <button type="button" className="icon-button" onClick={() => update('evidence_document', null)} aria-label="Remove document"><X size={13} /></button>
                )}
              </span>
            ) : (
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" disabled={financialsLocked} onChange={(e) => readAttachment(e, (doc) => update('evidence_document', doc))} />
            )}
          </label>
          <label className="span-2">
            <span>Internal Notes</span>
            <input value={form.internal_notes} onChange={(e) => update('internal_notes', e.target.value)} />
          </label>
        </div>

        <div className="auto-preview-list compact-preview">
          {FINANCIAL_FIELDS.map(([key, label]) => (
            <div key={key}><span>{label.replace(' (±)', '')}</span><strong>{formatCurrency(numeric(form[key]))}</strong></div>
          ))}
          <div className="preview-total">
            <span>{total >= 0 ? 'TOTAL ADDITIONAL AMOUNT' : 'TOTAL AMENDMENT CREDIT'}</span>
            <strong>{formatCurrency(Math.abs(total))}</strong>
          </div>
        </div>
        {total < 0 && (
          <p className="reconciliation-note">
            Negative total: confirming posts an AMENDMENT_CREDIT open item. It is never converted to a refund payout automatically.
          </p>
        )}

        {error && <div className="allocation-warning">{error}</div>}

        <div className="form-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Close</button>
          {!financialsLocked && (
            <>
              <button className="btn btn-secondary" type="button" onClick={() => saveWithStatus('DRAFT')}>Save Draft</button>
              <button className="btn btn-secondary" type="button" onClick={() => saveWithStatus('QUOTED', { needsFinancials: true })}>Create Quote</button>
              {['QUOTED', 'QUOTE_PENDING'].includes(status) && (
                <button className="btn btn-secondary" type="button" onClick={() => saveWithStatus('CUSTOMER_APPROVED', { needsFinancials: true })}>Customer Approved</button>
              )}
              {existing && (
                <button className="btn btn-danger" type="button" onClick={() => transition('REJECTED')}>Reject</button>
              )}
              <button className="btn btn-primary" type="button" onClick={() => saveWithStatus('CONFIRMED', { needsFinancials: true })}>Confirm Amendment</button>
            </>
          )}
          {posted && status === 'CONFIRMED' && (
            <button className="btn btn-primary" type="button" onClick={() => transition('COMPLETED')}>Mark Completed</button>
          )}
        </div>
        {posted && (
          <p className="reconciliation-note">
            Financial impact is posted to the ledger — amounts, currency, and counterparty are locked. Corrections require a reversing case.
          </p>
        )}
        <p className="reconciliation-note">
          Status flow: {AMENDMENT_CASE_STATUSES.filter((s) => !['QUOTE_PENDING', 'REJECTED', 'CANCELLED'].includes(s)).join(' → ').replace(/_/g, ' ')}. Financial posting happens at CONFIRMED; COMPLETED is the operational milestone.
        </p>
      </div>
    </div>
  );
}
