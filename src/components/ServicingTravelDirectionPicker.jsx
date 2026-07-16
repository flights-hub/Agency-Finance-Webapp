import {
  TRAVEL_DIRECTION_OPTIONS,
  groupedSegmentsByTravelDirection,
  hasInboundSegments,
} from '../helpers/servicingTravelDirection';

const SELECTED_BY_DIRECTION = {
  OUTBOUND: new Set(['OUTBOUND']),
  INBOUND: new Set(['INBOUND']),
  BOTH: new Set(['OUTBOUND', 'INBOUND']),
};

function SegmentGroup({ title, segments, active }) {
  return (
    <div className={`travel-segment-group${active ? ' active' : ''}`}>
      <span className="affected-picker-label">{title}</span>
      <div className="travel-segment-list">
        {segments.length ? segments.map((segment) => (
          <span key={segment.id} className="travel-segment-pill">{segment.label}</span>
        )) : <span className="affected-picker-empty">No segments</span>}
      </div>
    </div>
  );
}

export default function ServicingTravelDirectionPicker({
  value,
  onChange,
  options,
  disabled = false,
  required = false,
}) {
  const hasInbound = hasInboundSegments(options);
  const groups = groupedSegmentsByTravelDirection(options);
  const activeGroups = SELECTED_BY_DIRECTION[value] || SELECTED_BY_DIRECTION.OUTBOUND;

  return (
    <div className="travel-direction-panel">
      <span className="affected-picker-label">Travel direction{required ? ' *' : ''}</span>
      <div className="check-chip-list travel-direction-options">
        {TRAVEL_DIRECTION_OPTIONS.map(([direction, label]) => {
          const unavailable = direction !== 'OUTBOUND' && !hasInbound;
          const checked = value === direction;
          return (
            <label
              key={direction}
              className={`check-chip${checked ? ' selected' : ''}${disabled || unavailable ? ' disabled' : ''}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || unavailable}
                onChange={() => onChange(direction)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
      <div className="travel-segment-groups">
        <SegmentGroup title="Outbound" segments={groups.outbound} active={activeGroups.has('OUTBOUND')} />
        <SegmentGroup title="Inbound" segments={groups.inbound} active={activeGroups.has('INBOUND')} />
      </div>
    </div>
  );
}
