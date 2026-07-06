import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountId,
  allocationProblems,
  amendmentTotalImpact,
  balanceDisplay,
  bookingCounterparty,
  cancellationEstimate,
  buildAutoAllocation,
  buildAllocationRecords,
  buildFinanceModel,
  netRefundCredit,
  paymentAllocationSummary,
  refundCreditSummary,
  refundSettlementPreview,
  ticketOpenItemId,
} from './ledger.js';

let ids = 0;
const uid = (prefix) => `${prefix}-${ids += 1}`;

function agentBooking({ fare = 800, pnr = 'ABC123', date = '2026-07-01', agent = 'ABC Travels', ticket = null } = {}) {
  const id = uid('bk');
  return {
    id,
    pnr,
    booking_date: date,
    bill_to_type: 'AGENT',
    bill_to_name: agent,
    booked_by: agent,
    passenger_name: 'DALJEET KAUR',
    ticket_no: ticket || `055${String(ids).padStart(7, '0')}`,
    fare_sold: fare,
    fare_issued: fare - 100,
  };
}

function verifiedPayment({ amount, pnr = '', date = '2026-07-03', party = 'ABC Travels', partyType = 'AGENT', extra = {} } = {}) {
  return {
    id: uid('pay'),
    payment_date: date,
    payment_direction: 'RECEIVED',
    party_type: partyType,
    party_name: party,
    pnr,
    amount_paid: amount,
    payment_mode: 'BANK_TRANSFER',
    payment_method: 'BANK_TRANSFER',
    payment_reference: `RCPT-${String(ids).padStart(6, '0')}`,
    verification_status: 'VERIFIED',
    verified_at: `${date}T10:00:00Z`,
    ...extra,
  };
}

function account(model, type, name) {
  return model.accountList.find((entry) => entry.key === accountId(type, name));
}

test('booking counterparty uses bill-to customer instead of internal operator', () => {
  const party = bookingCounterparty({
    passenger_name: 'RATTU/LOVEKIRAT',
    bill_to_type: 'CUSTOMER',
    bill_to_name: 'RATTU BALBIR',
    booked_by: 'Admin',
    agent_issued_by: 'Mohan',
  });

  assert.equal(party.type, 'CUSTOMER');
  assert.equal(party.name, 'RATTU BALBIR');
});

test('booking counterparty uses bill-to agent instead of staff booked_by', () => {
  const party = bookingCounterparty({
    passenger_name: 'KAUR/RAJWINDER',
    bill_to_type: 'AGENT',
    bill_to_name: 'Mamatha',
    booked_by: 'Baljeet',
    agent_issued_by: 'Baljeet',
  });

  assert.equal(party.type, 'AGENT');
  assert.equal(party.name, 'Mamatha');
});

// §10 — ticket issued: ledger entry + open item, control matched.
test('ticket issue creates receivable ledger entry and open item', () => {
  const booking = agentBooking({ fare: 800 });
  const model = buildFinanceModel({ bookings: [booking] });
  const agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, 800);
  assert.equal(agent.ledger.length, 1);
  assert.equal(agent.ledger[0].entry_type, 'TICKET_SALE');
  assert.equal(agent.openItems.length, 1);
  assert.equal(agent.openItems[0].outstanding_amount, 800);
  assert.equal(agent.openItems[0].reconciliation_status, 'OPEN');
  assert.equal(agent.control.matched, true);
});

// Unverified payments must not touch the ledger (§8, §36 PAY-002 rule).
test('unverified payment does not change the ledger balance', () => {
  const booking = agentBooking({ fare: 800 });
  const payment = verifiedPayment({ amount: 500, pnr: booking.pnr });
  payment.verification_status = 'TO_BE_VERIFIED';
  delete payment.verified_at;
  const model = buildFinanceModel({ bookings: [booking], payments: [payment] });
  const agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, 800);
  assert.equal(agent.ledger.length, 1);
  assert.equal(agent.pending_verification_count, 1);
});

// §12 — €5,000 payment for 8 × €800 tickets, auto-allocated oldest first.
test('5000 payment across 8 tickets: oldest-first auto allocation', () => {
  const bookings = Array.from({ length: 8 }, (_, i) => agentBooking({
    fare: 800,
    pnr: `PNR00${i + 1}`,
    date: `2026-07-0${i + 1}`,
  }));
  const payment = verifiedPayment({ amount: 5000 });
  let model = buildFinanceModel({ bookings, payments: [payment] });
  let agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, 6400 - 5000);

  const lines = buildAutoAllocation(5000, agent.openItems, 'OLDEST_FIRST');
  assert.equal(lines.length, 7);
  assert.equal(lines[6].amount, 200);

  const records = buildAllocationRecords({
    source: payment, sourceType: 'PAYMENT', account: agent, lines, allocations: [],
  });
  model = buildFinanceModel({ bookings, payments: [payment], allocations: records });
  agent = account(model, 'AGENT', 'ABC Travels');

  const fully = agent.openItems.filter((item) => item.reconciliation_status === 'FULLY_ALLOCATED');
  const partial = agent.openItems.filter((item) => item.reconciliation_status === 'PARTIALLY_ALLOCATED');
  const open = agent.openItems.filter((item) => item.reconciliation_status === 'OPEN');
  assert.equal(fully.length, 6);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].outstanding_amount, 600);
  assert.equal(open.length, 1);
  assert.equal(agent.balance, 1400);
  assert.equal(agent.control.matched, true);
  assert.equal(agent.control.open_position, 1400);

  const summary = paymentAllocationSummary(payment, model);
  assert.equal(summary.allocated, 5000);
  assert.equal(summary.allocation_status, 'FULLY_ALLOCATED');
});

// §13 — unallocated advance payment: ledger correct immediately, control
// bridged by the unallocated amount.
test('unallocated advance payment reduces balance without touching open items', () => {
  const booking = agentBooking({ fare: 800 });
  const payment = verifiedPayment({ amount: 10000 });
  const model = buildFinanceModel({ bookings: [booking], payments: [payment] });
  const agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, -9200);
  assert.equal(agent.openItems[0].outstanding_amount, 800);
  assert.equal(agent.unallocated_payments, 10000);
  assert.equal(agent.control.matched, true);
  assert.equal(balanceDisplay(agent.balance, 'AGENT').label, 'Agent credit');
  assert.equal(balanceDisplay(agent.balance, 'AGENT').amount, 9200);
});

// §41 — net refund credit calculation.
test('net refund credit subtracts every deduction', () => {
  assert.equal(netRefundCredit({
    gross_refund_amount: 300,
    airline_cancellation_fee: 10,
    flyforsure_cancellation_fee: 10,
  }), 280);
});

// §18 — fully paid customer refund: credit posts, payout settles to zero.
test('fully paid customer refund: credit then payout returns balance to zero', () => {
  const booking = {
    ...agentBooking({ fare: 300, pnr: 'RF1' }),
    booked_by: '',
    bill_to_type: 'CUSTOMER',
    bill_to_name: 'Daljeet Kaur',
  };
  const payment = verifiedPayment({ amount: 300, pnr: 'RF1', party: 'Daljeet Kaur', partyType: 'CUSTOMER' });
  const payAlloc = buildAllocationRecords({
    source: payment,
    sourceType: 'PAYMENT',
    account: { type: 'CUSTOMER', name: 'Daljeet Kaur' },
    lines: [{ open_item: { open_item_id: ticketOpenItemId(booking), item_type: 'TICKET_RECEIVABLE', booking_id: booking.id, pnr: 'RF1', ticket_no: booking.ticket_no, passenger_name: 'Daljeet Kaur', outstanding_amount: 300 }, amount: 300 }],
    allocations: [],
  });
  const refund = {
    id: uid('ref'),
    refund_number: 'REF-000001',
    refund_status: 'APPROVED',
    approved_at: '2026-07-05T09:00:00Z',
    refund_party_type: 'CUSTOMER',
    pnr: 'RF1',
    ticket_no: booking.ticket_no,
    passenger_name: 'Daljeet Kaur',
    gross_refund_amount: 300,
    airline_cancellation_fee: 10,
    flyforsure_cancellation_fee: 10,
  };

  let model = buildFinanceModel({ bookings: [booking], payments: [payment], refunds: [refund], allocations: payAlloc });
  let customer = account(model, 'CUSTOMER', 'Daljeet Kaur');
  assert.equal(customer.balance, -280);
  assert.equal(balanceDisplay(customer.balance, 'CUSTOMER').label, 'Customer credit');

  const preview = refundSettlementPreview(refund, model);
  assert.equal(preview.original_offset, 0);
  assert.equal(preview.payout_due, 280);

  const payout = {
    ...verifiedPayment({ amount: 280, pnr: 'RF1', party: 'Daljeet Kaur', partyType: 'CUSTOMER', date: '2026-07-06' }),
    payment_direction: 'PAID',
    payment_type: 'REFUND_PAYOUT',
    refund_id: refund.id,
  };
  model = buildFinanceModel({ bookings: [booking], payments: [payment, payout], refunds: [refund], allocations: payAlloc });
  customer = account(model, 'CUSTOMER', 'Daljeet Kaur');
  assert.equal(customer.balance, 0);
  const summary = refundCreditSummary(refund, model);
  assert.equal(summary.paid_out, 280);
  assert.equal(summary.available, 0);
  assert.equal(summary.settlement_status, 'SETTLED');
  assert.equal(customer.control.matched, true);
});

// §19/§20 — refund credit offsets the unpaid part of the original ticket.
test('partially paid cancellation: offset 200, payout due 80', () => {
  const booking = {
    ...agentBooking({ fare: 300, pnr: 'RF2' }),
    booked_by: '',
    bill_to_type: 'CUSTOMER',
    bill_to_name: 'Mario Rossi',
  };
  const payment = verifiedPayment({ amount: 100, pnr: 'RF2', party: 'Mario Rossi', partyType: 'CUSTOMER' });
  const payAlloc = buildAllocationRecords({
    source: payment,
    sourceType: 'PAYMENT',
    account: { type: 'CUSTOMER', name: 'Mario Rossi' },
    lines: [{ open_item: { open_item_id: ticketOpenItemId(booking), item_type: 'TICKET_RECEIVABLE', booking_id: booking.id, pnr: 'RF2', ticket_no: booking.ticket_no, passenger_name: 'Mario Rossi', outstanding_amount: 300 }, amount: 100 }],
    allocations: [],
  });
  const refund = {
    id: uid('ref'),
    refund_number: 'REF-000002',
    refund_status: 'IN_PROCESS',
    refund_party_type: 'CUSTOMER',
    pnr: 'RF2',
    ticket_no: booking.ticket_no,
    gross_refund_amount: 300,
    airline_cancellation_fee: 20,
  };
  const model = buildFinanceModel({ bookings: [booking], payments: [payment], refunds: [refund], allocations: payAlloc });

  const preview = refundSettlementPreview(refund, model);
  assert.equal(preview.credit, 280);
  assert.equal(preview.original_outstanding, 200);
  assert.equal(preview.original_offset, 200);
  assert.equal(preview.payout_due, 80);

  // Credit not yet approved: no ledger effect.
  const customer = account(model, 'CUSTOMER', 'Mario Rossi');
  assert.equal(customer.balance, 200);
});

// §23 — agent refund credit allocated to a future ticket: no new ledger entry.
test('agent credit against future ticket nets ledger without extra entries', () => {
  const oldBooking = agentBooking({ fare: 300, pnr: 'OLD1', date: '2026-06-01' });
  const payment = verifiedPayment({ amount: 300, pnr: 'OLD1', date: '2026-06-02' });
  const refund = {
    id: uid('ref'),
    refund_number: 'REF-000003',
    refund_status: 'APPROVED',
    approved_at: '2026-06-05T09:00:00Z',
    refund_party_type: 'AGENT',
    pnr: 'OLD1',
    ticket_no: oldBooking.ticket_no,
    gross_refund_amount: 300,
    airline_cancellation_fee: 20,
  };
  const newBooking = agentBooking({ fare: 500, pnr: 'NEW1', date: '2026-06-10' });

  let model = buildFinanceModel({ bookings: [oldBooking, newBooking], payments: [payment], refunds: [refund] });
  let agent = account(model, 'AGENT', 'ABC Travels');
  // 300 sale - 300 payment - 280 credit + 500 new sale = 220
  assert.equal(agent.balance, 220);

  const creditItem = agent.openItems.find((item) => item.item_type === 'REFUND_CREDIT');
  const newTicketItem = agent.openItems.find((item) => item.booking_id === newBooking.id);
  const records = buildAllocationRecords({
    source: refund,
    sourceType: 'REFUND_CREDIT',
    account: agent,
    lines: [{ open_item: newTicketItem, amount: 280 }],
    allocations: [],
  });
  model = buildFinanceModel({ bookings: [oldBooking, newBooking], payments: [payment], refunds: [refund], allocations: records });
  agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, 220); // allocation never moves the ledger
  const newItem = agent.openItems.find((item) => item.booking_id === newBooking.id);
  assert.equal(newItem.outstanding_amount, 220);
  assert.equal(newItem.credit_allocated, 280);
  const summary = refundCreditSummary(refund, model);
  assert.equal(summary.used_future, 280);
  assert.equal(summary.available, 0);
  assert.equal(agent.control.matched, true);
  assert.equal(creditItem.original_amount, 280);
});

// §29 — supplier payable with allocation across three tickets.
test('supplier ledger: 2050 payable, 1500 payment, 550 outstanding', () => {
  const bookings = [700, 750, 600].map((cost, index) => ({
    id: uid('bk'),
    pnr: `SUP0${index + 1}`,
    booking_date: `2026-07-0${index + 1}`,
    passenger_name: `PAX ${index + 1}`,
    ticket_no: `057000000${index + 1}`,
    fare_sold: cost + 100,
    fare_issued: cost,
    supplier_name: 'ITA Airways',
  }));
  const payment = {
    id: uid('pay'),
    payment_date: '2026-07-05',
    payment_direction: 'SUPPLIER_OUT',
    party_type: 'SUPPLIER',
    supplier_name: 'ITA Airways',
    amount_paid: 1500,
    payment_mode: 'BANK_TRANSFER',
    payment_method: 'BANK_TRANSFER',
    verification_status: 'VERIFIED',
    verified_at: '2026-07-05T10:00:00Z',
  };

  let model = buildFinanceModel({ bookings, payments: [payment] });
  let supplier = account(model, 'SUPPLIER', 'ITA Airways');
  assert.equal(supplier.balance, 550);
  assert.equal(balanceDisplay(supplier.balance, 'SUPPLIER').label, 'FlyForSure owes supplier');

  const lines = buildAutoAllocation(1500, supplier.openItems, 'OLDEST_FIRST');
  assert.deepEqual(lines.map((line) => line.amount), [700, 750, 50]);
  const records = buildAllocationRecords({ source: payment, sourceType: 'PAYMENT', account: supplier, lines, allocations: [] });
  model = buildFinanceModel({ bookings, payments: [payment], allocations: records });
  supplier = account(model, 'SUPPLIER', 'ITA Airways');

  const outstanding = supplier.openItems.reduce((sum, item) => sum + item.outstanding_amount, 0);
  assert.equal(outstanding, 550);
  assert.equal(supplier.control.matched, true);
});

// §32 — over-allocation must be blocked.
test('allocation exceeding unallocated payment is blocked', () => {
  const item = (outstanding) => ({ open_item_id: uid('oi'), ticket_no: 'T', outstanding_amount: outstanding, side: 'DEBIT' });
  const problems = allocationProblems({
    available: 800,
    lines: [
      { open_item: item(800), amount: 800 },
      { open_item: item(400), amount: 400 },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /exceeds unallocated amount by 400/);

  const overItem = allocationProblems({ available: 1000, lines: [{ open_item: item(100), amount: 200 }] });
  assert.match(overItem[0], /exceeds outstanding/);
});

// §48 — reversal keeps history and reopens allocated items.
test('reversed payment shows reversal entry and reopens its open items', () => {
  const booking = agentBooking({ fare: 800, pnr: 'REV1' });
  const payment = verifiedPayment({ amount: 800, pnr: 'REV1' });
  let model = buildFinanceModel({ bookings: [booking], payments: [payment] });
  let agent = account(model, 'AGENT', 'ABC Travels');
  const records = buildAllocationRecords({
    source: payment, sourceType: 'PAYMENT', account: agent,
    lines: [{ open_item: agent.openItems[0], amount: 800 }], allocations: [],
  });

  const reversedPayment = { ...payment, settlement_status: 'CHARGEBACK' };
  model = buildFinanceModel({ bookings: [booking], payments: [reversedPayment], allocations: records });
  agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, 800); // credit + reversal cancel out
  const types = agent.ledger.map((entry) => entry.entry_type);
  assert.ok(types.includes('PAYMENT_RECEIVED'));
  assert.ok(types.includes('PAYMENT_RECEIVED_REVERSAL'));
  assert.equal(agent.openItems[0].outstanding_amount, 800);
  assert.equal(agent.openItems[0].reconciliation_status, 'OPEN');
  assert.equal(agent.control.matched, true);
});

// Servicing spec §5 — amendment total is input-driven and may be negative.
test('amendment total impact sums all input components', () => {
  assert.equal(amendmentTotalImpact({
    fare_difference: 80,
    supplier_change_fee: 25,
    flyforsure_service_fee: 10,
  }), 115);
  assert.equal(amendmentTotalImpact({
    fare_difference: -100,
    supplier_change_fee: 20,
    flyforsure_service_fee: 10,
  }), -70);
});

// Servicing spec §6/§7 — draft and quoted amendments never touch the ledger;
// CONFIRMED posts an AMENDMENT_CHARGE and an open receivable item.
test('amendment posts charge and open item only when confirmed', () => {
  const booking = agentBooking({ fare: 800, pnr: 'AMD1' });
  const amendment = {
    id: uid('amd'),
    amendment_number: 'AMD-000001',
    booking_id: booking.id,
    pnr: 'AMD1',
    amendment_type: 'DATE_CHANGE',
    fare_difference: 80,
    supplier_change_fee: 25,
    flyforsure_service_fee: 10,
    status: 'QUOTED',
    confirmed_at: '2026-07-04T10:00:00Z',
  };

  let model = buildFinanceModel({ bookings: [booking], amendments: [amendment] });
  let agent = account(model, 'AGENT', 'ABC Travels');
  assert.equal(agent.balance, 800);
  assert.equal(agent.openItems.length, 1);

  model = buildFinanceModel({ bookings: [booking], amendments: [{ ...amendment, status: 'CONFIRMED' }] });
  agent = account(model, 'AGENT', 'ABC Travels');
  assert.equal(agent.balance, 915);
  const charge = agent.ledger.find((entry) => entry.entry_type === 'AMENDMENT_CHARGE');
  assert.equal(charge.debit, 115);
  const item = agent.openItems.find((entry) => entry.item_type === 'AMENDMENT_RECEIVABLE');
  assert.equal(item.outstanding_amount, 115);
  assert.equal(agent.control.matched, true);
});

// Servicing spec §6 — negative amendment total posts a credit open item and
// never converts to a payout automatically.
test('negative amendment total posts amendment credit', () => {
  const booking = agentBooking({ fare: 800, pnr: 'AMD2' });
  const amendment = {
    id: uid('amd'),
    booking_id: booking.id,
    pnr: 'AMD2',
    amendment_type: 'DATE_CHANGE',
    fare_difference: -100,
    supplier_change_fee: 20,
    flyforsure_service_fee: 10,
    status: 'CONFIRMED',
    confirmed_at: '2026-07-04T10:00:00Z',
  };
  const model = buildFinanceModel({ bookings: [booking], amendments: [amendment] });
  const agent = account(model, 'AGENT', 'ABC Travels');

  assert.equal(agent.balance, 730);
  const credit = agent.ledger.find((entry) => entry.entry_type === 'AMENDMENT_CREDIT');
  assert.equal(credit.credit, 70);
  const item = agent.openItems.find((entry) => entry.item_type === 'AMENDMENT_CREDIT');
  assert.equal(item.side, 'CREDIT');
  assert.equal(item.outstanding_amount, 70);
  assert.equal(agent.control.matched, true);
});

// Servicing spec §17/§33 — processing fee and adjustment enter the net credit;
// the result is floored at zero.
test('net refund credit includes processing fee and adjustment, floored at zero', () => {
  assert.equal(netRefundCredit({
    gross_refund_amount: 1150,
    airline_cancellation_fee: 100,
    flyforsure_cancellation_fee: 15,
    processing_fee: 5,
  }), 1030);
  assert.equal(netRefundCredit({
    gross_refund_amount: 100,
    airline_cancellation_fee: 90,
    adjustment_amount: -20,
  }), 0);
});

// Servicing spec §10 — cancellation estimate is derived from inputs only.
test('cancellation estimate computes deductions and expected refund credit', () => {
  const estimate = cancellationEstimate({
    estimated_gross_refund: 1150,
    estimated_airline_fee: 100,
    estimated_flyforsure_fee: 15,
    estimated_processing_fee: 5,
  });
  assert.equal(estimate.deductions, 120);
  assert.equal(estimate.expectedRefundCredit, 1030);
});

// Servicing spec §29 — refund lines make the settlement preview span every
// affected ticket, not just the case-level ticket number.
test('multi-line refund preview offsets outstanding across all line tickets', () => {
  const bookingA = agentBooking({ fare: 900, pnr: 'ML1' });
  const bookingB = agentBooking({ fare: 900, pnr: 'ML1' });
  const refund = {
    id: uid('ref'),
    refund_number: 'REF-000099',
    pnr: 'ML1',
    ticket_no: bookingA.ticket_no,
    refund_party_type: 'AGENT',
    refund_status: 'REQUESTED',
    gross_refund_amount: 1600,
    airline_cancellation_fee: 200,
    refund_lines: [
      { ticket_no: bookingA.ticket_no, gross_refund_amount: 800, airline_cancellation_fee: 100 },
      { ticket_no: bookingB.ticket_no, gross_refund_amount: 800, airline_cancellation_fee: 100 },
    ],
  };
  const model = buildFinanceModel({ bookings: [bookingA, bookingB], refunds: [refund] });
  const preview = refundSettlementPreview(refund, model);

  assert.equal(preview.credit, 1400);
  assert.equal(preview.original_outstanding, 1800);
  assert.equal(preview.original_offset, 1400);
  assert.equal(preview.remaining_credit, 0);
  assert.equal(preview.bookings.length, 2);
});
