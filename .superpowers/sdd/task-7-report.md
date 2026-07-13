# Task 7 Report: One-Screen Booking Audit and Activity Timeline

## Status

Implemented and verified.

## TDD evidence

- The required pure `amendmentTimelineSummary` assertion was already present in commit `3c39f830`; it covers passenger-wise scope, outbound direction, affected passenger, `ABC123 → SPLIT9`, and `OLD-TKT-1 → NEW-TKT-1`.
- Baseline command: `node --test src/helpers/dateChangeAmendments.test.js`
- Baseline result: 22 tests passed, 0 failed. The requested output was not missing, so no artificial RED was introduced and the existing assertion was left unchanged.

## Implementation

- Booking Detail still groups rows by stable `booking_ref` (with the existing invoice fallback for legacy rows).
- Payments, refunds, amendments, and cancellations now use `recordMatchesBookingGroup`; `groupPnrs` comes from `groupPnrAliases`, keeping old- and current-PNR records visible through one filter without duplicating source records.
- Completed modern date changes use `finalized_at` and `finalized_by` in the timeline and combine `amendmentTimelineSummary` with posted charge/credit state and remarks.
- Servicing rows show the stored date-change audit summary while Manage continues to open the existing completed case in the modal's read-only state with stored itinerary and quote snapshots.
- Current itineraries are grouped by a canonical snapshot that ignores internal ids and object-key order. Identical group itineraries render once; divergent itineraries render separately with every applicable passenger name, current PNR, and ticket.
- Legacy/non-date amendment detail branches and all existing booking actions remain in place.

## Verification

- Focused identity/domain/ledger/calculation suite:
  `node --test src/helpers/dateChangeAmendments.test.js src/helpers/bookingIdentity.test.js src/helpers/ledger.test.js src/helpers/calculations.test.js`
  — 54 passed, 0 failed.
- Changed-file lint:
  `npx eslint src/pages/BookingDetail.jsx src/helpers/dateChangeAmendments.js`
  — exit 0.
- Production build:
  `npm run build`
  — exit 0; 1,853 modules transformed.
- Full Node suite (run once):
  `node --test`
  — 160 passed, 0 failed.
- `git diff --check` — exit 0.

## Self-review

- Duplicate finance records: each collection is filtered once; paid/balance uses the same payment array, so aliases cannot append the same record twice.
- Passenger itineraries: semantic grouping collapses identical snapshots and exposes all passenger contexts whenever snapshots diverge.
- Legacy records: rich audit rendering is gated on stored original/replacement/reissue snapshots; legacy and non-date rendering paths are unchanged.
- Timeline metadata: completed snapshot-backed date changes source timestamp/actor only from `finalized_at`/`finalized_by`.

## Concern

- Vite retains the existing large-chunk warning (main bundle above 500 kB); the build succeeds and Task 7 does not add a dependency.
