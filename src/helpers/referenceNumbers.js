function pad2(value) {
  return String(value).padStart(2, '0');
}

export function referenceDateCode(date = new Date()) {
  if (typeof date === 'string') {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}${match[2]}${match[1].slice(-2)}`;
  }

  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return referenceDateCode(new Date());
  return `${pad2(parsed.getDate())}${pad2(parsed.getMonth() + 1)}${String(parsed.getFullYear()).slice(-2)}`;
}

export function referenceSeriesNumber(prefix, records = [], field, date = new Date()) {
  const code = referenceDateCode(date);
  const pattern = new RegExp(`^${prefix}${code}(\\d+)$`, 'i');
  return records.reduce((max, record) => {
    const match = String(record?.[field] || '').match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

export function formatReferenceNumber(prefix, date = new Date(), sequence = 1) {
  return `${prefix}${referenceDateCode(date)}${String(sequence).padStart(3, '0')}`;
}

export function nextReferenceNumber(prefix, records = [], field, date = new Date()) {
  return formatReferenceNumber(prefix, date, referenceSeriesNumber(prefix, records, field, date));
}
