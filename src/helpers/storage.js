// Basic storage CRUD using localStorage

const STORAGE_KEYS = {
  BOOKINGS: 'ffs_bookings',
  PAYMENTS: 'ffs_payments',
  REFUNDS: 'ffs_refunds',
  EXPENSES: 'ffs_expenses',
  ALERTS: 'ffs_alerts',
  USERS: 'ffs_users',
};

// Generic read/write
function readData(key) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

function writeData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// Bookings
export function getBookings() { return readData(STORAGE_KEYS.BOOKINGS); }
export function saveBooking(booking) {
  const bookings = getBookings();
  if (booking.id) {
    const index = bookings.findIndex(b => b.id === booking.id);
    if (index !== -1) bookings[index] = { ...bookings[index], ...booking };
    else bookings.push(booking);
  } else {
    booking.id = crypto.randomUUID();
    bookings.push(booking);
  }
  writeData(STORAGE_KEYS.BOOKINGS, bookings);
  return booking;
}

// Payments
export function getPayments(pnr = null) {
  const payments = readData(STORAGE_KEYS.PAYMENTS);
  if (pnr) return payments.filter(p => p.pnr === pnr);
  return payments;
}
export function savePayment(payment) {
  const payments = getPayments();
  if (payment.id) {
    const index = payments.findIndex(p => p.id === payment.id);
    if (index !== -1) payments[index] = { ...payments[index], ...payment };
    else payments.push(payment);
  } else {
    payment.id = crypto.randomUUID();
    payments.push(payment);
  }
  writeData(STORAGE_KEYS.PAYMENTS, payments);
  return payment;
}

// Refunds
export function getRefunds() { return readData(STORAGE_KEYS.REFUNDS); }
export function saveRefund(refund) {
  const refunds = getRefunds();
  if (refund.id) {
    const index = refunds.findIndex(r => r.id === refund.id);
    if (index !== -1) refunds[index] = { ...refunds[index], ...refund };
    else refunds.push(refund);
  } else {
    refund.id = crypto.randomUUID();
    refunds.push(refund);
  }
  writeData(STORAGE_KEYS.REFUNDS, refunds);
  return refund;
}

// Expenses
export function getExpenses() { return readData(STORAGE_KEYS.EXPENSES); }
export function saveExpense(expense) {
  const expenses = getExpenses();
  if (expense.id) {
    const index = expenses.findIndex(e => e.id === expense.id);
    if (index !== -1) expenses[index] = { ...expenses[index], ...expense };
    else expenses.push(expense);
  } else {
    expense.id = crypto.randomUUID();
    expenses.push(expense);
  }
  writeData(STORAGE_KEYS.EXPENSES, expenses);
  return expense;
}

// Alerts
export function getAlerts() { return readData(STORAGE_KEYS.ALERTS); }
export function saveAlert(alert) {
  const alerts = getAlerts();
  if (alert.id) {
    const index = alerts.findIndex(a => a.id === alert.id);
    if (index !== -1) alerts[index] = { ...alerts[index], ...alert };
    else alerts.push(alert);
  } else {
    alert.id = crypto.randomUUID();
    alerts.push(alert);
  }
  writeData(STORAGE_KEYS.ALERTS, alerts);
  return alert;
}

// Users
export function getUsers() { return readData(STORAGE_KEYS.USERS); }
export function saveUser(user) {
  const users = getUsers();
  if (user.id) {
    const index = users.findIndex(u => u.id === user.id);
    if (index !== -1) users[index] = { ...users[index], ...user };
    else users.push(user);
  } else {
    user.id = crypto.randomUUID();
    users.push(user);
  }
  writeData(STORAGE_KEYS.USERS, users);
  return user;
}

// General function to clear all data
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}
