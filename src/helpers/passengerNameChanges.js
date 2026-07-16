export function nameChangeMapFromRecord(record = {}, selectedIds = []) {
  const map = {};
  const structured = record.passenger_name_changes || record.name_changes || [];
  structured.forEach((change) => {
    const id = String(change.id || change.booking_id || '');
    if (!id) return;
    map[id] = change.new_name || change.new_passenger_name || '';
  });

  if (!structured.length && record.new_passenger_name && selectedIds.length === 1) {
    map[String(selectedIds[0])] = record.new_passenger_name;
  }
  return map;
}

export function passengerNameChangeRows(options = [], selectedIds = [], changes = {}) {
  const selected = new Set(selectedIds.map(String));
  return options
    .filter((option) => selected.has(String(option.id)))
    .map((option) => ({
      id: String(option.id),
      current_name: option.label || '',
      new_name: changes[String(option.id)] || '',
    }));
}
