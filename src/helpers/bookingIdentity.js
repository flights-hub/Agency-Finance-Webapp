export function normalizeBookingPnr(value = '') {
  return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function stableBookingRef(booking = {}) {
  return String(booking.booking_ref || booking.invoice_no || '');
}

export function bookingPnrAliases(booking = {}) {
  return [...new Set([booking.pnr, ...(booking.pnr_history || [])]
    .map(normalizeBookingPnr)
    .filter(Boolean))];
}

export function groupPnrAliases(bookings = []) {
  return [...new Set(bookings.flatMap(bookingPnrAliases))];
}

export function bookingMatchesRecord(booking = {}, record = {}) {
  const bookingRef = stableBookingRef(booking);
  if (record.booking_ref && bookingRef && String(record.booking_ref) === bookingRef) return true;
  if (record.booking_id && String(record.booking_id) === String(booking.id)) return true;
  const pnr = normalizeBookingPnr(record.pnr);
  return Boolean(pnr && bookingPnrAliases(booking).includes(pnr));
}

export function recordMatchesBookingGroup(record = {}, group = []) {
  return group.some((booking) => bookingMatchesRecord(booking, record));
}
