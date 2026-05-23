// Helpers for calculations based on PRD formulas

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
  
  const totalRefunds = refunds
    .filter(r => r.refund_status === 'REFUNDED_TO_CLIENT')
    .reduce((sum, r) => sum + numeric(r.eligible_refund), 0);

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
  const pnrCounts = new Map();
  const pnrTotals = new Map();
  const pnrPayments = new Map();
  const today = new Date().toISOString().split('T')[0];

  bookings.forEach((booking) => {
    const pnr = normalizePnr(booking.pnr);
    pnrTotals.set(pnr, (pnrTotals.get(pnr) || 0) + numeric(booking.fare_sold));
  });

  payments.forEach((payment) => {
    const pnr = normalizePnr(payment.pnr);
    pnrPayments.set(pnr, (pnrPayments.get(pnr) || 0) + numeric(payment.amount_paid));
  });

  return bookings.map((booking, index) => {
    const pnr = normalizePnr(booking.pnr);
    const pnr_n = (pnrCounts.get(pnr) || 0) + 1;
    pnrCounts.set(pnr, pnr_n);

    const totalFare = pnrTotals.get(pnr) || numeric(booking.fare_sold);
    const totalPaid = pnrPayments.get(pnr) || numeric(booking.total_paid);
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
      num_instalments: pnr_n === 1 ? payments.filter((payment) => normalizePnr(payment.pnr) === pnr).length : null,
      ticket_status: booking.ticket_status || (booking.ticket_no ? 'TICKETED' : 'PENDING'),
      days_to_departure: daysToDeparture,
      alert: pnr_n === 1 ? alert : '',
      pnr_n,
      refund_flag: Boolean(booking.refund_flag),
    };
  });
}

export function getPaymentLedger(bookings = [], payments = []) {
  const fareByPnr = new Map();
  const firstPassengerByPnr = new Map();
  const runningByPnr = new Map();

  bookings.forEach((booking) => {
    const pnr = normalizePnr(booking.pnr);
    fareByPnr.set(pnr, (fareByPnr.get(pnr) || 0) + numeric(booking.fare_sold));
    if (!firstPassengerByPnr.has(pnr)) firstPassengerByPnr.set(pnr, booking.passenger_name);
  });

  return [...payments]
    .sort((a, b) => String(a.payment_date || '').localeCompare(String(b.payment_date || '')))
    .map((payment, index) => {
      const pnr = normalizePnr(payment.pnr);
      const previous = runningByPnr.get(pnr) || 0;
      const cumulativePaid = previous + numeric(payment.amount_paid);
      runningByPnr.set(pnr, cumulativePaid);
      const totalFare = fareByPnr.get(pnr) || numeric(payment.total_fare);
      const remainingBalance = Math.max(0, totalFare - cumulativePaid);
      const instalmentNo = [...payments.slice(0, index + 1)].filter((item) => normalizePnr(item.pnr) === pnr).length;

      return {
        ...payment,
        sl: index + 1,
        pnr,
        passenger_name: payment.passenger_name || firstPassengerByPnr.get(pnr) || '',
        amount_paid: numeric(payment.amount_paid),
        instalment_no: payment.instalment_no || instalmentNo,
        instalment_type: payment.instalment_type || getInstalmentType(instalmentNo, cumulativePaid, totalFare),
        cumulative_paid: cumulativePaid,
        total_fare: totalFare,
        remaining_balance: remainingBalance,
        pnr_n: 1,
      };
    });
}

export function createPaymentEntry({ payment_date, pnr, amount_paid, payment_mode, receipt_ref, received_by, remarks }, bookings = [], payments = []) {
  const normalizedPnr = normalizePnr(pnr);
  const relatedBookings = bookings.filter((booking) => normalizePnr(booking.pnr) === normalizedPnr);
  const totalFare = relatedBookings.reduce((sum, booking) => sum + numeric(booking.fare_sold), 0);
  const existingPaid = payments
    .filter((payment) => normalizePnr(payment.pnr) === normalizedPnr)
    .reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
  const amount = numeric(amount_paid);
  const instalmentNo = payments.filter((payment) => normalizePnr(payment.pnr) === normalizedPnr).length + 1;
  const cumulativePaid = existingPaid + amount;

  return {
    payment_date,
    pnr: normalizedPnr,
    passenger_name: relatedBookings[0]?.passenger_name || '',
    amount_paid: amount,
    payment_mode,
    receipt_ref,
    instalment_no: instalmentNo,
    instalment_type: getInstalmentType(instalmentNo, cumulativePaid, totalFare),
    received_by,
    cumulative_paid: cumulativePaid,
    total_fare: totalFare,
    remaining_balance: Math.max(0, totalFare - cumulativePaid),
    pnr_n: 1,
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
  const bookingLedger = getBookingLedger(bookings, payments);
  const paymentLedger = getPaymentLedger(bookings, payments);
  const expenseLedger = getExpenseLedger(expenses);
  const pnl = calculatePnL(bookings, refunds, expenseLedger);
  const collections = paymentLedger.reduce((sum, payment) => sum + numeric(payment.amount_paid), 0);
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
