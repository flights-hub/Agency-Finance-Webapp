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
  return payment?.payment_direction === 'SUPPLIER_OUT';
}

export function scopedFinanceData(user, { bookings = [], payments = [], refunds = [], expenses = [] }) {
  if (canSeeAll(user)) return { bookings, payments, refunds, expenses };

  const scopedBookings = filterBookingsForUser(user, bookings);
  const pnrs = new Set(scopedBookings.map((booking) => token(booking.pnr)).filter(Boolean));
  const tickets = new Set(scopedBookings.map((booking) => token(booking.ticket_no)).filter(Boolean));
  const aliases = userAliases(user);

  const scopedPayments = user?.role === 'SUPPLIER'
    ? payments.filter((payment) => (
      isSupplierPayment(payment)
      && (
        aliases.has(token(payment.supplier_name))
        || aliases.has(token(payment.supplier_id))
      )
    ))
    : payments.filter((payment) => !isSupplierPayment(payment) && pnrs.has(token(payment.pnr)));

  return {
    bookings: scopedBookings,
    payments: scopedPayments,
    refunds: refunds.filter((refund) => pnrs.has(token(refund.pnr)) || tickets.has(token(refund.ticket_no))),
    expenses: [],
  };
}
