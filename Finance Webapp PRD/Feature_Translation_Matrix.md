# Storefront Office Model v11 → Finance Webapp: Feature Translation Matrix

**Quick Reference for Development Team**

---

## 1. Core Financial Features

### Multi-Installment Payment Tracking

| Aspect | Storefront v11 | Finance Webapp | Implementation |
|--------|---|---|---|
| **Payment Entry** | Agent types: Date, PNR, Amount, Mode, Receipt Ref (5 fields) | Same (5 manual fields) | React form with validation |
| **Auto-Sequence** | COUNTIF per PNR → instalment_no (1, 2, 3...) | Same logic | SQL: SELECT COUNT(*) WHERE pnr = $1 |
| **Instalment Type** | IF chain → ADVANCE / 2ND / FINAL / EXTRA | Same logic | CASE WHEN ... THEN ... |
| **Running Balance** | Cumulative_Paid, Remaining_Bal per PNR | cumulative_paid, remaining_balance | Running SUM() OVER (PARTITION BY pnr) |
| **Status Derivation** | Payment_Status auto: UNPAID/PARTIAL/FULLY_PAID | Same (never dropdown) | Trigger on INSERT/UPDATE payments |
| **Display** | First passenger per PNR only (PNR_N=1) | Query filter: WHERE pnr_n = 1 | SELECT ... WHERE pnr_n = 1 |
| **Variable Amounts** | Yes (no fixed installment plan) | Yes (support any amount/date) | amount_paid: DECIMAL not constrained |
| **Irregular Dates** | Yes (no payment schedule) | Yes (any payment date allowed) | payment_date: DATE, no constraints |

### Booking Tracker (Core Data)

| Aspect | Storefront v11 | Finance Webapp | Implementation |
|--------|---|---|---|
| **Passenger Row** | One row per passenger (multi-pax PNR = multiple rows) | Same | bookings.passenger_name unique row per passenger |
| **PNR Grouping** | PNR field links passengers | pnr field (FK) | FOREIGN KEY references would be optional |
| **Ticket Number** | Unique per passenger (e-ticket) | ticket_no (unique) | CREATE UNIQUE INDEX on ticket_no |
| **Fare Split** | fare_sold (customer) vs. fare_issued (supplier) | Same split | fare_sold DECIMAL, fare_issued DECIMAL |
| **Profit Calc** | profit = fare_sold - fare_issued | Same | Computed column or trigger |
| **Days to Dep** | AUTO: outbound_date - TODAY() | days_to_departure | SQL: outbound_date - CURRENT_DATE |
| **Alert Auto** | Alert = IF(days <= 7 AND balance > 0) → URGENT | alert = auto-derived | Trigger calculates CASE WHEN ... |
| **Refund Flag** | ☑ checkbox (Boolean) | refund_flag (Boolean) | <input type="checkbox" /> |

---

## 2. Refund Management (Ticket-Keyed)

### Refund Tracker

| Aspect | Storefront v11 | Finance Webapp | Implementation |
|--------|---|---|---|
| **Primary Key** | ticket_no (per-passenger refund) | ticket_no UNIQUE | CREATE UNIQUE INDEX on ticket_no |
| **Lookup via Ticket** | INDEX/MATCH(ticket → booking data) | Foreign Key join on ticket_no | SELECT bookings.* FROM refunds JOIN bookings ON ... |
| **Cancel Type Auto** | COUNTIF(refund checkboxes) → FULL or CANCEL_PAX | cancel_type auto-derived | Trigger: COUNT(*) WHERE refund_flag = true |
| **Eligible Refund** | MAX(0, fare_sold - penalty - fee) | eligible_refund | Computed: GREATEST(0, fare_sold - penalty - service_fee) |
| **Status Chain** | TO APPLY → APPLIED → IN PROCESS → RCVD / REJECTED → REFUNDED | refund_status (manual chain) | Enum with 6 values; no auto-progression |
| **Processing Days** | Auto: TODAY - cancel_date | processing_days | Computed: EXTRACT(DAY FROM (CURRENT_DATE - cancel_date)) |
| **Refund Categories** | Dropdown: NO-SHOW, CANCEL, VOLUNTARY, TAX, MEDICAL | refund_category | ENUM [NO_SHOW, FLIGHT_CANCEL, VOLUNTARY, TAX_ONLY, MEDICAL_DEATH] |
| **Penalties** | airline_penalty (agent enters), service_fee (agent enters) | Same fields | DECIMAL columns, manually entered |
| **Supplier Refund** | supplier_refund (actual amount from airline) | supplier_refund | DECIMAL, manually entered |
| **Refund Receipts** | Printable via ticket lookup | Print refund receipt | GET /receipts/refund/:ticketNo → PDF |

---

## 3. Expense Tracking & P&L

### Expense Tracker

| Aspect | Storefront v11 | Finance Webapp | Implementation |
|--------|---|---|---|
| **Categories** | 12 dropdown: RENT, SALARIES, UTILITIES, MARKETING, OFFICE, TRAVEL, SOFTWARE, COMMISSIONS, INSURANCE, BANK, TAXES, MISC | Same 12 categories | ENUM expense_category |
| **Branch/Office** | 4 options: ROME_HQ, ROME_STOREFRONT, INDIA_OFFICE, REMOTE | branch_office | ENUM [ROME_HQ, ROME_STOREFRONT, INDIA_OFFICE, REMOTE] |
| **Recurring Flag** | YES / NO (fixed vs. variable) | recurring (Boolean) | Column for P&L analysis |
| **Month Extract** | TEXT(date, "MMM-YY") → May-26 | month field | TEXT(expense_date, 'MMM-YY') or EXTRACT(MONTH/YEAR) |
| **Amount** | amount_eur (€) | amount_eur | DECIMAL in EUR currency |
| **Payment Mode** | 9 options: CASH, BANK, CARD, DEBIT, UPI, CHEQUE, POS, ONLINE, AUTO DEBIT | Same 9 modes | ENUM payment_mode |

### P&L Statement (Auto-Calculated)

| Aspect | Storefront v11 | Finance Webapp | Implementation |
|--------|---|---|---|
| **Revenue** | SUM(fare_sold) from tblBookings | SUM(fare_sold) from bookings | SELECT SUM(fare_sold) FROM bookings WHERE ... |
| **COGS** | SUM(fare_issued) from tblBookings | SUM(fare_issued) from bookings | SELECT SUM(fare_issued) FROM bookings WHERE ... |
| **Gross Profit** | Revenue - COGS | Calculated | (SELECT SUM(fare_sold) ...) - (SELECT SUM(fare_issued) ...) |
| **Gross Margin %** | Gross Profit / Revenue | margin_percent | ROUND((gross_profit / revenue) * 100, 2) |
| **Client Refunds** | SUMIF(refund_status = "REFUNDED TO CLIENT") | Sum of eligible_refund where refunded | SELECT SUM(eligible_refund) FROM refunds WHERE refund_status = 'REFUNDED_TO_CLIENT' |
| **Operating Expenses** | SUMIF by category from tblExpenses | SUM(amount) GROUP BY category | SELECT category, SUM(amount) FROM expenses GROUP BY category |
| **Net Profit** | Gross Profit - Expenses | net_profit | gross_profit - total_expenses |
| **Collections** | SUM(payments) from tblPayments | SUM(amount_paid) from payments | SELECT SUM(amount_paid) FROM payments |
| **Outstanding** | SUMIF(balance > 0) from bookings | SUM(balance_due) | SELECT SUM(CASE WHEN payment_status != 'FULLY_PAID' THEN ... |
| **Cash Flow** | Collections - Expenses | net_cash_flow | (SELECT SUM(amount_paid) ...) - (SELECT SUM(amount) FROM expenses) |

### P&L Analytics (Right Panel)

| Metric | Storefront | Webapp | SQL |
|--------|---|---|---|
| Collections Status | Total, Outstanding, %, Paid PNRs count, Partial count, Unpaid count | Same metrics | Multiple COUNT/SUM with GROUP BY status |
| Expenses by Branch | Sum per branch, % breakdown | Same | GROUP BY branch_office, SUM(amount) |
| Fixed vs Variable | Recurring sum, One-time sum, ratio % | recurring_expenses / total_expenses | GROUP BY recurring, SUM(amount) |
| KPIs | Pax count, revenue/pax, cost/pax, expense/pax, net/pax, break-even pax | Same calculations | COUNT(DISTINCT booking_id), SUM/COUNT ratios |
| Refund Analysis | Total refunds, %, avg refund, in process, expected, avg days | Same | SUMIF by status, AVG(processing_days) |

---

## 4. Live Alerts System (New in Webapp)

### Auto-Flagging Architecture

| Alert Type | Storefront Equivalent | Condition | Severity | Action |
|---|---|---|---|---|
| **Overdue Payment** | Days_To_Dep <= 0 AND Balance > 0 | Departure ≤ 0d AND balance_due > 0 | 🔴 CRITICAL | Email + In-app red badge |
| **Urgent Departure** | Days_To_Dep 0-7 AND Balance > 0 | 0 < days_to_dep ≤ 7 AND balance_due > 0 | ⚠️ URGENT | Red badge, daily reminder |
| **Follow-Up** | Days_To_Dep 8-14 AND Balance > 0 | 8 ≤ days_to_dep ≤ 14 AND balance_due > 0 | ⏰ WARNING | Orange badge |
| **Escalated Refund** | Processing_Days > 30 | processing_days > 45 OR refund_status = 'REJECTED' | 🔴 ESCALATE | Email to manager |
| **Settled** | All payments received | payment_status = 'FULLY_PAID' | ✅ SETTLED | Green badge |

**Implementation:**
- Alerts table (auto-generated, never manual)
- Daily trigger calculates all alert conditions
- Email job sends daily digest at 9 AM
- In-app widget shows badge counts in real-time

---

## 5. Data Entry & Status Management

### Agent/Storefront Interface

| Task | Storefront | Webapp | UI Element |
|---|---|---|---|
| **Add Booking** | Form with blue fields (28 columns) | Same 28 fields | React form with sections: Passenger, Flight, Pricing, Staff |
| **Record Payment** | 5-field form (Date, PNR, Amount, Mode, Ref) | Same 5 fields | Modal form; populates running balance automatically |
| **Flag Refund** | ☑ checkbox in Booking Tracker | refund_flag Boolean | <input type="checkbox" /> in booking row |
| **Enter Refund** | Ticket lookup form (13 fields) | Same fields | Form: Ticket (lookup), Category, Penalties, Supplier Refund, Status |
| **Record Expense** | 12-field form | Same form | Dropdown category, branch, recurring flag |
| **Status Selection** | NONE (all auto) | NONE (all auto) | No manual status dropdowns |

---

## 6. Reporting & Receipts

### Printable Outputs

| Report | Storefront | Webapp | Generation |
|---|---|---|---|
| **Invoice Receipt** | PNR lookup → auto-populate booking + payments | Same | GET /receipts/invoice/:pnr → PDF |
| **Refund Receipt** | Ticket lookup → auto-populate refund details + PNR summary | Same | GET /receipts/refund/:ticketNo → PDF |
| **Daily Statement (Agent)** | HTML email + PDF, per-agent summary | Same | POST /statements/agent/:agentId → Email + In-app |
| **Daily Statement (Supplier)** | HTML email + PDF, payables summary | Same | POST /statements/supplier/:supplierId → Email |
| **P&L Report** | Pivot table, auto-linked to tblBookings/Payments/Expenses/Refunds | Stored Procedure + JSON | GET /reports/pnl?dateRange=... → JSON/PDF/XLSX |
| **Refund Tracker Report** | Filtered view of tblRefunds with status breakdown | Same | GET /reports/refunds?status=... → XLSX |

---

## 7. User Roles & Permissions

### Role Matrix

| Capability | Admin | Finance Manager (Peter) | Storefront Agent | Supplier |
|---|---|---|---|---|
| **Add Booking** | ✅ Yes | ✅ Yes | ✅ Own bookings | ❌ No |
| **Record Payment** | ✅ Yes | ✅ Yes | ✅ Own | ❌ No |
| **Create Refund** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Update Refund Status** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Record Expense** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **View All Bookings** | ✅ Yes | ✅ Yes | ❌ Own only | ❌ Their bookings |
| **View P&L** | ✅ Yes | ✅ Yes | ❌ No (summary only) | ❌ No |
| **Send Statements** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Access Alerts** | ✅ Yes | ✅ Yes | ✅ Yes (view) | ❌ No |
| **Configure Settings** | ✅ Yes | ❌ No | ❌ No | ❌ No |

---

## 8. Database Schema Mapping

### Table Creation (PostgreSQL)

```sql
-- Storefront v11 → Webapp Schema

-- Bookings (like tblBookings)
CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  booking_date DATE,
  invoice_no VARCHAR(20), -- FFS-DDMMYY-NNN
  pnr VARCHAR(6),
  passenger_name VARCHAR(255),
  pax_type ENUM ('ADT', 'CHD', 'INF'),
  mobile VARCHAR(20),
  airline VARCHAR(100),
  ticket_no VARCHAR(15) UNIQUE,
  ow_rt ENUM ('OW', 'RT'),
  sector VARCHAR(20),
  outbound_date DATE,
  inbound_date DATE,
  fare_sold DECIMAL(10, 2),
  fare_issued DECIMAL(10, 2),
  profit DECIMAL(10, 2) GENERATED ALWAYS AS (fare_sold - fare_issued),
  total_paid DECIMAL(10, 2) DEFAULT 0,
  balance_due DECIMAL(10, 2),
  payment_status ENUM ('UNPAID', 'PARTIAL', 'FULLY_PAID') DEFAULT 'UNPAID',
  num_instalments INT DEFAULT 0,
  booked_by VARCHAR(255),
  agent_issued_by VARCHAR(255),
  ticket_status ENUM ('PENDING', 'TICKETED', 'REISSUED'),
  days_to_departure INT,
  alert ENUM ('URGENT', 'FOLLOW_UP', 'OVERDUE', 'SETTLED'),
  refund_flag BOOLEAN DEFAULT FALSE,
  pnr_n INT, -- Auto: COUNTIF per PNR occurrence
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Payments (like tblPayments)
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  payment_date DATE,
  pnr VARCHAR(6), -- FK to bookings
  passenger_name VARCHAR(255),
  amount_paid DECIMAL(10, 2),
  payment_mode ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'CHEQUE', 'POS_TERMINAL', 'ONLINE_PAYMENT'),
  receipt_ref VARCHAR(100),
  instalment_no INT, -- AUTO: COUNT(*) per PNR + 1
  instalment_type VARCHAR(50), -- AUTO: ADVANCE, 2ND, FINAL, EXTRA
  received_by VARCHAR(255),
  cumulative_paid DECIMAL(10, 2), -- AUTO: SUM per PNR
  total_fare DECIMAL(10, 2), -- AUTO: SUM from bookings where pnr
  remaining_balance DECIMAL(10, 2), -- AUTO: total_fare - cumulative_paid
  pnr_n INT, -- Helper
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Refunds (like tblRefunds)
CREATE TABLE refunds (
  id UUID PRIMARY KEY,
  ticket_no VARCHAR(15) UNIQUE, -- PK for refunds
  pnr VARCHAR(6), -- AUTO: lookup from bookings via ticket
  passenger_name VARCHAR(255),
  airline VARCHAR(100),
  sector VARCHAR(20),
  fare_sold DECIMAL(10, 2),
  fare_issued DECIMAL(10, 2),
  cancel_date DATE,
  cancel_type ENUM ('FULL_BOOKING', 'CANCEL_PAX'), -- AUTO: from checkbox count
  refund_category ENUM ('NO_SHOW', 'FLIGHT_CANCEL', 'VOLUNTARY', 'TAX_ONLY', 'MEDICAL_DEATH'),
  airline_penalty DECIMAL(10, 2),
  service_fee DECIMAL(10, 2),
  eligible_refund DECIMAL(10, 2), -- AUTO: GREATEST(0, fare_sold - penalty - fee)
  supplier_refund DECIMAL(10, 2),
  refund_status ENUM ('TO_APPLY', 'APPLIED', 'IN_PROCESS', 'RCVD_FROM_SUPPLIER', 'REJECTED', 'REFUNDED_TO_CLIENT'),
  status_date DATE,
  processing_days INT, -- AUTO: EXTRACT(DAY FROM (status_date - cancel_date))
  refund_mode ENUM ('CASH', 'BANK_TRANSFER', 'ADJUSTED_AGAINST_BOOKING', 'CREDIT_CARD', 'CHEQUE'),
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Expenses (like tblExpenses)
CREATE TABLE expenses (
  id UUID PRIMARY KEY,
  expense_date DATE,
  category ENUM ('RENT', 'SALARIES', 'UTILITIES', 'MARKETING', 'OFFICE_SUPPLIES', 'TRAVEL', 'SOFTWARE_IT', 'COMMISSIONS', 'INSURANCE', 'BANK_CHARGES', 'TAXES_FEES', 'MISCELLANEOUS'),
  description VARCHAR(500),
  vendor_payee VARCHAR(255),
  amount_eur DECIMAL(10, 2),
  payment_mode ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'CHEQUE', 'POS_TERMINAL', 'ONLINE_PAYMENT', 'AUTO_DEBIT'),
  receipt_ref VARCHAR(100),
  branch_office ENUM ('ROME_HQ', 'ROME_STOREFRONT', 'INDIA_OFFICE', 'REMOTE'),
  recurring BOOLEAN DEFAULT FALSE, -- Fixed vs Variable
  month VARCHAR(10), -- AUTO: TEXT(expense_date, 'MMM-YY')
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Alerts (Auto-Generated)
CREATE TABLE alerts (
  id UUID PRIMARY KEY,
  alert_type ENUM ('OVERDUE_PAYMENT', 'URGENT_DEPARTURE', 'FOLLOW_UP', 'VOIDED_REFUND', 'PENDING_REFUND', 'ESCALATED'),
  severity ENUM ('CRITICAL', 'URGENT', 'WARNING'),
  pnr VARCHAR(6),
  ticket_no VARCHAR(15),
  message TEXT,
  amount_at_risk DECIMAL(10, 2),
  days_to_event INT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255),
  auto_generated BOOLEAN DEFAULT TRUE,
  notified BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMP
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  name VARCHAR(255),
  role ENUM ('ADMIN', 'FINANCE_MANAGER', 'AGENT', 'SUPPLIER'),
  agent_id UUID, -- FK if role = AGENT
  supplier_id UUID, -- FK if role = SUPPLIER
  status ENUM ('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit Log
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID,
  action VARCHAR(50),
  entity_type VARCHAR(50),
  entity_id UUID,
  changes JSONB,
  timestamp TIMESTAMP DEFAULT NOW(),
  ip_address VARCHAR(45)
);

-- Indexes (Performance)
CREATE INDEX idx_bookings_pnr ON bookings(pnr);
CREATE INDEX idx_bookings_ticket ON bookings(ticket_no);
CREATE INDEX idx_bookings_created ON bookings(created_at);
CREATE INDEX idx_payments_pnr ON payments(pnr);
CREATE INDEX idx_refunds_ticket ON refunds(ticket_no);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_alerts_pnr ON alerts(pnr);
```

---

## 9. API Endpoint Mapping

### REST Endpoints (Follows Storefront data flow)

```
# Bookings
POST   /api/bookings              — Create booking (like entering in Booking Tracker)
GET    /api/bookings              — List bookings (with filters, pagination)
GET    /api/bookings/:id          — Booking detail
PUT    /api/bookings/:id          — Update booking
DELETE /api/bookings/:id          — Soft delete booking

# Payments
POST   /api/payments              — Record payment (5-field form)
GET    /api/payments?pnr=ABC123   — Payment history for PNR
GET    /api/ledgers/agent/:agentId — Agent ledger
GET    /api/ledgers/supplier/:supplierId — Supplier ledger

# Refunds
POST   /api/refunds               — Create refund entry (Refund Tracker)
GET    /api/refunds?status=...    — Filter refunds by status
PUT    /api/refunds/:id           — Update refund status
GET    /api/refunds/analytics     — Refund dashboard metrics

# Expenses
POST   /api/expenses              — Record expense
GET    /api/expenses?category=... — Filter by category
GET    /api/pnl                   — P&L statement (auto-calculated)
GET    /api/pnl/monthly           — Monthly comparison

# Alerts
GET    /api/alerts                — Active alerts (auto-generated)
GET    /api/alerts/dashboard      — Alert summary + counts
POST   /api/alerts/:id/resolve    — Mark alert resolved
GET    /api/alerts/departures?days=14 — Upcoming departures

# Receipts
GET    /api/receipts/invoice/:pnr — Generate invoice receipt PDF
GET    /api/receipts/refund/:ticketNo — Generate refund receipt PDF

# Statements
POST   /api/statements            — Generate & send daily statement
GET    /api/statements/history    — Past statements

# Reports
GET    /api/reports/pnl?dateRange=... — P&L report (Excel/PDF)
GET    /api/reports/refunds?... — Refund tracker report
GET    /api/reports/agents/:agentId — Agent performance
```

---

## 10. Formula → Code Examples

### Example 1: Auto-Calculate Payment Status

**Storefront Formula:**
```excel
=IF(Q4=0,"UNPAID",IF(Q4<SUMIF($H$5:$H$204,H4,$N$5:$N$204),"PARTIAL","FULLY PAID"))
```

**Webapp Code:**
```sql
-- Trigger on INSERT/UPDATE payments
CREATE OR REPLACE FUNCTION update_booking_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bookings
  SET payment_status = CASE
    WHEN (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE pnr = NEW.pnr) = 0 THEN 'UNPAID'
    WHEN (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE pnr = NEW.pnr) < fare_sold THEN 'PARTIAL'
    ELSE 'FULLY_PAID'
  END
  WHERE pnr = NEW.pnr;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_status AFTER INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION update_booking_status();
```

**Webapp JavaScript (if needed in app layer):**
```javascript
const getPaymentStatus = (fareSold, totalPaid) => {
  if (totalPaid === 0) return 'UNPAID';
  if (totalPaid < fareSold) return 'PARTIAL';
  return 'FULLY_PAID';
};
```

### Example 2: Auto-Assign Instalment Type

**Storefront Formula:**
```excel
=IF(H5=1,"ADVANCE",IF(H5=2,"2ND INSTALMENT",IF(H5=3,"3RD INSTALMENT",IF(H5=4,"4TH INSTALMENT",
IF(SUMIF($C$5:$C$204,C5,$E$5:$E$204)>=SUMIF($H$5:$H$204,C5,$N$5:$N$204),"FINAL","EXTRA")))))
```

**Webapp Code:**
```sql
CREATE OR REPLACE FUNCTION assign_instalment_type()
RETURNS TRIGGER AS $$
BEGIN
  NEW.instalment_type := CASE
    WHEN NEW.instalment_no = 1 THEN 'ADVANCE'
    WHEN NEW.instalment_no = 2 THEN '2ND INSTALMENT'
    WHEN NEW.instalment_no = 3 THEN '3RD INSTALMENT'
    WHEN NEW.instalment_no = 4 THEN '4TH INSTALMENT'
    WHEN (SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE pnr = NEW.pnr) 
         >= (SELECT fare_sold FROM bookings WHERE pnr = NEW.pnr LIMIT 1) THEN 'FINAL'
    ELSE 'EXTRA'
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assign_instalment BEFORE INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION assign_instalment_type();
```

---

## 11. Development Checklist

### Phase 1 (MVP - 4-6 weeks)
- [ ] Set up PostgreSQL schema (bookings, payments tables)
- [ ] Implement Payment Ledger (5-field form, auto-calculations)
- [ ] Auto-derive payment_status (trigger)
- [ ] Auto-assign instalment_no & type (trigger)
- [ ] Invoice Receipt (PDF generation)
- [ ] Payment history view (running balance display)
- [ ] Admin Dashboard (KPI cards: Revenue, Collections, Outstanding)
- [ ] User authentication + Admin/Agent roles
- [ ] Audit logging on all CREATE/UPDATE operations

### Phase 2 (Core - 6-8 weeks)
- [ ] Refund Tracker table + form
- [ ] Cancel Type auto-detection (checkbox → full/partial)
- [ ] Refund Receipt PDF generation
- [ ] Expense Tracker (12 categories, branch tracking)
- [ ] P&L Statement (stored procedure → auto-calculate)
- [ ] P&L Analytics (right panel: collections, expenses, fixed/variable, KPIs)
- [ ] Supplier role + Supplier ledger view
- [ ] CSV/Excel upload with validation
- [ ] Edit history (audit trail display)

### Phase 3 (Alerts - 4-6 weeks)
- [ ] Alerts table + auto-generation trigger
- [ ] Alert types: Overdue, Urgent, Follow-Up, Escalated
- [ ] Alerts Dashboard (counts, filter, drill-down)
- [ ] Departure Alerts (0-14d window, color-coded)
- [ ] Email alerts (daily digest + immediate)
- [ ] In-app alert widget (badge counts, list)
- [ ] Cryptic Booking entry (text parsing, confidence levels)
- [ ] PDF extraction (OCR for e-tickets)
- [ ] Daily Statements (scheduled + manual)

### Phase 4 (Polish - 4-6 weeks, optional)
- [ ] Advanced reporting (pre-built + custom)
- [ ] Budget vs. Actual (expense budgeting)
- [ ] Monthly P&L trends
- [ ] Full-text search
- [ ] Mobile-responsive refinement
- [ ] Query optimization + caching
- [ ] Security audit + GDPR compliance
- [ ] Disaster recovery plan

---

## 12. Testing Checklist

### Unit Tests (Formula Logic)
- [ ] Payment status derivation (UNPAID → PARTIAL → FULLY_PAID)
- [ ] Instalment type assignment (ADVANCE → 2ND → FINAL)
- [ ] Alert condition evaluation (days_to_dep + balance)
- [ ] Refund eligible amount (MAX(0, fare - penalty - fee))
- [ ] Running balance calculation (cumulative per PNR)

### Integration Tests (End-to-End Workflows)
- [ ] Add booking → Record payment (1st & 2nd instalment) → Status changes
- [ ] Multi-passenger booking → Separate refunds per ticket → Different refund amounts
- [ ] Record expense → P&L recalculates → Net Profit updates
- [ ] Generate alert → Email sent → In-app badge shows → Agent resolves
- [ ] CSV upload → 1000 rows imported → P&L updates → All formulas accurate

### Data Integrity Tests (Storefront Accuracy)
- [ ] Manual booking entry matches Invoice Receipt output (100%)
- [ ] Payment ledger running balance correct (audited monthly vs. bank statement)
- [ ] Partial refund scenario: PNR total = original - refund (verified)
- [ ] P&L components: Revenue - COGS = Gross Profit (verified)
- [ ] Multi-branch expense rollup: Sum of all branches = Total (verified)

### Load Tests
- [ ] 10,000 bookings: Booking list loads in <2 seconds
- [ ] 50,000 payments: Payment ledger query completes in <1 second
- [ ] 100,000 rows across all tables: PDF export completes in <5 seconds
- [ ] 1,000 concurrent users: Alert generation completes in <10 seconds

---

## 13. Training Material (For Storefront Agents → Web Users)

### Quick Training (1 hour)

**What's the Same:**
- Blue fields = you type (same as Storefront)
- Black/gray = system calculates (no changes)
- Instalment sequence auto-numbers (no dropdown)
- Payment status auto-derives (you don't select)
- Refund flag checkbox = mark passengers to cancel (same)
- P&L updates automatically (no manual entry)

**What's Different:**
- Web form (not spreadsheet)
- Real-time calculations (instant, not F9 recalc)
- Multi-user (not single-user Excel)
- Auto-alerts (live, not daily only)
- Mobile-friendly (responsive web)

**New Features:**
- Live Alerts Dashboard (see all urgent items)
- Daily auto-statements (email + in-app)
- Cryptic booking entry (paste raw data, we parse)

---

---

**Document Status:** Complete & Ready for Development Team  
**Reference:** FlyForSure Storefront Office Model v11  
**Date:** May 2026  
**Next: Technical Design Document & Database Schema Review**
