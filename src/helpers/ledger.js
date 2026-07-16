// Continuous ledger + open item + allocation engine.
//
// Three concepts are kept strictly separate:
//   1. FINANCIAL DOCUMENT  — the existing collections (bookings/tickets,
//      payments, refund cases). They explain WHY money moved.
//   2. LEDGER ENTRY        — derived here, deterministically, from documents.
//      Only verified+posted payments and approved refund credits produce
//      entries, so the ledger changes exactly when the verification workflow
//      says money is real. Entries change the counterparty balance.
//   3. ALLOCATION          — stored records (the `allocations` collection)
//      that explain WHICH payment/credit settled WHICH ticket. Allocations
//      NEVER change a balance.
//
// Sign convention (customer/agent receivable ledger):
//   DEBIT  increases what the counterparty owes FlyForSure.
//   CREDIT reduces it. A negative running balance means FlyForSure owes the
//   counterparty (displayed as "Credit", never as a negative balance).
// Supplier ledger uses the same columns with business-friendly meaning:
//   DEBIT = charge (increases payable), CREDIT = payment/credit (reduces it).
//
// This module is dependency-light (only paymentVerification.js) so it can be
// unit-tested with plain `node --test`.

import {
  isCustomerLedgerPayment,
  isPostedPayment,
  isSupplierPayment,
  getLedgerPostingStatus,
} from './paymentVerification.js';
import { bookingPnrAliases, stableBookingRef } from './bookingIdentity.js';

export function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function token(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizePnr(value = '') {
  return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function round2(value) {
  return Math.round(numeric(value) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const COUNTERPARTY_TYPES = ['CUSTOMER', 'AGENT', 'SUPPLIER'];

export const OPEN_ITEM_STATUSES = [
  'OPEN',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
  'DISPUTED',
  'ON_HOLD',
  'WRITTEN_OFF',
  'CLOSED',
];

export const ALLOCATION_TYPES = [
  'PAYMENT_TO_TICKET',
  'PAYMENT_TO_PNR',
  'REFUND_CREDIT_TO_TICKET',
  'AMENDMENT_CREDIT_TO_TICKET',
  'CREDIT_NOTE_TO_TICKET',
  'SUPPLIER_PAYMENT_TO_TICKET',
  'ACM_TO_PAYABLE',
  'MANUAL_ALLOCATION',
];

export const ALLOCATION_MODES = [
  ['OLDEST_FIRST', 'Auto allocate — oldest first'],
  ['DUE_DATE_FIRST', 'Auto allocate — due date first'],
  ['MANUAL', 'Manual ticket selection'],
];

export const REFUND_CASE_STATUSES = [
  'REQUESTED',
  'IN_PROCESS',
  'APPROVED',
  'PARTIALLY_SETTLED',
  'SETTLED',
  'REJECTED',
  'CANCELLED',
];

// Amendment cases (booking servicing spec §3–§7). Date changes post at the
// finalized COMPLETED milestone; other servicing cases continue at CONFIRMED.
export const AMENDMENT_TYPES = [
  'DATE_CHANGE',
  'OUTBOUND_DATE_CHANGE',
  'INBOUND_DATE_CHANGE',
  'BOTH_DATE_CHANGE',
  'NAME_CORRECTION',
  'NAME_CHANGE',
  'ROUTE_CHANGE',
  'CABIN_CHANGE',
  'BAGGAGE_CHANGE',
  'OTHER',
];

export const AMENDMENT_CASE_STATUSES = [
  'DRAFT',
  'QUOTE_PENDING',
  'QUOTED',
  'CUSTOMER_APPROVED',
  'REJECTED',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
];

// Cancellation cases (spec §8–§13). A cancellation case NEVER posts to the
// ledger — it records what/why and may spawn a refund case for review.
export const CANCELLATION_SCOPES = [
  ['ENTIRE_BOOKING', 'Entire booking'],
  ['SELECTED_PASSENGERS', 'Select passengers'],
  ['SELECTED_TICKETS', 'Select tickets'],
  ['SELECTED_SEGMENTS', 'Select travel direction'],
];

export const CANCELLATION_CATEGORIES = [
  'VOLUNTARY',
  'INVOLUNTARY_AIRLINE_CANCEL',
  'NO_SHOW',
  'MEDICAL',
  'DEATH',
  'TAX_ONLY',
  'DUPLICATE_BOOKING',
  'VISA_REJECTION',
  'SCHEDULE_CHANGE',
  'OTHER',
];

export const CANCELLATION_CASE_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'CONFIRMED',
  'COMPLETED',
  'REJECTED',
  'REVERSED',
];

// Legacy refund lifecycle -> refund case lifecycle.
const LEGACY_REFUND_STATUS_MAP = {
  TO_APPLY: 'REQUESTED',
  APPLIED: 'REQUESTED',
  IN_PROCESS: 'IN_PROCESS',
  RCVD_FROM_SUPPLIER: 'IN_PROCESS',
  REJECTED: 'REJECTED',
  REFUNDED_TO_CLIENT: 'SETTLED',
};

// ---------------------------------------------------------------------------
// Counterparty resolution
// ---------------------------------------------------------------------------

export function accountId(type, name) {
  return `${type}:${token(name)}`;
}

// Receivable-side counterparty of a booking row. The bill-to fields are the
// commercial counterparty; booked_by/agent_issued_by are internal operators.
export function bookingCounterparty(booking = {}) {
  const billToType = String(booking.bill_to_type || '').toUpperCase();
  const billToName = String(booking.bill_to_name || '').trim();

  if (billToType === 'AGENT' && billToName) {
    return { type: 'AGENT', name: billToName, key: accountId('AGENT', billToName) };
  }
  if (billToType === 'CUSTOMER' && billToName) {
    return { type: 'CUSTOMER', name: billToName, key: accountId('CUSTOMER', billToName) };
  }

  const agentName = booking.agent_id || '';
  if (agentName) return { type: 'AGENT', name: String(agentName), key: accountId('AGENT', agentName) };
  const name = billToName || booking.passenger_name || 'Walk-in customer';
  return { type: 'CUSTOMER', name: String(name), key: accountId('CUSTOMER', name) };
}

// Supplier cost groups for a booking: one payable per distinct supplier.
export function bookingSupplierCosts(booking = {}) {
  const segments = Array.isArray(booking.supplier_segments) ? booking.supplier_segments : [];
  const groups = new Map();
  segments.forEach((segment) => {
    const name = segment.supplier_name || segment.supplier_id;
    if (!name || !numeric(segment.buying_price)) return;
    const key = token(name);
    if (!groups.has(key)) groups.set(key, { name: String(name), amount: 0 });
    groups.get(key).amount += numeric(segment.buying_price);
  });
  if (groups.size > 0) {
    return [...groups.values()].map((group) => ({ ...group, amount: round2(group.amount) }));
  }
  const fallback = booking.supplier_name || booking.supplier || booking.supplier_id || booking.airline;
  if (!fallback || !numeric(booking.fare_issued)) return [];
  return [{ name: String(fallback), amount: numeric(booking.fare_issued) }];
}

// Counterparty of a payment. Stable booking identity and PNR/ticket aliases
// keep it on the ticket account; explicit party fields are the fallback for
// account-level payments.
export function paymentCounterparty(payment = {}, bookingsByPnr = new Map(), bookingIndexes = null) {
  if (isSupplierPayment(payment)) {
    const name = payment.supplier_name || payment.supplier_id || payment.party_name || 'Unknown supplier';
    return { type: 'SUPPLIER', name: String(name), key: accountId('SUPPLIER', name) };
  }
  const indexes = bookingIndexes || bookingsByPnr.bookingIndexes;
  const related = indexes
    ? bookingsForRecord(payment, indexes)
    : (bookingsByPnr.get(normalizePnr(payment.pnr)) || []);
  if (related.length) return bookingCounterparty(related[0]);
  if (payment.party_name) {
    const type = payment.party_type === 'AGENT' ? 'AGENT' : 'CUSTOMER';
    return { type, name: String(payment.party_name), key: accountId(type, payment.party_name) };
  }
  const name = payment.passenger_name || 'Unassigned payments';
  return { type: 'CUSTOMER', name: String(name), key: accountId('CUSTOMER', name) };
}

// ---------------------------------------------------------------------------
// Refund cases
// ---------------------------------------------------------------------------

export function refundCaseStatus(refund = {}) {
  const status = refund.refund_status || 'REQUESTED';
  if (REFUND_CASE_STATUSES.includes(status)) return status;
  return LEGACY_REFUND_STATUS_MAP[status] || 'REQUESTED';
}

// A refund case created before this workflow existed (single "refunded"
// transaction). Its credit and payout are treated as settled together so
// historical balances stay unchanged.
export function isLegacyRefund(refund = {}) {
  return !refund.refund_number;
}

export function isRefundCreditPosted(refund = {}) {
  return ['APPROVED', 'PARTIALLY_SETTLED', 'SETTLED'].includes(refundCaseStatus(refund));
}

// NET REFUND CREDIT = gross - airline fee - FlyForSure fee - agent markup
// - processing fee - other deductions +/- approved adjustment. Never below
// zero — anything owed on top must be a separate charge, not a negative
// refund (spec §33).
export function netRefundCredit(refund = {}) {
  if (refund.net_refund_credit !== undefined && refund.net_refund_credit !== null && refund.net_refund_credit !== '') {
    return numeric(refund.net_refund_credit);
  }
  const gross = numeric(refund.gross_refund_amount ?? refund.fare_sold);
  return Math.max(0, round2(
    gross
    - numeric(refund.airline_cancellation_fee ?? refund.airline_penalty)
    - numeric(refund.flyforsure_cancellation_fee ?? refund.service_fee)
    - numeric(refund.agent_cancellation_markup)
    - numeric(refund.processing_fee)
    - numeric(refund.other_deductions)
    + numeric(refund.adjustment_amount),
  ));
}

// TOTAL AMENDMENT FINANCIAL IMPACT = fare difference (may be negative)
// + supplier change fee + FlyForSure service fee + agent markup
// + tax difference + other charges. Positive = counterparty owes more,
// negative = amendment credit.
export function amendmentTotalImpact(amendment = {}) {
  return round2(
    numeric(amendment.fare_difference)
    + numeric(amendment.supplier_change_fee)
    + numeric(amendment.flyforsure_service_fee)
    + numeric(amendment.agent_markup)
    + numeric(amendment.tax_difference)
    + numeric(amendment.other_charges),
  );
}

export function isAmendmentPosted(amendment = {}) {
  if (amendment.amendment_type === 'DATE_CHANGE') return amendment.status === 'COMPLETED';
  return ['CONFIRMED', 'COMPLETED'].includes(amendment.status);
}

// Cancellation financial estimate (spec §10). Estimates only — no posting.
export function cancellationEstimate(cancellation = {}) {
  const deductions = round2(
    numeric(cancellation.estimated_airline_fee)
    + numeric(cancellation.estimated_flyforsure_fee)
    + numeric(cancellation.estimated_agent_markup)
    + numeric(cancellation.estimated_processing_fee)
    + numeric(cancellation.estimated_other_deduction),
  );
  return {
    deductions,
    expectedRefundCredit: Math.max(0, round2(numeric(cancellation.estimated_gross_refund) - deductions)),
  };
}

export function nextRefundNumber(refunds = []) {
  const highest = refunds.reduce((max, refund) => {
    const match = String(refund.refund_number || '').match(/^REF-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `REF-${String(highest + 1).padStart(6, '0')}`;
}

export function nextAllocationNumber(allocations = []) {
  const highest = allocations.reduce((max, allocation) => {
    const match = String(allocation.allocation_number || '').match(/^ALC-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `ALC-${String(highest + 1).padStart(6, '0')}`;
}

export function nextAmendmentNumber(amendments = []) {
  const highest = amendments.reduce((max, amendment) => {
    const match = String(amendment.amendment_number || '').match(/^AMD-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `AMD-${String(highest + 1).padStart(6, '0')}`;
}

export function nextCancellationNumber(cancellations = []) {
  const highest = cancellations.reduce((max, cancellation) => {
    const match = String(cancellation.cancellation_number || '').match(/^CAN-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `CAN-${String(highest + 1).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Allocation records
// ---------------------------------------------------------------------------

export function isActiveAllocation(allocation = {}) {
  return allocation.status !== 'REVERSED';
}

export function allocationsForSource(allocations = [], sourceType, sourceId) {
  return allocations.filter((allocation) => (
    isActiveAllocation(allocation)
    && allocation.source_type === sourceType
    && String(allocation.source_id) === String(sourceId)
  ));
}

export function allocationsForTarget(allocations = [], targetId) {
  return allocations.filter((allocation) => (
    isActiveAllocation(allocation) && String(allocation.target_id) === String(targetId)
  ));
}

function sumAmounts(records) {
  return round2(records.reduce((sum, record) => sum + numeric(record.amount ?? record.allocation_amount), 0));
}

// Legacy supplier payments carry inline supplier_allocations. They keep
// counting toward supplier open items so historical reconciliation survives.
function legacyInlineSupplierAllocated(booking, supplierName, payments) {
  const pnr = normalizePnr(booking.pnr);
  const supplierKey = token(supplierName);
  return round2(payments.reduce((sum, payment) => {
    if (!isSupplierPayment(payment) || !isPostedPayment(payment)) return sum;
    const inline = Array.isArray(payment.supplier_allocations) ? payment.supplier_allocations : [];
    return sum + inline.reduce((inner, line) => {
      const matchesSupplier = token(line.supplier_name || line.supplier_id) === supplierKey;
      const matchesPnr = !line.pnr || normalizePnr(line.pnr) === pnr;
      return matchesSupplier && matchesPnr ? inner + numeric(line.amount_paid) : inner;
    }, 0);
  }, 0));
}

// ---------------------------------------------------------------------------
// The finance model: accounts -> ledger entries + open items + summaries
// ---------------------------------------------------------------------------

function bookingIssueDate(booking = {}) {
  return booking.booking_date || (booking.created_at ? String(booking.created_at).slice(0, 10) : '') || '';
}

function bookingDueDate(booking = {}) {
  return booking.payment_due_date || booking.outbound_date || bookingIssueDate(booking);
}

export function ticketOpenItemId(booking = {}) {
  return `ticket:${booking.id}`;
}

export function refundOpenItemId(refund = {}) {
  return `refund:${refund.id}`;
}

export function supplierOpenItemId(booking = {}, supplierName = '') {
  return `sticket:${booking.id}:${token(supplierName)}`;
}

export function amendmentOpenItemId(amendment = {}) {
  return `amendment:${amendment.id}`;
}

function newAccount(party) {
  return {
    key: party.key,
    type: party.type,
    name: party.name,
    bookings: [],
    payments: [],
    refunds: [],
    amendments: [], // [{ amendment, booking }]
    supplierCosts: [], // supplier accounts: [{ booking, name, amount }]
  };
}

function ensureAccount(accounts, party) {
  if (!accounts.has(party.key)) accounts.set(party.key, newAccount(party));
  return accounts.get(party.key);
}

export function groupBookingsByPnr(bookings = []) {
  const map = new Map();
  bookings.forEach((booking) => {
    bookingPnrAliases(booking).forEach((pnr) => addBookingToIndex(map, pnr, booking));
  });
  return map;
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

function buildBookingIndexes(bookings, bookingsByPnr) {
  const byRef = new Map();
  const byId = new Map();
  const byTicket = new Map();

  bookings.forEach((booking) => {
    addBookingToIndex(byRef, token(stableBookingRef(booking)), booking);
    if (booking.id !== undefined && booking.id !== null) byId.set(String(booking.id), booking);
    if (booking.ticket_no) byTicket.set(token(booking.ticket_no), booking);
  });

  const indexes = { byRef, byId, byPnr: bookingsByPnr, byTicket };
  // paymentCounterparty is also used by the Payments page with only the PNR
  // map, so keep the stable indexes alongside that public map.
  bookingsByPnr.bookingIndexes = indexes;
  return indexes;
}

function exactBookingForRecord(record = {}, rows = []) {
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

function bookingsForRecord(record = {}, indexes) {
  const stableRef = token(record.booking_ref);
  if (stableRef) {
    const stableRows = indexes.byRef.get(stableRef);
    if (!stableRows?.length) return [];
    const exact = exactBookingForRecord(record, stableRows);
    if (exact) return [exact];
    return stableRows.length === 1 ? stableRows : [];
  }

  const byId = record.booking_id === undefined || record.booking_id === null
    ? null
    : indexes.byId.get(String(record.booking_id));
  if (byId) return [byId];

  const ticket = record.ticket_no || record.ticket_id;
  const byTicket = ticket ? indexes.byTicket.get(token(ticket)) : null;
  if (byTicket) return [byTicket];

  const byPnr = indexes.byPnr.get(normalizePnr(record.pnr));
  if (!byPnr?.length) return [];
  const exact = exactBookingForRecord(record, byPnr);
  return exact ? [exact] : [];
}

// Posted refund payouts for a refund case: OUTGOING payments explicitly
// linked with refund_id. The payout->credit allocation is implicit through
// that link, so it can never disagree with the payment record.
function postedPayoutsForRefund(refund, payments) {
  return payments.filter((payment) => (
    payment.payment_type === 'REFUND_PAYOUT'
    && String(payment.refund_id) === String(refund.id)
    && isPostedPayment(payment)
  ));
}

export function buildFinanceModel({ bookings = [], payments = [], refunds = [], allocations = [], amendments = [] } = {}) {
  const bookingsByPnr = groupBookingsByPnr(bookings);
  const bookingsByTicket = new Map(bookings.filter((b) => b.ticket_no).map((b) => [token(b.ticket_no), b]));
  const bookingIndexes = buildBookingIndexes(bookings, bookingsByPnr);
  const accounts = new Map();

  bookings.forEach((booking) => {
    ensureAccount(accounts, bookingCounterparty(booking)).bookings.push(booking);
    bookingSupplierCosts(booking).forEach((cost) => {
      const party = { type: 'SUPPLIER', name: cost.name, key: accountId('SUPPLIER', cost.name) };
      ensureAccount(accounts, party).supplierCosts.push({ booking, name: cost.name, amount: cost.amount });
    });
  });

  payments.forEach((payment) => {
    ensureAccount(accounts, paymentCounterparty(payment, bookingsByPnr, bookingIndexes)).payments.push(payment);
  });

  refunds.forEach((refund) => {
    const booking = bookingsForRecord(refund, bookingIndexes)[0];
    const party = booking ? bookingCounterparty(booking) : null;
    const enriched = { refund, booking };
    if (party) ensureAccount(accounts, party).refunds.push(enriched);
    // Supplier refunds also touch the supplier account of the same booking.
    if (booking && numeric(refund.supplier_refund) > 0) {
      bookingSupplierCosts(booking).forEach((cost) => {
        const supplierParty = { type: 'SUPPLIER', name: cost.name, key: accountId('SUPPLIER', cost.name) };
        const account = ensureAccount(accounts, supplierParty);
        if (!account.refunds.some((entry) => entry.refund.id === refund.id)) {
          account.refunds.push(enriched);
        }
      });
    }
  });

  // Amendment cases land on the same receivable account as their booking.
  amendments.forEach((amendment) => {
    const booking = bookingsForRecord(amendment, bookingIndexes)[0];
    if (!booking) return;
    ensureAccount(accounts, bookingCounterparty(booking)).amendments.push({ amendment, booking });
  });

  const model = {
    accounts,
    bookingsByPnr,
    bookingsByTicket,
    payments,
    refunds,
    amendments,
    paymentsById: new Map(payments.map((payment) => [String(payment.id), payment])),
    refundsById: new Map(refunds.map((refund) => [String(refund.id), refund])),
    amendmentsById: new Map(amendments.map((amendment) => [String(amendment.id), amendment])),
    allocations: [],
    accountList: [],
  };
  // Reversing or un-verifying a source document automatically reopens the
  // open items it had settled: its allocations stop counting.
  model.allocations = allocations.filter((allocation) => isAllocationEffective(allocation, model));
  model.allAllocations = allocations;
  model.accountList = [...accounts.values()].map((account) => summarizeAccount(account, model));
  return model;
}

export function isAllocationEffective(allocation, model) {
  if (!isActiveAllocation(allocation)) return false;
  if (allocation.source_type === 'PAYMENT') {
    const payment = model.paymentsById.get(String(allocation.source_id));
    return Boolean(payment) && isPostedPayment(payment);
  }
  if (allocation.source_type === 'REFUND_CREDIT') {
    const refund = model.refundsById.get(String(allocation.source_id));
    return Boolean(refund) && isRefundCreditPosted(refund);
  }
  if (allocation.source_type === 'AMENDMENT_CREDIT') {
    const amendment = model.amendmentsById.get(String(allocation.source_id));
    return Boolean(amendment) && isAmendmentPosted(amendment);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Open items
// ---------------------------------------------------------------------------

export function getAccountOpenItems(account, model) {
  const { allocations, payments } = model;
  const today = new Date().toISOString().slice(0, 10);

  if (account.type === 'SUPPLIER') {
    return account.supplierCosts.map(({ booking, name, amount }) => {
      const id = supplierOpenItemId(booking, name);
      const allocated = round2(
        sumAmounts(allocationsForTarget(allocations, id))
        + legacyInlineSupplierAllocated(booking, name, payments),
      );
      const outstanding = Math.max(0, round2(amount - allocated));
      return {
        open_item_id: id,
        item_type: 'TICKET_PAYABLE',
        side: 'DEBIT',
        booking_id: booking.id,
        pnr: normalizePnr(booking.pnr),
        ticket_no: booking.ticket_no || '',
        passenger_name: booking.passenger_name || '',
        issue_date: bookingIssueDate(booking),
        due_date: bookingDueDate(booking),
        original_amount: amount,
        payment_allocated: allocated,
        credit_allocated: 0,
        allocated_amount: allocated,
        outstanding_amount: outstanding,
        reconciliation_status: outstanding <= 0 ? 'FULLY_ALLOCATED' : allocated > 0 ? 'PARTIALLY_ALLOCATED' : 'OPEN',
        days_overdue: 0,
      };
    });
  }

  const ticketItems = account.bookings
    .filter((booking) => numeric(booking.fare_sold) > 0)
    .map((booking) => {
      const id = ticketOpenItemId(booking);
      const targetAllocations = allocationsForTarget(allocations, id);
      const paymentAllocated = sumAmounts(targetAllocations.filter((a) => a.source_type === 'PAYMENT'));
      const creditAllocated = sumAmounts(targetAllocations.filter((a) => a.source_type !== 'PAYMENT'));
      const original = numeric(booking.fare_sold);
      const allocated = round2(paymentAllocated + creditAllocated);
      const outstanding = Math.max(0, round2(original - allocated));
      const dueDate = bookingDueDate(booking);
      const overdue = outstanding > 0 && dueDate && dueDate < today
        ? Math.round((new Date(today) - new Date(dueDate)) / 86400000)
        : 0;
      return {
        open_item_id: id,
        item_type: 'TICKET_RECEIVABLE',
        side: 'DEBIT',
        booking_id: booking.id,
        pnr: normalizePnr(booking.pnr),
        ticket_no: booking.ticket_no || '',
        passenger_name: booking.passenger_name || '',
        issue_date: bookingIssueDate(booking),
        due_date: dueDate,
        original_amount: original,
        payment_allocated: paymentAllocated,
        credit_allocated: creditAllocated,
        allocated_amount: allocated,
        outstanding_amount: outstanding,
        reconciliation_status: outstanding <= 0 ? 'FULLY_ALLOCATED' : allocated > 0 ? 'PARTIALLY_ALLOCATED' : 'OPEN',
        days_overdue: overdue,
      };
    });

  const refundItems = account.refunds
    .filter(({ refund }) => isRefundCreditPosted(refund))
    .map(({ refund, booking }) => {
      const summary = refundCreditSummary(refund, model, booking);
      return {
        open_item_id: refundOpenItemId(refund),
        item_type: 'REFUND_CREDIT',
        side: 'CREDIT',
        refund_id: refund.id,
        refund_number: refund.refund_number || '',
        booking_id: booking?.id || null,
        pnr: normalizePnr(refund.pnr || booking?.pnr),
        ticket_no: refund.ticket_no || '',
        passenger_name: refund.passenger_name || booking?.passenger_name || '',
        issue_date: refund.approved_at ? String(refund.approved_at).slice(0, 10) : refund.status_date || '',
        due_date: '',
        original_amount: summary.credit,
        payment_allocated: summary.paid_out,
        credit_allocated: round2(summary.used_original + summary.used_future),
        allocated_amount: round2(summary.credit - summary.available),
        outstanding_amount: summary.available,
        reconciliation_status: summary.available <= 0 ? 'CLOSED' : summary.available < summary.credit ? 'PARTIALLY_ALLOCATED' : 'OPEN',
        days_overdue: 0,
      };
    });

  // Posted amendment cases: positive impact = receivable open item, negative
  // impact = credit open item. A posted amendment with zero impact adds
  // nothing (spec §6).
  const amendmentItems = account.amendments
    .filter(({ amendment }) => isAmendmentPosted(amendment) && amendmentTotalImpact(amendment) !== 0)
    .map(({ amendment, booking }) => {
      const total = amendmentTotalImpact(amendment);
      const id = amendmentOpenItemId(amendment);
      const issueDate = amendmentPostingDate(amendment);
      const base = {
        open_item_id: id,
        amendment_id: amendment.id,
        amendment_number: amendment.amendment_number || '',
        booking_id: booking?.id || null,
        pnr: normalizePnr(amendment.pnr || booking?.pnr),
        ticket_no: amendment.ticket_no || booking?.ticket_no || '',
        passenger_name: amendment.passenger_name || booking?.passenger_name || '',
        issue_date: issueDate,
        days_overdue: 0,
      };
      if (total > 0) {
        const allocated = sumAmounts(allocationsForTarget(allocations, id));
        const outstanding = Math.max(0, round2(total - allocated));
        return {
          ...base,
          item_type: 'AMENDMENT_RECEIVABLE',
          side: 'DEBIT',
          due_date: issueDate,
          original_amount: total,
          payment_allocated: allocated,
          credit_allocated: 0,
          allocated_amount: allocated,
          outstanding_amount: outstanding,
          reconciliation_status: outstanding <= 0 ? 'FULLY_ALLOCATED' : allocated > 0 ? 'PARTIALLY_ALLOCATED' : 'OPEN',
        };
      }
      const credit = round2(-total);
      const used = sumAmounts(allocationsForSource(allocations, 'AMENDMENT_CREDIT', amendment.id));
      const available = Math.max(0, round2(credit - used));
      return {
        ...base,
        item_type: 'AMENDMENT_CREDIT',
        side: 'CREDIT',
        due_date: '',
        original_amount: credit,
        payment_allocated: 0,
        credit_allocated: used,
        allocated_amount: used,
        outstanding_amount: available,
        reconciliation_status: available <= 0 ? 'CLOSED' : available < credit ? 'PARTIALLY_ALLOCATED' : 'OPEN',
      };
    });

  return [...ticketItems, ...refundItems, ...amendmentItems];
}

function amendmentPostingDate(amendment = {}) {
  const stamp = amendment.amendment_type === 'DATE_CHANGE'
    ? amendment.finalized_at || amendment.completed_at || amendment.confirmed_at
      || amendment.approved_at || amendment.updated_at || amendment.created_at
    : amendment.confirmed_at || amendment.approved_at || amendment.updated_at || amendment.created_at;
  return stamp ? String(stamp).slice(0, 10) : '';
}

// ---------------------------------------------------------------------------
// Ledger entries with running balance
// ---------------------------------------------------------------------------

function entrySortKey(entry) {
  return `${entry.entry_date || '9999-99-99'}|${entry.sequence}`;
}

export function getAccountLedger(account) {
  const entries = [];
  let sequence = 0;
  const push = (entry) => entries.push({ ...entry, sequence: sequence += 1 });

  if (account.type === 'SUPPLIER') {
    account.supplierCosts.forEach(({ booking, name, amount }) => {
      push({
        entry_type: 'TICKET_COST',
        entry_date: bookingIssueDate(booking),
        reference_type: 'BOOKING',
        reference_id: booking.id,
        pnr: normalizePnr(booking.pnr),
        ticket_no: booking.ticket_no || '',
        description: `Ticket cost — ${booking.passenger_name || booking.pnr || name}`,
        debit: amount,
        credit: 0,
        posting_status: 'POSTED',
      });
    });
    account.payments.forEach((payment) => {
      pushPaymentEntries(push, payment, 'PAYMENT_SENT', 'CREDIT');
    });
    account.refunds.forEach(({ refund, booking }) => {
      if (!supplierRefundCounted(refund)) return;
      push({
        entry_type: 'SUPPLIER_REFUND',
        entry_date: refund.status_date || refund.cancel_date || '',
        reference_type: 'REFUND',
        reference_id: refund.id,
        pnr: normalizePnr(refund.pnr || booking?.pnr),
        ticket_no: refund.ticket_no || '',
        description: `Supplier refund — ${refund.ticket_no || refund.pnr || ''}`,
        debit: 0,
        credit: numeric(refund.supplier_refund),
        posting_status: 'POSTED',
      });
    });
  } else {
    account.bookings.forEach((booking) => {
      if (numeric(booking.fare_sold) <= 0) return;
      push({
        entry_type: 'TICKET_SALE',
        entry_date: bookingIssueDate(booking),
        reference_type: 'BOOKING',
        reference_id: booking.id,
        pnr: normalizePnr(booking.pnr),
        ticket_no: booking.ticket_no || '',
        description: `Ticket sale — ${booking.passenger_name || booking.pnr || ''}`,
        debit: numeric(booking.fare_sold),
        credit: 0,
        posting_status: 'POSTED',
      });
    });

    account.payments.forEach((payment) => {
      const incoming = isCustomerLedgerPayment(payment);
      const isPayout = payment.payment_type === 'REFUND_PAYOUT';
      if (incoming) {
        pushPaymentEntries(push, payment, 'PAYMENT_RECEIVED', 'CREDIT');
      } else {
        // Money going out to the counterparty: refund payout or generic
        // outgoing payment. Both are debits on the receivable ledger.
        pushPaymentEntries(push, payment, isPayout ? 'REFUND_PAYOUT' : 'PAYMENT_SENT', 'DEBIT');
      }
    });

    // Posted amendment cases: positive impact debits the counterparty
    // (AMENDMENT_CHARGE), negative impact credits it (AMENDMENT_CREDIT).
    account.amendments.forEach(({ amendment, booking }) => {
      if (!isAmendmentPosted(amendment)) return;
      const total = amendmentTotalImpact(amendment);
      if (total === 0) return;
      push({
        entry_type: total > 0 ? 'AMENDMENT_CHARGE' : 'AMENDMENT_CREDIT',
        entry_date: amendmentPostingDate(amendment),
        reference_type: 'AMENDMENT',
        reference_id: amendment.id,
        pnr: normalizePnr(amendment.pnr || booking?.pnr),
        ticket_no: amendment.ticket_no || booking?.ticket_no || '',
        description: `Amendment ${total > 0 ? 'charge' : 'credit'} ${amendment.amendment_number || ''} — ${String(amendment.amendment_type || '').replace(/_/g, ' ').toLowerCase()}`.trim(),
        debit: total > 0 ? total : 0,
        credit: total > 0 ? 0 : round2(-total),
        posting_status: 'POSTED',
      });
    });

    account.refunds.forEach(({ refund, booking }) => {
      if (!isRefundCreditPosted(refund)) return;
      const credit = netRefundCredit(refund);
      if (credit <= 0) return;
      const date = refund.approved_at ? String(refund.approved_at).slice(0, 10) : refund.status_date || refund.cancel_date || '';
      push({
        entry_type: 'REFUND_CREDIT',
        entry_date: date,
        reference_type: 'REFUND',
        reference_id: refund.id,
        pnr: normalizePnr(refund.pnr || booking?.pnr),
        ticket_no: refund.ticket_no || '',
        description: `Refund credit ${refund.refund_number || ''} — ${refund.passenger_name || refund.ticket_no || ''}`.trim(),
        debit: 0,
        credit,
        posting_status: 'POSTED',
      });
      // Legacy one-shot refunds settle credit and payout together so
      // historical balances are unchanged.
      if (isLegacyRefund(refund) && refundCaseStatus(refund) === 'SETTLED') {
        push({
          entry_type: 'REFUND_PAYOUT',
          entry_date: date,
          reference_type: 'REFUND',
          reference_id: refund.id,
          pnr: normalizePnr(refund.pnr || booking?.pnr),
          ticket_no: refund.ticket_no || '',
          description: `Refund paid to client — ${refund.ticket_no || ''}`.trim(),
          debit: credit,
          credit: 0,
          posting_status: 'POSTED',
        });
      }
    });
  }

  const sorted = entries.sort((a, b) => entrySortKey(a).localeCompare(entrySortKey(b), undefined, { numeric: true }));
  let balance = 0;
  return sorted.map((entry, index) => {
    balance = round2(balance + numeric(entry.debit) - numeric(entry.credit));
    return {
      ...entry,
      entry_no: `LED-${String(index + 1).padStart(5, '0')}`,
      running_balance: balance,
    };
  });
}

// A payment produces its posted entry; a payment that was posted and later
// reversed (chargeback, bounced after clearing) produces the entry AND a
// reversal entry so the audit history stays visible. Never-posted payments
// produce nothing.
function pushPaymentEntries(push, payment, entryType, side) {
  const posted = isPostedPayment(payment);
  const reversed = getLedgerPostingStatus(payment) === 'REVERSED' && payment.verified_at;
  if (!posted && !reversed) return;
  const amount = numeric(payment.amount_paid);
  const reference = payment.payment_reference || payment.receipt_ref || payment.id;
  const base = {
    entry_type: entryType,
    entry_date: payment.payment_date || '',
    reference_type: 'PAYMENT',
    reference_id: payment.id,
    pnr: normalizePnr(payment.pnr),
    ticket_no: payment.ticket_no || '',
    description: `${entryType === 'PAYMENT_SENT' ? 'Payment sent' : entryType === 'REFUND_PAYOUT' ? 'Refund payout' : 'Payment received'} ${reference} — ${String(payment.payment_method || payment.payment_mode || '').replace(/_/g, ' ')}`.trim(),
    debit: side === 'DEBIT' ? amount : 0,
    credit: side === 'CREDIT' ? amount : 0,
    posting_status: reversed ? 'REVERSED' : 'POSTED',
  };
  push(base);
  if (reversed) {
    push({
      ...base,
      entry_type: `${entryType}_REVERSAL`,
      description: `Reversal of ${reference} — ${payment.settlement_status || payment.payment_status || payment.cheque_status || 'reversed'}`,
      debit: base.credit,
      credit: base.debit,
      posting_status: 'POSTED',
      reversal_of_reference_id: payment.id,
    });
  }
}

function supplierRefundCounted(refund = {}) {
  if (numeric(refund.supplier_refund) <= 0) return false;
  if (refund.supplier_refund_received) return true;
  return ['RCVD_FROM_SUPPLIER', 'REFUNDED_TO_CLIENT'].includes(refund.refund_status);
}

// ---------------------------------------------------------------------------
// Payment + refund credit summaries
// ---------------------------------------------------------------------------

export function paymentAllocationSummary(payment, model) {
  const amount = numeric(payment.amount_paid);
  let allocated = sumAmounts(allocationsForSource(model.allocations, 'PAYMENT', payment.id));
  // Legacy supplier payments with inline allocation lines.
  if (isSupplierPayment(payment) && Array.isArray(payment.supplier_allocations)) {
    allocated = round2(allocated + payment.supplier_allocations.reduce((sum, line) => sum + numeric(line.amount_paid), 0));
  }
  // A refund payout is implicitly fully allocated against its refund credit.
  if (payment.payment_type === 'REFUND_PAYOUT' && payment.refund_id) allocated = amount;
  const unallocated = Math.max(0, round2(amount - allocated));
  return {
    amount,
    allocated: round2(allocated),
    unallocated,
    allocation_status: !isPostedPayment(payment) ? 'NOT_POSTED'
      : allocated <= 0 ? 'UNALLOCATED'
        : unallocated > 0 ? 'PARTIALLY_ALLOCATED'
          : 'FULLY_ALLOCATED',
  };
}

// Bookings whose ticket receivables count as this refund's "original tickets":
// every per-ticket refund line (spec §29), plus the case-level ticket_no.
export function refundTargetBookings(refund = {}, model) {
  const ticketNos = new Set();
  (Array.isArray(refund.refund_lines) ? refund.refund_lines : []).forEach((line) => {
    if (line.ticket_no) ticketNos.add(token(line.ticket_no));
  });
  if (refund.ticket_no) ticketNos.add(token(refund.ticket_no));
  const bookings = [...ticketNos].map((t) => model.bookingsByTicket.get(t)).filter(Boolean);
  if (!bookings.length) {
    const fallback = (model.bookingsByPnr.get(normalizePnr(refund.pnr)) || [])[0];
    if (fallback) bookings.push(fallback);
  }
  return bookings;
}

// AGENT AVAILABLE CREDIT = original credit - used vs original ticket
// - used vs future tickets - payouts.
export function refundCreditSummary(refund, model, bookingHint = null) {
  const credit = netRefundCredit(refund);
  const targets = refundTargetBookings(refund, model);
  if (bookingHint && !targets.some((b) => String(b.id) === String(bookingHint.id))) targets.push(bookingHint);
  const originalTargetIds = new Set(targets.map((b) => ticketOpenItemId(b)));
  const sourceAllocations = allocationsForSource(model.allocations, 'REFUND_CREDIT', refund.id);
  const usedOriginal = sumAmounts(sourceAllocations.filter((a) => originalTargetIds.has(a.target_id)));
  const usedFuture = sumAmounts(sourceAllocations.filter((a) => !originalTargetIds.has(a.target_id)));
  let paidOut = round2(postedPayoutsForRefund(refund, model.payments).reduce((sum, p) => sum + numeric(p.amount_paid), 0));
  if (isLegacyRefund(refund) && refundCaseStatus(refund) === 'SETTLED') paidOut = credit;
  const available = Math.max(0, round2(credit - usedOriginal - usedFuture - paidOut));
  return {
    credit,
    used_original: usedOriginal,
    used_future: usedFuture,
    paid_out: paidOut,
    available,
    settlement_status: !isRefundCreditPosted(refund) ? refundCaseStatus(refund)
      : available <= 0 && credit > 0 ? 'SETTLED'
        : available < credit ? 'PARTIALLY_SETTLED'
          : 'APPROVED',
  };
}

// Preview of what approving a refund case will do (doc §40):
// offset against the original ticket first, remainder becomes account credit
// (agents) or payout due (customers).
export function refundSettlementPreview(refund, model) {
  const credit = netRefundCredit(refund);
  const bookings = refundTargetBookings(refund, model);
  const booking = bookings[0] || null;
  let originalOutstanding = 0;
  let openItems = [];
  if (booking) {
    const account = model.accounts.get(bookingCounterparty(booking).key);
    if (account) {
      const targetIds = new Set(bookings.map((b) => ticketOpenItemId(b)));
      openItems = getAccountOpenItems(account, model).filter((item) => targetIds.has(item.open_item_id));
      originalOutstanding = round2(openItems.reduce((sum, item) => sum + item.outstanding_amount, 0));
    }
  }
  const offset = Math.min(credit, originalOutstanding);
  const remaining = round2(credit - offset);
  const partyType = refund.refund_party_type || (booking ? bookingCounterparty(booking).type : 'CUSTOMER');
  return {
    credit,
    original_outstanding: originalOutstanding,
    original_offset: offset,
    remaining_credit: remaining,
    account_credit: partyType === 'AGENT' ? remaining : 0,
    payout_due: partyType === 'AGENT' ? 0 : remaining,
    party_type: partyType,
    booking,
    bookings,
    open_items: openItems,
  };
}

// ---------------------------------------------------------------------------
// Account summary + control check
// ---------------------------------------------------------------------------

export function summarizeAccount(account, model) {
  const ledger = getAccountLedger(account);
  const openItems = getAccountOpenItems(account, model);
  const balance = ledger.length ? ledger[ledger.length - 1].running_balance : 0;
  const debitItems = openItems.filter((item) => item.side === 'DEBIT');
  const creditItems = openItems.filter((item) => item.side === 'CREDIT');
  const openReceivable = round2(debitItems.reduce((sum, item) => sum + item.outstanding_amount, 0));
  const openCredit = round2(creditItems.reduce((sum, item) => sum + item.outstanding_amount, 0));
  const paymentSummaries = account.payments.map((payment) => ({
    payment,
    ...paymentAllocationSummary(payment, model),
  }));
  const unallocated = round2(paymentSummaries
    .filter((entry) => entry.allocation_status !== 'NOT_POSTED' && (account.type === 'SUPPLIER' ? isSupplierPayment(entry.payment) : isCustomerLedgerPayment(entry.payment)))
    .reduce((sum, entry) => sum + entry.unallocated, 0));
  const pendingVerification = account.payments.filter((payment) => (
    (payment.verification_status || 'VERIFIED') !== 'VERIFIED'
  )).length;

  return {
    ...account,
    ledger,
    openItems,
    paymentSummaries,
    balance,
    open_receivable: openReceivable,
    open_credit: openCredit,
    unallocated_payments: unallocated,
    open_ticket_count: debitItems.filter((item) => item.outstanding_amount > 0).length,
    overdue_ticket_count: debitItems.filter((item) => item.days_overdue > 0).length,
    refund_credit_available: round2(creditItems.reduce((sum, item) => sum + item.outstanding_amount, 0)),
    pending_verification_count: pendingVerification,
    control: controlCheck(balance, openReceivable, openCredit, unallocated),
  };
}

// GOLDEN CONTROL RULE: ledger net balance = open debit items - open credit
// items. Unallocated posted payments already reduced the ledger without
// touching open items, so they are the expected bridge; anything beyond that
// is a reconciliation error.
export function controlCheck(ledgerBalance, openDebit, openCredit, unallocatedPayments) {
  const openPosition = round2(openDebit - openCredit);
  const difference = round2(openPosition - unallocatedPayments - ledgerBalance);
  return {
    ledger_balance: round2(ledgerBalance),
    open_position: openPosition,
    unallocated_payments: round2(unallocatedPayments),
    difference,
    matched: Math.abs(difference) < 0.01,
  };
}

// Never display a negative balance: flip it into credit wording.
export function balanceDisplay(balance, type = 'CUSTOMER') {
  const amount = Math.abs(round2(balance));
  if (Math.abs(balance) < 0.01) return { direction: 'SETTLED', amount: 0, label: 'Settled' };
  if (type === 'SUPPLIER') {
    return balance > 0
      ? { direction: 'WE_OWE', amount, label: 'FlyForSure owes supplier' }
      : { direction: 'OWES_US', amount, label: 'Supplier owes FlyForSure' };
  }
  const party = type === 'AGENT' ? 'Agent' : 'Customer';
  return balance > 0
    ? { direction: 'OWES_US', amount, label: `${party} owes FlyForSure` }
    : { direction: 'WE_OWE', amount, label: `${party} credit` };
}

// ---------------------------------------------------------------------------
// Allocation building + validation
// ---------------------------------------------------------------------------

// Blocking problems for a proposed allocation of `lines` ([{open_item, amount}])
// from a source with `available` unallocated money/credit.
export function allocationProblems({ available, lines = [] }) {
  const problems = [];
  let total = 0;
  lines.forEach(({ open_item: item, amount }) => {
    const value = numeric(amount);
    if (value <= 0) {
      problems.push(`${item.ticket_no || item.pnr || item.open_item_id}: allocation amount must be greater than zero.`);
      return;
    }
    if (round2(value) > round2(item.outstanding_amount) + 0.001) {
      problems.push(`${item.ticket_no || item.pnr || item.open_item_id}: allocation ${value.toFixed(2)} exceeds outstanding ${item.outstanding_amount.toFixed(2)}.`);
    }
    total = round2(total + value);
  });
  if (total > round2(available) + 0.001) {
    problems.push(`Allocation exceeds unallocated amount by ${(total - available).toFixed(2)}.`);
  }
  if (!lines.length) problems.push('Select at least one open item to allocate.');
  return problems;
}

// Auto allocation: fill open debit items oldest-first (or by due date) until
// the available amount is used up.
export function buildAutoAllocation(available, openItems = [], mode = 'OLDEST_FIRST') {
  const sortKey = mode === 'DUE_DATE_FIRST' ? 'due_date' : 'issue_date';
  const candidates = openItems
    .filter((item) => item.side === 'DEBIT' && item.outstanding_amount > 0)
    .sort((a, b) => String(a[sortKey] || '9999').localeCompare(String(b[sortKey] || '9999')) || String(a.open_item_id).localeCompare(String(b.open_item_id)));
  const lines = [];
  let remaining = round2(available);
  for (const item of candidates) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, item.outstanding_amount);
    lines.push({ open_item: item, amount: round2(amount) });
    remaining = round2(remaining - amount);
  }
  return lines;
}

// Constructs the allocation records to persist. Pure — caller saves them.
export function buildAllocationRecords({ source, sourceType, account, lines, allocations = [], user = null, allocationType = null }) {
  let counter = 0;
  const startNumber = Number(nextAllocationNumber(allocations).slice(4));
  return lines.map(({ open_item: item, amount }) => ({
    id: crypto.randomUUID(),
    allocation_number: `ALC-${String(startNumber + counter++).padStart(6, '0')}`,
    source_type: sourceType,
    source_id: source.id,
    source_reference: sourceType === 'PAYMENT'
      ? (source.payment_reference || source.receipt_ref || source.id)
      : (source.refund_number || source.id),
    target_id: item.open_item_id,
    target_type: item.item_type,
    counterparty_type: account.type,
    counterparty_name: account.name,
    booking_id: item.booking_id || null,
    pnr: item.pnr || '',
    ticket_no: item.ticket_no || '',
    passenger_name: item.passenger_name || '',
    amount: round2(numeric(amount)),
    currency: source.transaction_currency || 'EUR',
    allocation_type: allocationType || (
      sourceType === 'REFUND_CREDIT' ? 'REFUND_CREDIT_TO_TICKET'
        : account.type === 'SUPPLIER' ? 'SUPPLIER_PAYMENT_TO_TICKET'
          : 'PAYMENT_TO_TICKET'
    ),
    status: 'ACTIVE',
    allocated_by: user?.name || user?.email || '',
    allocated_by_user_id: user?.id || null,
    allocated_at: new Date().toISOString(),
  }));
}

// Builds the outgoing refund payout payment document. It enters the normal
// payment verification queue; the ledger only moves once an admin verifies it.
export function buildRefundPayoutPayment({ refund, preview, amount, method = 'BANK_TRANSFER', user = null, payments = [] }) {
  const highest = payments.reduce((max, payment) => {
    const match = String(payment.payment_reference || '').match(/^PAY-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const partyType = preview.party_type;
  const partyName = preview.booking
    ? bookingCounterparty(preview.booking).name
    : (refund.passenger_name || '');
  return {
    id: crypto.randomUUID(),
    payment_date: new Date().toISOString().slice(0, 10),
    payment_direction: 'PAID',
    payment_type: 'REFUND_PAYOUT',
    refund_id: refund.id,
    refund_number: refund.refund_number || '',
    party_type: partyType,
    party_name: partyName,
    pnr: normalizePnr(refund.pnr),
    ticket_no: refund.ticket_no || '',
    passenger_name: refund.passenger_name || '',
    amount_paid: round2(numeric(amount)),
    transaction_amount: round2(numeric(amount)),
    transaction_currency: 'EUR',
    payment_mode: method,
    payment_method: method,
    payment_reference: `PAY-${String(highest + 1).padStart(6, '0')}`,
    verification_status: 'TO_BE_VERIFIED',
    ledger_posting_status: 'PENDING_VERIFICATION',
    received_by: user?.name || user?.email || '',
    remarks: `Refund payout for ${refund.refund_number || refund.ticket_no || refund.id}`,
  };
}
