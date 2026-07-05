// Multi-select of the passengers, tickets, and flight segments a servicing
// case (amendment / cancellation / refund) affects. The finance workflow must
// know exactly which financial items are touched, so these are stored as
// structured lists — never as one text field.

const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

// Derives the selectable options from a booking group (one row per passenger).
export function bookingGroupOptions(group = []) {
  const passengers = group.map((row) => ({
    id: String(row.id),
    label: row.passenger_name || 'Unnamed passenger',
  }));

  const tickets = group
    .filter((row) => row.ticket_no)
    .map((row) => ({
      id: String(row.ticket_no),
      label: `${row.ticket_no} · ${row.passenger_name || ''}`.trim(),
      booking: row,
    }));

  // Segment itineraries are duplicated on every passenger row of the group —
  // dedupe by flight + route so each physical segment appears once.
  const segments = [];
  const seen = new Set();
  group.forEach((row) => {
    (row.flight_segments || []).forEach((segment) => {
      (segment.connections || []).forEach((conn) => {
        const label = [
          `${conn.airline || ''}${conn.flight_number || ''}`,
          `${conn.origin || conn.departure_city || '?'}-${conn.destination || conn.arrival_city || '?'}`,
        ].filter(Boolean).join(' ');
        const key = `${label}|${conn.departure_date || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        segments.push({ id: key, label: conn.departure_date ? `${label} · ${conn.departure_date}` : label });
      });
    });
  });

  return { passengers, tickets, segments };
}

export function selectedItems(options = [], ids = []) {
  const set = new Set(ids);
  return options.filter((option) => set.has(option.id));
}

// Shared attachment reader (same limits as payment proofs). Stores the file
// inline on the case document as { name, type, size, data_url }.
export function readAttachment(event, onLoaded) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!ATTACHMENT_TYPES.includes(file.type)) {
    alert('Document must be a JPG, PNG, or PDF file.');
    return;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    alert('Document must be smaller than 2 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => onLoaded({
    name: file.name,
    type: file.type,
    size: file.size,
    data_url: reader.result,
  });
  reader.readAsDataURL(file);
}

function ChipGroup({ label, options, value, onChange, disabled, required }) {
  const set = new Set(value);
  const toggle = (id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  return (
    <div className="affected-picker-group">
      <span className="affected-picker-label">{label}{required ? ' *' : ''}</span>
      <div className="check-chip-list">
        {options.map((option) => {
          const selected = set.has(option.id);
          return (
            <label key={option.id} className={`check-chip${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={() => toggle(option.id)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
        {options.length === 0 && <span className="affected-picker-empty">None on this booking</span>}
      </div>
    </div>
  );
}

export default function AffectedItemsPicker({ options, value, onChange, disabled = false, show = {}, required = {} }) {
  const update = (key) => (ids) => onChange({ ...value, [key]: ids });
  const disabledFor = (key) => (disabled && typeof disabled === 'object' ? Boolean(disabled[key]) : disabled);
  return (
    <div className="affected-picker">
      {show.passengers !== false && (
        <ChipGroup
          label="Affected Passengers"
          options={options.passengers}
          value={value.passengers || []}
          onChange={update('passengers')}
          disabled={disabledFor('passengers')}
          required={required.passengers}
        />
      )}
      {show.tickets !== false && (
        <ChipGroup
          label="Affected Tickets"
          options={options.tickets}
          value={value.tickets || []}
          onChange={update('tickets')}
          disabled={disabledFor('tickets')}
          required={required.tickets}
        />
      )}
      {show.segments !== false && (
        <ChipGroup
          label="Affected Segments"
          options={options.segments}
          value={value.segments || []}
          onChange={update('segments')}
          disabled={disabledFor('segments')}
          required={required.segments}
        />
      )}
    </div>
  );
}
