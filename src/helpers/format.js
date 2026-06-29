export function formatCurrency(value, currency = 'EUR') {
  return `${currency} ${Number(value || 0).toLocaleString()}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

export function humanize(str) {
  return String(str || '').replace(/_/g, ' ');
}

export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB');
}
