import {
  connectionDuration,
  normalizeConnectionChronology,
} from '../helpers/dateChangeAmendments';

const DIRECTION_KEYS = {
  OUTBOUND: ['outbound'],
  INBOUND: ['inbound'],
  BOTH: ['outbound', 'inbound'],
};

const DIRECTION_LABELS = {
  outbound: 'Outbound',
  inbound: 'Inbound',
};

const CONNECTION_FIELDS = [
  { key: 'airline', label: 'Airline' },
  { key: 'flight_number', label: 'Flight number' },
  { key: 'departure_city', label: 'Departure airport' },
  { key: 'arrival_city', label: 'Arrival airport' },
  { key: 'departure_date', label: 'Departure date', type: 'date' },
  { key: 'arrival_date', label: 'Arrival date', type: 'date' },
  { key: 'departure_time', label: 'Departure time', type: 'time' },
  { key: 'arrival_time', label: 'Arrival time', type: 'time' },
  { key: 'departure_terminal', label: 'Departure terminal' },
  { key: 'arrival_terminal', label: 'Arrival terminal' },
  { key: 'duration', label: 'Duration', readOnly: true },
  { key: 'check_in_baggage', label: 'Check-in baggage' },
  { key: 'cabin_baggage', label: 'Cabin baggage' },
];

function cloneReplacement(replacement) {
  const next = structuredClone(replacement || {});
  if (!Array.isArray(next.outbound)) next.outbound = [];
  if (!Array.isArray(next.inbound)) next.inbound = [];
  return next;
}

function emptyConnection() {
  return CONNECTION_FIELDS.reduce((connection, field) => ({
    ...connection,
    [field.key]: '',
  }), { id: crypto.randomUUID() });
}

function connectionCount(segments = []) {
  return segments.reduce((total, segment) => total + (segment.connections?.length || 0), 0);
}

function connectionKey(connection, segment, segmentIndex, connectionIndex) {
  return connection.id || `${segment.id || segmentIndex}-connection-${connectionIndex}`;
}

function OriginalConnection({ connection, index }) {
  return (
    <article className="date-change-connection-card">
      <div className="date-change-connection-head">
        <strong>Connection {index + 1}</strong>
        <span>{connection.departure_city || '—'} → {connection.arrival_city || '—'}</span>
      </div>
      <dl className="date-change-connection-grid date-change-readonly-grid">
        {CONNECTION_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{connection[key] || '—'}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function OriginalJourney({ directionKey, segments }) {
  const directionLabel = DIRECTION_LABELS[directionKey];

  return (
    <article className="date-change-journey date-change-journey-original" aria-label={`Original ${directionLabel.toLowerCase()} journey`}>
      <header className="date-change-journey-head">
        <div>
          <span className="date-change-journey-kicker">Current</span>
          <h6>Original itinerary</h6>
        </div>
        <span className="badge badge-neutral">Read only</span>
      </header>

      {segments.length ? segments.map((segment, segmentIndex) => (
        <section className="date-change-segment" key={segment.id || `${directionKey}-original-${segmentIndex}`}>
          <h6 className="date-change-segment-title">{segment.label || `${directionLabel} segment ${segmentIndex + 1}`}</h6>
          {(segment.connections || []).length ? segment.connections.map((connection, connectionIndex) => (
            <OriginalConnection
              key={connectionKey(connection, segment, segmentIndex, connectionIndex)}
              connection={connection}
              index={connectionIndex}
            />
          )) : <p className="date-change-empty">No original connections recorded.</p>}
        </section>
      )) : <p className="date-change-empty">No original {directionLabel.toLowerCase()} itinerary recorded.</p>}
    </article>
  );
}

function ReplacementConnection({
  connection,
  connectionIndex,
  directionKey,
  disabled,
  onRemove,
  onUpdate,
  removable,
  segmentLabel,
}) {
  const directionLabel = DIRECTION_LABELS[directionKey];

  return (
    <article className="date-change-connection-card">
      <div className="date-change-connection-head">
        <div>
          <strong>Connection {connectionIndex + 1}</strong>
          <span>{connection.departure_city || '—'} → {connection.arrival_city || '—'}</span>
        </div>
        <button
          className="btn btn-danger btn-sm"
          type="button"
          disabled={disabled || !removable}
          onClick={onRemove}
          aria-label={`Remove connection ${connectionIndex + 1} from ${directionLabel.toLowerCase()} ${segmentLabel}`}
          title={!removable ? 'At least one connection is required for this direction.' : undefined}
        >
          Remove connection
        </button>
      </div>

      <div className="date-change-connection-grid">
        {CONNECTION_FIELDS.map(({ key, label, readOnly, type }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type={type || 'text'}
              value={connection[key] ?? ''}
              readOnly={readOnly}
              disabled={disabled || readOnly}
              onChange={readOnly ? undefined : (event) => onUpdate(key, event.target.value)}
            />
          </label>
        ))}
      </div>
    </article>
  );
}

function ReplacementJourney({ directionKey, segments, disabled, onAdd, onAddFirst, onRemove, onUpdate }) {
  const directionLabel = DIRECTION_LABELS[directionKey];
  const removable = connectionCount(segments) > 1;

  return (
    <article className="date-change-journey" aria-label={`Replacement ${directionLabel.toLowerCase()} journey`}>
      <header className="date-change-journey-head">
        <div>
          <span className="date-change-journey-kicker">Proposed</span>
          <h6>Replacement itinerary</h6>
        </div>
        {disabled && <span className="badge badge-neutral">Finalized</span>}
      </header>

      {segments.length ? segments.map((segment, segmentIndex) => {
        const segmentLabel = segment.label || `${directionLabel} segment ${segmentIndex + 1}`;
        return (
          <section className="date-change-segment" key={segment.id || `${directionKey}-replacement-${segmentIndex}`}>
            <div className="date-change-segment-head">
              <h6 className="date-change-segment-title">{segmentLabel}</h6>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={disabled}
                onClick={() => onAdd(segmentIndex)}
                aria-label={`Add connection to ${directionLabel.toLowerCase()} ${segmentLabel}`}
              >
                Add connection
              </button>
            </div>

            {(segment.connections || []).length ? segment.connections.map((connection, connectionIndex) => (
              <ReplacementConnection
                key={connectionKey(connection, segment, segmentIndex, connectionIndex)}
                connection={connection}
                connectionIndex={connectionIndex}
                directionKey={directionKey}
                disabled={disabled}
                removable={removable}
                segmentLabel={segmentLabel}
                onRemove={() => onRemove(segmentIndex, connectionIndex)}
                onUpdate={(key, value) => onUpdate(segmentIndex, connectionIndex, key, value)}
              />
            )) : <p className="date-change-empty">No replacement connections recorded.</p>}
          </section>
        );
      }) : (
        <div className="date-change-empty-state">
          <p className="date-change-empty">No replacement {directionLabel.toLowerCase()} itinerary recorded.</p>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={disabled}
            onClick={onAddFirst}
            aria-label={`Add first connection to replacement ${directionLabel.toLowerCase()} journey`}
          >
            Add connection
          </button>
        </div>
      )}
    </article>
  );
}

export default function DateChangeItineraryEditor({
  original = {},
  replacement = {},
  direction,
  disabled = false,
  onChange,
}) {
  const directionKeys = DIRECTION_KEYS[direction] || [];
  const visibleDirectionKeys = ['outbound', 'inbound'].filter((directionKey) => (
    directionKeys.includes(directionKey)
    || original[directionKey]?.length
    || replacement[directionKey]?.length
  ));

  const updateConnection = (directionKey, segmentIndex, connectionIndex, key, value) => {
    if (disabled || key === 'duration') return;
    const next = cloneReplacement(replacement);
    const connection = next[directionKey]?.[segmentIndex]?.connections?.[connectionIndex];
    if (!connection) return;

    connection[key] = value;
    Object.assign(connection, normalizeConnectionChronology(connection));
    connection.duration = connectionDuration(connection);
    onChange(next);
  };

  const addConnection = (directionKey, segmentIndex) => {
    if (disabled) return;
    const next = cloneReplacement(replacement);
    const segment = next[directionKey]?.[segmentIndex];
    if (!segment) return;

    segment.connections = [...(segment.connections || []), emptyConnection()];
    onChange(next);
  };

  const addFirstConnection = (directionKey) => {
    if (disabled) return;
    const next = cloneReplacement(replacement);
    if (next[directionKey].length) return;

    const sourceSegment = Array.isArray(original[directionKey]) ? original[directionKey][0] : null;
    const segment = sourceSegment ? structuredClone(sourceSegment) : {
      id: directionKey,
      label: DIRECTION_LABELS[directionKey],
    };
    segment.connections = [emptyConnection()];
    next[directionKey] = [segment];
    onChange(next);
  };

  const removeConnection = (directionKey, segmentIndex, connectionIndex) => {
    if (disabled) return;
    const next = cloneReplacement(replacement);
    if (connectionCount(next[directionKey]) <= 1) return;
    const segment = next[directionKey]?.[segmentIndex];
    if (!segment?.connections?.[connectionIndex]) return;

    segment.connections = segment.connections.filter((_, index) => index !== connectionIndex);
    onChange(next);
  };

  return (
    <div className="date-change-editor">
      {visibleDirectionKeys.map((directionKey) => {
        const directionLabel = DIRECTION_LABELS[directionKey];
        const originalSegments = Array.isArray(original[directionKey]) ? original[directionKey] : [];
        const replacementSegments = Array.isArray(replacement[directionKey]) ? replacement[directionKey] : [];

        if (!directionKeys.includes(directionKey)) {
          return (
            <section className="date-change-direction date-change-unchanged" key={directionKey} aria-label={`${directionLabel} journey unchanged`}>
              <h5 className="date-change-direction-title">{directionLabel} journey</h5>
              <span className="badge badge-neutral">Unchanged</span>
            </section>
          );
        }

        return (
          <section className="date-change-direction" key={directionKey} aria-label={`${directionLabel} date change`}>
            <h5 className="date-change-direction-title">{directionLabel} journey</h5>
            <div className="date-change-comparison">
              <OriginalJourney directionKey={directionKey} segments={originalSegments} />
              <ReplacementJourney
                directionKey={directionKey}
                segments={replacementSegments}
                disabled={disabled}
                onAdd={(segmentIndex) => addConnection(directionKey, segmentIndex)}
                onAddFirst={() => addFirstConnection(directionKey)}
                onRemove={(segmentIndex, connectionIndex) => removeConnection(directionKey, segmentIndex, connectionIndex)}
                onUpdate={(segmentIndex, connectionIndex, key, value) => (
                  updateConnection(directionKey, segmentIndex, connectionIndex, key, value)
                )}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
