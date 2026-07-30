import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleLocalTime, scheduleLookupFlightNumber } from './flightScheduleForm.js';

test('manual booking schedule lookup combines airline code with numeric flight field', () => {
  assert.equal(
    scheduleLookupFlightNumber({ airline: 'ITA Airways (AZ)', flight_number: '770' }),
    'AZ770',
  );
  assert.equal(
    scheduleLookupFlightNumber({ airline: 'Lufthansa (LH)', flight_number: 'LH 761' }),
    'LH761',
  );
});

test('schedule local time converts stored UTC schedule times to airport local time', () => {
  const summerDate = new Date('2026-07-30T00:00:00Z');
  assert.equal(scheduleLocalTime('11:55:00', 'Europe/Rome', summerDate), '13:55');
  assert.equal(scheduleLocalTime('19:40:00', 'Asia/Kolkata', summerDate), '01:10');
});
