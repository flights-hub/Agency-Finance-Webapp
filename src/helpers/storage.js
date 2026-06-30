// Basic storage CRUD using localStorage

const STORAGE_KEYS = {
  BOOKINGS: 'ffs_bookings',
  PAYMENTS: 'ffs_payments',
  REFUNDS: 'ffs_refunds',
  AMENDMENTS: 'ffs_amendments',
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

// Amendments
export function getAmendments() { return readData(STORAGE_KEYS.AMENDMENTS); }
export function saveAmendment(amendment) { return save(STORAGE_KEYS.AMENDMENTS, amendment); }

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

// One-time backfill: bookings created before booking_ref existed each have their
// own invoice number. Passengers of the same booking share a PNR, so group flat
// rows by normalized PNR and assign the group's lowest invoice number as the
// shared booking_ref. Rows without a PNR fall back to their own invoice number.
// Idempotent — skips records that already carry a booking_ref.
export function migrateBookingRefs() {
  const bookings = readData(STORAGE_KEYS.BOOKINGS);
  if (!bookings.length || bookings.every(b => b.booking_ref)) return;

  const normalizePnr = (value = '') => value.replace(/[^a-z0-9]/gi, '').toUpperCase();

  // Lowest invoice number per PNR group becomes that group's canonical ref.
  const canonicalRef = {};
  bookings.forEach((booking) => {
    const pnr = normalizePnr(booking.pnr);
    if (!pnr) return;
    const invoice = booking.invoice_no || '';
    if (!canonicalRef[pnr] || invoice.localeCompare(canonicalRef[pnr], undefined, { numeric: true }) < 0) {
      canonicalRef[pnr] = invoice;
    }
  });

  const migrated = bookings.map((booking) => {
    if (booking.booking_ref) return booking;
    const pnr = normalizePnr(booking.pnr);
    return { ...booking, booking_ref: (pnr && canonicalRef[pnr]) || booking.invoice_no };
  });

  writeData(STORAGE_KEYS.BOOKINGS, migrated);
}
