import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatScheduleResponse,
  lookupFlightSchedules,
  normalizeFlightNumber,
  normalizeRouteToken,
  rankScheduleMatches,
  splitFlightNumber,
} from './flightSchedules.js';

test('flight schedule lookup normalizes common manual-entry flight numbers', () => {
  assert.equal(normalizeFlightNumber(' lh 761 '), 'LH761');
  assert.equal(normalizeFlightNumber('EK-202'), 'EK202');
  assert.equal(normalizeFlightNumber('6e  512'), '6E512');
  assert.equal(normalizeFlightNumber(''), '');

  assert.deepEqual(splitFlightNumber('LH761'), { carrier_code: 'LH', flight_digit: '761' });
  assert.deepEqual(splitFlightNumber('UAE202'), { carrier_code: 'UAE', flight_digit: '202' });
});

test('flight schedule lookup ranks fuzzy route tokens over unrelated legs', () => {
  const schedules = [
    {
      flight_number: 'EK202',
      origin_iata: 'DXB',
      destination_iata: 'JFK',
      origin: { iata: 'DXB', city: 'Dubai', name: 'Dubai International Airport' },
      destination: { iata: 'JFK', city: 'New York', name: 'John F Kennedy International Airport' },
    },
    {
      flight_number: 'EK202',
      origin_iata: 'MXP',
      destination_iata: 'JFK',
      origin: { iata: 'MXP', city: 'Milan', name: 'Malpensa Airport' },
      destination: { iata: 'JFK', city: 'New York', name: 'John F Kennedy International Airport' },
    },
  ];

  assert.equal(normalizeRouteToken('DXB - Dubai'), 'DXB');
  const ranked = rankScheduleMatches(schedules, { origin: 'Dubai', destination: 'New York' });

  assert.equal(ranked[0].origin_iata, 'DXB');
  assert.equal(ranked[0].destination_iata, 'JFK');
});

test('flight schedule response returns primary data for one route and options for multi-leg flight numbers', () => {
  const oneRoute = formatScheduleResponse([{
    flight_number: 'LH761',
    carrier_code: 'LH',
    flight_digit: '761',
    origin_iata: 'FRA',
    destination_iata: 'DEL',
    std_utc: '13:45:00',
    sta_utc: '01:30:00',
      aircraft_type: 'A343',
      source: 'open_dataset',
      confidence_score: 0.35,
      schedule_time_reliable: false,
      origin: {
      iata: 'FRA',
      name: 'Frankfurt Airport',
      city: 'Frankfurt',
      country: 'Germany',
      timezone: 'Europe/Berlin',
    },
    destination: {
      iata: 'DEL',
      name: 'Indira Gandhi International Airport',
      city: 'Delhi',
      country: 'India',
      timezone: 'Asia/Kolkata',
    },
  }]);

  assert.equal(oneRoute.success, true);
  assert.equal(oneRoute.data.flight_number, 'LH761');
  assert.equal(oneRoute.data.schedule.duration_minutes, null);
  assert.equal(oneRoute.data.schedule.time_reliable, false);
  assert.equal(oneRoute.data.source, 'open_dataset');

  const multiRoute = formatScheduleResponse([
    { ...oneRoute.data, origin_iata: 'FRA', destination_iata: 'DEL' },
    { ...oneRoute.data, origin_iata: 'DEL', destination_iata: 'FRA' },
  ]);

  assert.equal(Array.isArray(multiRoute.data), true);
  assert.equal(multiRoute.data.length, 2);
});

test('flight schedule response preserves verified times and source quality', () => {
  const response = formatScheduleResponse([{
    flight_number: 'AI137',
    carrier_code: 'AI',
    flight_digit: '137',
    origin_iata: 'DEL',
    destination_iata: 'MXP',
    std_utc: '07:15:00',
    sta_utc: '17:30:00',
    aircraft_type: '788',
    source: 'manual_verified',
    confidence_score: 1,
    schedule_time_reliable: true,
  }]);

  assert.equal(response.data.source, 'manual_verified');
  assert.equal(response.data.confidence_score, 1);
  assert.equal(response.data.schedule.time_reliable, true);
  assert.equal(response.data.schedule.duration_minutes, 615);
});

test('flight schedule ranking prefers verified schedules over open-data matches', () => {
  const ranked = rankScheduleMatches([
    {
      flight_number: 'AI137',
      origin_iata: 'DEL',
      destination_iata: 'MXP',
      source: 'open_dataset',
      confidence_score: 0.35,
    },
    {
      flight_number: 'AI137',
      origin_iata: 'DEL',
      destination_iata: 'MXP',
      source: 'manual_verified',
      confidence_score: 1,
    },
  ], { origin: 'DEL', destination: 'MXP' });

  assert.equal(ranked[0].source, 'manual_verified');
});

test('flight schedule lookup reports missing schedule tables as setup errors', async () => {
  await assert.rejects(
    lookupFlightSchedules({
      flightNumber: 'AZ770',
      request: async () => {
        const error = new Error("Could not find the table 'public.flight_schedules' in the schema cache");
        error.status = 404;
        error.data = { code: 'PGRST205' };
        throw error;
      },
    }),
    (error) => (
      error.status === 503
      && /schedule database is not set up/i.test(error.message)
    ),
  );
});

test('flight schedule lookup uses fallback when local rows are low-confidence route hints', async () => {
  const calls = [];
  const rows = await lookupFlightSchedules({
    flightNumber: 'EK202',
    request: async (path, options = {}) => {
      calls.push({ path, options });
      if (path.startsWith('/rest/v1/flight_schedules?flight_number=')) {
        return [{
          flight_number: 'EK202',
          carrier_code: 'EK',
          flight_digit: '202',
          origin_iata: 'JFK',
          destination_iata: 'DXB',
          std_utc: '22:14:45',
          sta_utc: '22:34:28',
          aircraft_type: 'B77W',
          source: 'open_dataset',
          confidence_score: 0.35,
          schedule_time_reliable: false,
        }];
      }
      if (path.startsWith('/rest/v1/airports?')) return [];
      return null;
    },
    fallback: async () => ({
      flight_number: 'EK202',
      carrier_code: 'EK',
      flight_digit: '202',
      origin_iata: 'JFK',
      destination_iata: 'DXB',
      std_utc: '15:55:00',
      sta_utc: '03:35:00',
      aircraft_type: 'A388',
      source: 'gds',
      confidence_score: 0.95,
      schedule_time_reliable: true,
    }),
  });

  assert.equal(rows[0].source, 'gds');
  assert.equal(rows[0].aircraft_type, 'A388');
  assert.equal(calls.some((call) => call.options.method === 'POST'), true);
});
