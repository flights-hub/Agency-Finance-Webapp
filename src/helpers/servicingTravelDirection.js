export const TRAVEL_DIRECTION_OPTIONS = [
  ['OUTBOUND', 'Outbound'],
  ['INBOUND', 'Inbound'],
  ['BOTH', 'Both'],
];

const normalize = (value = '') => String(value).trim().toUpperCase();
const text = (value = '') => String(value || '').trim().toLowerCase();

function firstConnection(segment = {}) {
  return Array.isArray(segment.connections) ? segment.connections[0] : null;
}

export function directionForSegment(segment = {}, row = {}, index = 0) {
  const label = `${text(segment.id)} ${text(segment.label)}`;
  if (/\b(return|inbound)\b/.test(label)) return 'INBOUND';
  if (/\b(onward|outbound)\b/.test(label)) return 'OUTBOUND';

  const connection = firstConnection(segment) || segment;
  const departureDate = connection.departure_date || connection.departureDate || '';
  const arrivalDate = connection.arrival_date || connection.arrivalDate || '';
  if (row.inbound_date && (departureDate === row.inbound_date || arrivalDate === row.inbound_date)) return 'INBOUND';
  if (row.outbound_date && (departureDate === row.outbound_date || arrivalDate === row.outbound_date)) return 'OUTBOUND';

  return index === 0 ? 'OUTBOUND' : '';
}

export function directionFromSegmentIds(options = {}, ids = []) {
  const selected = new Set(ids.map(String));
  const directions = new Set((options.segments || [])
    .filter((segment) => selected.has(String(segment.id)))
    .map((segment) => segment.direction)
    .filter(Boolean));
  if (directions.has('OUTBOUND') && directions.has('INBOUND')) return 'BOTH';
  if (directions.has('INBOUND')) return 'INBOUND';
  return 'OUTBOUND';
}

export function segmentIdsForTravelDirection(options = {}, direction = 'BOTH') {
  const normalized = normalize(direction) || 'BOTH';
  const segments = options.segments || [];
  if (normalized === 'BOTH') return segments.map((segment) => segment.id);

  const matching = segments
    .filter((segment) => segment.direction === normalized)
    .map((segment) => segment.id);
  return matching.length ? matching : segments.map((segment) => segment.id);
}

export function hasInboundSegments(options = {}) {
  return (options.segments || []).some((segment) => segment.direction === 'INBOUND');
}

export function groupedSegmentsByTravelDirection(options = {}) {
  return (options.segments || []).reduce((groups, segment) => {
    const direction = segment.direction === 'INBOUND' ? 'inbound' : 'outbound';
    groups[direction].push(segment);
    return groups;
  }, { outbound: [], inbound: [] });
}
