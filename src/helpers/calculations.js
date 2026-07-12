// Helpers for calculations based on PRD formulas

import {
  isCustomerLedgerPayment,
  isPostedPayment,
  isSupplierPayment,
  getLedgerPostingStatus,
  nextPaymentReference,
  normalizeVerificationStatus,
  postedPayments,
} from './paymentVerification';
import { bookingPnrAliases, stableBookingRef } from './bookingIdentity';

export const PAYMENT_MODES = [
  'CASH',
  'BANK_TRANSFER',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'UPI',
  'CHEQUE',
  'POS_TERMINAL',
  'ONLINE_PAYMENT',
  'AUTO_DEBIT',
];

export const EXPENSE_CATEGORIES = [
  'RENT',
  'SALARIES',
  'UTILITIES',
  'MARKETING',
  'OFFICE_SUPPLIES',
  'TRAVEL',
  'SOFTWARE_IT',
  'COMMISSIONS',
  'INSURANCE',
  'BANK_CHARGES',
  'TAXES_FEES',
  'MISCELLANEOUS',
];

export const BRANCH_OFFICES = [
  'ROME_HQ',
  'ROME_STOREFRONT',
  'INDIA_OFFICE',
  'REMOTE',
];

export const REFUND_CATEGORIES = [
  'NO_SHOW',
  'FLIGHT_CANCEL',
  'VOLUNTARY',
  'TAX_ONLY',
  'MEDICAL_DEATH',
];

export const REFUND_STATUSES = [
  'TO_APPLY',
  'APPLIED',
  'IN_PROCESS',
  'RCVD_FROM_SUPPLIER',
  'REJECTED',
  'REFUNDED_TO_CLIENT',
];

export function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePnr(value = '') {
  return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function token(value) {
  return String(value || '').trim().toLowerCase();
}

function addBookingToIndex(map, key, booking) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  const rows = map.get(key);
  const duplicate = rows.some((row) => (
    row === booking
    || (booking.id !== undefined && booking.id !== null && String(row.id) === String(booking.id))
  ));
  if (!duplicate) rows.push(booking);
}

function customerBookingKey(booking = {}) {
  const bookingRef = stableBookingRef(booking);
  if (bookingRef) return `ref:${bookingRef}`;
  const pnr = bookingPnrAliases(booking)[0];
  return pnr ? `pnr:${pnr}` : `booking:${booking.id || ''}`;
}

function customerBookingIndexes(bookings = []) {
  const byRef = new Map();
  const byId = new Map();
  const byPnr = new Map();
  const byTicket = new Map();
  const byGroup = new Map();

  bookings.forEach((booking) => {
    addBookingToIndex(byRef, String(stableBookingRef(booking)), booking);
    if (booking.id !== undefined && booking.id !== null) byId.set(String(booking.id), booking);
    bookingPnrAliases(booking).forEach((pnr) => addBookingToIndex(byPnr, pnr, booking));
    if (booking.ticket_no) byTicket.set(token(booking.ticket_no), booking);
    addBookingToIndex(byGroup, customerBookingKey(booking), booking);
  });

  return { byRef, byId, byPnr, byTicket, byGroup };
}

function exactBookingForFinanceRecord(record = {}, rows = []) {
  if (record.booking_id !== undefined && record.booking_id !== null) {
    const byId = rows.find((booking) => String(booking.id) === String(record.booking_id));
    if (byId) return byId;
  }

  const ticket = record.ticket_no || record.ticket_id;
  if (ticket) {
    const byTicket = rows.find((booking) => token(booking.ticket_no) === token(ticket));
    if (byTicket) return byTicket;
  }

  const pnr = normalizePnr(record.pnr);
  if (!pnr) return null;
  const currentMatches = rows.filter((booking) => normalizePnr(booking.pnr) === pnr);
  if (currentMatches.length === 1) return currentMatches[0];
  if (currentMatches.length > 1) return null;
  const historicalMatches = rows.filter((booking) => (
    booking.pnr_history || []
  ).some((alias) => normalizePnr(alias) === pnr));
  return historicalMatches.length === 1 ? historicalMatches[0] : null;
}

function bookingForFinanceRecord(record = {}, indexes) {
  const stableRef = String(record.booking_ref || '');
  if (stableRef) {
    const stableRows = indexes.byRef.get(stableRef);
    if (!stableRows?.length) return null;
    const exact = exactBookingForFinanceRecord(record, stableRows);
    if (exact) return exact;
    return stableRows.length === 1 ? stableRows[0] : null;
  }

  if (record.booking_id !== undefined && record.booking_id !== null) {
    const byId = indexes.byId.get(String(record.booking_id));
    if (byId) return byId;
  }

  const ticket = record.ticket_no || record.ticket_id;
  const byTicket = ticket ? indexes.byTicket.get(token(ticket)) : null;
  if (byTicket) return byTicket;

  const byPnr = indexes.byPnr.get(normalizePnr(record.pnr));
  return byPnr?.length ? exactBookingForFinanceRecord(record, byPnr) : null;
}

function financeRecordKey(record = {}, indexes) {
  const booking = bookingForFinanceRecord(record, indexes);
  if (booking) return customerBookingKey(booking);
  if (record.booking_ref) return `ref:${record.booking_ref}`;
  const pnr = normalizePnr(record.pnr);
  if (pnr) return `pnr:${pnr}`;
  return `record:${record.id || record.payment_reference || ''}`;
}

function tokensFrom(...values) {
  return values.flatMap((value) => (
    Array.isArray(value) ? tokensFrom(...value) : [token(value)]
  )).filter(Boolean);
}

function supplierAliases(supplierOrUser) {
  if (!supplierOrUser) return new Set();
  if (typeof supplierOrUser === 'string') return new Set([token(supplierOrUser)].filter(Boolean));
  return new Set(tokensFrom(
    supplierOrUser.id,
    supplierOrUser.name,
    supplierOrUser.email,
    supplierOrUser.linked_supplier_id,
    supplierOrUser.supplier_id,
    supplierOrUser.supplier_name,
  ));
}

function supplierMatchesValue(value, supplierOrUser) {
  const aliases = supplierAliases(supplierOrUser);
  return aliases.size > 0 && aliases.has(token(value));
}

export function getPaymentStatus(totalFare, totalPaid) {
  if (totalPaid === 0) return 'UNPAID';
  if (totalPaid < totalFare) return 'PARTIAL';
  return 'FULLY_PAID';
}

export function getInstalmentType(instalmentNumber, cumulativePaid, totalFare) {
  if (instalmentNumber === 1 && cumulativePaid < totalFare) return 'ADVANCE';
  if (instalmentNumber === 1 && cumulativePaid >= totalFare) return 'FULL PAYMENT';
  if (instalmentNumber === 2) return '2ND INSTALMENT';
  if (instalmentNumber === 3) return '3RD INSTALMENT';
  if (instalmentNumber === 4) return '4TH INSTALMENT';
  if (cumulativePaid >= totalFare) return 'FINAL PAYMENT';
  return 'EXTRA';
}

export function getAlertLevel(daysToDepart, balanceDue) {
  if (balanceDue <= 0) return 'SETTLED';
  if (daysToDepart <= 0) return 'OVERDUE';
  if (daysToDepart <= 7) return 'URGENT';
  if (daysToDepart <= 14) return 'FOLLOW_UP';
  return 'SETTLED';
}

export function getEligibleRefund(fareSold, penalty, serviceFee) {
  return Math.max(0, fareSold - penalty - serviceFee);
}

export function calculatePnL(bookings, refunds, expenses) {
  const revenue = bookings.reduce((sum, b) => sum + numeric(b.fare_sold), 0);
  const cogs = bookings.reduce((sum, b) => sum + numeric(b.fare_issued), 0);
  const grossProfit = revenue - cogs;
  
  const totalExpenses = expenses.reduce((sum, e) => sum + numeric(e.amount_eur ?? e.amount), 0);
  const netProfit = grossProfit - totalExpenses;
  
  // Settled refunds reduce effective revenue. Legacy records use
  // REFUNDED_TO_CLIENT; refund cases use SETTLED.
  const totalRefunds = refunds
    .filter(r => ['REFUNDED_TO_CLIENT', 'SETTLED'].includes(r.refund_status))
    .reduce((sum, r) => sum + numeric(r.eligible_refund ?? r.net_refund_credit), 0);

  const effectiveRevenue = revenue - totalRefunds;
  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMargin,
    totalExpenses,
    netProfit,
    totalRefunds,
    effectiveRevenue
  };
}

export function parseDate(dateStr) {
  return new Date(dateStr);
}

export function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  d1.setHours(0,0,0,0);
  d2.setHours(0,0,0,0);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function monthLabel(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', '-');
}

export function getInvoiceNo(index) {
  return `INV-${String(index + 1).padStart(5, '0')}`;
}

export function getBookingLedger(bookings = [], payments = []) {
  const groupCounts = new Map();
  const groupTotals = new Map();
  const groupPayments = new Map();
  const indexes = customerBookingIndexes(bookings);
  const today = new Date().toISOString().split('T')[0];
  const agentPayments = payments.filter(isCustomerLedgerPayment);
  // Only verified + eligible payments reduce outstanding balances.
  const countablePayments = postedPayments(agentPayments);

  bookings.forEach((booking) => {
    const key = customerBookingKey(booking);
    groupTotals.set(key, (groupTotals.get(key) || 0) + numeric(booking.fare_sold));
  });

  countablePayments.forEach((payment) => {
    const key = financeRecordKey(payment, indexes);
    groupPayments.set(key, (groupPayments.get(key) || 0) + numeric(payment.amount_paid));
  });

  return bookings.map((booking, index) => {
    const pnr = normalizePnr(booking.pnr);
    const groupKey = customerBookingKey(booking);
    const pnr_n = (groupCounts.get(groupKey) || 0) + 1;
    groupCounts.set(groupKey, pnr_n);

    const totalFare = groupTotals.get(groupKey) || numeric(booking.fare_sold);
    const totalPaid = groupPayments.get(groupKey) || numeric(booking.total_paid);
    const balanceDue = Math.max(0, totalFare - totalPaid);
    const daysToDeparture = booking.outbound_date ? daysBetween(today, booking.outbound_date) : '';
    const alert = booking.outbound_date ? getAlertLevel(daysToDeparture, balanceDue) : 'SETTLED';

    return {
      ...booking,
      sl: index + 1,
      invoice_no: booking.invoice_no || getInvoiceNo(index),
      booking_date: booking.booking_date || booking.created_at?.slice(0, 10) || '',
      pnr,
      pax_type: booking.pax_type || 'ADT',
      ow_rt: booking.inbound_date ? 'RT' : 'OW',
      fare_sold: numeric(booking.fare_sold),
      fare_issued: numeric(booking.fare_issued),
      profit: numeric(booking.fare_sold) - numeric(booking.fare_issued),
      total_paid: pnr_n === 1 ? totalPaid : null,
      balance_due: pnr_n === 1 ? balanceDue : null,
      payment_status: pnr_n === 1 ? getPaymentStatus(totalFare, totalPaid) : '',
      num_instalments: pnr_n === 1 ? countablePayments.filter((payment) => financeRecordKey(payment, indexes) === groupKey).length : null,
      ticket_status: booking.ticket_status || (booking.ticket_no ? 'TICKETED' : 'PENDING'),
      days_to_departure: daysToDeparture,
      alert: pnr_n === 1 ? alert : '',
      pnr_n,
      refund_flag: Boolean(booking.refund_flag),
    };
  });
}

export function getPaymentLedger(bookings = [], payments = []) {
  const fareByGroup = new Map();
  const firstPassengerByGroup = new Map();
  const runningByGroup = new Map();
  const instalmentsByGroup = new Map();
  const indexes = customerBookingIndexes(bookings);
  const agentPayments = payments.filter(isCustomerLedgerPayment);

  bookings.forEach((booking) => {
    const key = customerBookingKey(booking);
    fareByGroup.set(key, (fareByGroup.get(key) || 0) + numeric(booking.fare_sold));
    if (!firstPassengerByGroup.has(key)) firstPassengerByGroup.set(key, booking.passenger_name);
  });

  return [...agentPayments]
    .sort((a, b) => String(a.payment_date || '').localeCompare(String(b.payment_date || '')))
    .map((payment, index) => {
      const pnr = normalizePnr(payment.pnr);
      const groupKey = financeRecordKey(payment, indexes);
      // Pending/ineligible payments stay visible in the ledger but contribute
      // nothing to the running totals until they are verified and posted.
      const posted = isPostedPayment(payment);
      const previous = runningByGroup.get(groupKey) || 0;
      const cumulativePaid = previous + (posted ? numeric(payment.amount_paid) : 0);
      runningByGroup.set(groupKey, cumulativePaid);
      const totalFare = fareByGroup.get(groupKey) || numeric(payment.total_fare);
      const remainingBalance = Math.max(0, totalFare - cumulativePaid);
      const instalmentNo = (instalmentsByGroup.get(groupKey) || 0) + 1;
      instalmentsByGroup.set(groupKey, instalmentNo);

      return {
        ...payment,
        payment_direction: payment.payment_direction || 'AGENT_IN',
        sl: index + 1,
        pnr,
        passenger_name: payment.passenger_name || firstPassengerByGroup.get(groupKey) || '',
        amount_paid: numeric(payment.amount_paid),
        instalment_no: payment.instalment_no || instalmentNo,
        instalment_type: payment.instalment_type || getInstalmentType(instalmentNo, cumulativePaid, totalFare),
        cumulative_paid: cumulativePaid,
        total_fare: totalFare,
        remaining_balance: remainingBalance,
        verification_status: normalizeVerificationStatus(payment),
        ledger_posting_status: getLedgerPostingStatus(payment),
        posted,
        pnr_n: 1,
      };
    });
}

export function createPaymentEntry(input, bookings = [], payments = []) {
  const { payment_date, pnr, amount_paid, payment_mode, receipt_ref, received_by, remarks, ...rest } = input;
  const normalizedPnr = normalizePnr(pnr);
  const indexes = customerBookingIndexes(bookings);
  const relatedBooking = bookingForFinanceRecord({ ...rest, pnr: normalizedPnr }, indexes);
  const groupKey = relatedBooking ? customerBookingKey(relatedBooking) : financeRecordKey({ ...rest, pnr: normalizedPnr }, indexes);
  const relatedBookings = indexes.byGroup.get(groupKey) || (relatedBooking ? [relatedBooking] : []);
  const totalFare = relatedBookings.reduce((sum, booking) => sum + numeric(booking.fare_sold), 0);
  const agentPayments = payments.filter(isCustomerLedgerPayment);
  // Only posted payments count toward the running paid position.
  const existingPaid = postedPayments(agentPayments)
    .filter((payment) => financeRecordKey(payment, indexes) === groupKey)
    .reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
  const amount = numeric(amount_paid);
  const instalmentNo = agentPayments.filter((payment) => financeRecordKey(payment, indexes) === groupKey).length + 1;
  const cumulativePaid = existingPaid + amount;

  const entry = {
    ...rest,
    payment_date,
    pnr: normalizedPnr,
    booking_ref: (relatedBooking ? stableBookingRef(relatedBooking) : '') || rest.booking_ref || '',
    booking_id: relatedBooking?.id || rest.booking_id || '',
    payment_direction: rest.payment_direction || 'RECEIVED',
    party_type: rest.party_type || 'CUSTOMER',
    party_name: rest.party_name || relatedBooking?.bill_to_name || relatedBooking?.passenger_name || '',
    passenger_name: rest.passenger_name || relatedBooking?.passenger_name || '',
    amount_paid: amount,
    transaction_amount: amount,
    transaction_currency: rest.transaction_currency || 'EUR',
    payment_mode,
    payment_method: payment_mode,
    payment_reference: rest.payment_reference || nextPaymentReference(payments, rest.payment_direction || 'RECEIVED'),
    receipt_ref,
    instalment_no: instalmentNo,
    instalment_type: getInstalmentType(instalmentNo, cumulativePaid, totalFare),
    received_by,
    cumulative_paid: cumulativePaid,
    total_fare: totalFare,
    remaining_balance: Math.max(0, totalFare - cumulativePaid),
    verification_status: rest.verification_status || 'TO_BE_VERIFIED',
    pnr_n: 1,
    remarks,
  };
  entry.ledger_posting_status = getLedgerPostingStatus(entry);
  return entry;
}

export function supplierNamesForBooking(booking = {}) {
  const segmentSuppliers = (booking.supplier_segments || [])
    .flatMap((segment) => [segment.supplier_name, segment.supplier_id])
    .filter(Boolean);
  return [...new Set([
    booking.supplier_id,
    booking.supplier_name,
    booking.supplier,
    booking.airline,
    ...segmentSuppliers,
  ].filter(Boolean))];
}

export function bookingMatchesSupplier(booking = {}, supplierOrUser = '') {
  return supplierNamesForBooking(booking).some((name) => supplierMatchesValue(name, supplierOrUser));
}

export function getSupplierPayableForBooking(booking = {}, supplierOrUser = '') {
  const matchingSegments = (booking.supplier_segments || []).filter((segment) => (
    supplierMatchesValue(segment.supplier_name, supplierOrUser)
    || supplierMatchesValue(segment.supplier_id, supplierOrUser)
  ));
  const allocated = matchingSegments.reduce((sum, segment) => sum + numeric(segment.buying_price), 0);
  return allocated || numeric(booking.fare_issued);
}

export const supplierPayableForBooking = getSupplierPayableForBooking;

function segmentMatchesPayment(booking = {}, payment = {}, supplierOrUser = '') {
  const segmentId = payment.segment_id || payment.supplier_segment_id;
  const allocations = Array.isArray(payment.supplier_allocations) ? payment.supplier_allocations : [];
  if (allocations.length > 0) {
    return allocations.some((allocation) => (
      supplierMatchesValue(allocation.supplier_name || allocation.supplier_id, supplierOrUser)
      && (!allocation.pnr || normalizePnr(allocation.pnr) === normalizePnr(booking.pnr))
      && (!allocation.segment_id || (booking.supplier_segments || []).some((segment) => String(segment.id || segment.segment_id || '') === String(allocation.segment_id)))
    ));
  }
  if (!segmentId) return bookingMatchesSupplier(booking, supplierOrUser);
  return (booking.supplier_segments || []).some((segment) => (
    String(segment.id || segment.segment_id || '') === String(segmentId)
    && (
      supplierMatchesValue(segment.supplier_name, supplierOrUser)
      || supplierMatchesValue(segment.supplier_id, supplierOrUser)
    )
  ));
}

function paymentMatchesSupplierScope(payment = {}, booking = {}, supplierOrUser = '') {
  if (!isSupplierPayment(payment)) return false;
  const supplierTarget = payment.supplier_name || payment.supplier_id;
  const matchesSupplier = supplierMatchesValue(supplierTarget, supplierOrUser) || bookingMatchesSupplier(booking, supplierOrUser);
  if (!matchesSupplier) return false;

  const scope = payment.supplier_payment_scope || 'SUPPLIER';
  if (scope === 'SUPPLIER') return true;
  if (normalizePnr(payment.pnr) !== normalizePnr(booking.pnr)) return false;
  if (scope === 'PNR') return true;
  return segmentMatchesPayment(booking, payment, supplierOrUser);
}

function supplierPaymentAmountForBooking(payment = {}, booking = {}, supplierOrUser = '') {
  if (!isSupplierPayment(payment)) return 0;
  if ((payment.supplier_payment_scope || 'SUPPLIER') === 'SUPPLIER') return 0;
  const allocations = Array.isArray(payment.supplier_allocations) ? payment.supplier_allocations : [];
  if (allocations.length > 0) {
    return allocations.reduce((sum, allocation) => {
      const matches = (
        supplierMatchesValue(allocation.supplier_name || allocation.supplier_id, supplierOrUser)
        && (!allocation.pnr || normalizePnr(allocation.pnr) === normalizePnr(booking.pnr))
        && (!allocation.segment_id || (booking.supplier_segments || []).some((segment) => String(segment.id || segment.segment_id || '') === String(allocation.segment_id)))
      );
      return matches ? sum + numeric(allocation.amount_paid) : sum;
    }, 0);
  }
  return paymentMatchesSupplierScope(payment, booking, supplierOrUser) ? numeric(payment.amount_paid) : 0;
}

function supplierPaymentMatchesTarget(payment = {}, supplierOrUser = '') {
  return isSupplierPayment(payment)
    && supplierMatchesValue(payment.supplier_name || payment.supplier_id, supplierOrUser);
}

function supplierPaymentScopePayable(bookings = [], payment = {}) {
  const supplier = payment.supplier_name || payment.supplier_id;
  const scope = payment.supplier_payment_scope || 'SUPPLIER';
  const supplierBookings = bookings.filter((booking) => bookingMatchesSupplier(booking, supplier));
  if (scope === 'SUPPLIER') {
    return supplierBookings.reduce((sum, booking) => sum + getSupplierPayableForBooking(booking, supplier), 0);
  }
  const scopedBookings = supplierBookings.filter((booking) => normalizePnr(booking.pnr) === normalizePnr(payment.pnr));
  if (scope === 'PNR') {
    return scopedBookings.reduce((sum, booking) => sum + getSupplierPayableForBooking(booking, supplier), 0);
  }
  return scopedBookings.reduce((sum, booking) => {
    const segmentId = payment.segment_id || payment.supplier_segment_id;
    const allocated = (booking.supplier_segments || [])
      .filter((segment) => (
        String(segment.id || segment.segment_id || '') === String(segmentId)
        && (
          supplierMatchesValue(segment.supplier_name, supplier)
          || supplierMatchesValue(segment.supplier_id, supplier)
        )
      ))
      .reduce((segmentSum, segment) => segmentSum + numeric(segment.buying_price), 0);
    return sum + (allocated || getSupplierPayableForBooking(booking, supplier));
  }, 0);
}

function supplierPaymentScopeKey(payment = {}) {
  const scope = payment.supplier_payment_scope || 'SUPPLIER';
  return [
    token(payment.supplier_name || payment.supplier_id),
    scope,
    scope === 'SUPPLIER' ? '' : normalizePnr(payment.pnr),
    scope === 'SEGMENT' ? String(payment.segment_id || payment.supplier_segment_id || '') : '',
  ].join('|');
}

export function getSupplierPayableLedger(bookings = [], payments = [], supplierOrUser = '') {
  const supplierBookings = bookings.filter((booking) => bookingMatchesSupplier(booking, supplierOrUser));
  const pnrCounts = new Map();

  return supplierBookings.map((booking, index) => {
    const pnr = normalizePnr(booking.pnr);
    const pnr_n = (pnrCounts.get(pnr) || 0) + 1;
    pnrCounts.set(pnr, pnr_n);
    const supplierPayable = getSupplierPayableForBooking(booking, supplierOrUser);
    const supplierPaid = postedPayments(payments).reduce((sum, payment) => (
      sum + supplierPaymentAmountForBooking(payment, booking, supplierOrUser)
    ), 0);

    return {
      ...booking,
      sl: index + 1,
      invoice_no: booking.invoice_no || getInvoiceNo(index),
      booking_date: booking.booking_date || booking.created_at?.slice(0, 10) || '',
      pnr,
      fare_sold: numeric(booking.fare_sold),
      fare_issued: numeric(booking.fare_issued),
      supplier_payable: supplierPayable,
      supplier_paid: supplierPaid,
      supplier_balance_due: Math.max(0, supplierPayable - supplierPaid),
      payment_status: getPaymentStatus(supplierPayable, supplierPaid),
      pnr_n,
      alert: Math.max(0, supplierPayable - supplierPaid) > 0 ? 'PAYABLE_OPEN' : 'SETTLED',
    };
  });
}

export function getSupplierPayableSummary(bookings = [], payments = [], supplierOrUser = '') {
  const rows = getSupplierPayableLedger(bookings, payments, supplierOrUser);
  const payable = rows.reduce((sum, booking) => sum + numeric(booking.supplier_payable), 0);
  const paid = postedPayments(payments)
    .filter((payment) => supplierPaymentMatchesTarget(payment, supplierOrUser))
    .reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
  const outstanding = Math.max(0, payable - paid);

  return {
    bookings: rows,
    payable,
    paid,
    outstanding,
    paidBookings: rows.filter((booking) => booking.payment_status === 'FULLY_PAID').length,
    partialBookings: rows.filter((booking) => booking.payment_status === 'PARTIAL').length,
    unpaidBookings: rows.filter((booking) => booking.payment_status === 'UNPAID').length,
  };
}

export function getSupplierPaymentLedger(bookings = [], payments = []) {
  const supplierPayments = payments
    .filter(isSupplierPayment)
    .sort((a, b) => String(a.payment_date || '').localeCompare(String(b.payment_date || '')));
  const runningByScope = new Map();

  return supplierPayments
    .map((payment, index) => {
      const scopeKey = supplierPaymentScopeKey(payment);
      const totalPayable = supplierPaymentScopePayable(bookings, payment);
      const posted = isPostedPayment(payment);
      const cumulativePaid = (runningByScope.get(scopeKey) || 0) + (posted ? numeric(payment.amount_paid) : 0);
      runningByScope.set(scopeKey, cumulativePaid);
      const scope = payment.supplier_payment_scope || 'SUPPLIER';

      return {
        ...payment,
        verification_status: normalizeVerificationStatus(payment),
        ledger_posting_status: getLedgerPostingStatus(payment),
        posted,
        sl: index + 1,
        supplier_name: payment.supplier_name || '',
        passenger_name: payment.supplier_name || '',
        pnr: payment.pnr || scope,
        supplier_payment_scope: scope,
        amount_paid: numeric(payment.amount_paid),
        instalment_no: payment.instalment_no || '',
        instalment_type: `${scope.replace(/_/g, ' ')} PAYMENT`,
        cumulative_paid: cumulativePaid,
        total_fare: totalPayable,
        remaining_balance: Math.max(0, totalPayable - cumulativePaid),
        pnr_n: 1,
      };
    });
}

export function createSupplierPaymentEntry({
  payment_date,
  supplier_name,
  amount_paid,
  payment_mode,
  receipt_ref,
  received_by,
  remarks,
  pnr = '',
  segment_id = '',
  supplier_payment_scope = 'SUPPLIER',
  supplier_allocations = [],
}) {
  const amount = numeric(amount_paid);
  return {
    payment_date,
    pnr: supplier_payment_scope === 'SUPPLIER' ? '' : normalizePnr(pnr),
    segment_id: supplier_payment_scope === 'SEGMENT' ? segment_id : '',
    supplier_name,
    passenger_name: supplier_name,
    party_type: 'SUPPLIER',
    party_name: supplier_name,
    amount_paid: amount,
    transaction_amount: amount,
    payment_mode,
    payment_method: payment_mode,
    receipt_ref,
    received_by,
    payment_direction: 'SUPPLIER_OUT',
    verification_status: 'TO_BE_VERIFIED',
    ledger_posting_status: 'PENDING_VERIFICATION',
    supplier_payment_scope,
    supplier_allocations: supplier_allocations.length > 0 ? supplier_allocations : (
      supplier_payment_scope === 'SUPPLIER'
        ? []
        : [{ pnr: normalizePnr(pnr), segment_id, supplier_name, amount_paid: amount }]
    ),
    instalment_type: `${supplier_payment_scope.replace(/_/g, ' ')} PAYMENT`,
    remarks,
  };
}

export function getRefundLedger(bookings = [], refunds = []) {
  return refunds.map((refund, index) => {
    const booking = bookings.find((item) => item.ticket_no === refund.ticket_no) || {};
    const cancelDate = refund.cancel_date || new Date().toISOString().split('T')[0];
    const statusDate = refund.status_date || new Date().toISOString().split('T')[0];
    const checkedForPnr = bookings.filter((item) => normalizePnr(item.pnr) === normalizePnr(booking.pnr) && item.refund_flag).length;
    const paxForPnr = bookings.filter((item) => normalizePnr(item.pnr) === normalizePnr(booking.pnr)).length;

    return {
      ...refund,
      sl: index + 1,
      pnr: refund.pnr || booking.pnr || '',
      passenger_name: refund.passenger_name || booking.passenger_name || '',
      airline: refund.airline || booking.airline || '',
      sector: refund.sector || booking.sector || '',
      fare_sold: numeric(refund.fare_sold || booking.fare_sold),
      fare_issued: numeric(refund.fare_issued || booking.fare_issued),
      cancel_date: cancelDate,
      cancel_type: refund.cancel_type || (checkedForPnr >= paxForPnr && paxForPnr > 0 ? 'FULL_BOOKING' : 'CANCEL_PAX'),
      airline_penalty: numeric(refund.airline_penalty),
      service_fee: numeric(refund.service_fee),
      eligible_refund: getEligibleRefund(numeric(refund.fare_sold || booking.fare_sold), numeric(refund.airline_penalty), numeric(refund.service_fee)),
      supplier_refund: numeric(refund.supplier_refund),
      refund_status: refund.refund_status || 'TO_APPLY',
      status_date: statusDate,
      processing_days: daysBetween(cancelDate, statusDate),
    };
  });
}

export function getExpenseLedger(expenses = []) {
  return expenses.map((expense, index) => ({
    ...expense,
    sl: index + 1,
    amount_eur: numeric(expense.amount_eur ?? expense.amount),
    payment_mode: expense.payment_mode || 'BANK_TRANSFER',
    branch_office: expense.branch_office || 'ROME_HQ',
    recurring: Boolean(expense.recurring),
    month: expense.month || monthLabel(expense.expense_date),
  }));
}

export function getPnlAnalytics(bookings = [], payments = [], refunds = [], expenses = []) {
  const agentPayments = payments.filter(isCustomerLedgerPayment);
  const bookingLedger = getBookingLedger(bookings, agentPayments);
  const paymentLedger = getPaymentLedger(bookings, agentPayments);
  const expenseLedger = getExpenseLedger(expenses);
  const pnl = calculatePnL(bookings, refunds, expenseLedger);
  // Confirmed collections: verified + eligible payments only.
  const collections = paymentLedger
    .filter((payment) => payment.posted)
    .reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
  const outstanding = bookingLedger
    .filter((booking) => booking.pnr_n === 1)
    .reduce((sum, booking) => sum + numeric(booking.balance_due), 0);
  const paidPnrs = bookingLedger.filter((booking) => booking.pnr_n === 1 && booking.payment_status === 'FULLY_PAID').length;
  const partialPnrs = bookingLedger.filter((booking) => booking.pnr_n === 1 && booking.payment_status === 'PARTIAL').length;
  const unpaidPnrs = bookingLedger.filter((booking) => booking.pnr_n === 1 && booking.payment_status === 'UNPAID').length;
  const recurringExpenses = expenseLedger.filter((expense) => expense.recurring).reduce((sum, expense) => sum + numeric(expense.amount_eur), 0);
  const variableExpenses = pnl.totalExpenses - recurringExpenses;

  return {
    ...pnl,
    collections,
    outstanding,
    collectionRate: pnl.revenue > 0 ? (collections / pnl.revenue) * 100 : 0,
    paidPnrs,
    partialPnrs,
    unpaidPnrs,
    recurringExpenses,
    variableExpenses,
    cashFlow: collections - pnl.totalExpenses,
    paxCount: bookings.length,
    revenuePerPax: bookings.length ? pnl.revenue / bookings.length : 0,
    costPerPax: bookings.length ? pnl.cogs / bookings.length : 0,
    expensePerPax: bookings.length ? pnl.totalExpenses / bookings.length : 0,
    netPerPax: bookings.length ? pnl.netProfit / bookings.length : 0,
  };
}

const BASE_STATEMENT_COLUMNS = [
  ['invoice_no', 'Invoice'],
  ['pnr', 'PNR'],
  ['passenger_name', 'Passenger'],
  ['ticket_no', 'Ticket'],
  ['sector', 'Sector'],
];

export function getStatementColumns({ role = '', statementType = 'agent' } = {}) {
  const normalizedRole = String(role || '').toUpperCase();
  if (statementType === 'supplier') {
    const supplierColumns = [
      ...BASE_STATEMENT_COLUMNS,
      ['supplier_payable', 'Supplier Receivable'],
      ['supplier_paid', 'Paid by Admin'],
      ['supplier_balance_due', 'Outstanding'],
      ['payment_status', 'Payment Status'],
      ['alert', 'Alert'],
    ];
    return normalizedRole === 'ADMIN'
      ? [
        ...BASE_STATEMENT_COLUMNS,
        ['fare_sold', 'Fare Sold'],
        ['fare_issued', 'Fare Issued'],
        ['supplier_payable', 'Supplier Receivable'],
        ['supplier_paid', 'Paid by Admin'],
        ['supplier_balance_due', 'Outstanding'],
        ['payment_status', 'Payment Status'],
        ['alert', 'Alert'],
      ]
      : supplierColumns;
  }

  const agentColumns = [
    ...BASE_STATEMENT_COLUMNS,
    ['fare_sold', 'Agent Payable'],
    ['total_paid', 'Paid to Admin'],
    ['balance_due', 'Outstanding'],
    ['payment_status', 'Payment Status'],
    ['alert', 'Alert'],
  ];
  return normalizedRole === 'ADMIN'
    ? [
      ...BASE_STATEMENT_COLUMNS,
      ['fare_sold', 'Agent Payable'],
      ['fare_issued', 'Fare Issued'],
      ['profit', 'Admin Profit'],
      ['total_paid', 'Paid to Admin'],
      ['balance_due', 'Outstanding'],
      ['payment_status', 'Payment Status'],
      ['alert', 'Alert'],
    ]
    : agentColumns;
}

export function getRoleDashboardSummary(user = {}, data = {}) {
  const bookings = data.bookings || [];
  const payments = data.payments || [];
  const refunds = data.refunds || [];
  const expenses = data.expenses || [];
  const role = user?.role || 'ADMIN';

  if (role === 'SUPPLIER') {
    const supplierSummary = getSupplierPayableSummary(bookings, payments, user);
    return {
      roleView: 'SUPPLIER',
      kicker: 'Supplier finance',
      title: 'Your supplied bookings and receivables',
      description: 'Track supplied tickets, payments from Admin, open supplier receivables, and booking performance.',
      bookings: supplierSummary.bookings,
      alerts: supplierSummary.bookings.filter((booking) => numeric(booking.supplier_balance_due) > 0),
      showRefundPanel: false,
      valueKey: 'supplier_payable',
      valueLabel: 'Supplier receivable',
      statusLabel: 'Supplier payment status',
      kpis: [
        ['Supplied bookings', supplierSummary.bookings.length, `${supplierSummary.paidBookings} fully paid`],
        ['Supplier receivable', supplierSummary.payable, `${supplierSummary.partialBookings} partial bookings`],
        ['Paid by Admin', supplierSummary.paid, `${supplierSummary.unpaidBookings} unpaid bookings`],
        ['Outstanding receivable', supplierSummary.outstanding, 'Supplier payable basis'],
      ],
      detailsTitle: 'Supplier payable breakdown',
      detailsKicker: 'Supplier statement',
      details: [
        ['Supplier receivable', supplierSummary.payable],
        ['Paid by Admin', supplierSummary.paid],
        ['Remaining receivable', supplierSummary.outstanding],
        ['Booking count', supplierSummary.bookings.length],
      ],
      refundStats: { total: 0, pendingCount: 0, avgDays: 0, overdueCount: 0 },
    };
  }

  const bookingLedger = getBookingLedger(bookings, payments);
  const paymentLedger = getPaymentLedger(bookings, payments);

  if (role === 'AGENT') {
    const payable = bookingLedger.reduce((sum, booking) => sum + numeric(booking.fare_sold), 0);
    const paid = paymentLedger
      .filter((payment) => payment.posted)
      .reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
    const outstanding = bookingLedger
      .filter((booking) => booking.pnr_n === 1)
      .reduce((sum, booking) => sum + numeric(booking.balance_due), 0);
    const paidPnrs = bookingLedger.filter((booking) => booking.pnr_n === 1 && booking.payment_status === 'FULLY_PAID').length;
    const partialPnrs = bookingLedger.filter((booking) => booking.pnr_n === 1 && booking.payment_status === 'PARTIAL').length;
    const unpaidPnrs = bookingLedger.filter((booking) => booking.pnr_n === 1 && booking.payment_status === 'UNPAID').length;

    return {
      roleView: 'AGENT',
      kicker: 'Agent finance',
      title: 'Your bookings and payable position',
      description: 'Track your booking rows, payments made to Admin, instalments, open payable, and payment performance.',
      bookings: bookingLedger,
      alerts: generateAlerts(bookings, payments, refunds),
      showRefundPanel: false,
      valueKey: 'fare_sold',
      valueLabel: 'Agent payable',
      statusLabel: 'Payment status',
      kpis: [
        ['Own bookings', bookingLedger.length, `${paidPnrs} fully paid PNRs`],
        ['Agent payable', payable, `${partialPnrs} partial PNRs`],
        ['Paid to Admin', paid, `${unpaidPnrs} unpaid PNRs`],
        ['Outstanding payable', outstanding, 'Based on fare sold'],
      ],
      detailsTitle: 'Agent payable breakdown',
      detailsKicker: 'Agent statement',
      details: [
        ['Agent payable', payable],
        ['Paid to Admin', paid],
        ['Outstanding payable', outstanding],
        ['Payment instalments', paymentLedger.length],
      ],
      refundStats: { total: 0, pendingCount: 0, avgDays: 0, overdueCount: 0 },
    };
  }

  const pnl = getPnlAnalytics(bookings, payments, refunds, expenses);
  const refundLedger = getRefundLedger(bookings, refunds);
  const settledStatuses = ['REFUNDED_TO_CLIENT', 'SETTLED'];
  const closedStatuses = [...settledStatuses, 'REJECTED', 'CANCELLED'];
  const pendingRefunds = refundLedger.filter((refund) => !closedStatuses.includes(refund.refund_status));
  const totalRefunded = refundLedger
    .filter((refund) => settledStatuses.includes(refund.refund_status))
    .reduce((sum, refund) => sum + numeric(refund.eligible_refund ?? refund.net_refund_credit), 0);
  const processedRefunds = refundLedger.filter((refund) => settledStatuses.includes(refund.refund_status));
  const avgDays = processedRefunds.length > 0
    ? Math.round(processedRefunds.reduce((sum, refund) => sum + numeric(refund.processing_days), 0) / processedRefunds.length)
    : 0;

  return {
    roleView: 'ADMIN',
    kicker: 'Finance command center',
    title: "Today's booking-to-cash picture",
    description: 'Track revenue, unsettled balances, refunds, supplier payables, and operating costs from one clean workspace.',
    bookings: bookingLedger,
    pnl,
    alerts: generateAlerts(bookings, payments, refunds),
    showRefundPanel: true,
    valueKey: 'fare_sold',
    valueLabel: 'Fare sold',
    statusLabel: 'Payment status',
    kpis: [
      ['Effective revenue', pnl.effectiveRevenue, `${Math.round(pnl.grossMargin || 0)}% gross margin`],
      ['Net profit', pnl.netProfit, `${numeric(pnl.totalExpenses).toLocaleString()} expenses`],
      ['Outstanding', pnl.outstanding, `${pnl.paidPnrs} paid PNRs, ${pnl.partialPnrs} partial`],
      ['Active alerts', generateAlerts(bookings, payments, refunds).length, `${pendingRefunds.length} refunds pending`],
    ],
    detailsTitle: 'Profit breakdown',
    detailsKicker: 'P&L',
    details: [
      ['Sales revenue', pnl.revenue],
      ['Ticket cost', -pnl.cogs],
      ['Gross profit', pnl.grossProfit],
      ['Collections', pnl.collections],
      ['Operating expenses', -pnl.totalExpenses],
      ['Cash flow', pnl.cashFlow],
      ['Net profit', pnl.netProfit],
    ],
    refundStats: {
      total: totalRefunded,
      pendingCount: pendingRefunds.length,
      avgDays,
      overdueCount: pendingRefunds.filter((refund) => numeric(refund.processing_days) > 30).length,
    },
  };
}

export function generateAlerts(bookings = [], payments = [], refunds = []) {
  const bookingAlerts = getBookingLedger(bookings, payments)
    .filter((booking) => booking.pnr_n === 1 && booking.alert && booking.alert !== 'SETTLED')
    .map((booking) => ({
      id: `${booking.id || booking.pnr}_payment_alert`,
      alert_type: booking.alert === 'OVERDUE' ? 'OVERDUE_PAYMENT' : booking.alert === 'URGENT' ? 'URGENT_DEPARTURE' : 'FOLLOW_UP',
      severity: booking.alert === 'OVERDUE' ? 'CRITICAL' : booking.alert === 'URGENT' ? 'URGENT' : 'WARNING',
      pnr: booking.pnr,
      ticket_no: booking.ticket_no,
      message: `${booking.pnr} has EUR ${numeric(booking.balance_due).toLocaleString()} pending and departs in ${booking.days_to_departure} days.`,
      amount_at_risk: numeric(booking.balance_due),
      days_to_event: booking.days_to_departure,
      status: 'ACTIVE',
    }));

  const refundAlerts = getRefundLedger(bookings, refunds)
    .filter((refund) => refund.processing_days > 30 || refund.refund_status === 'REJECTED')
    .map((refund) => ({
      id: `${refund.id || refund.ticket_no}_refund_alert`,
      alert_type: refund.processing_days > 45 || refund.refund_status === 'REJECTED' ? 'ESCALATED' : 'PENDING_REFUND',
      severity: refund.processing_days > 45 || refund.refund_status === 'REJECTED' ? 'CRITICAL' : 'WARNING',
      pnr: refund.pnr,
      ticket_no: refund.ticket_no,
      message: `${refund.ticket_no} refund is ${refund.processing_days} days old with status ${refund.refund_status.replace(/_/g, ' ')}.`,
      amount_at_risk: numeric(refund.eligible_refund),
      days_to_event: refund.processing_days,
      status: 'ACTIVE',
    }));

  return [...bookingAlerts, ...refundAlerts];
}
