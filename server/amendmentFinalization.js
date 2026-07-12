import { isDeepStrictEqual } from 'node:util';
import { applyDateChangeAmendment } from '../src/helpers/dateChangeAmendments.js';

const SAFE_HTTP_STATUSES = new Set([400, 401, 403, 409]);

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
    `/rest/v1/bookings?select=id,data&or=(data->>booking_ref.eq.${value},and(data->>booking_ref.is.null,data->>invoice_no.eq.${value}),and(data->>booking_ref.eq.,data->>invoice_no.eq.${value}))&order=created_at.asc`,
  );
  return (rows || []).map((row) => ({ ...row.data, id: row.id }));
}

export async function persistDateChangeFinalization({ draft, actor, repository, finalizedAt }) {
  const existing = draft.id ? await repository.loadAmendment(draft.id) : null;
  if (existing?.status === 'COMPLETED') {
    if (String(existing.booking_ref || '') !== String(draft.booking_ref || '')) {
      const error = new Error('Amendment booking reference does not match the submitted booking reference.');
      error.status = 409;
      throw error;
    }
    return {
      amendment: existing,
      bookings: await repository.loadBookingGroup(draft.booking_ref),
    };
  }

  const group = await repository.loadBookingGroup(draft.booking_ref);
  let result;
  try {
    result = applyDateChangeAmendment(draft, group, {
      actor: actor.name || actor.email,
      finalizedAt,
    });
  } catch (error) {
    error.status = /\bstale\b/i.test(error.message) ? 409 : 400;
    throw error;
  }
  const bookings = [...result.bookings];

  for (let index = 0; index < bookings.length; index += 1) {
    if (!isDeepStrictEqual(bookings[index], group[index])) {
      bookings[index] = await repository.saveBooking(bookings[index]);
    }
  }

  const amendment = await repository.saveAmendment(result.amendment);
  return { amendment, bookings };
}
