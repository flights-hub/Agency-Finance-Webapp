# Date-Change Amendment and Reissue Design

**Date:** 2026-07-12

**Status:** Approved design awaiting implementation

**Scope:** Extend the current amendment modal and Booking Detail audit view; do not introduce live airline, GDS, schedule, availability, or minimum-connection-time retrieval.

## Purpose

Internal travel-agency employees need to process date changes manually against an existing internal booking. A change may apply to the entire PNR or only selected passengers. It may replace the outbound itinerary, inbound itinerary, or both, and each direction may contain one or more connected flights.

Finalizing a date change must update the affected booking rows, record any GDS PNR split and reissued ticket numbers, post the finalized financial impact to the ledger, and preserve a complete before/after audit trail. The shared internal Booking ID remains stable even if an employee splits a passenger into a new PNR in the GDS.

## Industry Basis

The design follows these operational principles:

- IATA treats ticket changes as exchange/reissue operations governed by the affected ticket coupons and carrier instructions. Agents must promptly cancel changed reservation space and preserve required ticket information and authorizations.
- Unaffected coupons must remain intact; a change to one direction must not silently overwrite the other direction.
- Reaccommodation may replace a direct flight with connections, change the number of coupons, or require manual reissue. Therefore a direction cannot be represented by one date or one physical flight segment.
- Travel-agency staff must retain documentation, fare/tax differences, fees, waiver or quote references, and customer-facing itinerary details.
- Minimum connection time, live availability, rebooking-class eligibility, and carrier-specific waiver eligibility cannot be verified without GDS or airline data. The product must not claim that these checks have occurred.

Primary references:

- [IATA Ticketing Handbook](https://www.iata.org/en/publications/manuals/ticketing-handbook)
- [IATA Travel Agent's Handbook, Resolution 838](https://www.iata.org/en/fmc-documents/04e5384f-dcd9-4e49-b135-ee8931e6e0f1/)
- [IATA interline irregular-operations guidance](https://www.iata.org/contentassets/e7a533819be440edbb1e49da96e0f2a8/guidance-document-interline-irops_25june2020.pdf)
- [Delta travel-agency schedule-change and irregular-operations policy](https://pro.delta.com/content/agency/emea/en/policy-library/schedule-change-and-irregular-operations/irregular-operations-rebooking-policy-for-travel-agency-partners.html)
- [Delta schedule-change and ticket-revalidation overview](https://pro.delta.com/content/agency/global/en/policy-library/schedule-change-and-irregular-operations/schedule-change-and-ticket-revalidation-policy.html)

These references establish process and audit requirements only. Carrier-specific change rules remain the employee's responsibility.

## Design Decisions

### 1. Permanent internal booking identity

The existing shared `booking_ref` is the permanent internal Booking ID. Every passenger row belonging to the booking retains this value for its entire lifetime.

A GDS split changes operational identifiers, not the internal booking identity:

- The selected passenger row may receive a new `pnr`.
- Its former PNR is appended to `pnr_history` without duplicates.
- The selected row receives its reissued `ticket_no`.
- The unselected passenger rows remain unchanged.
- The amendment stores `booking_ref` plus the affected passenger row IDs.

Financial and servicing records should resolve by `booking_ref` first. Older records without `booking_ref` continue to resolve through current and historical PNR aliases and passenger row IDs. This keeps previous and future payments, costs, refunds, cancellations, and amendments visible together after a PNR split.

### 2. One date-change type with explicit scope

New cases use `amendment_type: "DATE_CHANGE"` and two independent fields:

- `application_scope`: `PNR_WIDE` or `SELECTED_PASSENGERS`
- `travel_direction`: `OUTBOUND`, `INBOUND`, or `BOTH`

`PNR_WIDE` automatically includes every passenger row under the internal Booking ID. `SELECTED_PASSENGERS` requires one or more explicit passenger selections.

Legacy values `OUTBOUND_DATE_CHANGE`, `INBOUND_DATE_CHANGE`, and `BOTH_DATE_CHANGE` remain readable and normalize to `DATE_CHANGE` plus the corresponding direction when opened. They do not need destructive migration.

For a one-way booking, only `OUTBOUND` is available. An inbound option is available only when the booking has an inbound journey group. A direction represents the complete journey in that direction, including all connections; it is not one flight coupon.

### 3. Full immutable itinerary snapshots

The amendment stores full snapshots rather than a patch of changed fields:

```text
original_itinerary
  outbound: flight-segment objects and connections
  inbound: flight-segment objects and connections

replacement_itinerary
  outbound: flight-segment objects and connections
  inbound: flight-segment objects and connections
```

Both snapshots use the booking's current `flight_segments` shape. Every connection retains:

- airline
- flight number
- departure airport/city
- arrival airport/city
- departure date
- arrival date
- departure time
- arrival time
- departure terminal
- arrival terminal
- calculated duration
- check-in baggage
- cabin baggage

The modal clones the booking's current itinerary when the case is created. Staff may add or remove connections in the selected replacement direction. Unselected directions remain read-only and are copied unchanged into the replacement snapshot.

After finalization, both snapshots are immutable. Later amendments start from the booking's then-current itinerary, creating a new independent historical pair.

### 4. Passenger reissue mapping

Every affected passenger has a structured mapping:

```text
passenger_reissues[]
  booking_id             internal passenger-row ID
  passenger_name
  old_pnr
  new_pnr                defaults to old_pnr when there is no GDS split
  old_ticket_no
  new_ticket_no          required at finalization
  reissue_reference      optional waiver, exchange, or GDS reference
```

PNR-wide changes generate a mapping for every passenger. Passenger-wise changes generate mappings only for selected passengers.

The application does not generate airline ticket numbers. Employees manually enter the number returned by the GDS or carrier. Ticket numbers are treated as identifiers rather than forced into one numeric format because suppliers and low-cost carriers can use different document references.

### 5. Current modal mapping

The existing `AmendmentCaseModal` remains the user-facing layer. Its layout becomes:

1. **Amendment scope**
   - Amendment type
   - PNR-wide or passenger-wise
   - Outbound, inbound, or both
   - Passenger selection when applicable
2. **Original and replacement itinerary**
   - Original selected direction shown read-only
   - Replacement direction editable with add/remove connection controls
   - Unselected direction explicitly marked unchanged
3. **Passenger ticket reissue mapping**
   - One row per affected passenger with old/new PNR and old/new ticket
4. **Requested-change remarks**
5. **Existing Amendment Quote (Input-Driven)**
   - Preserve the existing currency, fare difference, airline/supplier fee, FlyforSure fee, agent markup, tax difference, other charges, description, quote reference, evidence upload, internal notes, and total preview
6. **Existing case actions adapted to the finalization rules below**

The quote section shown in the approved screenshot is retained rather than replaced or redesigned.

## Lifecycle and Data Flow

### Draft and quote stages

`DRAFT`, `QUOTE_PENDING`, `QUOTED`, and `CUSTOMER_APPROVED` cases may store a proposed itinerary and incomplete reissue mappings. They do not alter booking rows and do not post to the ledger.

Staff may revise an unfinalized proposal. The original snapshot continues to represent the itinerary captured when the case began.

### Confirm Amendment

For a date change, the existing **Confirm Amendment** button is the final reissue action. There is no separate **Mark Completed** step.

After all validation succeeds, one domain operation:

1. Creates one ISO `finalized_at` timestamp and records `finalized_by`.
2. Produces the finalized amendment with `status: "COMPLETED"`.
3. Applies only the selected direction to only the affected passenger booking rows.
4. Updates each affected row's current PNR and ticket number from its mapping.
5. Appends each changed old PNR to that row's `pnr_history`.
6. Recomputes the booking summary fields derived from the updated itinerary, including airline, sector, outbound date, and inbound date where applicable.
7. Sends the affected booking rows and completed amendment through one awaited finalization operation in the existing server-backed finance persistence layer. Booking rows are persisted first and the completed amendment is persisted last, so a failed booking write cannot post the amendment ledger entry prematurely.
8. Updates the local cache and reloads Booking Detail only after the server operation succeeds. A persistence error keeps the modal open and shows a retryable error instead of silently treating the case as completed.

All transformed records are computed and validated before the first write. Retrying a partially interrupted finalization is idempotent: applying the same updated row again cannot duplicate PNR history, and an already completed amendment cannot post twice.

### Ledger posting

The finalized date-change financial impact remains input-driven:

```text
fare difference
+ airline/supplier change fee
+ FlyforSure service fee
+ agent markup
+ tax difference
+ other charges
```

Only `COMPLETED` date changes post. The ledger entry and amendment open item use `finalized_at` as their posting date. A positive total posts an amendment charge; a negative total posts an amendment credit; zero posts no financial entry. Draft and quote states never post.

This completion rule applies to the new date-change workflow. Existing non-date amendment behavior is not otherwise redesigned by this feature.

## Validation

### Scope validation

- A PNR-wide case must resolve at least one passenger row.
- A passenger-wise case requires at least one selected passenger.
- Every reissue mapping must correspond to an affected row under the same `booking_ref`.
- Unaffected passenger rows must not be mutated.

### Replacement itinerary validation

- Every selected direction must contain at least one connection.
- Airline, flight number, origin, destination, departure date, arrival date, departure time, and arrival time are required at finalization.
- Each connection's arrival date/time must be later than its departure date/time.
- Adjacent connections must be route-continuous: the previous arrival airport equals the next departure airport.
- The inbound journey, when present, cannot begin before the outbound journey ends.
- Duration is recalculated from the entered local dates and times; staff may not edit it directly.
- Terminals and baggage fields remain optional.
- No minimum-connection-time or live-flight-validity claim is made.

### Reissue validation

- `new_pnr` defaults to `old_pnr` if left blank.
- Every affected passenger requires a non-empty `new_ticket_no`.
- A new ticket number cannot equal that passenger's old ticket number.
- A new ticket number cannot be duplicated among affected passengers.
- Finalization cannot proceed if the booking row changed since the amendment snapshot in a way that makes the old PNR, ticket, or itinerary stale; staff must refresh and review rather than silently overwriting newer work.

### Financial validation

- Only fare difference may be negative.
- All fee and charge fields must be zero or positive.
- The existing input-driven total remains the sole ledger amount; itinerary fields never fabricate a fare or fee.

## Booking Detail and Activity Timeline

Booking Detail remains the single operational and financial audit screen for the shared internal Booking ID. It groups all passenger rows by `booking_ref`, even when their current PNRs differ.

The amendment timeline entry uses `finalized_at` when completed and shows:

- amendment number and completed status
- PNR-wide or passenger-wise scope
- outbound, inbound, or both
- affected passenger names
- each old PNR to new PNR change when a split occurred
- each old ticket to new ticket mapping
- compact original-to-replacement itinerary summaries for every changed direction
- amendment charge or credit and whether it posted
- remarks
- finalizing employee and timestamp

Opening the amendment from Booking Detail exposes the full read-only before/after snapshots, quote inputs, evidence, and internal notes. Earlier payments tied to historical PNRs and later payments tied to new PNRs remain visible in the same booking view and finance model.

## Backward Compatibility

- Existing amendment records without snapshots render through their current requested-change representation.
- Existing bookings without `pnr_history` behave as though it is an empty array.
- Existing financial records without `booking_ref` continue using PNR and booking-row fallback matching.
- Legacy direction-specific amendment types normalize only in the form/view layer; stored records are not rewritten merely by viewing them.
- No new flight retrieval API or dependency is introduced.

## Testing Strategy

Pure amendment-domain helpers will be tested with Node's built-in test runner before UI integration. Coverage includes:

- outbound-only replacement preserves inbound
- inbound-only replacement preserves outbound
- both-direction replacement
- one direction with multiple connections
- direct-to-connecting and connecting-to-direct replacements
- route and chronology validation
- PNR-wide application to every passenger
- passenger-wise application to only selected rows
- GDS split updates PNR while preserving `booking_ref` and PNR history
- old-to-new ticket replacement and duplicate rejection
- immutable before/after snapshots across later amendments
- stale-booking protection and idempotent finalization
- completion-only date-change ledger posting using `finalized_at`
- historical-PNR payment matching after a split
- Activity timeline summary content
- legacy amendment display behavior

Verification also includes the full existing helper tests, lint on changed files, a production build, and a browser walkthrough covering draft, quote, passenger selection, connection editing, confirmation, updated itinerary, finance display, and timeline history.

## Acceptance Criteria

1. An employee can start a date change from the current amendment layer for an internal Booking ID.
2. The employee can choose PNR-wide or selected-passenger scope and outbound, inbound, or both directions.
3. The employee can manually enter a complete replacement journey with any number of connections and all current flight fields.
4. The existing input-driven quote area remains available and visually consistent.
5. Confirm Amendment requires valid replacement flights and a new ticket number for each affected passenger.
6. A GDS-split passenger can receive a new PNR without leaving the original internal Booking ID.
7. Confirmation updates only the intended passenger rows and directions.
8. Original and replacement itineraries, old and new PNRs, and old and new tickets remain permanently auditable.
9. The ledger posts only when the date change is finalized, using the finalization date.
10. Booking Detail shows amendments, costs, and payments together after PNR splits.
11. No live schedule, availability, fare, ticket, or minimum-connection-time data is implied or fabricated.
