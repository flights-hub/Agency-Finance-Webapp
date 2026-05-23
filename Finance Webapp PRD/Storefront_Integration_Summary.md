# Storefront Office Model (v11) → Finance Webapp PRD Integration Summary

**Date:** May 2026  
**Integration Status:** Complete  
**PRD Version:** 1.0 (Storefront-Aligned)

---

## 1. What Was Integrated?

The FlyForSure **Storefront Office Model v11** — an operational Excel system deployed since Feb 2026 with 9,029 formulas across 10 interconnected sheets — has been fully integrated into the Finance webapp PRD. Key architectural patterns from the Storefront have been translated into web application requirements.

---

## 2. Core Architectural Elements Transferred

### 2.1 Multi-Installment Payment Ledger ✅

**From Storefront:** tblPayments (15 columns, 500 rows)
- Agent types only 5 fields (Date, PNR, Amount, Mode, Receipt Ref)
- System auto-calculates: Instalment Number, Type (ADVANCE → 2ND → FINAL), Running Balance

**To PRD:**
- **Section 3.4: Payment Ledger Architecture** — Complete breakdown of multi-installment design
- **Section 3.4.2-3.4.6:** Detailed workflows for recording payments, auto-sequencing, ledger views
- **Section 5.2:** Payment Ledger Entity with 5 manual + 9 auto-calculated fields
- **Data Model:** `instalment_no` and `instalment_type` auto-assigned (no dropdown selection)
- **Key Feature:** Variable amounts on irregular dates, no fixed payment schedule

### 2.2 Ticket-Number Keying (Not PNR-Only) ✅

**From Storefront:** Refund Tracker uses Ticket_No as primary key; Booking Tracker has PNR + per-passenger rows

**To PRD:**
- **Section 3.5.1-3.5.7:** Complete ticket-keyed refund architecture
- **Section 3.5.2:** Cancel Type auto-detection (from refund checkbox count)
- **Section 3.5.4:** Refund calculation & financial impact (supplier refund vs. customer refund)
- **Section 3.5.5:** Partial cancellation scenario (multi-passenger PNR with single refund)
- **Data Model (5.3):** Refund Tracker keyed by ticket_no with auto-derived cancel_type
- **Key Feature:** Enables per-passenger cancellations & amendments without affecting other passengers

### 2.3 Built-In Expense Tracker & P&L ✅

**From Storefront:** tblExpenses (12 categories, fixed vs. variable, branch tracking) + P&L Sheet

**To PRD:**
- **Section 3.6.1-3.6.6:** Complete expense tracking & P&L architecture
- **Section 3.6.1:** 12-category expense system (Rent, Salaries, Utilities, Marketing, etc.)
- **Section 3.6.3-3.6.4:** Full P&L Statement with Revenue, COGS, Expenses, Net Profit
- **Section 3.6.4:** Right Panel Analytics (collections, expenses by branch, fixed vs. variable, KPIs, cash flow)
- **Section 3.6.5:** Monthly P&L Comparison for trend analysis
- **Data Model (5.4):** Expense Tracker with 12 categories, multi-branch support, recurring flag
- **Key Features:**
  - Revenue = SUM(Fare_Sold), COGS = SUM(Fare_Issued), Expenses = SUM by category
  - Collections tracking (total, outstanding, collection rate %)
  - Fixed vs. variable breakdown
  - Cash position (Cash In - Cash Out)
  - Break-even analysis per passenger

### 2.4 Live Alerts System (Auto-Flagging) ✅

**From Storefront:** Days_To_Dep + Alert column (auto-calculated; ⚠️ URGENT, ⏰ FOLLOW UP, 🔴 OVERDUE, ✅ SETTLED)

**To PRD:**
- **Section 3.7: Live Alerts System** — Entire new section
- **Section 3.7.1:** 6 alert types with auto-detection conditions:
  - Overdue Payment (0-7 days to departure, unpaid)
  - Urgent Departure (upcoming 0-7 days)
  - Follow-Up Payment (8-14 days)
  - Voided/Rejected Refund
  - Pending Refund (processing > 30 days)
  - Escalated alerts (> 45 days)
- **Section 3.7.2-3.7.6:** Alerts Dashboard, Departure Alerts, Email notifications, In-app widgets, Settings
- **Data Model (5.5):** Alert Entity (auto-generated, never manual)
- **Key Feature:** Real-time operational signals; agents don't manually select alerts

### 2.5 Status Auto-Derivation (No Manual Selection) ✅

**From Storefront:** Payment_Status, Ticket_Status, Alert all auto-calculated from ledger data

**To PRD:**
- **Section 3.4.3:** Payment Status Auto-Derivation (UNPAID → PARTIAL → FULLY PAID)
- **Section 3.4.4:** Instalment Type Auto-Assignment (ADVANCE → 2ND → FINAL, no dropdown)
- **Section 3.5.2:** Cancel Type Auto-Detection (from checkbox count)
- **Section 3.7:** Alert Status Auto-Derivation (from days_to_departure + balance_due)
- **Design Principle:** Agents never manually select status; system calculates
- **Technical:** Database triggers/stored procedures for auto-population

### 2.6 First Passenger Per PNR Only (Prevent Double-Counting) ✅

**From Storefront:** PNR_N helper column; financial totals (Q, R, S, T) show only on PNR_N=1; subsequent passengers show "—"

**To PRD:**
- **Section 3.1.1:** Booking Detail field descriptions
- **Data Model (5.1):** `pnr_n` helper field (which passenger number in PNR: 1st/2nd/3rd)
- **Query Pattern:** SUMIF conditions include "AND pnr_n = 1" to prevent double-counting
- **Operational Rule:** Total_Paid, Balance_Due, Payment_Status show only on first passenger per PNR
- **Key Benefit:** Reduces confusion in multi-passenger bookings

### 2.7 Positive-Only Ledger (Refunds Separate) ✅

**From Storefront:** tblPayments never has negative amounts; refunds tracked in separate tblRefunds

**To PRD:**
- **Section 3.4:** Payment Ledger stores only positive payments
- **Section 3.5:** Refund Tracker is separate table with its own lifecycle
- **Design Principle:** Prevents confusion; clear audit trail; no offset logic needed
- **Financial Integrity:** Client refunds tracked separately from payment collections

### 2.8 Color-Coded Manual Fields ✅

**From Storefront:** Blue font = agent types, Black = auto-calculated, Green = auto-lookup, Purple = internal analytics

**To PRD:**
- **Implementation Note:** In webapp, blue = editable fields, gray = read-only/auto-calculated
- **UI Design:** Conditional formatting shows payment status (green = paid, red = unpaid, yellow = partial)
- **Alerts:** Color coding (red = critical, orange = urgent, yellow = follow-up, green = settled)

---

## 3. Feature Mapping

| Storefront Module | PRD Section | Status |
|------------------|-------------|--------|
| Booking Tracker (tblBookings) | 3.1 Booking Management | ✅ Full |
| Payment Ledger (tblPayments) | 3.4 Payment Recording | ✅ Full |
| Refund Tracker (tblRefunds) | 3.5 Refund Management | ✅ Full |
| Expense Tracker (tblExpenses) | 3.6 Expense Tracking | ✅ Full |
| P&L Statement | 3.6.3-3.6.5 P&L Analysis | ✅ Full |
| Invoice Receipt | 3.1.5 + Print | ✅ Adapted |
| Refund Receipt | 3.5.6 + Print | ✅ Adapted |
| Departure Alerts | 3.7.3 Departure Alerts | ✅ Full |
| Financial Summary | 3.8.1 Admin Dashboard | ✅ Adapted |
| Instructions | Help & Training | ✅ Planned |

---

## 4. Data Model Alignment

### Booking Ledger Equivalence

**Storefront Table: tblBookings**
```
A: SL
B: Invoice_No        → invoice_no (auto)
C: Booking_Date      → booking_date
D: Passenger_Name    → passenger_name
E: Pax_Type          → pax_type [ADT, CHD, INF]
F: Mobile            → mobile
G: Airline           → airline
H: PNR               → pnr
I: OW_RT             → ow_rt (auto: OW or RT)
J: Ticket_No         → ticket_no
K: Sector            → sector
L: Outbound_Date     → outbound_date
M: Inbound_Date      → inbound_date
N: Fare_Sold         → fare_sold
O: Fare_Issued       → fare_issued
P: Profit            → profit (auto)
Q: Total_Paid        → total_paid (auto from Ledger)
R: Balance_Due       → balance_due (auto)
S: Payment_Status    → payment_status (auto: UNPAID/PARTIAL/FULLY_PAID)
T: Num_Instalments   → num_instalments (auto)
U: Booked_By         → booked_by
V: Agent_Issued_By   → agent_issued_by
W: Ticket_Status     → ticket_status (auto: PENDING/TICKETED/REISSUED)
X: Days_To_Dep       → days_to_departure (auto)
Y: Alert             → alert (auto: URGENT/FOLLOW_UP/OVERDUE/SETTLED)
Z: Remarks           → remarks
AA: PNR_N            → pnr_n (helper, hidden)
AB: Refund           → refund_flag (checkbox)
```

**Storefront Table: tblPayments**
```
A: SL
B: Payment_Date      → payment_date
C: PNR               → pnr (FK)
D: Passenger_Name    → passenger_name (auto-lookup)
E: Amount_Paid       → amount_paid (manual)
F: Payment_Mode      → payment_mode (manual: CASH, BANK_TRANSFER, etc.)
G: Receipt_Ref       → receipt_ref (manual)
H: Inst_No           → instalment_no (auto COUNTIF)
I: Inst_Type         → instalment_type (auto: ADVANCE → 2ND → FINAL)
J: Received_By       → received_by (auto-lookup)
K: Cumulative_Paid   → cumulative_paid (auto running sum)
L: Total_Fare        → total_fare (auto-sum from Booking)
M: Remaining_Bal     → remaining_balance (auto: total - cumulative)
N: Remarks           → remarks
O: PNR_N             → pnr_n (helper)
```

**Storefront Table: tblRefunds**
```
A: SL
B: Ticket_No         → ticket_no (PK)
C: PNR               → pnr (auto-lookup from Booking)
D: Passenger_Name    → passenger_name (auto-lookup)
E: Airline           → airline (auto-lookup)
F: Sector            → sector (auto-lookup)
G: Fare_Sold         → fare_sold (auto-lookup)
H: Fare_Issued       → fare_issued (auto-lookup)
I: Cancel_Date       → cancel_date
J: Cancel_Type       → cancel_type (auto: FULL_BOOKING or CANCEL_PAX)
K: Refund_Category   → refund_category (manual dropdown)
L: Airline_Penalty   → airline_penalty (manual)
M: Service_Fee       → service_fee (manual)
N: Eligible_Refund   → eligible_refund (auto: MAX(0, fare - penalty - fee))
O: Supplier_Refund   → supplier_refund (manual: actual airline refund)
P: Refund_Status     → refund_status (manual chain: TO_APPLY → REFUNDED_TO_CLIENT)
Q: Status_Date       → status_date (manual)
R: Processing_Days   → processing_days (auto)
S: Refund_Mode       → refund_mode (manual: CASH, BANK_TRANSFER, etc.)
T: Remarks           → remarks
```

**Storefront Table: tblExpenses**
```
A: SL
B: Expense_Date      → expense_date
C: Category          → category (12 types: RENT, SALARIES, UTILITIES, etc.)
D: Description       → description
E: Vendor_Payee      → vendor_payee
F: Amount_EUR        → amount_eur
G: Payment_Mode      → payment_mode
H: Receipt_Ref       → receipt_ref
I: Branch_Office     → branch_office (multi-location)
J: Recurring         → recurring (YES/NO: fixed vs. variable)
K: Month             → month (auto-extracted from date)
L: Remarks           → remarks
```

---

## 5. Design Principles Inherited from Storefront

### Principle 1: Agent Simplicity First
- **Storefront:** Storefront agent enters only blue-colored fields; all other columns auto-calculate
- **Webapp:** Agent enters only editable (blue) fields; system auto-populates derived fields
- **Benefit:** Non-technical staff can use system without understanding formulas

### Principle 2: Formula-Driven Intelligence
- **Storefront:** 9,029 formulas do all business logic
- **Webapp:** Equivalent logic in stored procedures, triggers, API endpoints
- **Benefit:** Single source of truth; no conflicting calculation methods

### Principle 3: Status Never Manually Selected
- **Storefront:** Payment_Status, Ticket_Status, Alert all auto-derived
- **Webapp:** System calculates payment_status from ledger (never dropdown)
- **Benefit:** No inconsistency; always accurate

### Principle 4: Positive-Only Ledger
- **Storefront:** tblPayments never negative; refunds in separate tblRefunds
- **Webapp:** Payment Ledger stores only positive entries; Refund Tracker separate
- **Benefit:** Clear audit trail; simple reconciliation

### Principle 5: First Passenger Per PNR Only
- **Storefront:** Financial totals (Total_Paid, Balance) show only on PNR_N=1; others show "—"
- **Webapp:** Query logic includes "pnr_n = 1" filter to prevent double-counting
- **Benefit:** Reduces confusion in multi-passenger bookings

### Principle 6: Helper Columns (Don't Hide Complexity)
- **Storefront:** PNR_N, Inst_No visible (but hidden or grayed in UI)
- **Webapp:** pnr_n, instalment_no in data model; used in queries but not displayed
- **Benefit:** Transparent business logic; easy to audit

---

## 6. Technical Architecture Alignment

### Database Design
```
Storefront (Excel Tables):           Webapp (PostgreSQL):
  tblBookings (A4:AB204)       →       bookings table
  tblPayments (A4:O504)        →       payments table
  tblRefunds (A4:T204)         →       refunds table
  tblExpenses (A4:L304)        →       expenses table
  
  Pivot Tables (P&L)           →       Stored Procedures / Views
  Formulas (9,029)             →       Triggers / Computed Columns
  Named Ranges                 →       Database Constraints / Indexes
```

### Formula Patterns → Code Patterns
```
Storefront Formula:              Webapp Code:
  COUNTIF (sequence)     →       SELECT COUNT(*) ... WHERE pnr = $1
  SUMIF (totals)         →       SELECT SUM(amount) ... WHERE pnr = $1
  INDEX/MATCH (lookup)   →       JOIN ... ON pnr = ...
  IF (status logic)       →       CASE WHEN ... THEN ...
  TEXT (formatting)      →       DATE_FORMAT(...), CONCAT(...)
```

### Color Coding → CSS Classes
```
Storefront:                      Webapp:
  Blue font (manual)      →       input.editable, textarea.editable
  Black font (auto)       →       span.auto-calculated (read-only)
  Green font (lookup)     →       span.auto-lookup (read-only)
  Yellow bg (alert)       →       .alert-warning (background)
  Red bg (urgent)         →       .alert-danger (background)
```

---

## 7. Implementation Roadmap (4 Phases)

| Phase | Timeline | Key Deliverables | Storefront Equivalent |
|-------|----------|------------------|----------------------|
| Phase 1 (MVP) | 4-6 weeks | Bookings, Payments, Ledger, Dashboard | Storefront v1-v3 |
| Phase 2 (Core) | 6-8 weeks | Refunds, Expenses, P&L, Reports | Storefront v9-v10 |
| Phase 3 (Alerts) | 4-6 weeks | Live Alerts, Auto-Statements, Cryptic | Storefront v11 Full |
| Phase 4 (Polish) | 4-6 weeks | Advanced Analytics, Optimization, Scale | Storefront v11+ |

---

## 8. Success Criteria (Storefront-Inspired)

✅ **Agent Simplicity:** Storefront staff can enter bookings & payments without training within 2 hours
✅ **Formula Accuracy:** All financial calculations match manual verification (100% accuracy)
✅ **Auto-Calculations:** Zero manual status updates; all statuses auto-derived
✅ **Refund Lifecycle:** Per-ticket refunds work cleanly for full & partial cancellations
✅ **P&L Accuracy:** Net Profit auto-calculated with <1% variance from manual audit
✅ **Alert Precision:** Zero false positives; all alerts actionable
✅ **Time Savings:** Reduce statement prep time by 80% (5 hours/week → 1 hour/week)
✅ **User Adoption:** 80% of agents using system within 30 days of launch

---

## 9. Known Differences (Web vs. Storefront Excel)

| Aspect | Storefront Excel | Webapp |
|--------|------------------|--------|
| **Calculation Layer** | Formulas (9,029 cells) | Stored Procedures / Triggers |
| **Concurrency** | Single user at a time | Multi-user (database locks) |
| **Scalability** | 200-500 rows per table (max) | 100,000+ rows per table |
| **Backup** | Manual Excel save | Automated daily backups |
| **Audit Trail** | Manual change tracking | Automatic (100% logged) |
| **Multi-Location** | Branch column only | Full multi-tenant isolation |
| **Mobile** | Desktop Excel only | Responsive web (mobile-friendly) |
| **API** | None (manual entry) | RESTful API (future integrations) |

---

## 10. Future Integrations (Mentioned in Storefront Doc)

Storefront v11 mentions future integration with:
1. **Itinerary Processor (n8n)** — Parse GDS itineraries, paste into table
   - **Webapp:** Cryptic Booking entry (Phase 3) + CSV/Excel upload (Phase 2)
   
2. **FlyForSure Platform (Flysync)** — When platform reaches production
   - **Webapp:** API endpoints for bidirectional sync (Phase 4)
   
3. **Data Capacity Expansion** — Regenerate Excel with larger row limits
   - **Webapp:** PostgreSQL auto-scales; no manual limit changes needed

---

## 11. Conclusion

The Finance Webapp PRD successfully integrates the **FlyForSure Storefront Office Model v11** architecture into a modern web application. Core design patterns — multi-installment payments, ticket-keyed refunds, expense tracking, P&L analysis, and live alerts — are preserved while benefiting from web-scale infrastructure (PostgreSQL, Node.js, multi-user concurrency, API integrations).

**Ready for Development:** Yes ✅
**Next Steps:** 
1. Share PRD with development team
2. Schedule architecture deep-dive session
3. Create technical design document (database schema, API spec)
4. Assign sprints (Phase 1: Weeks 1-6)
5. Set up dev environment (Node.js, PostgreSQL, Git)

---

**Integration Date:** May 2026  
**Storefront Reference:** FlyForSure Storefront Office Model v11 (Operational since Feb 2026)  
**Document Status:** Complete & Ready for Handoff
