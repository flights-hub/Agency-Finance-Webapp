// Helpers for calculations based on PRD formulas

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
  if (daysToDepart <= 0) return 'CRITICAL';
  if (daysToDepart <= 7) return 'URGENT';
  if (daysToDepart <= 14) return 'FOLLOW_UP';
  return 'SETTLED';
}

export function getEligibleRefund(fareSold, penalty, serviceFee) {
  return Math.max(0, fareSold - penalty - serviceFee);
}

export function calculatePnL(bookings, refunds, expenses) {
  const revenue = bookings.reduce((sum, b) => sum + (b.fare_sold || 0), 0);
  const cogs = bookings.reduce((sum, b) => sum + (b.fare_issued || 0), 0);
  const grossProfit = revenue - cogs;
  
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const netProfit = grossProfit - totalExpenses;
  
  const totalRefunds = refunds
    .filter(r => r.refund_status === 'REFUNDED_TO_CLIENT')
    .reduce((sum, r) => sum + (r.eligible_refund || 0), 0);

  const effectiveRevenue = revenue - totalRefunds;

  return {
    revenue,
    cogs,
    grossProfit,
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
