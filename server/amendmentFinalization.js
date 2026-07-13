import { isDeepStrictEqual } from 'node:util';
import crypto from 'node:crypto';
import {
  applyDateChangeAmendment,
  isDateChangeType,
} from '../src/helpers/dateChangeAmendments.js';

const SAFE_HTTP_STATUSES = new Set([400, 401, 403, 409]);
const IMMUTABLE_DRAFT_FIELDS = ['id', 'booking_ref', 'original_itinerary', 'created_at', 'created_by'];
const OPEN_DATE_CHANGE_STATUSES = new Set([
  'DRAFT',
  'QUOTE_PENDING',
  'QUOTED',
  'CUSTOMER_APPROVED',
  'APPROVED',
]);

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const text = (value) => String(value ?? '').trim();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function finalizationFingerprint(record = {}) {
  const ignored = new Set([
    '_version', 'status', 'updated_at', 'confirmed_at', 'confirmed_by', 'completed_at',
    'finalized_at', 'finalized_by', 'finalization_fingerprint', 'finalization_locked_at',
    'finalization_locked_by', 'total_financial_impact',
  ]);
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key)));
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
}

export function isUniqueConstraintConflict(error) {
  return error?.data?.code === '23505';
}

function withoutVersion(record) {
  if (!record) return record;
  const clean = { ...record };
  delete clean._version;
  return clean;
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}

function bindExistingDraft(submitted, existing, group) {
  if (existing && text(existing.booking_ref) !== text(submitted.booking_ref)) {
    conflict('Amendment booking reference does not match the submitted booking reference.');
  }

  const bound = clone(submitted);
  bound.amendment_type = 'DATE_CHANGE';
  if (existing) {
    IMMUTABLE_DRAFT_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(existing, field)) bound[field] = clone(existing[field]);
    });
  }
  const rows = new Map(group.map((row) => [String(row.id), row]));
  const storedMappings = new Map((existing?.passenger_reissues || [])
    .map((mapping) => [String(mapping.booking_id), mapping]));
  bound.passenger_reissues = (submitted.passenger_reissues || []).map((mapping) => {
    const bookingId = String(mapping.booking_id ?? '');
    const row = rows.get(bookingId) || {};
    const stored = storedMappings.get(bookingId) || {};
    return {
      booking_id: row.id ?? mapping.booking_id,
      passenger_name: stored.passenger_name ?? row.passenger_name ?? '',
      old_pnr: stored.old_pnr ?? row.pnr ?? '',
      new_pnr: mapping.new_pnr ?? '',
      old_ticket_no: stored.old_ticket_no ?? row.ticket_no ?? '',
      new_ticket_no: mapping.new_ticket_no ?? '',
      reissue_reference: mapping.reissue_reference ?? '',
    };
  });
  return bound;
}

export function finalizationHttpError(error) {
  if (
    error
    && !Object.prototype.hasOwnProperty.call(error, 'data')
    && SAFE_HTTP_STATUSES.has(error.status)
  ) return error;

  const redacted = new Error('Unable to finalize amendment.');
  redacted.status = 500;
  return redacted;
}

export async function loadBookingGroupByRef(bookingRef, request) {
  const value = encodeURIComponent(bookingRef);
  const rows = await request(
    `/rest/v1/bookings?select=id,data,updated_at&or=(data->>booking_ref.eq.${value},and(data->>booking_ref.is.null,data->>invoice_no.eq.${value}),and(data->>booking_ref.eq.,data->>invoice_no.eq.${value}))&order=created_at.asc`,
  );
  return (rows || []).map((row) => ({ ...row.data, id: row.id, _version: row.updated_at }));
}

export async function persistDateChangeFinalization({ draft, actor, repository, finalizedAt }) {
  const existing = draft.id ? await repository.loadAmendment(draft.id) : null;
  if (!isDateChangeType(draft.amendment_type)) {
    conflict('The submitted amendment must be a recognized date-change type.');
  }
  if (existing && !isDateChangeType(existing.amendment_type)) {
    conflict('Only an open date-change amendment case can use the finalization endpoint.');
  }
  if (existing && text(existing.booking_ref) !== text(draft.booking_ref)) {
    conflict('Amendment booking reference does not match the submitted booking reference.');
  }

  if (existing?.status === 'COMPLETED') {
    const submittedFingerprint = finalizationFingerprint(bindExistingDraft(draft, existing, []));
    if (!existing.finalization_fingerprint || existing.finalization_fingerprint !== submittedFingerprint) {
      conflict('Amendment was already completed by a different finalization request.');
    }
    return {
      amendment: withoutVersion(existing),
      bookings: (await repository.loadBookingGroup(draft.booking_ref)).map(withoutVersion),
    };
  }

  const recovery = existing?.status === 'FINALIZING';
  if (existing && !recovery && !OPEN_DATE_CHANGE_STATUSES.has(existing.status)) {
    conflict('Only an open date-change amendment case can be finalized; create a new amendment case.');
  }

  const group = await repository.loadBookingGroup(draft.booking_ref);
  const boundDraft = bindExistingDraft(draft, existing, group);
  const fingerprint = finalizationFingerprint(boundDraft);
  if (recovery && existing.finalization_fingerprint !== fingerprint) {
    conflict('Amendment finalization is already in progress for a different finalization request.');
  }
  const placeholder = {
    ...clone(boundDraft),
    status: 'FINALIZING',
    finalization_fingerprint: fingerprint,
    finalization_locked_at: finalizedAt,
    finalization_locked_by: actor.name || actor.email,
    updated_at: finalizedAt,
  };
  let result;
  try {
    result = applyDateChangeAmendment(boundDraft, group, {
      actor: actor.name || actor.email,
      finalizedAt,
      amendmentId: boundDraft.id,
      finalizationFingerprint: fingerprint,
      allowPartialRecovery: recovery,
    });
  } catch (error) {
    if (!recovery && existing && /stale|compatible itinerary cohort/i.test(error.message)) {
      conflict('The selected passenger scope no longer matches this amendment original itinerary. Create a new amendment case.');
    }
    error.status = /\bstale\b/i.test(error.message) ? 409 : 400;
    throw error;
  }
  let leaseVersion = existing?._version || null;
  if (repository.claimFinalization) {
    const claimed = await repository.claimFinalization(
      placeholder,
      existing?._version || null,
      { recovery },
    );
    if (!claimed) conflict('Amendment finalization is already in progress or the draft changed.');
    leaseVersion = claimed?._version || leaseVersion;
  }
  const bookings = [...result.bookings];

  const changedRows = bookings
    .map((row, index) => ({ row, index, original: group[index] }))
    .filter(({ row, original }) => !isDeepStrictEqual(withoutVersion(row), withoutVersion(original)))
    .sort((left, right) => String(left.row.id).localeCompare(String(right.row.id)));
  for (const { row, index, original } of changedRows) {
    const saved = await repository.saveBooking(withoutVersion(row), original?._version || null);
    if (!saved) conflict(`Booking row ${row.id} changed while finalizing; refresh and retry.`);
    bookings[index] = saved;
  }

  const completed = {
    ...result.amendment,
    finalization_fingerprint: fingerprint,
  };
  const amendment = repository.completeFinalization
    ? await repository.completeFinalization(completed, leaseVersion, fingerprint)
    : await repository.saveAmendment(completed);
  if (!amendment) conflict('Amendment finalization lock was lost before completion.');
  return {
    amendment: withoutVersion(amendment),
    bookings: bookings.map(withoutVersion),
  };
}
