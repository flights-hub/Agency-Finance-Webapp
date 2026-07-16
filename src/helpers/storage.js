// Finance data store: server-backed (Supabase via the API) with a synchronous
// in-memory cache so pages can keep reading data without async plumbing.
//
// App.jsx calls loadFinanceData() once after login; pages then read through the
// sync getters. Most legacy saves update the cache immediately and push to the
// server in the background. Amendment saves await server acceptance before
// updating the cache so lifecycle/CAS conflicts remain visible in the modal.
// localStorage keeps a mirror copy for pre-database imports.

import { api } from './api.js';

const STORAGE_KEYS = {
  BOOKINGS: 'ffs_bookings',
  PAYMENTS: 'ffs_payments',
  REFUNDS: 'ffs_refunds',
  AMENDMENTS: 'ffs_amendments',
  CANCELLATIONS: 'ffs_cancellations',
  EXPENSES: 'ffs_expenses',
  ALLOCATIONS: 'ffs_allocations',
  ALERTS: 'ffs_alerts',
  USERS: 'ffs_users',
  BANK_ACCOUNTS: 'ffs_bank_accounts',
};

// Collections persisted to the database. Alerts are computed and legacy
// users stay local-only.
const SERVER_COLLECTIONS = {
  [STORAGE_KEYS.BOOKINGS]: 'bookings',
  [STORAGE_KEYS.PAYMENTS]: 'payments',
  [STORAGE_KEYS.REFUNDS]: 'refunds',
  [STORAGE_KEYS.AMENDMENTS]: 'amendments',
  [STORAGE_KEYS.CANCELLATIONS]: 'cancellations',
  [STORAGE_KEYS.EXPENSES]: 'expenses',
  [STORAGE_KEYS.ALLOCATIONS]: 'allocations',
  [STORAGE_KEYS.BANK_ACCOUNTS]: 'bank_accounts',
};

const cache = new Map();
let syncError = null;

function readLocal(key) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

function writeLocal(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function readData(key) {
  if (!cache.has(key)) cache.set(key, readLocal(key));
  return cache.get(key);
}

function writeData(key, data) {
  cache.set(key, data);
  writeLocal(key, data);
}

function pushToServer(key, item) {
  const collection = SERVER_COLLECTIONS[key];
  if (!collection) return;
  api.saveFinanceRecord(collection, item).catch((error) => {
    syncError = error;
    console.error(`[storage] Failed to save ${collection} record ${item.id}:`, error);
  });
}

export function getSyncError() {
  return syncError;
}

// Loads all finance collections from the API into the cache. If the database
// is still empty but this browser has locally stored records (pre-database
// data), offers to import them once. Concurrent callers share one request.
let loadPromise = null;
export function loadFinanceData({ force = false } = {}) {
  if (!loadPromise || force) {
    loadPromise = fetchFinanceData().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

async function fetchFinanceData() {
  const data = await api.financeData();
  // Config collections (seeded server-side) never count as "the app has no
  // data yet" — only transactional records drive the one-time local import.
  const CONFIG_COLLECTIONS = new Set(['bank_accounts']);
  const serverEmpty = Object.values(SERVER_COLLECTIONS)
    .filter((name) => !CONFIG_COLLECTIONS.has(name))
    .every((name) => !(data[name] || []).length);
  const localCounts = Object.entries(SERVER_COLLECTIONS)
    .filter(([, name]) => !CONFIG_COLLECTIONS.has(name))
    .map(([key, name]) => [key, name, readLocal(key)])
    .filter(([, , records]) => records.length);

  if (serverEmpty && localCounts.length) {
    const summary = localCounts.map(([, name, records]) => `${records.length} ${name}`).join(', ');
    const shouldImport = window.confirm(
      `This browser has finance data that is not in the database yet (${summary}). Import it now so it is shared with other users?`,
    );
    if (shouldImport) {
      for (const [key, name, records] of localCounts) {
        try {
          await api.bulkImportFinance(name, records);
          cache.set(key, records);
        } catch (error) {
          syncError = error;
          console.error(`[storage] Failed to import local ${name}:`, error);
          cache.set(key, records);
        }
      }
      return;
    }
  }

  for (const [key, name] of Object.entries(SERVER_COLLECTIONS)) {
    const records = data[name] || [];
    cache.set(key, records);
    writeLocal(key, records);
  }
}

function save(key, item, { sync = true } = {}) {
  const items = [...readData(key)];
  if (item.id) {
    const index = items.findIndex(i => i.id === item.id);
    if (index !== -1) items[index] = { ...items[index], ...item };
    else items.push(item);
    item = index !== -1 ? items[index] : item;
  } else {
    item.id = crypto.randomUUID();
    items.push(item);
  }
  writeData(key, items);
  if (sync) pushToServer(key, item);
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
export function rememberPayment(payment) { return save(STORAGE_KEYS.PAYMENTS, payment, { sync: false }); }

// Refunds
export function getRefunds() { return readData(STORAGE_KEYS.REFUNDS); }
export function saveRefund(refund) { return save(STORAGE_KEYS.REFUNDS, refund); }

// Amendments
export function getAmendments() { return readData(STORAGE_KEYS.AMENDMENTS); }
export async function saveAmendment(amendment) {
  try {
    const result = await api.saveFinanceRecord('amendments', amendment);
    return save(STORAGE_KEYS.AMENDMENTS, result.record || amendment, { sync: false });
  } catch (error) {
    syncError = error;
    throw error;
  }
}
export async function finalizeAmendment(amendment) {
  const result = await api.finalizeAmendment(amendment);
  result.bookings.forEach((booking) => save(STORAGE_KEYS.BOOKINGS, booking, { sync: false }));
  return save(STORAGE_KEYS.AMENDMENTS, result.amendment, { sync: false });
}

// Cancellation cases
export function getCancellations() { return readData(STORAGE_KEYS.CANCELLATIONS); }
export function saveCancellation(cancellation) { return save(STORAGE_KEYS.CANCELLATIONS, cancellation); }

// Expenses
export function getExpenses() { return readData(STORAGE_KEYS.EXPENSES); }
export function saveExpense(expense) { return save(STORAGE_KEYS.EXPENSES, expense); }

// Allocations (payment/credit -> open item settlement records)
export function getAllocations() { return readData(STORAGE_KEYS.ALLOCATIONS); }
export function saveAllocation(allocation) { return save(STORAGE_KEYS.ALLOCATIONS, allocation); }

// Alerts
export function getAlerts() { return readData(STORAGE_KEYS.ALERTS); }
export function saveAlert(alert) { return save(STORAGE_KEYS.ALERTS, alert); }

// Users
export function getUsers() { return readData(STORAGE_KEYS.USERS); }
export function saveUser(user) { return save(STORAGE_KEYS.USERS, user); }

// Bank accounts (configurable internal accounts for the payment dropdowns)
export function getBankAccounts() { return readData(STORAGE_KEYS.BANK_ACCOUNTS); }
export function saveBankAccount(account) { return save(STORAGE_KEYS.BANK_ACCOUNTS, account); }
export async function deleteBankAccount(id) {
  const remaining = readData(STORAGE_KEYS.BANK_ACCOUNTS).filter((account) => account.id !== id);
  writeData(STORAGE_KEYS.BANK_ACCOUNTS, remaining);
  try {
    await api.deleteFinanceRecord('bank_accounts', id);
  } catch (error) {
    syncError = error;
    throw error;
  }
}

// General function to clear all data
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key);
    cache.delete(key);
  });
}

// One-time backfill: bookings created before booking_ref existed each have their
// own invoice number. Passengers of the same booking share a PNR, so group flat
// rows by normalized PNR and assign the group's lowest invoice number as the
// shared booking_ref. Rows without a PNR fall back to their own invoice number.
// Idempotent — skips records that already carry a booking_ref. Runs against the
// local mirror before the database import so migrated rows are already grouped.
export function migrateBookingRefs() {
  const bookings = readLocal(STORAGE_KEYS.BOOKINGS);
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

  writeLocal(STORAGE_KEYS.BOOKINGS, migrated);
  cache.delete(STORAGE_KEYS.BOOKINGS);
}
