# FlyForSure Agency Finance Webapp — Architecture Review & Workflow Gap Analysis

*Prepared 2026-07-15 · Reviewed as a senior travel-platform architecture assessment of the current `main` branch (HEAD `3749a07`).*

---

## 1. Executive Summary

The app is an internal finance back-office for a flight agency (FlyForSure, Rome HQ). It manages the full money lifecycle around flight bookings: booking capture (manual, cryptic PNR paste, PDF/OCR), payment recording with proof evidence and verification, a derived double-entry ledger with open items and allocations, refund cases, booking servicing (amendments incl. concurrency-hardened date-change finalization, cancellations), expenses, statements, live alerts, RBAC user management, and a full security/audit module.

**Overall maturity:** The core financial workflows (payments → verification → ledger; date-change amendments) are unusually well-engineered — versioned saves, CAS-based finalization with idempotency fingerprints, an atomic Postgres RPC for payment verification, append-only audit logs. The weak points are at the **edges of the workflows**: silent client-side sync failures, a split-brain ledger (server vs client-derived), non-functional Settings, alerts that exist only in the browser, and several PRD-promised capabilities (statement delivery, P&L, reports, directories) that have no implementation.

Top 5 risks to address first:

| # | Risk | Severity |
|---|------|----------|
| 1 | Background save failures are invisible to users (`getSyncError()` is never consumed) — silent data divergence between the browser cache and the database | **High** |
| 2 | Split-brain ledger: server `ledger_entries` covers only verified payments; refund/amendment credits exist only as client-derived entries | **High** |
| 3 | `/api/finance/data` loads *every row of every collection* into memory + localStorage on login — no pagination; will hit browser storage limits and slow login as volume grows | **High** (scalability) |
| 4 | Alerts are recomputed per-browser, never persisted server-side, never delivered — no acknowledgment workflow, no email | **Medium** |
| 5 | Agent/supplier row scoping matches on free-text name aliases — renames or name collisions silently leak or hide records | **Medium** |

---

## 2. System Architecture

### 2.1 Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 5, React Router 7, lucide-react icons |
| Client-side OCR | tesseract.js + PP-OCRv5 (bundled models in `public/ocr/ppocrv5`), pdfjs-dist for PDF text |
| API (BFF) | Plain Node `http` server (`server/index.js`), no framework, port 8787 |
| Database | Supabase Postgres (project `ujcextipqebwatoykqry`), accessed **only** from the BFF with the service-role key; RLS restricts every table to `service_role` |
| Auth | Supabase Auth password grant, wrapped in an app-signed JWT (HS256) carried in an `HttpOnly SameSite=Lax` cookie; JWT embeds a server-side session id (`sid`) validated against `user_sessions` so sessions are revocable |
| File storage | Cloudflare R2 (payment proof evidence via presigned upload/view URLs, `server/r2.js`) |
| Dev workflow | `npm run dev` → `server/dev.js` spawns API + Vite together; Vite proxies `/api` → 8787 |

### 2.2 Backend-for-Frontend pattern

The browser never talks to Supabase. All reads/writes go through the Node BFF which:
- Enforces RBAC (role + 15 granular permissions, role templates + per-user overrides).
- Enforces row-level scoping for AGENT/SUPPLIER roles server-side (`server/financeAccess.js`, a port of the client `src/helpers/access.js`).
- Enforces payment-verification invariants (`server/paymentRules.js`) — only `verify_payments` holders can set VERIFIED; financial edits to a verified payment reset it.
- Writes append-only audit events and raises security alerts.

### 2.3 Data model philosophy

Finance collections (`bookings`, `payments`, `refunds`, `amendments`, `cancellations`, `expenses`, `allocations`) are **JSONB documents with client-generated text IDs**; the web app owns the record shape. Generated columns (`pnr`, `booking_ref`, `invoice_no`, `booking_id`) exist purely for filtering/joins. Structured relational tables exist only where invariants demand them: `payment_proofs`, `payment_proof_ocr`, `ledger_entries`, `audit_events`, plus the security module (`login_history`, `user_sessions`, `security_alerts`, `audit_logs`) and identity (`profiles`, `permissions`, `role_templates`, `user_permissions`).

### 2.4 Client data layer

`src/helpers/storage.js` implements a **synchronous in-memory cache** loaded once after login via `GET /api/finance/data`, mirrored to localStorage. Two write paths coexist:

- **Legacy path** (payments, refunds, cancellations, expenses, allocations, bookings from most pages): update cache immediately, push to server **in the background, fire-and-forget**.
- **Modern path** (amendments, date-change finalization): `await` server acceptance before updating the cache, so lifecycle/CAS conflicts surface in the modal.

### 2.5 Ledger engine

`src/helpers/ledger.js` (1,229 lines, unit-tested) derives a continuous double-entry ledger **deterministically from documents** — verified+posted payments and approved refund/amendment credits produce entries; allocations are stored settlement records that never change balances. Sign convention: DEBIT increases what a counterparty owes FlyForSure. Separately, the server RPC `verify_and_post_payment` writes *persistent* `ledger_entries` rows (cash/bank account vs counterparty account) at payment-verification time, atomically with the status flip.

---

## 3. Feature Inventory (as implemented)

### 3.1 Bookings (`/bookings`, `src/pages/Bookings.jsx` — 2,084 lines)
- Manual booking entry form (route/passengers, pricing & supplier, flight details incl. multi-segment, contact & payment, auto-calculated fields).
- **Cryptic PNR paste** with Amadeus/Sabre auto-detection and confidence scoring (`POST /api/bookings/parse-pnr`), draft review before commit.
- **PDF ticket upload** with client-side OCR (PP-OCRv5/tesseract) → text → server parser (`POST /api/bookings/parse-text`).
- List/filter, column pickers, CSV export.
- Multi-passenger bookings grouped by `booking_ref` (lowest invoice of the PNR group; one-time client migration `migrateBookingRefs()`).

### 3.2 Booking Detail (`/bookings/:invoiceNo`, 1,111 lines, uncommitted changes in progress)
- Full booking group view; **Servicing cases panel** (amendments/cancellations/refunds per booking); **Activity Timeline** interleaving payments, refunds, amendments, notes; date-reissue (PNR/ticket before→after) history.

### 3.3 Payments (`/payments`, `/payments/verification`)
- Record payments (customer/agent receipts, supplier outbound) via `PaymentRecordModal` (multi-mode: bank, cash, UPI, POS, gateway).
- **Payment proof evidence flow**: create presigned R2 upload → client OCR extraction → complete upload with OCR metadata (`payment_proofs` + `payment_proof_ocr` tables). Signed view URLs with ownership/permission checks.
- **Verification workflow**: dedicated queue page; verify posts to the persistent ledger atomically via the `verify_and_post_payment` RPC (row lock, void-then-repost, audit event, partial unique index preventing duplicate active entries). Unverify voids ledger entries (best-effort).
- Agents may submit payments (always land unverified); suppliers cannot write.

### 3.4 Ledgers (`/accounts`, `/accounts/:accountKey`)
- Consolidated view: receivable, credits held, supplier payable, unallocated payments, reconciliation errors.
- Per-account detail with running balance, open items, allocation records; `AllocationModal` supports auto-allocation (oldest-first, due-date-first) and manual ticket selection across 8 allocation types.

### 3.5 Refunds (`/refunds`)
- Refund case lifecycle: `REQUESTED → IN_PROCESS → APPROVED → PARTIALLY_SETTLED → SETTLED` (+ REJECTED/CANCELLED), per-ticket keying, payout creation and credit allocation actions, stats tiles, CSV export.

### 3.6 Booking Servicing — Amendments & Cancellations
- 10 amendment types in two flows (see `docs/amendment-workflow-guide.md`):
  - **Group B** (name/route/cabin/baggage/other): posts at CONFIRMED, manual COMPLETED.
  - **Group A (date change)**: QUOTED → CUSTOMER_APPROVED → **FINALIZING → COMPLETED** via `POST /api/amendments/finalize` — CAS on `updated_at`, unique-constraint claim, idempotency fingerprint, itinerary-cohort validation ("one itinerary at a time"), atomic PNR/ticket/itinerary rewrite + posting, safe **Retry Finalization** recovery. This is the strongest workflow in the system.
- Cancellation cases never post to the ledger; they record scope/reason and may spawn a refund case.
- Versioned, immutable-after-posting saves for bookings & amendments (`saveVersionedFinanceRecord`).

### 3.7 Expenses (`/expenses`)
- Fixed/recurring vs variable expense entry, stats, CSV export. No approval chain.

### 3.8 Statements (`/statements`)
- Daily statements per agent/supplier party, admin summary, CSV export. **No delivery mechanism.**

### 3.9 Alerts (`/alerts`)
- Auto-flagged from bookings/payments/refunds at render time (`generateAlerts` in `calculations.js`): overdue payment, urgent departure (0–14 day window), follow-up, pending/escalated refunds (>45 days). Severity tiles (CRITICAL/URGENT/WARNING), CSV export. **Computed client-side only.**

### 3.10 Dashboard (`/`)
- Role-scoped summary (admin/employee vs agent vs supplier variants): stat tiles, processing health, latest bookings.

### 3.11 Users & RBAC (`/users`)
- Admin CRUD for users (4 roles: ADMIN, EMPLOYEE, AGENT, SUPPLIER), temp-password provisioning with forced change, suspend/reactivate (bans the auth user + revokes sessions), bulk actions, per-user permission overrides, role-template editor, per-user audit log viewer.
- 15 permission keys spanning bookings/payments/refunds/financials/statements/users/audit/settings.

### 3.12 Security module (`/security`, 6 tabs)
- Overview KPIs (logins today, failures, blocked, open alerts, active sessions, 7-day high-risk events, repeated-failure users, suspicious IPs).
- Login history (180-day window, rich filters), enriched audit trail, session registry with **force logout** (single / per-user / emergency all), security alerts triage (OPEN → UNDER_REVIEW → RESOLVED/FALSE_POSITIVE), per-user investigation timeline.
- Login risk scoring (new device/location, failure counts), account lockout after threshold, append-only log protection triggers, export logging with large-export alerts.

### 3.13 Global booking lookup
- Header search across PNR/passenger/ticket/invoice/sector/mobile with relevance scoring, jump-to-detail.

---

## 4. API Endpoint Catalog

All endpoints are served by the BFF on `:8787`, proxied under `/api`. Auth = session cookie unless noted.

### Auth
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Password login; lockout after repeated failures (429); risk assessment; sets session cookie |
| POST | `/api/auth/logout` | session | Ends server session, clears cookie |
| GET | `/api/auth/me` | session | Current profile + effective permissions |
| POST | `/api/auth/change-password` | session | Min 10 chars; revokes all *other* sessions |

### Booking parsing
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/bookings/parse-pnr` | none ⚠️ | Cryptic PNR → drafts; Amadeus/Sabre auto-detect |
| POST | `/api/bookings/parse-text` | none ⚠️ | Generic text/PDF-text → booking drafts |

⚠️ *Both parse endpoints perform no auth check — see gap G-13.*

### Finance data
| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/finance/data` | session | ALL collections, permission-filtered per collection, row-scoped for agent/supplier |
| PUT | `/api/finance/{collection}/{id}` | writer perms per collection | Upsert one record; versioned/immutability rules for bookings & amendments; verification rules for payments |
| POST | `/api/finance/{collection}/bulk` | writer perms | Bulk import (used for pre-database localStorage migration) |
| POST | `/api/amendments/finalize` | bookings + amendments writer | Atomic date-change finalization (CAS + idempotency fingerprint) |

Collections & write permissions: `bookings` (create/edit_bookings), `payments` (record_payments; AGENT allowed), `refunds` (process_refunds), `amendments`/`cancellations` (edit_bookings or process_refunds), `expenses` (edit_financials), `allocations` (record_payments/process_refunds/edit_financials; AGENT/SUPPLIER blocked).

### Payment proofs
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/payments/{id}/proof-upload` | Reserve proof row + presigned R2 PUT; payment parked at PENDING_UPLOAD |
| POST | `/api/payments/{id}/proof-complete` | Attach proof + OCR result; re-runs verification rules; may verify+post atomically |
| GET | `/api/payments/{id}/proofs/{proofId}/view-url` | Signed view URL (permission or record-owner check) |

### Directory & admin
| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/directory/users` | session | Active users with party ids (for pickers) |
| GET/POST | `/api/admin/users` | admin/manage_users | List / create (temp password) |
| PATCH | `/api/admin/users/{id}` | admin | Update role/status/links/permissions; suspend revokes sessions |
| POST | `/api/admin/users/{id}/reset-password` | admin | Temp password + revoke all sessions |
| POST | `/api/admin/users/bulk` | admin | Bulk suspend/reactivate |
| GET | `/api/admin/users/{id}/audit-logs` | admin/view_audit_logs | Last 50 events for target |
| GET | `/api/admin/role-templates` | admin | Templates + permission catalog |
| PUT | `/api/admin/role-templates/{role}` | admin | Update template (audited + alerted) |

### Security module
| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/security/overview` | admin/view_audit_logs | KPI dashboard |
| GET | `/api/security/login-history` | admin/view_audit_logs | Filterable, 180-day floor, export-logged |
| GET | `/api/security/audit-trail` | admin/view_audit_logs | Filterable, export-logged |
| GET | `/api/security/sessions` | admin/view_audit_logs | Session registry (hash never exposed) |
| GET | `/api/security/alerts` | admin/view_audit_logs | Security alerts |
| GET | `/api/security/timeline?user=` | admin/view_audit_logs | Per-user investigation bundle (itself audited) |
| POST | `/api/security/sessions/{id}/revoke` | ADMIN only | Force logout one session |
| POST | `/api/security/users/{id}/revoke-sessions` | ADMIN only | Force logout a user |
| POST | `/api/security/sessions/revoke-all` | ADMIN only | Emergency logout everyone (except caller) |
| PATCH | `/api/security/alerts/{id}` | ADMIN only | Triage alert status |

### Misc
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health*` | Liveness (prefix match, unauthenticated) |

---

## 5. Database Schema Summary

| Table | Kind | Notes |
|---|---|---|
| `profiles`, `permissions`, `role_templates`, `user_permissions` | relational | Identity & RBAC |
| `bookings`, `payments`, `refunds`, `expenses` | JSONB doc | Generated cols: pnr, booking_ref, invoice_no |
| `amendments`, `cancellations`, `allocations` | JSONB doc | Servicing cases + settlements (migrated 2026-07-05) |
| `payment_proofs`, `payment_proof_ocr` | relational | R2 evidence metadata, OCR extraction, statuses |
| `ledger_entries` | relational | Double-entry rows, void support, partial unique index `(payment_id, entry_side, account_key) where voided_at is null` |
| `audit_events` | relational | Finance-side audit (verify/post) |
| `audit_logs`, `login_history`, `user_sessions`, `security_alerts` | relational | Security module; append-only protected |
| RPC `verify_and_post_payment` | plpgsql | Row-lock, void+repost, audit — service_role only |

All tables RLS-enabled, service-role-only policies (correct for the BFF pattern).

---

## 6. Workflow Gap Analysis

### A. Data-integrity & consistency gaps

**G-1 (High) — Silent background-save failures.**
`storage.js` legacy path pushes writes fire-and-forget; on failure it sets `syncError` and logs to console. `getSyncError()` is exported but **never called by any page**. A user recording a payment or expense on a flaky connection (or hitting a server-side validation rejection) sees success locally while the database — and every other user — never receives the record. The mismatch persists in localStorage across reloads until the next successful `loadFinanceData` overwrites it, at which point the record vanishes without explanation.
*Recommendation:* Surface `syncError` globally (toast/banner + retry queue), or migrate all collections to the awaited "modern path" used by amendments.

**G-2 (High) — Split-brain ledger.**
Persistent `ledger_entries` rows exist only for **verified payments** (via the RPC). Refund credits, amendment charges/credits, and open-item balances are derived **client-side** in `ledger.js` from documents. Two consequences: (a) there is no server-side authoritative balance — any reporting/reconciliation outside this SPA re-derives from JSONB documents; (b) the amendment finalization "posts to the ledger" only in the sense that the document reaches a status the client-side derivation recognizes — nothing lands in `ledger_entries`.
*Recommendation:* Extend the RPC pattern — post amendment/refund credit entries into `ledger_entries` at their respective posting milestones, and make the client derivation a *view* of server entries rather than a parallel source of truth.

**G-3 (High) — Full-dataset loading, no pagination.**
`GET /api/finance/data` returns every row of 7 collections; the client caches all of it in memory **and mirrors it to localStorage**. With payment-proof metadata embedded in payment JSON, a few thousand bookings/payments will (a) slow login, (b) exceed localStorage quota (~5 MB) causing write exceptions, (c) make the global lookup scan the entire dataset per keystroke.
*Recommendation:* Server-side pagination/filtering per page; drop the localStorage mirror (its purpose — pre-database import — is complete); or move to incremental sync (updated_since cursor).

**G-4 (Medium) — Check-then-insert race in `upsertFinanceRow`.**
SELECT-then-POST/PATCH is not atomic; two users creating the same id concurrently → unhandled unique-constraint 500 (only the finalization path handles conflicts). Low likelihood with UUID ids, but the bulk-import path and booking-ref based flows raise the odds.
*Recommendation:* Use PostgREST upsert (`Prefer: resolution=merge-duplicates`) or handle 23505 uniformly.

**G-5 (Medium) — Best-effort ledger voiding on unverify.**
`voidPaymentLedgerEntries` swallows failures with a console warning ("best effort during rollout"). If it fails, a payment shows UNVERIFIED while its ledger entries remain active — the exact inconsistency the RPC was built to prevent on the verify side.
*Recommendation:* Move unverify into its own RPC (mirror of `verify_and_post_payment`), now that the rollout is complete.

**G-6 (Medium) — Name-alias row scoping.**
Agent/supplier visibility matches lower-cased free-text fields (`bill_to_name`, `booked_by`, `supplier_name`, even `airline`) against profile name/email/linked ids. Renaming a user, typos in `bill_to_name`, or an agent named like an airline silently changes what a counterparty can see — in both directions (leak or blind spot).
*Recommendation:* Stamp `agent_id`/`supplier_id` (profile/party UUIDs) onto records at write time and scope on ids only; keep alias matching as a migration-era fallback flag, not the primary rule.

**G-7 (Low) — No delete/void workflow for documents.**
There are no DELETE endpoints (defensible append-only stance), but there is also no *void/archive* status for an erroneous booking or expense — mistakes live forever in lists, statements, and alert calculations. Amendments have the "new case supersedes" doctrine; plain documents have nothing.
*Recommendation:* Add a `VOIDED` status honored by calculations/alerts/statements, with audit.

### B. Missing or stub workflows (vs PRD)

**G-8 (High) — Statements are generated but never delivered.**
PRD §3.6.4 specifies scheduling & email delivery; the `send_statements` permission exists in the catalog but **no code path uses it**, and there is no email transport anywhere in the repo (security alerts note "console-logged only"). Statements page = on-screen + CSV only.

**G-9 (High) — Settings page is a non-functional stub.**
`Settings.jsx` renders uncontrolled inputs (`defaultValue`) with no state, no save handler, no backend endpoint. Default currency and the alert threshold (14 days) are actually hardcoded in `calculations.js`. The `configure_settings` permission gates a page that configures nothing. PRD §3.8.1 (custom statuses), §3.8.2 (custom fields), §3.8.3 (email config) unimplemented.

**G-10 (Medium) — Alerts have no lifecycle.**
Alerts are recomputed on render, per browser. The `ffs_alerts` localStorage key and `saveAlert()` exist but alerts are **not** a server collection. No acknowledge/snooze/assign, no dedup across users, no email notifications (PRD §3.7.4), no configurable thresholds (§3.7.5), no in-app widget (§3.7.6). Two staff members can chase the same overdue booking with no record either is on it.

**G-11 (Medium) — Reporting suite absent.**
PRD §3.6.3 P&L auto-calculation, §3.6.5 monthly comparison, §3.9.1 pre-built reports, §3.9.2 custom report builder — none implemented. Expenses page shows totals only; the ledger engine has the data to power a real P&L but nothing consumes it that way.

**G-12 (Medium) — No agent/supplier party directory.**
PRD §3.8.5. Parties exist only as free-text names scattered across records plus optional `linked_agent_id`/`linked_supplier_id` on profiles. No CRUD, no dedup, no contact data (needed for statement delivery anyway). This is the root cause of G-6.

**G-13 (Medium) — Parse endpoints are unauthenticated.**
`POST /api/bookings/parse-pnr` and `/parse-text` never call `currentUser`. Low data-exposure (they only transform submitted text) but they're free compute for anyone who can reach the port, and they leak parser behavior. One-line fix.

**G-14 (Low) — CSV/Excel bulk upload UI missing.**
PRD §3.2.1. The `/bulk` endpoint exists but is only reachable via the one-time localStorage import prompt; there's no user-facing "upload a spreadsheet of bookings" flow. (PDF extraction, §3.2.2, *is* implemented.)

**G-15 (Low) — Refund receipt (PRD §3.5.6) not implemented** — no printable receipt view; refund detail modal has no print path.

**G-16 (Low) — Group B amendment completion is honor-system.**
"Mark Completed" is a manual click with no checklist/evidence (e.g., reissued ticket number capture like Group A has). Cases can idle at CONFIRMED forever; nothing surfaces stale servicing cases.

### C. Security & operational gaps

**G-17 — Known security gaps** (tracked from the 2026-07-02 module build, still open): no MFA/TOTP enforcement (enum exists), no IP allowlisting, no re-auth before sensitive actions (e.g., emergency revoke-all, role changes), alert notification transport is console-only, no simultaneous-distant-location detection.

**G-18 — No CSRF token.** Mitigated by `SameSite=Lax` + JSON bodies, but state-changing endpoints have no explicit CSRF defense; consider an origin check at minimum.

**G-19 — No global rate limiting.** Login has lockout; every other endpoint (incl. unauthenticated parse endpoints) is unthrottled.

**G-20 — Single-process server, no deployment story.** No Dockerfile/process manager/CI config in-repo; `NODE_ENV=production` only toggles the cookie `Secure` flag. Vite `dist/` is built but nothing serves it (the BFF serves only `/api`).

**G-21 — Session fixed at 8h with no sliding renewal** — `last_activity` is tracked but expiry never extends; active users get hard-logged-out mid-shift.

---

## 7. Suggested Roadmap (priority order)

1. **Close the write-path trust gap** (G-1, G-4): global sync-error surfacing or awaited saves everywhere; uniform conflict handling.
2. **Unify the ledger** (G-2, G-5): server-side posting RPCs for refund/amendment credits + unverify; client renders server entries.
3. **Authenticate the parse endpoints** (G-13) — trivial, do immediately.
4. **Party directory** (G-12) then **id-based scoping** (G-6).
5. **Pagination / incremental sync** (G-3) before data volume forces it.
6. **Email transport** (one integration unlocks G-8 statements, G-10 alert notifications, G-17 security notifications, and the PRD's temp-password delivery).
7. **Real Settings** (G-9): persist currency/threshold, feed them into `calculations.js`.
8. **Alert persistence + acknowledgment** (G-10), then reporting/P&L (G-11).

---

## Appendix A — Permission catalog

`view_bookings, create_bookings, edit_bookings, view_payments, record_payments, verify_payments, view_refunds, process_refunds, view_financials, edit_financials, view_statements, send_statements (unused), manage_users, view_audit_logs, configure_settings (gates a stub)`

## Appendix B — Key reference documents in-repo

- `docs/amendment-workflow-guide.md` — plain-English amendment lifecycle (accurate to code as of 2026-07-12).
- `docs/superpowers/specs/2026-07-12-date-change-amendment-design.md` — date-change design spec.
- `Finance Webapp PRD/Finance_Webapp_PRD.md` — original PRD (source of §6.B gap references).
- `BOOKING_DETAIL_IMPLEMENTATION.md` — booking detail page implementation notes.
