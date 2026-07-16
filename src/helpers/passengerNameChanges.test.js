import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nameChangeMapFromRecord,
  passengerNameChangeRows,
} from './passengerNameChanges.js';

test('passengerNameChangeRows returns one editable row per selected passenger', () => {
  const options = [
    { id: 'p1', label: 'RATTU/LOVEKIRAT' },
    { id: 'p2', label: 'RATTU/SARGUN' },
    { id: 'p3', label: 'KAUR/INDERJIT' },
  ];

  assert.deepEqual(passengerNameChangeRows(options, ['p2', 'p3'], { p3: 'KAUR/INDER' }), [
    { id: 'p2', current_name: 'RATTU/SARGUN', new_name: '' },
    { id: 'p3', current_name: 'KAUR/INDERJIT', new_name: 'KAUR/INDER' },
  ]);
});

test('nameChangeMapFromRecord supports structured and legacy single-name records', () => {
  assert.deepEqual(nameChangeMapFromRecord({
    passenger_name_changes: [
      { id: 'p2', new_name: 'RATTU/SARGUN MS' },
    ],
  }), { p2: 'RATTU/SARGUN MS' });

  assert.deepEqual(nameChangeMapFromRecord({
    new_passenger_name: 'RATTU/LOVE',
  }, ['p1']), { p1: 'RATTU/LOVE' });
});
