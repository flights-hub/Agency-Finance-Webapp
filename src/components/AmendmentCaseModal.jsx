// Amendment case modal (servicing spec §3–§7). An amendment is a CASE with a
// lifecycle, not an instant edit: DRAFT and QUOTED never touch the ledger;
// Legacy and non-date cases post at CONFIRMED. Modern date changes apply the
// new itinerary and post their input-driven financial impact only when their
// dedicated finalization completes. All amounts are employee-entered.

import { useMemo, useRef, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { formatCurrency } from '../helpers/format';
import { stableBookingRef } from '../helpers/bookingIdentity';
import {
  createPassengerReissues,
  itinerarySnapshotsEqual,
  isDateChangeType,
  normalizeDateChange,
  selectCompatibleItinerary,
  snapshotItinerary,
  validateDateChangeFinalization,
} from '../helpers/dateChangeAmendments';
import { finalizeAmendment, saveAmendment } from '../helpers/storage';
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
import DateChangeItineraryEditor from './DateChangeItineraryEditor';

const FINANCIAL_FIELDS = [
  ['fare_difference', 'Fare Difference (±)'],
  ['supplier_change_fee', 'Airline / Supplier Change Fee'],
  ['flyforsure_service_fee', 'FlyforSure Service Fee'],
  ['agent_markup', 'Agent Markup'],
  ['tax_difference', 'Tax Difference'],
  ['other_charges', 'Other Charges'],
];

const TYPE_DISABLED = {
  DATE_CHANGE: { passengers: true, tickets: true, segments: false },
  OUTBOUND_DATE_CHANGE: { passengers: true, tickets: true, segments: false },
  INBOUND_DATE_CHANGE: { passengers: true, tickets: true, segments: false },
  BOTH_DATE_CHANGE: { passengers: true, tickets: true, segments: false },
  ROUTE_CHANGE: { passengers: true, tickets: true, segments: false },
  NAME_CORRECTION: { passengers: false, tickets: true, segments: true },
  NAME_CHANGE: { passengers: false, tickets: true, segments: true },
  CABIN_CHANGE: { passengers: true, tickets: false, segments: true },
  BAGGAGE_CHANGE: { passengers: true, tickets: false, segments: true },
  OTHER: { passengers: true, tickets: false, segments: true },
};

const DATE_CHANGE_DIRECTIONS = {
  OUTBOUND: ['outbound'],
  INBOUND: ['inbound'],
  BOTH: ['outbound', 'inbound'],
};

const SELECTABLE_AMENDMENT_TYPES = AMENDMENT_TYPES.filter((type) => (
  !['OUTBOUND_DATE_CHANGE', 'INBOUND_DATE_CHANGE', 'BOTH_DATE_CHANGE'].includes(type)
));

const emptyAffected = () => ({ passengers: [], tickets: [], segments: [] });

const existingAffected = (existing) => ({
  passengers: existing?.affected_passengers?.map((p) => String(p.id)) || [],
  tickets: existing?.affected_tickets?.map((t) => String(t.id)) || [],
  segments: existing?.affected_segments?.map((s) => String(s.id)) || [],
});

const activeAffectedKey = (type) => {
  const disabled = TYPE_DISABLED[type] || TYPE_DISABLED.OTHER;
  if (!disabled.passengers) return 'passengers';
  if (!disabled.tickets) return 'tickets';
  return 'segments';
};

const affectedForType = (type, existing = null) => {
  const stored = existingAffected(existing);
  const next = emptyAffected();
  const key = activeAffectedKey(type);
  next[key] = stored[key];
  return next;
};

const clone = (value) => structuredClone(value);
const rowId = (row) => String(row.id);

const normalizedItinerary = (value, fallback) => {
  const itinerary = clone(value || fallback);
  return {
    ...itinerary,
    outbound: Array.isArray(itinerary?.outbound) ? itinerary.outbound : [],
    inbound: Array.isArray(itinerary?.inbound) ? itinerary.inbound : [],
  };
};

const storedSelectedPassengerIds = (existing) => {
  if (existing?.selected_passenger_ids?.length) return existing.selected_passenger_ids.map(String);
  if (existing?.passenger_reissues?.length) return existing.passenger_reissues.map((mapping) => String(mapping.booking_id));
  return existing?.affected_passengers?.map((passenger) => String(passenger.id)) || [];
};

const initialDateChangeState = (existing, booking, group) => {
  const groupIds = group.map(rowId);
  const groupCompatibility = selectCompatibleItinerary(group, groupIds);
  const applicationScope = existing
    ? existing.application_scope === 'SELECTED_PASSENGERS' ? 'SELECTED_PASSENGERS' : 'PNR_WIDE'
    : groupCompatibility.compatible ? 'PNR_WIDE' : 'SELECTED_PASSENGERS';
  const selectedIds = applicationScope === 'PNR_WIDE'
    ? groupIds
    : existing
      ? storedSelectedPassengerIds(existing)
      : [booking?.id ?? group[0]?.id].filter(Boolean).map(String);
  const selectedSnapshot = selectCompatibleItinerary(group, selectedIds).snapshot;
  const snapshot = selectedIds.length ? selectedSnapshot : snapshotItinerary(group[0] || booking);
  const original = normalizedItinerary(existing?.original_itinerary, snapshot);
  const replacement = normalizedItinerary(existing?.replacement_itinerary, original);
  const normalized = normalizeDateChange(existing?.amendment_type || 'DATE_CHANGE', existing?.travel_direction);
  const hasInbound = original.inbound.length > 0;
  const direction = DATE_CHANGE_DIRECTIONS[normalized.direction]
    && (normalized.direction === 'OUTBOUND' || hasInbound)
    ? normalized.direction
    : 'OUTBOUND';

  return {
    amendment_type: normalized.amendmentType,
    application_scope: applicationScope,
    travel_direction: direction,
    original_itinerary: original,
    replacement_itinerary: replacement,
    selected_passenger_ids: selectedIds,
    passenger_reissues: createPassengerReissues(group, selectedIds, existing?.passenger_reissues || []),
  };
};

const mergeReissueMemory = (stored, current) => {
  const byBookingId = new Map(stored.map((mapping) => [String(mapping.booking_id), mapping]));
  current.forEach((mapping) => byBookingId.set(String(mapping.booking_id), mapping));
  return [...byBookingId.values()];
};

const affectedSegmentIds = (itinerary, direction) => {
  const ids = [];
  (DATE_CHANGE_DIRECTIONS[direction] || []).forEach((directionKey) => {
    (itinerary?.[directionKey] || []).forEach((segment) => {
      (segment.connections || []).forEach((connection) => {
        const label = [
          `${connection.airline || ''}${connection.flight_number || ''}`,
          `${connection.origin || connection.departure_city || '?'}-${connection.destination || connection.arrival_city || '?'}`,
        ].filter(Boolean).join(' ');
        ids.push(`${label}|${connection.departure_date || ''}`);
      });
    });
  });
  return ids;
};

const serverErrorMessage = (error) => {
  const details = Array.isArray(error?.details)
    ? error.details
    : error?.details && typeof error.details === 'object'
      ? Object.values(error.details).flat()
      : error?.details ? [error.details] : [];
  return [error?.message || 'Unable to save amendment.', ...details]
    .map((message) => String(message).trim())
    .filter(Boolean)
    .join('\n');
};

export default function AmendmentCaseModal({ user, booking, group, amendments, existing = null, onClose, onSaved }) {
  const options = useMemo(() => bookingGroupOptions(group), [group]);
  const initialDateChange = useMemo(
    () => initialDateChangeState(existing, booking, group),
    [booking, existing, group],
  );
  const posted = existing ? isAmendmentPosted(existing) : false;
  const closed = existing ? ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(existing.status) : false;
  const legacyDateChange = Boolean(
    existing
    && isDateChangeType(existing.amendment_type)
    && !existing.original_itinerary
    && !existing.replacement_itinerary,
  );
  const initialAmendmentType = isDateChangeType(existing?.amendment_type || 'DATE_CHANGE')
    ? 'DATE_CHANGE'
    : existing.amendment_type;

  const [form, setForm] = useState(() => existing ? {
    ...initialDateChange,
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
    ...initialDateChange,
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
  const [affected, setAffected] = useState(() => affectedForType(initialAmendmentType, existing));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recordId] = useState(() => existing?.id || crypto.randomUUID());
  const reissueMemory = useRef(mergeReissueMemory(
    existing?.passenger_reissues || [],
    initialDateChange.passenger_reissues,
  ));
  const selectedPassengerMemory = useRef(
    initialDateChange.selected_passenger_ids,
  );
  const savingRef = useRef(false);

  const update = (key, value) => { setForm((c) => ({ ...c, [key]: value })); setError(''); };

  const total = amendmentTotalImpact(form);
  const party = bookingCounterparty(booking);
  const actor = user?.name || user?.email || '';
  const dateChange = isDateChangeType(form.amendment_type);
  const finalizing = existing?.status === 'FINALIZING';
  const financialsLocked = posted || closed || legacyDateChange;
  const editingLocked = financialsLocked || finalizing;
  const pickerDisabled = editingLocked ? true : (TYPE_DISABLED[form.amendment_type] || TYPE_DISABLED.OTHER);
  const activeKey = activeAffectedKey(form.amendment_type);
  const pickerRequired = {
    passengers: activeKey === 'passengers',
    tickets: activeKey === 'tickets',
    segments: activeKey === 'segments',
  };

  const setAmendmentType = (type) => {
    update('amendment_type', type);
    setAffected(affectedForType(type, existing));
  };

  const setDateChangeSelection = (ids) => {
    const selectedIds = ids.map(String);
    const selection = selectCompatibleItinerary(group, selectedIds);
    if (existing && (
      !selectedIds.length
      || !selection.compatible
      || !itinerarySnapshotsEqual(selection.snapshot, form.original_itinerary)
    )) {
      setError('This passenger selection does not match the amendment original itinerary. Create a new amendment case for a different passenger cohort.');
      return;
    }
    selectedPassengerMemory.current = selectedIds;
    const passengerReissues = createPassengerReissues(group, selectedIds, reissueMemory.current);
    reissueMemory.current = mergeReissueMemory(reissueMemory.current, passengerReissues);
    setForm((current) => ({
      ...current,
      selected_passenger_ids: selectedIds,
      passenger_reissues: passengerReissues,
      ...(!existing && selectedIds.length ? {
        original_itinerary: selection.snapshot,
        replacement_itinerary: clone(selection.snapshot),
        travel_direction: current.travel_direction !== 'OUTBOUND' && !selection.snapshot.inbound.length
          ? 'OUTBOUND'
          : current.travel_direction,
      } : {}),
    }));
    setError(selection.compatible
      ? ''
      : 'Selected passengers have different current itineraries. Handle one compatible passenger itinerary cohort at a time.');
  };

  const setApplicationScope = (applicationScope) => {
    const selectedIds = applicationScope === 'PNR_WIDE'
      ? group.map(rowId)
      : selectedPassengerMemory.current;
    const passengerReissues = createPassengerReissues(group, selectedIds, reissueMemory.current);
    const selection = selectCompatibleItinerary(group, selectedIds);
    if (existing && (
      !selectedIds.length
      || !selection.compatible
      || !itinerarySnapshotsEqual(selection.snapshot, form.original_itinerary)
    )) {
      setError('This scope does not match the amendment original itinerary. Create a new amendment case for a different passenger cohort.');
      return;
    }
    reissueMemory.current = mergeReissueMemory(reissueMemory.current, passengerReissues);
    setForm((current) => ({
      ...current,
      application_scope: applicationScope,
      selected_passenger_ids: selectedIds,
      passenger_reissues: passengerReissues,
      ...(!existing && selectedIds.length ? {
        original_itinerary: selection.snapshot,
        replacement_itinerary: clone(selection.snapshot),
        travel_direction: current.travel_direction !== 'OUTBOUND' && !selection.snapshot.inbound.length
          ? 'OUTBOUND'
          : current.travel_direction,
      } : {}),
    }));
    setError(selection.compatible
      ? ''
      : 'PNR-wide finalization is unavailable because passenger itineraries differ. Use passenger-wise compatible cohorts.');
  };

  const updatePassengerReissue = (bookingId, key, value) => {
    const passengerReissues = form.passenger_reissues.map((mapping) => (
      String(mapping.booking_id) === String(bookingId) ? { ...mapping, [key]: value } : mapping
    ));
    reissueMemory.current = mergeReissueMemory(reissueMemory.current, passengerReissues);
    update('passenger_reissues', passengerReissues);
  };

  const validate = (needsFinancials) => {
    if (!form.amendment_type) return 'Amendment type is required.';
    if (dateChange && !form.selected_passenger_ids.length) return 'Select at least one affected passenger.';
    if (!dateChange && activeKey === 'passengers' && !affected.passengers.length) return 'Select at least one affected passenger.';
    if (!dateChange && activeKey === 'tickets' && !affected.tickets.length) return 'Select at least one affected ticket.';
    if (!dateChange && activeKey === 'segments' && !affected.segments.length) return 'Select at least one affected segment.';
    if (!form.remarks.trim()) return 'Amendment remarks are required.';
    if (needsFinancials) {
      const fees = ['supplier_change_fee', 'flyforsure_service_fee', 'agent_markup', 'tax_difference', 'other_charges'];
      if (fees.some((key) => numeric(form[key]) < 0)) return 'Fee values cannot be negative (only the fare difference may be).';
    }
    return '';
  };

  const buildRecord = (status) => {
    const now = new Date().toISOString();
    const selectedDateRows = dateChange
      ? group.filter((row) => form.selected_passenger_ids.includes(rowId(row)))
      : [];
    const dateAffectedPassengers = dateChange
      ? selectedItems(options.passengers, form.selected_passenger_ids)
      : [];
    const dateAffectedTickets = selectedDateRows
      .filter((row) => row.ticket_no)
      .map((row) => ({
        id: String(row.ticket_no),
        label: `${row.ticket_no} · ${row.passenger_name || ''}`.trim(),
      }));
    const dateAffectedSegments = dateChange
      ? selectedItems(
        options.segments,
        affectedSegmentIds(form.original_itinerary, form.travel_direction),
      )
      : [];
    return {
      ...(existing || {}),
      id: recordId,
      amendment_number: existing?.amendment_number || nextAmendmentNumber(amendments),
      booking_id: existing?.booking_id || booking.id,
      booking_ref: existing?.booking_ref || stableBookingRef(group[0] || booking),
      pnr: existing?.pnr || booking.pnr,
      ticket_no: dateAffectedTickets[0]?.id
        || selectedItems(options.tickets, affected.tickets)[0]?.id
        || existing?.ticket_no
        || booking.ticket_no
        || '',
      passenger_name: dateAffectedPassengers[0]?.label
        || selectedItems(options.passengers, affected.passengers)[0]?.label
        || booking.passenger_name
        || '',
      counterparty_type: party.type,
      counterparty_name: party.name,
      amendment_type: dateChange ? 'DATE_CHANGE' : form.amendment_type,
      ...(dateChange ? {
        application_scope: form.application_scope,
        travel_direction: form.travel_direction,
        original_itinerary: clone(form.original_itinerary),
        replacement_itinerary: clone(form.replacement_itinerary),
        selected_passenger_ids: [...form.selected_passenger_ids],
        passenger_reissues: clone(form.passenger_reissues),
      } : {}),
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
      affected_passengers: dateChange
        ? dateAffectedPassengers
        : selectedItems(options.passengers, affected.passengers),
      affected_tickets: dateChange
        ? dateAffectedTickets
        : selectedItems(options.tickets, affected.tickets).map(({ id, label }) => ({ id, label })),
      affected_segments: dateChange
        ? dateAffectedSegments
        : selectedItems(options.segments, affected.segments),
      status,
      created_by: existing?.created_by || actor,
      created_at: existing?.created_at || now,
      updated_at: now,
      ...(status === 'CONFIRMED' && !dateChange && !existing?.confirmed_at
        ? { confirmed_by: actor, confirmed_at: now }
        : {}),
      ...(status === 'COMPLETED' && !existing?.completed_at ? { completed_at: now } : {}),
    };
  };

  const saveWithStatus = async (status, { needsFinancials = false } = {}) => {
    if (savingRef.current) return;
    const problem = validate(needsFinancials || status === 'CONFIRMED');
    if (problem) { setError(problem); return; }
    const candidate = buildRecord(status);

    if (dateChange && status === 'CONFIRMED') {
      const validationErrors = validateDateChangeFinalization(candidate, group, {
        allowPartialRecovery: existing?.status === 'FINALIZING',
        amendmentId: candidate.id,
        finalizationFingerprint: existing?.finalization_fingerprint || '',
      });
      if (validationErrors.length) {
        setError(validationErrors.join('\n'));
        return;
      }

      savingRef.current = true;
      setSaving(true);
      setError('');
      try {
        await finalizeAmendment(candidate);
        savingRef.current = false;
        setSaving(false);
        onSaved();
      } catch (finalizationError) {
        setError(serverErrorMessage(finalizationError));
        savingRef.current = false;
        setSaving(false);
      }
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await saveAmendment(candidate);
      onSaved();
    } catch (saveError) {
      setError(serverErrorMessage(saveError));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Status transition (no field edits) for already-posted or quoted cases.
  const transition = async (status) => {
    if (savingRef.current) return;
    const now = new Date().toISOString();
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await saveAmendment({
        ...existing,
        status,
        updated_at: now,
        ...(status === 'CONFIRMED' && !existing.confirmed_at ? { confirmed_by: actor, confirmed_at: now } : {}),
        ...(status === 'COMPLETED' && !existing.completed_at ? { completed_at: now } : {}),
      });
      onSaved();
    } catch (saveError) {
      setError(serverErrorMessage(saveError));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const status = existing?.status || 'DRAFT';

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
              {party.type} · {party.name} · PNR {booking.pnr || '-'} · Modern date changes post only after itinerary finalization; other amendments post on confirmation.
            </p>
          </div>
          <button className="icon-button" type="button" disabled={saving} onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <h4 className="servicing-section-title">Amendment scope</h4>
        <div className="modal-form-grid">
          <label>
            <span>Amendment Type *</span>
            <select value={form.amendment_type} disabled={editingLocked || saving} onChange={(e) => setAmendmentType(e.target.value)}>
              {SELECTABLE_AMENDMENT_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          {dateChange && !legacyDateChange && (
            <>
              <label>
                <span>Application Scope *</span>
                <select
                  value={form.application_scope}
                  disabled={editingLocked || saving}
                  onChange={(event) => setApplicationScope(event.target.value)}
                >
                  <option value="PNR_WIDE">PNR-wide</option>
                  <option value="SELECTED_PASSENGERS">Selected passengers</option>
                </select>
              </label>
              <label>
                <span>Travel Direction *</span>
                <select
                  value={form.travel_direction}
                  disabled={editingLocked || saving}
                  onChange={(event) => update('travel_direction', event.target.value)}
                >
                  <option value="OUTBOUND">Outbound</option>
                  {form.original_itinerary.inbound.length > 0 && <option value="INBOUND">Inbound</option>}
                  {form.original_itinerary.inbound.length > 0 && <option value="BOTH">Both</option>}
                </select>
              </label>
            </>
          )}
        </div>
        {legacyDateChange ? (
          <div className="allocation-warning">
            Legacy date-change record (read-only). No itinerary snapshots were stored, so the dates below are the original recorded request. To use modern finalization, create a new date-change case and enter the replacement itinerary and passenger reissue details.
          </div>
        ) : dateChange ? (
          <AffectedItemsPicker
            options={options}
            value={{ passengers: form.selected_passenger_ids, tickets: [], segments: [] }}
            onChange={(next) => setDateChangeSelection(next.passengers)}
            disabled={editingLocked || saving || form.application_scope === 'PNR_WIDE'}
            show={{ tickets: false, segments: false }}
            required={{ passengers: form.application_scope === 'SELECTED_PASSENGERS' }}
          />
        ) : (
          <AffectedItemsPicker
            options={options}
            value={affected}
            onChange={(next) => { setAffected(next); setError(''); }}
            disabled={pickerDisabled}
            required={pickerRequired}
          />
        )}

        <h4 className="servicing-section-title">Requested change</h4>
        {legacyDateChange ? (
          <div className="modal-form-grid">
            <label>
              <span>Current Outbound Date</span>
              <input value={existing?.requested_changes?.current_outbound_date || '-'} readOnly disabled />
            </label>
            <label>
              <span>New Outbound Date</span>
              <input value={existing?.requested_changes?.new_outbound_date || '-'} readOnly disabled />
            </label>
            <label>
              <span>Current Inbound Date</span>
              <input value={existing?.requested_changes?.current_inbound_date || '-'} readOnly disabled />
            </label>
            <label>
              <span>New Inbound Date</span>
              <input value={existing?.requested_changes?.new_inbound_date || '-'} readOnly disabled />
            </label>
          </div>
        ) : dateChange ? (
          <>
            <DateChangeItineraryEditor
              original={form.original_itinerary}
              replacement={form.replacement_itinerary}
              direction={form.travel_direction}
              disabled={editingLocked || saving}
              onChange={(replacement) => update('replacement_itinerary', replacement)}
            />

            <h4 className="servicing-section-title">Passenger reissues</h4>
            {form.passenger_reissues.length ? form.passenger_reissues.map((mapping) => (
              <div key={mapping.booking_id}>
                <h5>{mapping.passenger_name || 'Passenger'}</h5>
                <div className="modal-form-grid">
                  <label>
                    <span>Original PNR</span>
                    <input value={mapping.old_pnr || '-'} readOnly disabled />
                  </label>
                  <label>
                    <span>New PNR</span>
                    <input
                      value={mapping.new_pnr || ''}
                      disabled={editingLocked || saving}
                      onChange={(event) => updatePassengerReissue(mapping.booking_id, 'new_pnr', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Original Ticket</span>
                    <input value={mapping.old_ticket_no || '-'} readOnly disabled />
                  </label>
                  <label>
                    <span>New Ticket</span>
                    <input
                      value={mapping.new_ticket_no || ''}
                      disabled={editingLocked || saving}
                      onChange={(event) => updatePassengerReissue(mapping.booking_id, 'new_ticket_no', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Reissue Reference</span>
                    <input
                      value={mapping.reissue_reference || ''}
                      disabled={editingLocked || saving}
                      onChange={(event) => updatePassengerReissue(mapping.booking_id, 'reissue_reference', event.target.value)}
                    />
                  </label>
                </div>
              </div>
            )) : <p className="affected-picker-empty">Select at least one passenger to map the reissue.</p>}
          </>
        ) : (
          <div className="modal-form-grid">
            <label>
              <span>Current Outbound Date</span>
              <input value={booking.outbound_date || '-'} readOnly disabled />
            </label>
            <label>
              <span>New Outbound Date</span>
              <input type="date" value={form.new_outbound_date} disabled={editingLocked} onChange={(e) => update('new_outbound_date', e.target.value)} />
            </label>
            <label>
              <span>Current Inbound Date</span>
              <input value={booking.inbound_date || '-'} readOnly disabled />
            </label>
            <label>
              <span>New Inbound Date</span>
              <input type="date" value={form.new_inbound_date} disabled={editingLocked} onChange={(e) => update('new_inbound_date', e.target.value)} />
            </label>
            <label>
              <span>Current Passenger Name</span>
              <input value={booking.passenger_name || '-'} readOnly disabled />
            </label>
            <label>
              <span>New Passenger Name</span>
              <input value={form.new_passenger_name} disabled={editingLocked} onChange={(e) => update('new_passenger_name', e.target.value)} />
            </label>
          </div>
        )}
        <div className="modal-form-grid">
          <label className="span-2">
            <span>Amendment Remarks *</span>
            <textarea rows={2} value={form.remarks} disabled={editingLocked || saving} onChange={(e) => update('remarks', e.target.value)} />
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
                disabled={editingLocked || saving}
                onChange={(e) => update(key, e.target.value)}
                placeholder="0.00"
              />
            </label>
          ))}
          <label>
            <span>Other Charge Description</span>
            <input value={form.other_charge_description} disabled={editingLocked || saving} onChange={(e) => update('other_charge_description', e.target.value)} />
          </label>
          <label>
            <span>Supplier Quote Reference</span>
            <input value={form.supplier_quote_reference} disabled={editingLocked || saving} onChange={(e) => update('supplier_quote_reference', e.target.value)} />
          </label>
          <label>
            <span><Upload size={12} style={{ marginRight: 4 }} />Quote Evidence / Screenshot</span>
            {form.evidence_document ? (
              <span className="attachment-name">
                {form.evidence_document.name}
                {!editingLocked && (
                  <button type="button" className="icon-button" disabled={saving} onClick={() => update('evidence_document', null)} aria-label="Remove document"><X size={13} /></button>
                )}
              </span>
            ) : (
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" disabled={editingLocked || saving} onChange={(e) => readAttachment(e, (doc) => update('evidence_document', doc))} />
            )}
          </label>
          <label className="span-2">
            <span>Internal Notes</span>
            <input value={form.internal_notes} disabled={editingLocked || saving} onChange={(e) => update('internal_notes', e.target.value)} />
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

        {error && (
          <div className="allocation-warning">
            {error.split('\n').map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
        )}

        <div className="form-actions">
          <button className="btn btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>
          {!financialsLocked && (
            <>
              {!finalizing && <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => saveWithStatus('DRAFT')}>Save Draft</button>}
              {!finalizing && <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => saveWithStatus('QUOTED', { needsFinancials: true })}>Create Quote</button>}
              {!finalizing && ['QUOTED', 'QUOTE_PENDING'].includes(status) && (
                <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => saveWithStatus('CUSTOMER_APPROVED', { needsFinancials: true })}>Customer Approved</button>
              )}
              {existing && !finalizing && (
                <button className="btn btn-danger" type="button" disabled={saving} onClick={() => transition('REJECTED')}>Reject</button>
              )}
              <button className="btn btn-primary" type="button" disabled={saving} onClick={() => saveWithStatus('CONFIRMED', { needsFinancials: true })}>
                {saving ? 'Confirming…' : finalizing ? 'Retry Finalization' : 'Confirm Amendment'}
              </button>
            </>
          )}
          {!dateChange && posted && status === 'CONFIRMED' && (
            <button className="btn btn-primary" type="button" disabled={saving} onClick={() => transition('COMPLETED')}>Mark Completed</button>
          )}
        </div>
        {posted && (
          <p className="reconciliation-note">
            Financial impact is posted to the ledger — amounts, currency, and counterparty are locked. Corrections require a reversing case.
          </p>
        )}
        <p className="reconciliation-note">
          Status flow: {AMENDMENT_CASE_STATUSES.filter((s) => !['QUOTE_PENDING', 'REJECTED', 'CANCELLED'].includes(s)).join(' → ').replace(/_/g, ' ')}. Modern date changes post at COMPLETED; other amendments retain CONFIRMED posting.
        </p>
      </div>
    </div>
  );
}
