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

function save(key, item) {
  const items = readData(key);
  if (item.id) {
    const index = items.findIndex(i => i.id === item.id);
    if (index !== -1) items[index] = { ...items[index], ...item };
    else items.push(item);
  } else {
    item.id = crypto.randomUUID();
    items.push(item);
  }
  writeData(key, items);
  return item;
}

// Bookings
export function getBookings() { return readData(STORAGE_KEYS.BOOKINGS); }
export function saveBooking(booking) { return save(STORAGE_KEYS.BOOKINGS, booking); }

// Payments
export function getPayments(pnr = null) {
  const payments = readData(STORAGE_KEYS.PAYMENTS);
  if (pnr) return payments.filter(p => p.pnr === pnr);
  return payments;
}
export function savePayment(payment) { return save(STORAGE_KEYS.PAYMENTS, payment); }

// Refunds
export function getRefunds() { return readData(STORAGE_KEYS.REFUNDS); }
export function saveRefund(refund) { return save(STORAGE_KEYS.REFUNDS, refund); }

// Expenses
export function getExpenses() { return readData(STORAGE_KEYS.EXPENSES); }
export function saveExpense(expense) { return save(STORAGE_KEYS.EXPENSES, expense); }

// Alerts
export function getAlerts() { return readData(STORAGE_KEYS.ALERTS); }
export function saveAlert(alert) { return save(STORAGE_KEYS.ALERTS, alert); }

// Users
export function getUsers() { return readData(STORAGE_KEYS.USERS); }
export function saveUser(user) { return save(STORAGE_KEYS.USERS, user); }

// General function to clear all data
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}
