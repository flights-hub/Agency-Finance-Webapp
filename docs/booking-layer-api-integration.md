# Booking Layer Integration API

This document specifies the API surface required to connect **Agency-Finance-Webapp** (the
finance back-office) to an **external booking layer** (GDS, airline NDC platform, OTA/booking
engine, or an internal reservation system). It replaces today's manual/parsed booking entry
(cryptic text and PDF parsing in `server/bookingParser.js`) with a proper, real-time integration.

Scope is data and business logic only — endpoint contracts, payloads, statuses, and the rules
that govern how incoming booking-layer events must be reconciled against the finance ledger.

---

## 1. Integration model

Two directions of data flow:

1. **Inbound (booking layer → finance app)** — the booking layer is the system of record for
   itineraries, fares, ticketing, and cancellations. It pushes events via webhooks and/or the
   finance app pulls via sync endpoints.
2. **Outbound (finance app → booking layer)** — the finance app is the system of record for
   money. It reports back payment status and balance so the booking layer can gate actions
   (e.g., block ticketing until required deposit is verified).

The finance app never re-derives itinerary/fare data on its own — it only computes **financial**
state (balances, instalments, refund eligibility, supplier payables) from what the booking layer
reports.

---

## 2. Authentication & transport

- All endpoints are namespaced under `/api/v1/booking-layer/*`.
- Server-to-server calls authenticate with a signed API key (`Authorization: Bearer <key>`)
  issued per booking-layer partner, scoped to a supplier/agency tenant.
- Inbound webhooks must be signed (HMAC-SHA256 over the raw body) with a shared secret per
  partner; the finance app rejects unsigned or stale (>5 min clock skew) requests.
- All write endpoints require an `Idempotency-Key` header. Replaying the same key with the same
  body returns the original result rather than creating a duplicate record.

---

## 3. Endpoints

### 3.1 Bookings

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/booking-layer/bookings` | Create a booking (one call per passenger row, matching the existing per-passenger `bookings` model) |
| `PATCH` | `/api/v1/booking-layer/bookings/{booking_id}` | Update mutable booking fields (itinerary, ticket status, fare) |
| `GET` | `/api/v1/booking-layer/bookings/{booking_id}` | Fetch current finance-side state of a booking |
| `GET` | `/api/v1/booking-layer/bookings?pnr={pnr}` | Fetch all passenger rows sharing a PNR |
| `POST` | `/api/v1/booking-layer/bookings/{booking_id}/ticket-status` | Report a ticketing lifecycle transition (issue, reissue, void) |
| `POST` | `/api/v1/booking-layer/bookings/{booking_id}/reprice` | Report a fare change on an existing, unticketed booking |

**Booking payload fields** (mirrors `bookings` table columns used by `server/bookingParser.js`
and `src/helpers/seedData.js`):

```json
{
  "pnr": "string",
  "booking_ref": "string",
  "invoice_no": "string",
  "booking_date": "date",
  "passenger_name": "string",
  "title": "MR|MRS|MS|MSTR|MISS",
  "pax_type": "ADT|CHD|INF",
  "dob": "date",
  "nationality": "string",
  "doc_type": "PASSPORT|ID_CARD",
  "doc_number": "string",
  "doc_country": "string",
  "doc_expiry": "date",
  "airline": "string",
  "flight_no": "string",
  "ow_rt": "OW|RT",
  "sector": "string",
  "outbound_date": "date",
  "inbound_date": "date|null",
  "flight_segments": [{ "id": "string", "label": "string", "connections": [] }],
  "ticket_no": "string|null",
  "ticket_status": "PENDING|TICKETED|REISSUED|VOIDED",
  "ticket_issue_date": "date|null",
  "previous_ticket_no": "string|null",
  "fare_type": "string",
  "fare_sold": "number",
  "fare_issued": "number",
  "currency": "EUR|INR|USD|GBP",
  "supplier_id": "string",
  "supplier_name": "string",
  "supplier_segments": [{ "segment_id": "string", "supplier_name": "string", "supplier_id": "string", "buying_price": "number" }],
  "bill_to_type": "AGENT|CUSTOMER",
  "bill_to_name": "string",
  "refund_flag": "boolean"
}
```

### 3.2 Payments

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/booking-layer/payments` | Register a payment event originating in the booking layer (e.g. card auth on booking engine checkout) |
| `GET` | `/api/v1/booking-layer/bookings/{booking_id}/balance` | Return computed balance/payment status for the booking layer to gate ticketing/servicing actions |
| `GET` | `/api/v1/booking-layer/bookings/{booking_id}/payments` | List posted payments for a booking |

**Payment payload fields** (mirrors `payments` table / `src/helpers/paymentVerification.js`):

```json
{
  "booking_id": "string",
  "pnr": "string",
  "payment_date": "date",
  "amount_paid": "number",
  "transaction_amount": "number",
  "transaction_currency": "EUR|INR|USD|GBP",
  "payment_mode": "CASH|BANK_TRANSFER|CREDIT_CARD|DEBIT_CARD|UPI|CHEQUE|POS_TERMINAL|ONLINE_PAYMENT|AUTO_DEBIT",
  "payment_direction": "RECEIVED|PAID",
  "party_type": "CUSTOMER|AGENT|SUPPLIER",
  "party_name": "string",
  "receipt_ref": "string"
}
```

`GET /balance` response:

```json
{
  "booking_id": "string",
  "fare_sold": "number",
  "total_paid": "number",
  "balance_due": "number",
  "payment_status": "UNPAID|PARTIAL|FULLY_PAID",
  "next_instalment_type": "ADVANCE|2ND|3RD|4TH|FINAL"
}
```

### 3.3 Cancellations & Refunds

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/booking-layer/cancellations` | Notify the finance app that a booking (or specific passengers) was cancelled |
| `GET` | `/api/v1/booking-layer/refunds/{ticket_no}` | Fetch refund status/eligibility for a ticket |
| `POST` | `/api/v1/booking-layer/refunds/{ticket_no}/status` | Report a refund lifecycle transition (e.g. supplier confirms refund received) |

**Cancellation payload fields** (mirrors `cancellations` table):

```json
{
  "booking_id": "string",
  "pnr": "string",
  "cancel_type": "FULL_BOOKING|CANCEL_PAX",
  "selected_passenger_ids": ["string"],
  "cancel_date": "date",
  "refund_category": "NO_SHOW|FLIGHT_CANCEL|VOLUNTARY|TAX_ONLY|MEDICAL_DEATH",
  "airline_penalty": "number",
  "service_fee": "number"
}
```

### 3.4 Amendments

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/booking-layer/amendments` | Notify the finance app of an itinerary change (date change, name correction, etc.) |
| `PATCH` | `/api/v1/booking-layer/amendments/{amendment_id}` | Update amendment status as it progresses through the booking layer's workflow |

**Amendment payload fields** (mirrors `amendments` table / `server/amendmentFinalization.js`):

```json
{
  "booking_id": "string",
  "pnr": "string",
  "amendment_type": "DATE_CHANGE|NAME_CORRECTION|ROUTE_CHANGE|OTHER",
  "application_scope": "PNR_WIDE|SELECTED",
  "selected_passenger_ids": ["string"],
  "original_itinerary": {},
  "new_itinerary": {},
  "status": "FINALIZING|CONFIRMED|COMPLETED"
}
```

### 3.5 Suppliers

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/booking-layer/suppliers/{supplier_id}/payables` | List outstanding supplier payables generated from booking-layer bookings |
| `POST` | `/api/v1/booking-layer/suppliers/{supplier_id}/settlements` | Report a settlement/payment made to a supplier outside the finance app |

### 3.6 Webhooks (booking layer → finance app)

| Event | Fired when |
|---|---|
| `booking.created` | New PNR/passenger created in the booking layer |
| `booking.updated` | Itinerary, fare, or passenger details changed |
| `ticket.issued` / `ticket.reissued` / `ticket.voided` | Ticketing status change |
| `booking.cancelled` | Full or partial cancellation |
| `amendment.requested` / `amendment.confirmed` | Servicing case lifecycle |
| `refund.supplier_confirmed` | Supplier confirms refund back to agency |

Each webhook delivers the same payload shape as the corresponding `POST`/`PATCH` endpoint above,
and must be acknowledged with `2xx` within 10 seconds or it is retried with exponential backoff
(up to 5 attempts).

### 3.7 Health

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/booking-layer/health` | Partner connectivity/auth check |

---

## 4. Business rules

These are the rules the finance app enforces regardless of what the booking layer sends,
carried over from the existing ledger logic (`src/helpers/calculations.js`,
`src/helpers/paymentVerification.js`, `server/financeRecordInvariants.js`):

1. **Money is derived, not asserted.** `total_paid`, `balance_due`, and `payment_status` are
   always computed server-side from posted payments against `fare_sold`; the booking layer
   cannot set them directly.
2. **Payment status thresholds**: `UNPAID` (nothing posted) → `PARTIAL` (0 < paid < fare_sold) →
   `FULLY_PAID` (paid ≥ fare_sold).
3. **Only "posted" payments count.** A payment only affects balance once
   `verification_status = VERIFIED` and it has passed ledger-posting checks. Payments reported by
   the booking layer as pending/unconfirmed do not reduce `balance_due` until verified.
4. **Instalment sequencing.** Instalments are auto-typed in order:
   `ADVANCE → 2ND → 3RD → 4TH → FINAL` (additional payments beyond FINAL are `EXTRA`). The
   booking layer cannot skip or relabel this sequence.
5. **PNR-shared totals are counted once.** For multi-passenger PNRs, only the first passenger row
   per PNR (`pnr_n === 1`) contributes to PNR-level aggregate totals, to avoid double-counting a
   shared fare/payment across passengers.
6. **Supplier payable defaults to `fare_issued`**, unless a specific `supplier_segments[].buying_price`
   override is supplied for that segment — that override takes precedence per segment.
7. **Refund eligibility formula** (fixed, not overridable by the booking layer):
   `eligible_refund = MAX(0, fare_sold - airline_penalty - service_fee)`.
8. **Refund status is a strict lifecycle**: `TO_APPLY → APPLIED → IN_PROCESS →
   RCVD_FROM_SUPPLIER → REFUNDED_TO_CLIENT`, or a terminal `REJECTED`. Transitions must be
   sequential — the API rejects a status update that skips a stage.
9. **Ticket status lifecycle**: `PENDING → TICKETED → REISSUED/VOIDED`. A `REISSUED` ticket must
   reference `previous_ticket_no`; the original ticket record is retained, not overwritten.
10. **Immutability**: once set, `booking_ref` and a confirmed amendment's `amendment_type` /
    `original_itinerary` cannot be changed by subsequent updates — corrections require a new
    amendment record, not a mutation of history.
11. **Cancellation scope**: `cancel_type = FULL_BOOKING` cancels every passenger under the PNR;
    `CANCEL_PAX` requires `selected_passenger_ids` and only affects those rows.
12. **Currency is fixed at booking creation.** `transaction_currency` on a payment must match one
    of `EUR|INR|USD|GBP`; the finance app does not perform FX conversion — cross-currency
    payments must be pre-converted by the booking layer before posting.
13. **Idempotent writes.** Re-sending the same `booking.created`/`payment` event with an unchanged
    `Idempotency-Key` must not create duplicate finance records; the finance app treats booking
    layer identifiers (`pnr`, `booking_ref`, `ticket_no`) as natural keys for de-duplication.
14. **Amendments gate on scope.** An amendment with `application_scope = SELECTED` must include
    `selected_passenger_ids`; finance impact (reissue fees, fare differences) is applied only to
    those passengers, not the whole PNR.
15. **No commission/markup endpoint.** The finance app computes agency margin as
    `profit = fare_sold - fare_issued`; there is no separate commission-rate field for the
    booking layer to populate today.

---

## 5. Error handling

- `400` — payload fails schema/enum validation (e.g. invalid `pax_type`, non-sequential refund
  status transition).
- `404` — referenced `booking_id` / `pnr` / `ticket_no` not found.
- `409` — conflicting write (e.g. attempt to mutate an immutable field, or a stale
  `Idempotency-Key` replay with a different body).
- `422` — business-rule violation (e.g. cancellation for a booking already fully refunded).
- `502` — booking layer webhook delivery could not be verified (signature mismatch).

All error responses:

```json
{ "error": { "code": "string", "message": "string", "field": "string|null" } }
```
