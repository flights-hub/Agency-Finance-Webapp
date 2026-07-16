import { isDeepStrictEqual } from 'node:util';
import {
  itinerarySnapshotsEqual,
  selectCompatibleItinerary,
} from '../src/helpers/dateChangeAmendments.js';

const text = (value) => String(value ?? '').trim();

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}

function affectedPassengerIds(record = {}, bookingGroup = []) {
  if (record.application_scope === 'PNR_WIDE') return bookingGroup.map((row) => text(row.id));
  const ids = record.selected_passenger_ids?.length
    ? record.selected_passenger_ids
    : (record.passenger_reissues || []).map((mapping) => mapping.booking_id);
  return ids.map(text).filter(Boolean).sort();
}

function selectionChanged(incoming, existing, bookingGroup) {
  if (incoming.application_scope !== existing.application_scope) return true;
  return !isDeepStrictEqual(
    affectedPassengerIds(incoming, bookingGroup),
    affectedPassengerIds(existing, bookingGroup),
  );
}

export function assertFinanceRecordInvariant({
  collection,
  incoming = {},
  existing = null,
  bookingGroup = [],
}) {
  const existingRef = text(existing?.booking_ref);
  const incomingRef = text(incoming.booking_ref);

  if (collection === 'bookings' && existingRef && incomingRef !== existingRef) {
    conflict('Booking reference is immutable and cannot be changed or removed.');
  }

  if (collection !== 'amendments') return;

  if (existing && incomingRef !== existingRef) {
    conflict('Amendment booking reference is immutable and cannot be changed or removed.');
  }

  const existingModern = existing?.amendment_type === 'DATE_CHANGE';
  if (existingModern && incoming.amendment_type !== existing.amendment_type) {
    conflict('A modern date-change amendment type is immutable.');
  }
  if (existingModern && !isDeepStrictEqual(incoming.original_itinerary, existing.original_itinerary)) {
    conflict('The original itinerary audit baseline is immutable.');
  }
  if (existingModern && selectionChanged(incoming, existing, bookingGroup)) {
    const selectedIds = affectedPassengerIds(incoming, bookingGroup);
    const selection = selectCompatibleItinerary(bookingGroup, selectedIds);
    if (
      !selectedIds.length
      || !selection.compatible
      || !itinerarySnapshotsEqual(selection.snapshot, existing.original_itinerary)
    ) {
      conflict('The selected passenger scope does not match the original itinerary. Create a new amendment case.');
    }
  }
  if (
    existingModern
    && (incoming.created_at !== existing.created_at || incoming.created_by !== existing.created_by)
  ) {
    conflict('Amendment creation stamps are immutable.');
  }
  if (existingModern && ['FINALIZING', 'COMPLETED'].includes(existing.status)) {
    conflict('Modern date changes in finalization or completed state may only use the dedicated finalization endpoint.');
  }

  const incomingModern = incoming.amendment_type === 'DATE_CHANGE';
  if (incomingModern && ['FINALIZING', 'CONFIRMED', 'COMPLETED'].includes(incoming.status)) {
    conflict('Modern date changes must be completed through the amendment finalize endpoint.');
  }
}

export async function saveVersionedFinanceRecord({
  collection,
  record,
  existingRow,
  bookingGroup,
  userId,
  request,
}) {
  assertFinanceRecordInvariant({
    collection,
    incoming: record,
    existing: existingRow?.data || null,
    bookingGroup,
  });

  const { id, _version, ...data } = record;
  void _version;
  let rows;
  if (existingRow) {
    if (!existingRow.updated_at) conflict('Record version is missing; refresh and retry.');
    rows = await request(
      `/rest/v1/${collection}?id=eq.${encodeURIComponent(id)}&updated_at=eq.${encodeURIComponent(existingRow.updated_at)}`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { data },
      },
    );
    if (!rows?.length) conflict('Record changed since it was loaded; refresh and retry.');
  } else {
    rows = await request(`/rest/v1/${collection}`, {
      method: 'POST',
      prefer: 'return=representation',
      body: { id, data, created_by: userId },
    });
  }

  const saved = rows?.[0];
  if (!saved) conflict('Record was not saved; refresh and retry.');
  return { ...saved.data, id: saved.id };
}
