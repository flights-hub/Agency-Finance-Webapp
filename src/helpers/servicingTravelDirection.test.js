import test from 'node:test';
import assert from 'node:assert/strict';

import {
  directionForSegment,
  groupedSegmentsByTravelDirection,
  segmentIdsForTravelDirection,
} from './servicingTravelDirection.js';

test('directionForSegment classifies outbound and inbound legs from labels and travel dates', () => {
  const row = { outbound_date: '2026-07-09', inbound_date: '2026-08-11' };

  assert.equal(directionForSegment({ label: 'Onward', connections: [{ departure_date: '2026-07-09' }] }, row, 0), 'OUTBOUND');
  assert.equal(directionForSegment({ label: 'Return', connections: [{ departure_date: '2026-08-11' }] }, row, 1), 'INBOUND');
  assert.equal(directionForSegment({ label: 'Leg 4', connections: [{ departure_date: '2026-08-11' }] }, row, 3), 'INBOUND');
});

test('segmentIdsForTravelDirection resolves outbound, inbound, and both selected segment ids', () => {
  const options = {
    segments: [
      { id: 'out-1', direction: 'OUTBOUND' },
      { id: 'out-2', direction: 'OUTBOUND' },
      { id: 'in-1', direction: 'INBOUND' },
    ],
  };

  assert.deepEqual(segmentIdsForTravelDirection(options, 'OUTBOUND'), ['out-1', 'out-2']);
  assert.deepEqual(segmentIdsForTravelDirection(options, 'INBOUND'), ['in-1']);
  assert.deepEqual(segmentIdsForTravelDirection(options, 'BOTH'), ['out-1', 'out-2', 'in-1']);
});

test('groupedSegmentsByTravelDirection separates outbound and inbound display groups', () => {
  const groups = groupedSegmentsByTravelDirection({
    segments: [
      { id: 'out-1', direction: 'OUTBOUND' },
      { id: 'in-1', direction: 'INBOUND' },
      { id: 'unknown-1', direction: '' },
    ],
  });

  assert.deepEqual(groups.outbound.map((segment) => segment.id), ['out-1', 'unknown-1']);
  assert.deepEqual(groups.inbound.map((segment) => segment.id), ['in-1']);
});
