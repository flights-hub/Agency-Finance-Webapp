// Cancellation case modal (servicing spec §8–§13). Cancellation is NOT a
// refund payout: this records what was cancelled, why, which items are
// affected, and an input-driven financial ESTIMATE. Confirming may spawn a
// refund case for financial review — it never posts a ledger entry and never
// sends money.

import { useMemo, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { formatCurrency } from '../helpers/format';
import { saveCancellation, saveRefund, saveBooking } from '../helpers/storage';
import {
  CANCELLATION_SCOPES,
  CANCELLATION_CATEGORIES,
  bookingCounterparty,
  cancellationEstimate,
  nextCancellationNumber,
  nextRefundNumber,
  numeric,
} from '../helpers/ledger';
import AffectedItemsPicker, { bookingGroupOptions, selectedItems, readAttachment } from './AffectedItemsPicker';
import {
  directionFromSegmentIds,
  segmentIdsForTravelDirection,
} from '../helpers/servicingTravelDirection';
import ServicingTravelDirectionPicker from './ServicingTravelDirectionPicker';

const ESTIMATE_FIELDS = [
  ['estimated_gross_refund', 'Gross Refundable Amount'],
  ['estimated_airline_fee', 'Airline Cancellation Fee'],
  ['estimated_flyforsure_fee', 'FlyforSure Cancellation Fee'],
  ['estimated_agent_markup', 'Agent Cancellation Markup'],
  ['estimated_processing_fee', 'Processing Fee'],
  ['estimated_other_deduction', 'Other Deduction'],
];

const SCOPE_DISABLED = {
  ENTIRE_BOOKING: { passengers: true, tickets: true, segments: true },
  SELECTED_PASSENGERS: { passengers: false, tickets: true, segments: true },
  SELECTED_TICKETS: { passengers: true, tickets: false, segments: true },
  SELECTED_SEGMENTS: { passengers: true, tickets: true, segments: false },
};

const emptyAffected = () => ({ passengers: [], tickets: [], segments: [] });

const allAffected = (options) => ({
  passengers: options.passengers.map((p) => p.id),
  tickets: options.tickets.map((t) => t.id),
  segments: options.segments.map((s) => s.id),
});

const existingAffected = (existing) => ({
  passengers: existing?.affected_passengers?.map((p) => String(p.id)) || [],
  tickets: existing?.affected_tickets?.map((t) => String(t.id)) || [],
  segments: existing?.affected_segments?.map((s) => String(s.id)) || [],
});

const affectedForScope = (scope, options, existing = null) => {
  if (scope === 'ENTIRE_BOOKING') return allAffected(options);

  const stored = existingAffected(existing);
  const next = emptyAffected();
  if (scope === 'SELECTED_PASSENGERS') next.passengers = stored.passengers;
  if (scope === 'SELECTED_TICKETS') next.tickets = stored.tickets;
  if (scope === 'SELECTED_SEGMENTS') next.segments = stored.segments;
  return next;
};

export default function CancellationCaseModal({
  user, booking, group, cancellations, refunds, initialScope = 'ENTIRE_BOOKING', existing = null, onClose, onSaved,
}) {
  const options = useMemo(() => bookingGroupOptions(group), [group]);
  const locked = existing ? ['CONFIRMED', 'COMPLETED', 'REVERSED', 'REJECTED'].includes(existing.status) : false;
  const initialCancellationScope = existing?.cancellation_scope || initialScope;

  const [form, setForm] = useState(() => ({
    cancellation_scope: initialCancellationScope,
    travel_direction: directionFromSegmentIds(options, existingAffected(existing).segments),
    cancellation_category: existing?.cancellation_category || 'VOLUNTARY',
    cancellation_reason: existing?.cancellation_reason || '',
    supplier_reference: existing?.supplier_reference || '',
    cancellation_date: existing?.cancellation_date || new Date().toISOString().slice(0, 10),
    internal_remarks: existing?.internal_remarks || '',
    supporting_document: existing?.supporting_document || null,
    estimated_gross_refund: existing?.estimated_gross_refund ?? '',
    estimated_airline_fee: existing?.estimated_airline_fee ?? '',
    estimated_flyforsure_fee: existing?.estimated_flyforsure_fee ?? '',
    estimated_agent_markup: existing?.estimated_agent_markup ?? '',
    estimated_processing_fee: existing?.estimated_processing_fee ?? '',
    estimated_other_deduction: existing?.estimated_other_deduction ?? '',
    other_deduction_reason: existing?.other_deduction_reason || '',
  }));
  const [affected, setAffected] = useState(() => affectedForScope(initialCancellationScope, options, existing));
  const [createRefundCase, setCreateRefundCase] = useState(true);
  const [error, setError] = useState('');

  const update = (key, value) => { setForm((c) => ({ ...c, [key]: value })); setError(''); };

  const estimate = cancellationEstimate(form);
  const party = bookingCounterparty(booking);
  const actor = user?.name || user?.email || '';
  const pickerDisabled = locked ? true : (SCOPE_DISABLED[form.cancellation_scope] || SCOPE_DISABLED.ENTIRE_BOOKING);
  const pickerRequired = {
    passengers: form.cancellation_scope === 'SELECTED_PASSENGERS',
    tickets: form.cancellation_scope === 'SELECTED_TICKETS',
  };
  const selectedSegmentIds = form.cancellation_scope === 'SELECTED_SEGMENTS'
    ? segmentIdsForTravelDirection(options, form.travel_direction)
    : affected.segments;

  const setScope = (scope) => {
    update('cancellation_scope', scope);
    setAffected(affectedForScope(scope, options, existing));
  };

  const updateTravelDirection = (direction) => {
    update('travel_direction', direction);
    setAffected((current) => ({
      ...current,
      segments: segmentIdsForTravelDirection(options, direction),
    }));
  };

  const validate = () => {
    if (!form.cancellation_scope) return 'Cancellation scope is required.';
    if (!form.cancellation_category) return 'Cancellation category is required.';
    if (!form.cancellation_reason.trim()) return 'Cancellation reason is required.';
    if (form.cancellation_scope === 'SELECTED_PASSENGERS' && !affected.passengers.length) {
      return 'Select at least one passenger.';
    }
    if (form.cancellation_scope === 'SELECTED_TICKETS' && !affected.tickets.length) {
      return 'Select at least one ticket.';
    }
    if (form.cancellation_scope === 'SELECTED_SEGMENTS' && !selectedSegmentIds.length) {
      return 'Select a travel direction.';
    }
    if (ESTIMATE_FIELDS.some(([key]) => numeric(form[key]) < 0)) return 'Estimate values cannot be negative.';
    return '';
  };

  const buildRecord = (status) => {
    const now = new Date().toISOString();
    return {
      ...(existing || {}),
      cancellation_number: existing?.cancellation_number || nextCancellationNumber(cancellations),
      booking_id: existing?.booking_id || booking.id,
      pnr: existing?.pnr || booking.pnr,
      ticket_no: selectedItems(options.tickets, affected.tickets)[0]?.id || booking.ticket_no || '',
      passenger_name: selectedItems(options.passengers, affected.passengers)[0]?.label || booking.passenger_name || '',
      counterparty_type: party.type,
      counterparty_name: party.name,
      cancellation_scope: form.cancellation_scope,
      cancellation_category: form.cancellation_category,
      cancellation_reason: form.cancellation_reason,
      supplier_reference: form.supplier_reference,
      supporting_document: form.supporting_document,
      cancellation_date: form.cancellation_date,
      internal_remarks: form.internal_remarks,
      currency: 'EUR',
      estimated_gross_refund: numeric(form.estimated_gross_refund),
      estimated_airline_fee: numeric(form.estimated_airline_fee),
      estimated_flyforsure_fee: numeric(form.estimated_flyforsure_fee),
      estimated_agent_markup: numeric(form.estimated_agent_markup),
      estimated_processing_fee: numeric(form.estimated_processing_fee),
      estimated_other_deduction: numeric(form.estimated_other_deduction),
      other_deduction_reason: form.other_deduction_reason,
      estimated_refund_credit: estimate.expectedRefundCredit,
      affected_passengers: selectedItems(options.passengers, affected.passengers),
      affected_tickets: selectedItems(options.tickets, affected.tickets).map(({ id, label }) => ({ id, label })),
      travel_direction: form.travel_direction,
      affected_segments: selectedItems(options.segments, selectedSegmentIds),
      status,
      created_by: existing?.created_by || actor,
      created_at: existing?.created_at || now,
      updated_at: now,
      ...(status !== 'DRAFT' && !existing?.confirmed_at ? { confirmed_by: actor, confirmed_at: now } : {}),
    };
  };

  const handleSaveDraft = () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    saveCancellation(buildRecord('DRAFT'));
    onSaved();
  };

  const handleConfirm = () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    const wantsRefund = createRefundCase && estimate.expectedRefundCredit >= 0 && numeric(form.estimated_gross_refund) > 0;
    // No refund review required -> cancellation is operationally complete.
    const record = buildRecord(wantsRefund ? 'CONFIRMED' : 'COMPLETED');
    const saved = saveCancellation(record);

    // Cancelled passenger/ticket rows get their booking status updated.
    // Segment-scoped cancellations leave passenger statuses untouched.
    const cancelledPassengerIds = new Set(affected.passengers);
    const cancelledTickets = new Set(affected.tickets);
    const today = new Date().toISOString().slice(0, 10);
    group.forEach((row) => {
      const hit = form.cancellation_scope === 'ENTIRE_BOOKING'
        || (form.cancellation_scope === 'SELECTED_PASSENGERS' && cancelledPassengerIds.has(String(row.id)))
        || (form.cancellation_scope === 'SELECTED_TICKETS' && cancelledTickets.has(String(row.ticket_no)));
      if (!hit) return;
      saveBooking({ ...row, ticket_status: 'CANCELLED', cancel_date: today, cancel_scope: form.cancellation_scope, updated_at: new Date().toISOString() });
    });

    // Spec §11: copy the financial estimate into a refund case (REQUESTED).
    // No refund credit ledger entry yet — that happens on refund approval.
    if (wantsRefund) {
      const affectedTickets = selectedItems(options.tickets, affected.tickets);
      saveRefund({
        refund_number: nextRefundNumber(refunds),
        cancellation_id: saved.id,
        cancellation_number: record.cancellation_number,
        booking_id: booking.id,
        pnr: booking.pnr,
        ticket_no: affectedTickets[0]?.id || booking.ticket_no || '',
        passenger_name: record.passenger_name,
        airline: booking.airline,
        sector: booking.sector,
        refund_party_type: party.type,
        refund_status: 'REQUESTED',
        refund_category: form.cancellation_category,
        cancel_date: form.cancellation_date,
        status_date: today,
        currency: 'EUR',
        original_sale_amount: affectedTickets.reduce((sum, t) => sum + numeric(t.booking?.fare_sold), 0) || numeric(booking.fare_sold),
        gross_refund_amount: numeric(form.estimated_gross_refund),
        airline_cancellation_fee: numeric(form.estimated_airline_fee),
        flyforsure_cancellation_fee: numeric(form.estimated_flyforsure_fee),
        agent_cancellation_markup: numeric(form.estimated_agent_markup),
        processing_fee: numeric(form.estimated_processing_fee),
        other_deductions: numeric(form.estimated_other_deduction),
        other_deduction_reason: form.other_deduction_reason,
        affected_passengers: record.affected_passengers,
        affected_tickets: record.affected_tickets,
        affected_segments: record.affected_segments,
        refund_lines: affectedTickets.map(({ id, label, booking: row }) => ({
          ticket_no: id,
          passenger_name: label,
          original_sell_amount: numeric(row?.fare_sold),
          currency: 'EUR',
        })),
        // Legacy-compatible mirrors (P&L, old refund ledger).
        fare_sold: numeric(booking.fare_sold),
        fare_issued: numeric(booking.fare_issued),
        airline_penalty: numeric(form.estimated_airline_fee),
        service_fee: numeric(form.estimated_flyforsure_fee),
        created_by: actor,
        remarks: `From cancellation ${record.cancellation_number}: ${form.cancellation_reason}`,
      });
    }
    onSaved({ refundCreated: wantsRefund });
  };

  return (
    <div className="modal-backdrop allocation-backdrop">
      <div className="card modal-card modal-card-wide servicing-modal">
        <div className="allocation-modal-head">
          <div>
            <h3>
              {existing ? `Cancellation ${existing.cancellation_number || ''}` : 'Cancel Booking'}
              {existing && <span className="badge badge-warn" style={{ marginLeft: 8 }}>{existing.status.replace(/_/g, ' ')}</span>}
            </h3>
            <p className="allocation-subtitle">
              {party.type} · {party.name} · PNR {booking.pnr || '-'} · Cancellation is not a refund payout — confirming records the case and may open a refund review.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <h4 className="servicing-section-title">Cancellation scope</h4>
        <div className="modal-form-grid">
          <label>
            <span>Cancellation Scope *</span>
            <select value={form.cancellation_scope} disabled={locked} onChange={(e) => setScope(e.target.value)}>
              {CANCELLATION_SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <AffectedItemsPicker
          options={options}
          value={affected}
          onChange={(next) => { setAffected(next); setError(''); }}
          disabled={pickerDisabled}
          required={pickerRequired}
          show={{ segments: false }}
        />

        {form.cancellation_scope === 'SELECTED_SEGMENTS' && (
          <ServicingTravelDirectionPicker
            value={form.travel_direction}
            onChange={updateTravelDirection}
            options={options}
            disabled={locked}
            required
          />
        )}

        <h4 className="servicing-section-title">Cancellation details</h4>
        <div className="modal-form-grid">
          <label>
            <span>Cancellation Category *</span>
            <select value={form.cancellation_category} disabled={locked} onChange={(e) => update('cancellation_category', e.target.value)}>
              {CANCELLATION_CATEGORIES.map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label>
            <span>Cancellation Date</span>
            <input type="date" value={form.cancellation_date} disabled={locked} onChange={(e) => update('cancellation_date', e.target.value)} />
          </label>
          <label>
            <span>Supplier / Airline Reference</span>
            <input value={form.supplier_reference} disabled={locked} onChange={(e) => update('supplier_reference', e.target.value)} />
          </label>
          <label>
            <span><Upload size={12} style={{ marginRight: 4 }} />Supporting Document</span>
            {form.supporting_document ? (
              <span className="attachment-name">
                {form.supporting_document.name}
                {!locked && (
                  <button type="button" className="icon-button" onClick={() => update('supporting_document', null)} aria-label="Remove document"><X size={13} /></button>
                )}
              </span>
            ) : (
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" disabled={locked} onChange={(e) => readAttachment(e, (doc) => update('supporting_document', doc))} />
            )}
          </label>
          <label className="span-2">
            <span>Cancellation Reason *</span>
            <textarea rows={2} value={form.cancellation_reason} disabled={locked} onChange={(e) => update('cancellation_reason', e.target.value)} />
          </label>
          <label className="span-2">
            <span>Internal Remarks</span>
            <input value={form.internal_remarks} disabled={locked} onChange={(e) => update('internal_remarks', e.target.value)} />
          </label>
        </div>

        <h4 className="servicing-section-title">Cancellation financial estimate (input-driven)</h4>
        <div className="modal-form-grid">
          {ESTIMATE_FIELDS.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input type="number" step="0.01" min="0" value={form[key]} disabled={locked} onChange={(e) => update(key, e.target.value)} placeholder="0.00" />
            </label>
          ))}
          <label className="span-2">
            <span>Other Deduction Reason</span>
            <input value={form.other_deduction_reason} disabled={locked} onChange={(e) => update('other_deduction_reason', e.target.value)} />
          </label>
        </div>

        <div className="auto-preview-list compact-preview">
          <div><span>Gross Refundable</span><strong>{formatCurrency(numeric(form.estimated_gross_refund))}</strong></div>
          <div><span>Airline Fee</span><strong>− {formatCurrency(numeric(form.estimated_airline_fee))}</strong></div>
          <div><span>FlyforSure Fee</span><strong>− {formatCurrency(numeric(form.estimated_flyforsure_fee))}</strong></div>
          <div><span>Agent Markup</span><strong>− {formatCurrency(numeric(form.estimated_agent_markup))}</strong></div>
          <div><span>Processing Fee</span><strong>− {formatCurrency(numeric(form.estimated_processing_fee))}</strong></div>
          <div><span>Other Deduction</span><strong>− {formatCurrency(numeric(form.estimated_other_deduction))}</strong></div>
          <div><span>Total Deductions</span><strong>{formatCurrency(estimate.deductions)}</strong></div>
          {/* "Expected" on purpose: this is not necessarily money payable to
              the counterparty — settlement is decided on the refund case. */}
          <div className="preview-total"><span>EXPECTED REFUND CREDIT</span><strong>{formatCurrency(estimate.expectedRefundCredit)}</strong></div>
        </div>

        {!locked && (
          <label className="check-chip standalone-check">
            <input type="checkbox" checked={createRefundCase} onChange={(e) => setCreateRefundCase(e.target.checked)} />
            <span>Create a refund case for financial review on confirmation (copies this estimate, status REQUESTED — no ledger change)</span>
          </label>
        )}

        {error && <div className="allocation-warning">{error}</div>}

        <div className="form-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          {!locked && (
            <>
              <button className="btn btn-secondary" type="button" onClick={handleSaveDraft}>Save Cancellation Draft</button>
              <button className="btn btn-primary" type="button" onClick={handleConfirm}>Confirm Cancellation</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
