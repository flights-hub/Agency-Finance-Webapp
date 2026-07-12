// Server-side port of the scoping rules in src/helpers/access.js.
// Kept dependency-free so the API server can enforce row visibility for
// AGENT and SUPPLIER accounts instead of trusting the client filter.

function token(value) {
  return String(value || '').trim().toLowerCase();
}

function tokensFrom(...values) {
  return values.flatMap((value) => (
    Array.isArray(value) ? tokensFrom(...value) : [token(value)]
  )).filter(Boolean);
}

function userAliases(user) {
  return new Set(tokensFrom(
    user?.id,
    user?.name,
    user?.email,
    user?.linked_agent_id,
    user?.linked_supplier_id,
  ));
}

function canSeeAll(user) {
  return user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';
}

function supplierNamesForBooking(booking) {
  const segmentSuppliers = (booking?.supplier_segments || [])
    .flatMap((segment) => [segment.supplier_name, segment.supplier_id])
    .filter(Boolean);

  return [...new Set([
    booking?.supplier_id,
    booking?.supplier_name,
    booking?.supplier,
    booking?.airline,
    ...segmentSuppliers,
  ].filter(Boolean))];
}

function bookingMatchesAgent(booking, aliases) {
  return tokensFrom(
    booking?.agent_id,
    booking?.bill_to_name,
    booking?.booked_by,
    booking?.agent_issued_by,
  ).some((value) => aliases.has(value));
}

function bookingMatchesSupplier(booking, aliases) {
  return supplierNamesForBooking(booking).some((value) => aliases.has(token(value)));
}

export function filterBookingsForUser(user, bookings = []) {
  if (canSeeAll(user)) return bookings;
  const aliases = userAliases(user);
  if (user?.role === 'AGENT') return bookings.filter((booking) => bookingMatchesAgent(booking, aliases));
  if (user?.role === 'SUPPLIER') return bookings.filter((booking) => bookingMatchesSupplier(booking, aliases));
  return bookings;
}

function isSupplierPayment(payment) {
  return payment?.payment_direction === 'SUPPLIER_OUT' || payment?.party_type === 'SUPPLIER';
}

function addBookingToIndex(map, key, booking) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  const rows = map.get(key);
  if (!rows.some((row) => row === booking || (booking.id && String(row.id) === String(booking.id)))) {
    rows.push(booking);
  }
}

function financeBookingIndexes(bookings) {
  const byRef = new Map();
  const byId = new Map();
  const byPnr = new Map();
  const byTicket = new Map();

  bookings.forEach((booking) => {
    addBookingToIndex(byRef, token(booking.booking_ref || booking.invoice_no), booking);
    if (booking.id !== undefined && booking.id !== null) byId.set(token(booking.id), booking);
    tokensFrom(booking.pnr, booking.pnr_history).forEach((pnr) => addBookingToIndex(byPnr, pnr, booking));
    if (booking.ticket_no) byTicket.set(token(booking.ticket_no), booking);
  });

  return { byRef, byId, byPnr, byTicket };
}

function bookingsForFinanceRecord(record, indexes) {
  const stableRows = indexes.byRef.get(token(record.booking_ref));
  if (stableRows?.length) return stableRows;

  const byId = indexes.byId.get(token(record.booking_id));
  if (byId) return [byId];

  const pnrRows = indexes.byPnr.get(token(record.pnr));
  if (pnrRows?.length) return pnrRows;

  const byTicket = indexes.byTicket.get(token(record.ticket_no || record.ticket_id));
  return byTicket ? [byTicket] : [];
}

export function scopedFinanceData(user, { bookings = [], payments = [], refunds = [], amendments = [], cancellations = [], expenses = [], allocations = [] }) {
  if (canSeeAll(user)) return { bookings, payments, refunds, amendments, cancellations, expenses, allocations };

  const scopedBookings = filterBookingsForUser(user, bookings);
  const indexes = financeBookingIndexes(bookings);
  const visibleBookings = new Set(scopedBookings);
  const aliases = userAliases(user);

  const followsBooking = (record) => bookingsForFinanceRecord(record, indexes)
    .some((booking) => visibleBookings.has(booking));

  const scopedPayments = user?.role === 'SUPPLIER'
    ? payments.filter((payment) => (
      isSupplierPayment(payment)
      && (
        aliases.has(token(payment.supplier_name))
        || aliases.has(token(payment.supplier_id))
      )
    ))
    : payments.filter((payment) => !isSupplierPayment(payment) && (
      followsBooking(payment)
      // Agents always see payments they submitted themselves, plus payments
      // recorded against them as the party.
      || aliases.has(token(payment.recorded_by_user_id))
      || (payment.party_type === 'AGENT' && aliases.has(token(payment.party_name)))
    ));

  // Allocations follow the documents the user can already see: settlements
  // that touch one of their scoped payments, or one of their scoped
  // bookings/PNRs, or that name them as the counterparty.
  const paymentIds = new Set(scopedPayments.map((payment) => token(payment.id)));
  const scopedAllocations = allocations.filter((allocation) => (
    paymentIds.has(token(allocation.source_id))
    || followsBooking(allocation)
    || aliases.has(token(allocation.counterparty_name))
  ));

  // Servicing cases follow their booking: visible when the user can see the
  // booking they amend/cancel (by id, PNR, or ticket).
  return {
    bookings: scopedBookings,
    payments: scopedPayments,
    refunds: refunds.filter(followsBooking),
    amendments: amendments.filter(followsBooking),
    cancellations: cancellations.filter(followsBooking),
    expenses: [],
    allocations: scopedAllocations,
  };
}
