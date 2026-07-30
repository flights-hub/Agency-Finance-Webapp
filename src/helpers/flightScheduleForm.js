export function carrierCodeFromAirline(value = '', airlineLookup = () => []) {
  const text = String(value || '').trim();
  const parenthesized = text.match(/\(([A-Z0-9]{2,3})\)\s*$/i);
  if (parenthesized) return parenthesized[1].toUpperCase();

  const exact = airlineLookup(text, 1)[0];
  if (exact && (exact.label === text || exact.code === text.toUpperCase())) return exact.code;

  const leadingCode = text.match(/^([A-Z0-9]{2,3})\b/i);
  return leadingCode ? leadingCode[1].toUpperCase() : '';
}

export function scheduleLookupFlightNumber(connection, airlineLookup) {
  const rawFlightNumber = String(connection?.flight_number || '').trim();
  const normalized = rawFlightNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return '';
  if (/^[A-Z][A-Z0-9]{1,2}\d{1,6}$/.test(normalized)) return normalized;
  if (/^\d{1,6}$/.test(normalized)) {
    const carrierCode = carrierCodeFromAirline(connection?.airline, airlineLookup);
    return carrierCode ? `${carrierCode}${normalized}` : normalized;
  }
  return normalized;
}

export function scheduleLocalTime(time, timezone, referenceDate = new Date()) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match || !timezone) return String(time || '').slice(0, 5);

  const [, hours, minutes, seconds = '00'] = match;
  const utc = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
    Number(hours),
    Number(minutes),
    Number(seconds),
  ));

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(utc);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.hour}:${byType.minute}`;
  } catch {
    return String(time || '').slice(0, 5);
  }
}
