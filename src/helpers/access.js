import { hasPermission } from './permissions';

function token(value) {
  return String(value || '').trim().toLowerCase();
}

function tokensFrom(...values) {
  return values.flatMap((value) => (
    Array.isArray(value) ? tokensFrom(...value) : [token(value)]
  )).filter(Boolean);
}

export function getUserPartyKey(user) {
  const aliases = tokensFrom(
    user?.id,
    user?.name,
    user?.email,
    user?.linked_agent_id,
    user?.linked_supplier_id,
  );

  return {
    role: user?.role || '',
    agentKey: token(user?.linked_agent_id || user?.name || user?.email),
    supplierKey: token(user?.linked_supplier_id || user?.name || user?.email),
    aliases: new Set(aliases),
  };
}

export function canSeeAll(user) {
  return user?.role === 'ADMIN';
}

export function canCreateBookings(user) {
  return hasPermission(user, 'create_bookings');
}

export function canEditBookings(user) {
  return hasPermission(user, 'edit_bookings');
}

export function canExport(user) {
  return user?.role === 'ADMIN' || hasPermission(user, 'send_statements');
}

export function canRecordPayments(user) {
  return user?.role === 'ADMIN' || hasPermission(user, 'record_payments');
}

export function canProcessRefunds(user) {
  return user?.role === 'ADMIN' || hasPermission(user, 'process_refunds');
}

export function isSupplierPayment(payment) {
  return payment?.payment_direction === 'SUPPLIER_OUT';
}

export function supplierNamesForBooking(booking) {
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

export function bookingMatchesAgent(booking, user) {
  if (canSeeAll(user)) return true;
  const party = getUserPartyKey(user);
  const values = tokensFrom(
    booking?.agent_id,
    booking?.bill_to_name,
    booking?.booked_by,
    booking?.agent_issued_by,
  );
  return values.some((value) => party.aliases.has(value));
}

export function bookingMatchesSupplier(booking, userOrSupplier) {
  const aliases = typeof userOrSupplier === 'string'
    ? new Set([token(userOrSupplier)])
    : getUserPartyKey(userOrSupplier).aliases;
  return supplierNamesForBooking(booking).some((value) => aliases.has(token(value)));
}

export function filterBookingsForUser(user, bookings = []) {
  if (canSeeAll(user)) return bookings;
  if (user?.role === 'AGENT') return bookings.filter((booking) => bookingMatchesAgent(booking, user));
  if (user?.role === 'SUPPLIER') return bookings.filter((booking) => bookingMatchesSupplier(booking, user));
  return bookings;
}

function bookingPnrs(bookings = []) {
  return new Set(bookings.map((booking) => token(booking.pnr)).filter(Boolean));
}

function bookingTickets(bookings = []) {
  return new Set(bookings.map((booking) => token(booking.ticket_no)).filter(Boolean));
}

export function filterRecordsForUser(user, records = [], recordType, context = {}) {
  if (canSeeAll(user)) return records;

  const scopedBookings = context.bookings || [];
  const pnrs = bookingPnrs(scopedBookings);
  const tickets = bookingTickets(scopedBookings);

  if (recordType === 'bookings') return filterBookingsForUser(user, records);

  if (recordType === 'payments') {
    if (user?.role === 'SUPPLIER') {
      return records.filter((payment) => (
        isSupplierPayment(payment)
        && (
          bookingMatchesSupplier(payment, user)
          || getUserPartyKey(user).aliases.has(token(payment.supplier_name))
          || getUserPartyKey(user).aliases.has(token(payment.supplier_id))
        )
      ));
    }

    return records.filter((payment) => !isSupplierPayment(payment) && pnrs.has(token(payment.pnr)));
  }

  if (recordType === 'refunds') {
    return records.filter((refund) => pnrs.has(token(refund.pnr)) || tickets.has(token(refund.ticket_no)));
  }

  if (recordType === 'alerts') {
    return records.filter((alert) => pnrs.has(token(alert.pnr)) || tickets.has(token(alert.ticket_no)));
  }

  if (recordType === 'expenses') return [];

  return records;
}

export function scopedFinanceData(user, { bookings = [], payments = [], refunds = [], expenses = [] }) {
  const scopedBookings = filterBookingsForUser(user, bookings);
  return {
    bookings: scopedBookings,
    payments: filterRecordsForUser(user, payments, 'payments', { bookings: scopedBookings }),
    refunds: filterRecordsForUser(user, refunds, 'refunds', { bookings: scopedBookings }),
    expenses: canSeeAll(user) || hasPermission(user, 'view_financials') ? expenses : [],
  };
}
