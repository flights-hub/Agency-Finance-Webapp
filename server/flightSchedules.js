import { supabaseRequest } from './supabase.js';

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const SOURCE_PRIORITY = {
  manual_verified: 0,
  gds: 1,
  airline_site: 2,
  flightinfo: 3,
  open_dataset: 6,
};

export function normalizeFlightNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function splitFlightNumber(flightNumber) {
  const normalized = normalizeFlightNumber(flightNumber);
  const match = normalized.match(/^([A-Z]{3}|[A-Z0-9]{2})(\d{1,6})/);
  if (!match) return { carrier_code: '', flight_digit: '' };
  return { carrier_code: match[1], flight_digit: match[2] };
}

export function normalizeRouteToken(value) {
  const token = String(value || '').trim().toUpperCase();
  const iata = token.match(/\b[A-Z]{3}\b/);
  return iata ? iata[0] : token.replace(/[^A-Z0-9]/g, '');
}

function routeScore(schedule, origin, destination) {
  const originToken = normalizeRouteToken(origin);
  const destinationToken = normalizeRouteToken(destination);
  let score = 0;

  if (originToken) {
    const haystack = [
      schedule.origin_iata,
      schedule.origin?.iata,
      schedule.origin?.city,
      schedule.origin?.name,
    ].map(normalizeRouteToken);
    if (haystack.some((part) => part === originToken || part.includes(originToken))) score += 2;
  }

  if (destinationToken) {
    const haystack = [
      schedule.destination_iata,
      schedule.destination?.iata,
      schedule.destination?.city,
      schedule.destination?.name,
    ].map(normalizeRouteToken);
    if (haystack.some((part) => part === destinationToken || part.includes(destinationToken))) score += 2;
  }

  return score;
}

function sourcePriority(source) {
  return SOURCE_PRIORITY[source] ?? 9;
}

export function rankScheduleMatches(schedules, { origin = '', destination = '' } = {}) {
  return [...schedules].sort((a, b) => (
    routeScore(b, origin, destination) - routeScore(a, origin, destination)
    || sourcePriority(a.source) - sourcePriority(b.source)
    || Number(b.confidence_score || 0) - Number(a.confidence_score || 0)
  ));
}

function minutesFromTime(time) {
  const match = String(time || '').match(TIME_RE);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function durationMinutes(stdUtc, staUtc) {
  const departure = minutesFromTime(stdUtc);
  const arrival = minutesFromTime(staUtc);
  if (departure === null || arrival === null) return null;
  const normalizedArrival = arrival <= departure ? arrival + 24 * 60 : arrival;
  return normalizedArrival - departure;
}

function timeOnly(value) {
  const match = String(value || '').match(TIME_RE);
  if (!match) return '';
  const [, hours, minutes, seconds = '00'] = match;
  return `${hours.padStart(2, '0')}:${minutes}:${seconds}`;
}

function airportPayload(airport, fallbackIata) {
  return {
    iata: airport?.iata || airport?.iata_code || fallbackIata || '',
    name: airport?.name || '',
    city: airport?.city || '',
    country: airport?.country || '',
    latitude: airport?.latitude ?? null,
    longitude: airport?.longitude ?? null,
    timezone: airport?.timezone || 'UTC',
  };
}

function reliableSchedule(row, duration) {
  if (row.schedule_time_reliable === true) return true;
  if (['manual_verified', 'gds', 'airline_site', 'flightinfo'].includes(row.source)) return true;
  if (duration === null) return false;
  return Number(row.confidence_score || 0) >= 0.85;
}

export function formatScheduleRecord(row) {
  const std = timeOnly(row.std_utc || row.schedule?.std_utc);
  const sta = timeOnly(row.sta_utc || row.schedule?.sta_utc);
  const duration = durationMinutes(std, sta);
  const timeReliable = reliableSchedule(row, duration);
  return {
    flight_number: row.flight_number,
    carrier_code: row.carrier_code,
    flight_digit: row.flight_digit,
    airline_name: row.airline_name || row.carrier_code,
    origin: airportPayload(row.origin, row.origin_iata),
    destination: airportPayload(row.destination, row.destination_iata),
    schedule: {
      std_utc: timeReliable ? std : '',
      sta_utc: timeReliable ? sta : '',
      duration_minutes: timeReliable ? duration : null,
      time_reliable: timeReliable,
    },
    aircraft_type: row.aircraft_type || '',
    departure_terminal: row.departure_terminal || '',
    arrival_terminal: row.arrival_terminal || '',
    days_of_operation: row.days_of_operation || '1234567',
    source: row.source || 'open_dataset',
    confidence_score: Number(row.confidence_score || (timeReliable ? 0.85 : 0.35)),
    source_url: row.source_url || '',
    schedule_notes: row.schedule_notes || '',
  };
}

export function formatScheduleResponse(rows) {
  const data = rows.map(formatScheduleRecord);
  return {
    success: true,
    data: data.length === 1 ? data[0] : data,
  };
}

function encodeIn(values) {
  return `(${values.map((value) => `"${String(value).replace(/"/g, '')}"`).join(',')})`;
}

async function loadAirports(rows, request) {
  const codes = [...new Set(rows.flatMap((row) => [row.origin_iata, row.destination_iata]).filter(Boolean))];
  if (!codes.length) return new Map();

  const airports = await request(
    `/rest/v1/airports?iata_code=in.${encodeURIComponent(encodeIn(codes))}&select=*`,
  );
  return new Map((airports || []).map((airport) => [airport.iata_code, airport]));
}

function isMissingScheduleSchema(error) {
  return error?.data?.code === 'PGRST205'
    || /Could not find the table 'public\.(flight_schedules|airports)'/i.test(error?.message || '');
}

function scheduleSetupError() {
  const error = new Error('Flight schedule database is not set up. Apply supabase/09_flight_schedules.sql, then seed schedules before using auto-fill.');
  error.status = 503;
  return error;
}

function attachAirports(rows, airportMap) {
  return rows.map((row) => ({
    ...row,
    origin: airportMap.get(row.origin_iata) || { iata_code: row.origin_iata, timezone: 'UTC' },
    destination: airportMap.get(row.destination_iata) || { iata_code: row.destination_iata, timezone: 'UTC' },
  }));
}

function normalizeExternalSchedule(payload, flightNumber) {
  const item = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload;
  if (!item) return null;

  const normalized = normalizeFlightNumber(item.flight_number || item.flightNumber || flightNumber);
  const split = splitFlightNumber(normalized);
  const origin = item.origin || item.departure || {};
  const destination = item.destination || item.arrival || {};

  return {
    flight_number: normalized,
    carrier_code: item.carrier_code || item.carrierCode || split.carrier_code,
    flight_digit: item.flight_digit || item.flightDigit || split.flight_digit,
    origin_iata: item.origin_iata || item.originIata || origin.iata || origin.iata_code,
    destination_iata: item.destination_iata || item.destinationIata || destination.iata || destination.iata_code,
    std_utc: timeOnly(item.std_utc || item.departure_time_utc || item.schedule?.std_utc),
    sta_utc: timeOnly(item.sta_utc || item.arrival_time_utc || item.schedule?.sta_utc),
    aircraft_type: item.aircraft_type || item.aircraftType || '',
      days_of_operation: item.days_of_operation || item.daysOfOperation || '1234567',
      source: item.source || 'gds',
      confidence_score: item.confidence_score || item.confidenceScore || 0.95,
      schedule_time_reliable: item.schedule_time_reliable ?? item.scheduleTimeReliable ?? true,
      origin: airportPayload(origin, item.origin_iata || item.originIata || origin.iata),
      destination: airportPayload(destination, item.destination_iata || item.destinationIata || destination.iata),
  };
}

async function fetchFallbackSchedule(flightNumber) {
  if (!process.env.FLIGHT_SCHEDULE_FALLBACK_URL) return null;
  const url = new URL(process.env.FLIGHT_SCHEDULE_FALLBACK_URL);
  url.searchParams.set('flight_number', flightNumber);

  const response = await fetch(url, {
    headers: process.env.FLIGHT_SCHEDULE_FALLBACK_API_KEY
      ? { Authorization: `Bearer ${process.env.FLIGHT_SCHEDULE_FALLBACK_API_KEY}` }
      : {},
  });
  if (!response.ok) return null;
  return normalizeExternalSchedule(await response.json(), flightNumber);
}

async function persistFallbackSchedule(schedule, request) {
  if (!schedule?.flight_number || !schedule.origin_iata || !schedule.destination_iata) return;

  await request('/rest/v1/flight_schedules?on_conflict=flight_number,origin_iata,destination_iata', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      flight_number: schedule.flight_number,
      carrier_code: schedule.carrier_code,
      flight_digit: schedule.flight_digit,
      origin_iata: schedule.origin_iata,
      destination_iata: schedule.destination_iata,
      std_utc: schedule.std_utc,
      sta_utc: schedule.sta_utc,
      aircraft_type: schedule.aircraft_type,
      days_of_operation: schedule.days_of_operation,
      source: schedule.source,
      confidence_score: schedule.confidence_score,
      schedule_time_reliable: schedule.schedule_time_reliable,
    },
  });
}

export async function lookupFlightSchedules({
  flightNumber,
  origin = '',
  destination = '',
  request = supabaseRequest,
  fallback = fetchFallbackSchedule,
} = {}) {
  const normalized = normalizeFlightNumber(flightNumber);
  if (!normalized) {
    const error = new Error('flight_number is required.');
    error.status = 400;
    throw error;
  }

  let rows;
  try {
    rows = await request(
      `/rest/v1/flight_schedules?flight_number=eq.${encodeURIComponent(normalized)}&select=*&order=confidence_score.desc,updated_at.desc,origin_iata.asc,destination_iata.asc`,
    );
  } catch (error) {
    if (isMissingScheduleSchema(error)) throw scheduleSetupError();
    throw error;
  }

  if (rows?.length) {
    let airports;
    try {
      airports = await loadAirports(rows, request);
    } catch (error) {
      if (isMissingScheduleSchema(error)) throw scheduleSetupError();
      throw error;
    }
    const localMatches = rankScheduleMatches(attachAirports(rows, airports), { origin, destination });
    if (!localMatches.some((row) => reliableSchedule(row, durationMinutes(row.std_utc, row.sta_utc)))) {
      const fallbackSchedule = await fallback(normalized);
      if (fallbackSchedule) {
        await persistFallbackSchedule(fallbackSchedule, request);
        return rankScheduleMatches([fallbackSchedule, ...localMatches], { origin, destination });
      }
    }
    return localMatches;
  }

  const fallbackSchedule = await fallback(normalized);
  if (!fallbackSchedule) return [];
  await persistFallbackSchedule(fallbackSchedule, request);
  return [fallbackSchedule];
}
