# Booking Servicing Finance Workflow (Amendment + Cancellation + Refund) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded void/cancel/amend/refund quote modals on BookingDetail with input-driven amendment cases, cancellation cases, and refund cases that post to the existing continuous ledger only at their spec-defined lifecycle points.

**Architecture:** Documents (amendment/cancellation/refund cases) are stored collections; the ledger and open items stay derived deterministically in `src/helpers/ledger.js` (`buildFinanceModel`), so posting rules live in one place. New modals are separate components using the existing design-system classes (`modal-card`, `modal-form-grid`, `auto-preview-list`, `badge`, `btn`). New collections are server-backed through the same jsonb-table pattern as refunds.

**Tech Stack:** React (JSX, inline + index.css design system), Node API server (`server/index.js`), Supabase jsonb tables, `node --test` for ledger unit tests.

## Global Constraints

- No hardcoded financial values anywhere in React components or helpers (no 10% cancellation, EUR 5/25/10/115 fees).
- All financial amounts are input-driven; the system only computes derived totals.
- Ledger changes happen ONLY at: amendment CONFIRMED (charge/credit + open item), refund APPROVED (REFUND_CREDIT + auto-offset), refund payout VERIFIED (existing payment verification queue). Cancellation cases NEVER post to the ledger.
- Net refund credit is floored at 0 (`netRefundCredit >= 0`).
- Label "Expected Refund Credit", never "Refund Amount", on cancellation estimates.
- Posted cases are not editable (amounts/currency/counterparty locked after posting).
- Currency: EUR (existing `formatCurrency`).

---

### Task 1: Ledger engine — amendment cases, cancellation helpers, refund fee fields, multi-line settlement

**Files:**
- Modify: `src/helpers/ledger.js`
- Test: `src/helpers/ledger.test.js`

**Produces:**
- `AMENDMENT_TYPES`, `AMENDMENT_CASE_STATUSES` (DRAFT, QUOTE_PENDING, QUOTED, CUSTOMER_APPROVED, REJECTED, CONFIRMED, COMPLETED, CANCELLED)
- `CANCELLATION_SCOPES`, `CANCELLATION_CATEGORIES`, `CANCELLATION_CASE_STATUSES` (DRAFT, REQUESTED, CONFIRMED, COMPLETED, REJECTED, REVERSED)
- `nextAmendmentNumber(amendments)` -> `AMD-000001`, `nextCancellationNumber(cancellations)` -> `CAN-000001`
- `amendmentTotalImpact(amendment)` = fare_difference + supplier_change_fee + flyforsure_service_fee + agent_markup + tax_difference + other_charges (may be negative)
- `isAmendmentPosted(amendment)` = status in (CONFIRMED, COMPLETED)
- `cancellationEstimate(c)` = { deductions, expectedRefundCredit } from gross/airline/ffs/markup/processing/other inputs
- `netRefundCredit` additionally subtracts `processing_fee` and adds `adjustment_amount`
- `buildFinanceModel({ ..., amendments })`: posted amendments produce ledger entries (`AMENDMENT_CHARGE` debit / `AMENDMENT_CREDIT` credit) and open items (`amendment:{id}`, item_type `AMENDMENT_RECEIVABLE` side DEBIT, or `AMENDMENT_CREDIT` side CREDIT)
- `refundSettlementPreview` supports `refund.refund_lines` (multi-ticket): outstanding summed across line tickets; returns `bookings` list for offset allocation
- `isAllocationEffective` handles source_type `AMENDMENT_CREDIT`

- [x] Add vocab/constants, number generators, `amendmentTotalImpact`, `cancellationEstimate`
- [x] Extend `netRefundCredit` with processing_fee/adjustment_amount
- [x] Wire amendments into `buildFinanceModel`, `getAccountLedger`, `getAccountOpenItems`
- [x] Extend `refundSettlementPreview` for refund_lines
- [x] Add tests: amendment charge posts on CONFIRMED only; negative amendment total posts credit; net refund credit with processing fee + adjustment; multi-line settlement preview; cancellation estimate
- [x] `node --test src/helpers/ledger.test.js` passes

### Task 2: Remove hardcoded quote calculators

**Files:**
- Modify: `src/helpers/calculations.js` (delete `calculateVoidQuote`, `calculateCancelQuote`, `calculateAmendQuote`, `calculateRefundQuote`)
- Modify: `src/pages/BookingDetail.jsx` (drop imports; done in Task 5)

- [x] Delete the four quote functions; grep confirms no remaining references after Task 5

### Task 3: Collections — storage, server, SQL

**Files:**
- Modify: `src/helpers/storage.js` (add `CANCELLATIONS` key + getters; add amendments & cancellations to `SERVER_COLLECTIONS`)
- Modify: `server/index.js` (`FINANCE_COLLECTIONS` += amendments/cancellations; `handleFinanceData` fetch list)
- Modify: `server/financeAccess.js` (`scopedFinanceData` scopes both by pnr)
- Create: `supabase/06_servicing_tables.sql` (amendments + cancellations jsonb tables, same pattern as refunds)

- [x] Storage: `getCancellations`/`saveCancellation`, server collections updated
- [x] Server: permissions view `view_bookings`, write `['edit_bookings','process_refunds']`
- [x] SQL file written; applied to Supabase via MCP (connector authorized per memory)

### Task 4: Modal components (design-system classes only)

**Files:**
- Create: `src/components/AffectedItemsPicker.jsx` — checkbox chip multi-selects for passengers / tickets / segments derived from the booking group
- Create: `src/components/AmendmentCaseModal.jsx` — spec §4–§7: scope section, requested change (current values read-only), financial inputs incl. negative fare difference, computed total, buttons Save Draft / Create Quote / Confirm Amendment; status transitions for existing cases; locked once posted
- Create: `src/components/CancellationCaseModal.jsx` — spec §9–§11: scope, category, reason, supplier ref, date, remarks, financial estimate inputs, computed deductions + EXPECTED REFUND CREDIT, buttons Save Cancellation Draft / Confirm Cancellation (+ optional linked refund case creation, status REQUESTED, estimate copied)
- Create: `src/components/RefundCaseModal.jsx` — spec §14–§22, §29: header (party auto, category, remarks), affected items, per-ticket lines table (original sell / allocated / outstanding fetched from model; gross + fee inputs per line; net per line), case totals, settlement preview (offset, account credit vs payout due, remaining balance), button Create Refund Case (status REQUESTED)

- [x] All three modals render from BookingDetail and save documents via storage helpers

### Task 5: BookingDetail rewire

**Files:**
- Modify: `src/pages/BookingDetail.jsx`

- [x] Cancel dropdown scopes -> ENTIRE_BOOKING / SELECT_PASSENGERS / SELECT_TICKETS / SELECT_SEGMENTS (opens CancellationCaseModal with scope preset)
- [x] Amend -> AmendmentCaseModal; Apply refund button renamed "Create Refund Case" -> RefundCaseModal
- [x] Void modal keeps confirm but no fabricated amounts
- [x] "Servicing cases" card lists amendment + cancellation cases with status badges and Manage buttons
- [x] Timeline events for cancellation cases, amendment cases, refund cases with financial detail (spec §36)

### Task 6: Refunds page approval supports refund_lines

**Files:**
- Modify: `src/pages/Refunds.jsx` (`handleApprove` allocates the credit across every line ticket via `buildAutoAllocation`; New Refund form gains processing fee + adjustment inputs)

- [x] Multi-ticket refund approval offsets each ticket receivable

### Task 7: Verification

- [x] `node --test src/helpers/*.test.js server/*.test.js` all pass
- [x] `npm run lint` clean
- [x] `npm run build` succeeds
- [x] App boot verified via dev server + browser: login page renders, zero console errors (full authenticated flow needs login credentials, so posting behavior is covered by the ledger unit tests instead)
