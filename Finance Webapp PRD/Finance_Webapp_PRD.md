# PRODUCT REQUIREMENTS DOCUMENT (PRD)
## Travel Agency Finance Management Webapp

**Version:** 1.0  
**Date:** May 2026  
**Status:** Requirements Gathering Complete  

---

## 1. EXECUTIVE SUMMARY

### Project Objective
Build a lightweight, production-ready finance management webapp for travel agencies (franchises, networks, storefronts) to manage the complete booking-to-payment lifecycle: from initial reservation through multi-installment payment collection, refund processing, expense tracking, P&L analysis, and automated daily statement distribution. The system is inspired by the **FlyForSure Storefront Office Model (v11)** — an operational Excel system managing 9,000+ formulas across 10 interconnected sheets, deployed live since Feb 2026.

### Core Problem Solved
- **Centralized, real-time booking & financial data** across distributed agents/storefronts
- **Multi-installment payment tracking** with irregular dates and variable amounts per installment
- **Ticket-number keying** (not PNR-only) for clean handling of reissues, amendments, and partial refunds
- **Built-in expense & P&L analytics** (rent, salary, utilities, profit by staff/period)
- **Live alerts system** auto-flagging overdue payments, unpaid tickets, voided bookings
- **Transparent agent/supplier settlement** with automated daily statement distribution
- **Manual data flexibility** for cryptic/unstructured booking entry (emails, screenshots, text)

### Key Stakeholders
- **Travel Agency Admin** (Primary operator, P&L oversight)
- **Travel Agents / Storefront Staff** (Booking entry, payment collection, customer service)
- **Suppliers** (Airlines, hotels, booking partners — view payables/settlements)
- **Finance Manager / Peter** (Refund processing, expense tracking, P&L review)

---

## 2. USER PERSONAS & ROLES

### 2.1 Admin User
**Description:** Travel agency owner/manager who oversees all operations, finances, and settlements.

**Responsibilities:**
- Add/edit all bookings (structured and cryptic)
- Manage agent and supplier information
- View complete ledgers (agents + suppliers)
- Generate and send daily statements (manual or scheduled)
- Upload bulk booking data (CSV, Excel, PDF)
- Manage custom fields and workflow statuses
- View comprehensive dashboard with KPIs

**Permissions:**
- Full read/write access to all bookings, ledgers, and transactions
- Access to all user data (agents, suppliers, bookings)
- Ability to configure payment/refund workflows
- Can trigger manual statement generation
- Can set scheduled statement delivery times

---

### 2.2 Agent User
**Description:** Travel agents (part of network) who create bookings and need to track their financial obligations/receivables.

**Responsibilities:**
- View their own bookings only
- Create new bookings (manual entry)
- Update basic booking fields (passenger details, flight info)
- Receive daily statements of their activities
- View their own ledger and outstanding amounts
- Track refunds on their bookings

**Permissions:**
- Read/write access to own bookings only
- Cannot view other agents' data
- Cannot edit supplier information (read-only)
- Can view assigned commission amounts (read-only)
- Receive in-app notifications and email statements

---

### 2.3 Supplier User
**Description:** External suppliers (airlines, hotel chains, booking partners) who need to see bookings created via their services and amounts payable.

**Responsibilities:**
- View all bookings created through their service
- Track payments owed to them
- View their own ledger (payables only)
- Receive daily statements of their bookings

**Permissions:**
- Read-only access to their associated bookings
- Cannot edit booking data
- Can view payment status and outstanding amounts
- Receive in-app notifications and email statements (payables summary)

---

## 3. FEATURE SPECIFICATIONS

### 3.1 Booking Management

#### 3.1.1 Add Booking - Standard Entry
**Purpose:** Create structured bookings with complete information capture.

**User Flow:**
1. Admin/Agent clicks "Add Booking"
2. Form opens with the following fields:

**Required Fields:**
- PNR (Booking Reference)
- Passenger Name(s)
- Email
- Phone
- Flight/Service Type (Flight, Hotel, Activity, Group Seat, etc.)

**Flight Details (if applicable):**
- Departure City/Airport
- Arrival City/Airport
- Departure Date
- Return Date (if round trip)
- Airline
- Flight Numbers
- Seat Numbers
- Cabin Class

**Pricing Information:**
- Base Fare
- Taxes
- Fees
- Markup/Commission Amount
- Discount (if any)
- Final Price (auto-calculated: Base + Taxes + Fees + Markup - Discount)
- Currency

**Financial Breakdown:**
- Gross Amount (total charged to customer)
- Commission % or Fixed Amount
- Net Amount (amount due to supplier)
- Payment Status
- Payment Date
- Refund Status (if applicable)

**Assignment & Status:**
- Assigned Agent
- Assigned Supplier
- Booking Status (Confirmed, Pending, Cancelled, etc.)
- Payment Status (Pending, Partial, Received, Refund Issued, etc.)

**Custom Fields:** 
- Allow admin to define 5-10 custom fields per booking (e.g., Group Name, Special Requests, Marketing Channel)

**Submission:**
- Save as Draft / Publish
- Validation: All required fields must be populated
- Success message with booking ID

---

#### 3.1.2 Add Booking - Cryptic Entry
**Purpose:** Handle raw/semi-structured booking data (emails, text messages, screenshots, etc.).

**User Flow:**
1. Admin/Agent clicks "Add Cryptic Booking"
2. Large text area appears for pasting raw data
3. System attempts to parse and extract structured data
4. Suggest fields with confidence levels (High/Medium/Low)
5. Admin can override suggested values
6. Missing fields highlighted as required before save

**Supported Input Formats:**
- Plain text (e.g., "John Doe, DEL-BOM 15 May, AI 203, 30000 INR")
- Email-forwarded confirmation text
- Screenshot OCR (manual paste of text)
- Semi-structured data with delimiters

**Processing:**
- Use regex/NLP patterns to extract:
  - Passenger names
  - PNRs / Booking references
  - Dates (departure, return)
  - Cities/Airports
  - Airlines
  - Pricing amounts
  - Agent/Supplier references
- Mark extracted fields with confidence level
- Allow manual correction before save

**Data Validation:**
- At minimum: PNR, Passenger Name, Amount, Agent/Supplier assigned
- Suggest currency based on amount (optional AI enhancement)

---

#### 3.1.3 Edit/Update Booking
**Purpose:** Modify booking details after creation, especially financial adjustments.

**Editable Fields (Post-Creation):**
- Passenger Details (name, contact)
- Flight Information (dates, flights, seat changes)
- Commission/Markup Amounts
- Payment Status & Payment Date
- Refund Amount & Refund Status
- Supplier Information (re-assign if needed)
- Pricing/Currency Adjustments
- Agent Assignment (re-assign if needed)
- Custom Fields

**Workflow:**
1. Admin/Agent clicks "Edit" on a booking
2. Same form as "Add Booking" appears with populated data
3. Fields are editable with history tracking (who changed what, when)
4. Save triggers validation
5. Confirmation message with change summary

**Audit Trail:**
- Log all edits: User, Field, Old Value, New Value, Timestamp
- Admin can view edit history for any booking

---

#### 3.1.4 View Bookings - List & Filter
**Purpose:** Display all bookings in structured table format with filtering and search.

**Display Table Columns (Configurable):**
- PNR
- Passenger Name
- Agent Assigned
- Supplier
- Booking Date
- Travel Date
- Gross Amount
- Commission
- Net Amount
- Payment Status
- Refund Status
- Last Updated

**Filters:**
- Date Range (Booking Date, Travel Date, Payment Date)
- Agent (Multi-select)
- Supplier (Multi-select)
- Payment Status (Multi-select)
- Refund Status (Multi-select)
- Amount Range
- Booking Status

**Search:**
- Global search by: PNR, Passenger Name, Agent Name, Supplier Name

**Sorting:**
- All columns sortable (ascending/descending)
- Default: Latest bookings first

**Permissions:**
- Admin: Sees all bookings
- Agent: Sees only their own bookings
- Supplier: Sees only bookings created via their service

**Actions:**
- Click row to view detail view
- Bulk select bookings for bulk actions (export, update status)

---

#### 3.1.5 View Booking Detail
**Purpose:** Single booking full-page view with all details and history.

**Layout:**
- Header: PNR, Passenger, Status badges (Payment, Refund)
- Tabs:
  - **Overview:** All booking fields displayed in read-only format initially
  - **Financial Details:** Breakdown of charges, commissions, taxes
  - **Edit Mode:** Switch to editable form
  - **Edit History:** All changes with user, timestamp, old/new values
  - **Attachments:** PDFs, images, documents uploaded against this booking

**Actions:**
- Edit Booking
- Update Payment Status
- Process Refund
- Add Note/Comment
- Download as PDF
- Share with Supplier/Agent (email)

---

### 3.2 Bulk Upload & Import

#### 3.2.1 Upload CSV/Excel
**Purpose:** Import multiple bookings at once from structured data files.

**Supported Formats:**
- CSV (.csv)
- Excel (.xlsx)

**File Requirements:**
- Header row required
- Column mapping: Admin maps file columns to booking fields
- Required columns: PNR, Passenger Name, Amount, Agent, Supplier
- Optional columns: Auto-detected based on header names

**Process:**
1. Admin clicks "Upload Bookings"
2. Selects file (CSV or Excel)
3. System displays preview of first 5 rows
4. Admin maps columns (drag-drop or dropdown selection)
5. System validates data:
   - Check for duplicate PNRs
   - Validate required fields
   - Check for invalid dates, amounts
   - Verify agent/supplier exist in system
6. Shows validation report: X rows valid, Y rows with errors
7. Allow retry/fix before final import
8. Import bookings with success notification
9. Log generated with import ID, timestamp, row count

**Error Handling:**
- Rows with errors not imported
- Generate downloadable error report
- Allow fixing and re-uploading error rows

---

#### 3.2.2 Upload PDF (Data Extraction)
**Purpose:** Extract booking data from PDF invoices, confirmations, or statements.

**Use Cases:**
- Airline booking confirmations
- Hotel confirmations
- supplier settlement statements
- Custom invoice PDFs

**Process:**
1. Admin clicks "Upload PDF"
2. Selects one or multiple PDFs
3. System uses OCR + pattern matching to extract:
   - Passenger names
   - PNRs
   - Travel dates
   - Amounts
   - Supplier name
   - Any dates matching booking patterns
4. Presents extracted data in a table for review
5. Admin can:
   - Accept extracted data
   - Manually edit any field
   - Map extracted fields to custom fields
   - Discard extraction and enter manually
6. After approval, create bookings or update existing ones

**Confidence Levels:**
- Mark each extracted field with confidence: High (>95%), Medium (70-95%), Low (<70%)
- Highlight Low confidence fields for manual review

**Storage:**
- Attach original PDF to created booking(s) for audit trail

---

#### 3.2.3 Bulk Update
**Purpose:** Modify multiple bookings at once (e.g., update payment status for a batch).

**Use Cases:**
- Mark 20 bookings as "Payment Received" after bank transfer
- Update commission amounts for agent's bookings
- Bulk refund processing

**Process:**
1. Admin filters bookings (e.g., Agent = "John", Payment Status = "Pending")
2. Selects multiple bookings (checkbox select all or individual)
3. Clicks "Bulk Action"
4. Chooses action: Update Status, Update Field, Add Note
5. Enters new value(s)
6. Preview of affected bookings shown
7. Confirm and execute
8. Log generated with action details

---

### 3.3 Ledger Management

#### 3.3.1 Agent Ledger
**Purpose:** Track financial obligations and receivables per agent.

**Display:**
- Agent name and ID
- Date range selector (default: current month)
- Summary cards:
  - Total Bookings (count)
  - Gross Revenue (sum of all booking amounts)
  - Commission Earned (sum of commission)
  - Payments Received (sum of confirmed payments)
  - Outstanding Amount (Total Commission - Payments Received)
  - Refunds Issued (sum of refunds)

**Transaction Table:**
- Date
- Booking PNR
- Description (e.g., "Flight booking DEL-BOM")
- Debit (commission earned, refunds)
- Credit (payments received)
- Running Balance
- Status

**Filters:**
- Agent (dropdown)
- Date Range
- Transaction Type (Booking, Payment, Refund)

**Export:**
- Download as PDF or CSV

---

#### 3.3.2 Supplier Ledger
**Purpose:** Track payables to suppliers.

**Display:**
- Supplier name and ID
- Date range selector
- Summary cards:
  - Total Bookings (count)
  - Total Amount Payable (sum of net amounts)
  - Payments Made (sum of paid amounts)
  - Outstanding Payable (Amount Payable - Payments Made)
  - Deductions/Disputes (if applicable)

**Transaction Table:**
- Date
- Booking PNR
- Description
- Debit (amount payable)
- Credit (payments made, deductions)
- Running Balance
- Status

**Filters:**
- Supplier (dropdown)
- Date Range
- Transaction Type

**Export:**
- Download as PDF or CSV

---

#### 3.3.3 Consolidated Ledger (Admin View)
**Purpose:** Overview of all agent and supplier transactions.

**Display:**
- Toggle between "Agent Ledger" and "Supplier Ledger"
- List all agents or suppliers with summary
- Quick view: Name, Total Outstanding, Total Received, Status

**Actions:**
- Click on any agent/supplier to drill into their detailed ledger
- Export all ledgers as consolidated PDF/Excel

---

### 3.4 Payment Recording & Multi-Installment Ledger

#### 3.4.1 Payment Ledger Architecture
**Purpose:** Track all incoming payments against PNRs with multi-installment support, irregular payment dates, and variable installment amounts.

**Inspired by:** FlyForSure Storefront v11 Payment Ledger (tblPayments) — tracks payment sequence, auto-calculates installment types, shows running balance per PNR.

**Core Design:**
- **PNR-based grouping** — all payments for a PNR are linked and sequenced
- **Variable installments** — each payment can be any amount (advance, partial, final, overpayment)
- **Irregular dates** — payments don't need to follow a fixed schedule
- **Auto-sequencing** — system automatically assigns installment numbers (1st, 2nd, 3rd, etc.) and types (ADVANCE → 2ND INSTALMENT → 3RD → FINAL → EXTRA)
- **Positive-only ledger** — refunds tracked separately in Refund Tracker, never as negative payments

**Data Fields:**
- Payment Date (agent enters)
- PNR (agent selects)
- Amount Paid (agent enters)
- Payment Mode (Dropdown: Cash, Bank Transfer, Credit Card, Debit Card, UPI, Cheque, POS Terminal, Online Payment)
- Receipt Reference (agent enters, e.g., transaction ID, bank reference)
- Received By (auto-populated from Booking staff)
- Instalment Number (auto-calculated: 1, 2, 3, 4...)
- Instalment Type (auto-calculated: ADVANCE → 2ND INSTALMENT → 3RD INSTALMENT → FINAL → EXTRA)
- Cumulative Paid (running total for PNR)
- Remaining Balance (Total Fare − Cumulative Paid)

**Agent View:**
- Agent types only 5 fields (Date, PNR, Amount, Mode, Receipt Ref)
- System auto-calculates: Passenger Name, Received By, Instalment Number/Type, Running Balance
- Displays running total per PNR to show how much is still outstanding
- No manual status selection — payment status on Booking is auto-derived from ledger

---

#### 3.4.2 Record Agent Payment (Multi-Installment)
**Purpose:** Log variable-amount payments on a PNR with automatic sequencing.

**User Flow:**
1. Admin/Agent clicks "Record Payment" → "From Agent/Storefront"
2. Form opens with fields:
   - Payment Date (calendar picker)
   - PNR (searchable dropdown with passenger names preview)
   - Amount Paid (currency input, any amount)
   - Payment Mode (dropdown)
   - Receipt Reference (text, e.g., "UTR-123456" for bank transfers)
   - Notes
3. System auto-displays:
   - Total Fare for PNR (sum of all passengers)
   - Previous payments (table of prior installments)
   - Running cumulative balance
   - Suggested remaining amount (for convenience)
4. Save triggers:
   - Payment recorded with auto-sequenced installment number
   - Instalment Type auto-assigned based on sequence
   - Booking Tracker payment status auto-updates (UNPAID → PARTIAL → FULLY PAID)
   - Receipt generated with installment breakdown
   - Email/in-app notification sent to agent

**Scenarios Handled:**
- **Advance Payment:** First payment, any amount (e.g., €200 deposit on €850 booking)
- **2nd Installment:** Second payment, any amount (e.g., €400)
- **Final Payment:** Remaining balance clears the account (system recognizes this)
- **Overpayment:** If payment exceeds remaining balance, system flags and allows agent to apply credit to another booking
- **Partial Payment:** Multiple small payments across irregular dates (e.g., installment every 2 weeks)

---

#### 3.4.3 Payment Status Auto-Derivation
**Purpose:** Eliminate manual status selection — system calculates based on ledger data.

**Logic:**
```
IF Total_Paid = 0
    → Status = "UNPAID"
ELSE IF Total_Paid < Total_Fare
    → Status = "PARTIAL"
ELSE IF Total_Paid >= Total_Fare
    → Status = "FULLY PAID"
```

This appears automatically on the Booking Tracker (first passenger per PNR only) and updates in real-time as payments are recorded.

---

#### 3.4.4 Installment Type Auto-Assignment
**Purpose:** System automatically names each payment in sequence without agent selection.

**Logic:**
```
IF Instalment_Number = 1 AND Amount < Total_Fare
    → "ADVANCE"
ELSE IF Instalment_Number = 1 AND Amount = Total_Fare
    → "FULL PAYMENT"
ELSE IF Instalment_Number = 2
    → "2ND INSTALMENT"
ELSE IF Instalment_Number = 3
    → "3RD INSTALMENT"
ELSE IF Instalment_Number = 4
    → "4TH INSTALMENT"
ELSE IF Cumulative_Paid = Total_Fare
    → "FINAL PAYMENT"
ELSE IF Cumulative_Paid > Total_Fare
    → "EXTRA / CREDIT"
```

This auto-naming ensures clarity without requiring manual status updates.

---

#### 3.4.5 Payment History & Ledger View
**Purpose:** See all payments for a PNR with running balance.

**Display Table:**
- Date
- Amount
- Instalment Type
- Cumulative Paid
- Remaining Balance
- Payment Mode
- Receipt Reference
- Notes

**Filters:**
- Agent/Storefront
- Date Range
- Payment Mode
- Status (Partial/Fully Paid)

**Summary Cards:**
- Total Collections (sum of all payments)
- Outstanding Receivables (sum of remaining balances)
- Collection Rate (% of total fares collected)
- Fully Paid PNRs (count)
- Partial/Unpaid Count

---

#### 3.4.6 Record Supplier Payment
**Purpose:** Log payments made to suppliers with tracking.

**User Flow:**
1. Admin clicks "Record Payment" → "To Supplier"
2. Form opens:
   - Supplier (dropdown)
   - Payment Date
   - Amount Paid
   - Payment Method
   - Reference (Transaction ID, Wire Reference, Check #)
   - Notes
3. System shows:
   - Supplier's outstanding payable
   - New balance after payment
   - Recent bookings from supplier (for reference)
4. Save generates:
   - Payment record
   - Supplier payables ledger updates
   - Notification sent to supplier (if configured)

**Bulk Supplier Payments:**
- Admin can settle multiple suppliers in one session
- Quick-pay feature: Pre-fill with outstanding payable amount
- Payment can be applied to:
  - All outstanding (auto-apply to oldest first)
  - Specific bookings/period

---

---

### 3.5 Refund Management (Ticket-Number Keying Architecture)

#### 3.5.1 Refund Tracker — Per-Ticket Refund Lifecycle
**Purpose:** Track refund lifecycle per ticket (per-passenger) for partial cancellations, amendments, and complete refunds.

**Inspired by:** FlyForSure Storefront v11 Refund Tracker (tblRefunds) — keyed by ticket number, not PNR. Handles multi-passenger scenarios cleanly.

**Core Design:**
- **Ticket number as primary key** — each passenger has unique ticket, enabling partial cancellations
- **Separate from Payment Ledger** — refunds never appear as negative payments (positive-only ledger principle)
- **Full refund lifecycle tracking** — from cancellation request through airline refund receipt to customer refund completion
- **Auto-calculated eligible refund** — gross fare minus airline penalties and service fees
- **Clear status chain** — visual progression through defined workflow

**Data Fields:**
- Ticket Number (agent enters, must match Booking)
- PNR (auto-lookup from Booking)
- Passenger Name (auto-lookup)
- Airline (auto-lookup)
- Sector (auto-lookup)
- Fare Sold (auto-lookup — customer-facing price)
- Fare Issued (auto-lookup — supplier cost)
- Cancel Date (agent enters)
- Cancel Type (auto-derived: FULL BOOKING vs CANCEL PAX)
- Refund Category (Dropdown: NO-SHOW, FLIGHT CANCEL, VOLUNTARY, TAX ONLY, MEDICAL-DEATH)
- Airline Penalty (agent enters, e.g., €80 cancellation fee)
- Service Fee (agent enters, e.g., €20 FlyForSure handling charge)
- Eligible Refund (auto-calculated: MAX(0, Fare_Sold − Penalty − Service_Fee))
- Supplier Refund (agent enters actual amount airline refunds to agency)
- Refund Status (Dropdown: TO APPLY → APPLIED → IN PROCESS → RCVD FROM SUPPLIER / REJECTED → REFUNDED TO CLIENT)
- Status Date (agent updates when status changes)
- Processing Days (auto-calculated: TODAY − Cancel_Date)
- Refund Mode (Dropdown: Cash, Bank Transfer, Adjusted Against Booking, Credit Card, Cheque)
- Remarks (free text)

---

#### 3.5.2 Cancel Type Auto-Detection
**Purpose:** System automatically distinguishes full vs. partial cancellation.

**Logic:**
```
IF (count of flagged passengers for this PNR) = (total passengers count for this PNR)
    → Cancel Type = "FULL BOOKING"
ELSE
    → Cancel Type = "CANCEL PAX"
```

**On Booking Tracker:**
- Agent simply checks a "Refund Flag" checkbox next to passenger name
- No manual cancel type selection needed
- Multiple passengers can be checked for full-booking refunds

**Example:**
- PNR ABC123: Passenger 1 (Rajesh) + Passenger 2 (Meena), both checked → "FULL BOOKING"
- PNR ABC123: Passenger 1 (Rajesh) unchecked, Passenger 2 (Meena) checked → "CANCEL PAX"

---

#### 3.5.3 Refund Status Workflow Chain
**Purpose:** Define clear progression through refund lifecycle with visual indicators.

**Status Chain:**
```
TO APPLY ──▶ APPLIED ──▶ IN PROCESS ──┬──▶ RCVD FROM SUPPLIER ──▶ REFUNDED TO CLIENT
                                        │
                                        └──▶ REJECTED
```

**Each Status with Color Coding:**
- **TO APPLY** (Yellow) — Cancellation request received, awaiting agency action
- **APPLIED** (Orange) — Agency has applied for refund with airline
- **IN PROCESS** (Blue) — Awaiting airline response
- **RCVD FROM SUPPLIER** (Green) — Airline has refunded the agency
- **REFUNDED TO CLIENT** (Dark Green) — Customer refund completed
- **REJECTED** (Red) — Airline rejected the refund request (escalate manually)

**Processing Days Auto-Alert:**
- If Processing_Days > 30 → highlight row in red for escalation
- Supplier refund expected metric shows pending refund amount

---

#### 3.5.4 Refund Calculation & Financial Impact
**Purpose:** Clear breakdown of refund amounts and financial positions.

**Calculation:**
```
Eligible Refund = MAX(0, Fare_Sold − Airline_Penalty − Service_Fee)

Example:
    Fare Sold (customer charged):        €400
    Less: Airline Penalty:               -€80
    Less: Service Fee (FlyForSure):      -€20
    ────────────────────────────────────────
    REFUND TO CUSTOMER:                  €300
```

**Agency Financial Impact:**
```
Original Position:
    Revenue (Fare Sold):        €400
    Cost (Fare Issued):         €340
    Your Profit:                €60

After Refund:
    Supplier refunds you:       €260 (airline refund)
    Service fee you keep:       €20  (cancellation fee)
    You refund customer:        -€300
    ────────────────────
    Net cost to you:           -€20 (loss on this refund)
    
    BUT: You retain €20 service fee + get airline credit → net €0 impact
```

---

#### 3.5.5 Partial Cancellation Scenario
**Purpose:** Handle complex scenario where multi-passenger PNR has one cancellation.

**Example:**
```
PNR ABC123:
  Passenger 1: Rajesh  | Fare €450 | Ticket 055-1234567890 | ☐ (not cancelling)
  Passenger 2: Meena   | Fare €400 | Ticket 055-1234567891 | ☑ (cancelling)
  ───────────────────────────────────────────────────────────────
  Total PNR Fare:      €850
  Total Payments Received: €850 (fully paid)

Refund Entry (Meena):
  Cancel Type: AUTO-DETECTS "CANCEL PAX" (1 of 2 checked)
  Fare Sold: €400
  Airline Penalty: €80
  Service Fee: €20
  Eligible Refund: €300
  
Financial Summary:
  Revised PNR Fare (active passengers only): €450 (Rajesh)
  Total Payments Received:                   €850
  Remaining Fare Due:                        €450
  Less: Refund to Meena:                     -€300
  ──────────────────────────────────────────
  Net Status: Customer overpaid by €400
  Action: Issue €300 refund to Meena, keep €50 as credit for Rajesh
```

The system shows:
- Revised PNR Fare (only active passengers)
- Revised Balance (remaining money owed or overpaid)
- Clear message: "Customer overpaid — process refund of €300"

---

#### 3.5.6 Refund Receipt (Printable)
**Purpose:** Print-friendly confirmation for customer records.

**Auto-Populated From:**
- Ticket number lookup → pulls booking details
- Refund Tracker data → shows cancellation & refund terms

**Receipt Content:**
```
┌──────────────────────────────────┐
│      REFUND CONFIRMATION         │
├──────────────────────────────────┤
│ Ref: RFD-DDMMYY-NNN              │
│ PNR: XXXXXX                      │
│ Ticket: 055-XXXXXXXXXX           │
│ Passenger: RAJESH SHARMA         │
│ Airline: ITA AIRWAYS             │
│ Sector: FCO-DEL-FCO              │
├──────────────────────────────────┤
│ CANCELLATION DETAILS             │
│ Cancel Date: 15-May-2026         │
│ Cancel Type: CANCEL PAX          │
│ Category: VOLUNTARY              │
├──────────────────────────────────┤
│ REFUND CALCULATION               │
│ Original Fare:        €400.00    │
│ Airline Penalty:      -€80.00    │
│ Service Fee:          -€20.00    │
│ ────────────────────────────────│
│ REFUND AMOUNT:        €300.00    │
├──────────────────────────────────┤
│ PNR PAYMENT SUMMARY              │
│ Total PNR Fare (all): €850.00    │
│ Payments Received:    €850.00    │
│ This Refund:          -€300.00   │
│ Active Pax Fare:      €450.00    │
│ Remaining Balance:    €0.00      │
│                                  │
│ ✅ PNR SETTLED                   │
├──────────────────────────────────┤
│ Refund Mode: BANK TRANSFER       │
│ Status: RCVD FROM SUPPLIER       │
│ Processing: 8 days               │
└──────────────────────────────────┘
```

---

#### 3.5.7 Refund Tracking Dashboard
**Purpose:** Admin view of all refunds with status counts and KPIs.

**Summary Cards:**
- Total Refunds to Customers (amount & count)
- Pending Refunds (TO APPLY + APPLIED + IN PROCESS count)
- Refunds Rcvd from Suppliers (amount & count)
- Penalties Retained by Agency (sum of airline penalties)
- Service Fees Earned (sum of service fees)
- Avg Processing Time (avg days from cancel to customer refund)
- Overdue Refunds (Processing Days > 30, red alert)

**Refund Status Table:**
- Ticket No
- Passenger
- Original Fare
- Refund Amount
- Cancel Type
- Refund Status
- Processing Days
- Actions (Edit, Print Receipt)

**Filters:**
- Date Range (Cancel Date)
- Status
- Cancel Type (Full/Partial)
- Refund Category
- Refund Mode

**Analytics:**
- Refunds by Category (pie chart: No-Show, Flight Cancel, Voluntary, etc.)
- Processing Time Trend (avg days over time)
- Refund Rate % (refund tickets / total tickets)
- Penalties by Airline (which airlines charge most)

---

### 3.6 Daily Statements

#### 3.6.1 Daily Statement - For Agents
**Purpose:** Provide agents with daily summary of their bookings and financial obligations.

**Content:**
- Statement Date Range (Yesterday, or last 24 hours)
- Summary Section:
  - New Bookings (count, total amount)
  - Confirmed Bookings
  - Pending Payments
  - Refunds Processed
  - Total Outstanding Amount Due (Agent → Admin)
  
- Booking Table:
  - PNR
  - Passenger
  - Travel Date
  - Amount
  - Commission
  - Payment Status
  - Refund Status

- Payment History (if any payments received)
- Outstanding Bookings (if any pending)

**Recipients:** All agents in the network

**Delivery:** Email + In-app notification

**Format:** PDF + HTML email template (readable on mobile)

---

#### 3.6.2 Daily Statement - For Suppliers
**Purpose:** Provide suppliers with settlement summary and outstanding payables.

**Content:**
- Statement Date Range
- Summary Section:
  - Total Bookings Created (count, total amount)
  - Total Amount Payable
  - Payments Received (during period)
  - Outstanding Payable
  - Pending Refunds

- Booking Table:
  - PNR
  - Agent Name
  - Passenger
  - Travel Date
  - Gross Amount
  - Commission/Deduction (supplier's cut)
  - Net Amount Payable
  - Payment Status

- Payment History
- Outstanding Amounts

**Recipients:** All suppliers with active bookings

**Delivery:** Email + In-app notification

**Format:** PDF + HTML email

---

#### 3.6.3 Daily Statement - Admin Summary
**Purpose:** Provide admin with comprehensive daily snapshot of all activities.

**Content:**
- Total Bookings (new, by status)
- Total Revenue
- Total Payables
- Total Receivables
- Total Payments In/Out
- Outstanding Amounts (agents + suppliers)
- Refunds Processed
- High-priority alerts (e.g., large unpaid amounts, failed refunds)

- Breakdown by agent (top performers, pending amounts)
- Breakdown by supplier (top volume, outstanding payables)

**Delivery:** Email + In-app notification

**Format:** PDF + HTML email with links to detailed views

---

#### 3.6.4 Statement Scheduling & Delivery
**Purpose:** Automate or manually trigger statement distribution.

**Scheduling:**
- Admin can set:
  - Daily delivery time (e.g., 9 AM)
  - Delivery enabled/disabled
  - Recipient filters (all agents, specific agents, all suppliers, etc.)

**Manual Trigger:**
- Admin can generate and send statements on-demand
- Select recipients
- Preview before sending
- Send immediately or schedule for later

**Delivery Channels:**
1. **Email:** System sends PDF attachment + HTML body
   - To: Agent/Supplier email addresses from system
   - From: noreply@[agencyname].com
   - Subject: "Daily Statement - [Date]"

2. **In-App Notification:**
   - Notification badge
   - Email-style notification panel
   - Link to view statement in-app
   - Mark as read/unread

**Recipient Preferences:**
- Agents/Suppliers can manage email preferences
- Opt-in/out of daily statements
- Choose delivery time
- Choose delivery method (email, in-app, or both)

---

### 3.6 Expense Tracking & P&L Analysis

#### 3.6.1 Expense Tracker
**Purpose:** Record all operating expenses for business P&L calculation.

**Inspired by:** FlyForSure Storefront v11 Expense Tracker (tblExpenses) — categorized expenses, branch-level tracking, fixed vs. variable classification.

**Data Fields:**
- Expense Date (agent enters)
- Category (Dropdown: RENT, SALARIES, UTILITIES, MARKETING, OFFICE SUPPLIES, TRAVEL, SOFTWARE & IT, COMMISSIONS, INSURANCE, BANK CHARGES, TAXES & FEES, MISCELLANEOUS)
- Description (free text, e.g., "Office rent for May")
- Vendor / Payee (who was paid)
- Amount (€)
- Payment Mode (Dropdown: Cash, Bank Transfer, Credit Card, Debit Card, UPI, Cheque, POS Terminal, Online Payment, Auto Debit)
- Receipt Reference (receipt/invoice number for audit)
- Branch / Office (Dropdown: Rome HQ, Rome Storefront, India Office, Remote — enables multi-location tracking)
- Recurring (Dropdown: YES / NO — distinguishes fixed vs. variable expenses)
- Month (auto-extracted from date for monthly grouping)
- Remarks (free text)

**Agent Action:**
- Storefront staff enters expense when incurred
- All calculations (month, category totals) auto-populate
- No formula knowledge required

---

#### 3.6.2 Expense Entry Flow
**Purpose:** Simple, standardized expense recording.

**User Flow:**
1. Finance Manager clicks "Record Expense"
2. Form opens with fields listed above (blue = manual, auto = green)
3. Validates:
   - Date cannot be future date
   - Amount must be positive
   - Category must be selected
4. Save triggers:
   - Expense recorded
   - Monthly category totals auto-update
   - P&L Statement auto-recalculates
   - If amount > €1000, flag in dashboard (optional alert)

**Bulk Expense Upload:**
- Support CSV/Excel upload for multi-expense batches
- Map columns: Date, Category, Description, Vendor, Amount, Mode, Branch, Recurring
- Validate before import
- Generate import log with success/error counts

---

#### 3.6.3 P&L Statement (Auto-Calculated)
**Purpose:** Comprehensive profit & loss statement pulling from all data sources.

**Left Panel — Full P&L Structure:**

**Revenue Section:**
```
Revenue (Fare Sold):              €12,450
  Breakdown by Airline:
    ITA AIRWAYS:                  €4,200
    AIR INDIA:                    €5,100
    EMIRATES:                     €3,150

Less: Client Refunds:             -€1,200
────────────────────────────────────────
EFFECTIVE REVENUE:                €11,250
```

**COGS (Cost of Goods Sold) Section:**
```
COGS (Fare Issued to Suppliers):  €10,000
  Breakdown by Airline:
    ITA AIRWAYS:                  €3,500
    AIR INDIA:                    €4,300
    EMIRATES:                     €2,200

Gross Profit:                     €2,450
Gross Margin %:                   21.8%
```

**Operating Expenses Section:**
```
RENT:                             €1,200
SALARIES:                         €3,500
UTILITIES:                        €300
MARKETING:                        €400
OFFICE SUPPLIES:                  €150
TRAVEL:                           €200
SOFTWARE & IT:                    €250
COMMISSIONS:                      €100
INSURANCE:                        €100
BANK CHARGES:                     €50
TAXES & FEES:                     €200
MISCELLANEOUS:                    €100
────────────────────────────────────────
TOTAL OPERATING EXPENSES:         €6,550
```

**Bottom Line:**
```
NET PROFIT (LOSS):                -€4,100
Net Margin %:                     -36.5%

Commentary: High expenses relative to revenue; need to increase bookings or reduce overhead
```

**Automatic Updates:**
- System recalculates automatically when:
  - New booking added
  - Payment recorded
  - Refund processed
  - Expense entered
- No manual P&L entry needed
- Historical P&L by month available for trend analysis

---

#### 3.6.4 Right Panel — Financial Analytics

**Collections Status:**
```
Total Collections (Revenue):      €11,250
Outstanding Receivables:          €2,100
Collection Rate:                  84.3%
Fully Paid PNRs:                  23
Partial Payment PNRs:             4
Unpaid PNRs:                      3
Avg Days Outstanding:             8 days
```

**Expenses by Branch:**
```
Rome HQ:                          €3,200 (49%)
Rome Storefront:                  €2,100 (32%)
India Office:                     €900 (14%)
Remote:                           €350 (5%)
```

**Expenses by Payment Mode:**
```
Bank Transfer:                    €3,500 (53%)
Cash:                             €1,800 (27%)
Credit Card:                      €900 (14%)
Auto Debit:                       €350 (5%)
```

**Fixed vs Variable:**
```
Recurring (Fixed):                €4,900 (75%)
  - Rent, Salaries, Utilities, Insurance, Software
One-time (Variable):              €1,650 (25%)
  - Supplies, Travel, Marketing, Miscellaneous
  
Ratio: 3:1 Fixed to Variable (sustainable if revenue grows)
```

**Key Performance Indicators:**
```
Total Passengers (bookings):      45
Revenue per Passenger:            €250
Cost per Passenger (COGS):        €222
Expense per Passenger:            €146
Net Profit per Passenger:         -€118
Break-even Passengers Needed:     56 (vs. current 45)
```

**Cash Position:**
```
Cash In (Collections):            €11,250
Cash Out (Expenses):              €6,550
Net Cash Flow:                    €4,700
Runway (months):                  0.7 months (tight — increase collections or cut expenses)
```

**Refund Analysis:**
```
Total Refunds Issued:             €1,200
Refunds as % of Revenue:          9.6%
Avg Refund per Cancellation:      €300
Refunds In Process:               €400
Expected from Suppliers:          €800
Avg Days to Customer Refund:      12 days
```

---

#### 3.6.5 Monthly P&L Comparison
**Purpose:** Trend analysis and month-over-month performance.

**Display:**
```
              May 2026    Apr 2026    Mar 2026    YTD 2026
──────────────────────────────────────────────────────────
Revenue       €11,250    €9,800     €8,500     €29,550
COGS          €10,000    €8,800     €7,600     €26,400
Gross Profit  €1,250     €1,000     €900       €3,150
Net Profit    -€4,100    -€2,200    -€1,100    -€7,400
Net Margin %  -36.5%     -22.4%     -12.9%     -25.0%
```

**Trend Lines:**
- Revenue trending up (25% vs prev month) ✅
- Expenses stable (same level) ⚠️
- Margin improving but still negative ⚠️

**Actions Suggested by System:**
- "Revenue increased 25% — great! But net profit still negative. Need to reduce expenses by €4K/month or 2x bookings to break even."

---

#### 3.6.6 Budget vs. Actual (Optional Phase 2)
**Purpose:** Compare planned expenses vs. actual spending.

**Features:**
- Admin sets monthly budget per category (e.g., RENT: €1,200, SALARIES: €3,500)
- System tracks actual vs. budget
- Red flags if category exceeds budget by 10%
- Shows overspend/underspend variance

**Example:**
```
Category      Budget    Actual    Variance    % Var
─────────────────────────────────────────────────────
RENT          €1,200    €1,200    €0         0%
SALARIES      €3,500    €3,650    -€150      -4%
UTILITIES     €300      €320      -€20       -7%
MARKETING     €400      €600      -€200      -50% ⚠️
```

---

### 3.8 Settings & Configuration

#### 3.8.1 Payment & Refund Statuses
**Purpose:** Allow admin to define custom status workflows.

**Default Statuses Provided:**

**Payment Statuses:**
- Pending
- Awaiting Confirmation
- Partial
- Received
- Failed
- Disputed

**Refund Statuses:**
- Awaiting Confirmation
- Approved
- Processed
- Completed
- Failed
- Reversed

**Admin Customization:**
- Add/Edit/Delete custom statuses
- Reorder status sequence (workflow order)
- Assign colors to each status
- Set default status on booking creation

---

#### 3.8.2 Custom Fields
**Purpose:** Add agency-specific fields to bookings.

**Creation:**
- Admin clicks "Add Custom Field"
- Define:
  - Field Name (e.g., "Group Tour Name")
  - Field Type (Text, Number, Date, Dropdown, Textarea, Checkbox)
  - Required (Yes/No)
  - Placeholder/Help Text
  - Default Value
  - Dropdown options (if applicable)

**Management:**
- List all custom fields
- Edit/Delete fields
- Reorder fields on form
- Set which user roles can edit field

**Usage:**
- Custom fields appear in booking form
- Searchable/filterable in booking list
- Included in ledger views if relevant
- Included in daily statements if marked "Include in Statement"

---

#### 3.8.3 Email Configuration
**Purpose:** Setup email delivery for statements and notifications.

**SMTP Settings:**
- SMTP Server Address
- SMTP Port
- Username / Password
- From Email Address
- From Name (display name)
- Test Email button

**Statement Templates:**
- Preview/Edit HTML email templates
- Add agency logo
- Customize colors, fonts
- Add footer (terms, contact info)

**Notification Templates:**
- Payment received notification
- Refund issued notification
- Payment reminder (overdue)
- Statement sent confirmation

---

#### 3.8.4 User Management
**Purpose:** Manage admin, agent, and supplier user accounts.

**User List:**
- Name
- Email
- Role (Admin/Agent/Supplier)
- Status (Active/Inactive)
- Last Login
- Created Date

**Create/Edit User:**
- Email (unique)
- Name
- Role
- Password (auto-generated, send to user)
- Permissions (based on role)
- Linked Agent/Supplier (if applicable)

**Actions:**
- Activate/Deactivate user
- Reset password
- Delete user (soft delete, preserves data)
- View login history

---

#### 3.8.5 Agent & Supplier Directory
**Purpose:** Manage agents and supplier information.

**Agent Directory:**
- Agent ID / Name
- Email
- Phone
- Address
- Commission Rate (% or fixed)
- Account Status (Active/Inactive/Suspended)
- Total Commissions Earned (YTD)
- Current Outstanding Amount
- Last Active Date

**Actions:**
- Edit details
- Suspend/Activate
- View all bookings
- View ledger
- Send message

**Supplier Directory:**
- Supplier Name
- Contact Email
- Phone
- Service Type (Airline, Hotel, Activity, etc.)
- Payment Terms (e.g., Net 30)
- Bank Details (for payouts)
- Current Outstanding Payable
- Last Payment Date

**Actions:**
- Edit details
- Update payment info
- View all bookings
- View ledger
- Record payment

### 3.7 Live Alerts System (Auto-Flagging)

#### 3.7.1 Alert Categories & Auto-Detection
**Purpose:** System automatically flags critical situations without agent action.

**Inspired by:** FlyForSure Storefront v11 Alerts (Days_To_Dep, Alert auto-calculated) — real-time flagging of urgent scenarios.

**Alert Type 1: Overdue Payment**
```
Condition: Days_To_Departure ≤ 0 AND Balance_Due > 0
Severity: 🔴 CRITICAL
Message: "Flight DEPARTED UNPAID. PNR ABC123, balance €450 outstanding."
Action: Admin must contact customer immediately; may need to file complaint with airline
Notification: Email + In-app red badge
Auto-Escalate: After 7 days unpaid post-departure, flag for legal/debt collection
```

**Alert Type 2: Upcoming Departure (Payment Due)**
```
Condition: 0 < Days_To_Departure ≤ 7 AND Balance_Due > 0
Severity: ⚠️ URGENT
Message: "URGENT: Departure in {X} days. Customer {Name}, {PNR} owes €{Amount}"
Suggested Action: Call customer, request immediate payment, offer installment if needed
Notification: Red badge, daily reminder until paid
Auto-Clear: When payment received or departure passed
```

**Alert Type 3: Follow-Up Payment**
```
Condition: 8 ≤ Days_To_Departure ≤ 14 AND Balance_Due > 0
Severity: ⏰ FOLLOW UP
Message: "Payment due in 2 weeks. PNR ABC123, {Passenger}, €{Amount}"
Suggested Action: Gentle reminder, offer final installment plan
Notification: Orange badge, once per day
```

**Alert Type 4: Settled / No Action**
```
Condition: Payment_Status = "FULLY PAID"
Severity: ✅ SETTLED
Message: "✅ All payments received. Booking confirmed."
Notification: Green badge, archive after departure +7 days
```

**Alert Type 5: Voided/Cancelled Ticket**
```
Condition: Refund_Flag = ☑ AND Refund_Status = "REJECTED" (or stuck > 45 days)
Severity: 🔴 ESCALATE
Message: "Refund STUCK: Ticket {No}, customer {Name}, {Amount} pending {X} days. Escalate to Peter."
Action: Manual review, contact airline, consider goodwill refund
Notification: Red email alert to manager
```

**Alert Type 6: Pending Refund (In Process)**
```
Condition: Refund_Status = "IN PROCESS" AND Processing_Days > 30
Severity: ⚠️ FOLLOW UP
Message: "Refund pending {X} days. Follow up with airline supplier."
Suggested Action: Check with airline, request status update
Notification: Yellow badge, escalate if > 45 days
```

---

#### 3.7.2 Alerts Dashboard
**Purpose:** Central view of all active alerts with drill-down capability.

**Alert Summary Cards:**
```
┌─────────────────────────────────────────────┐
│ 🔴 CRITICAL ALERTS          3               │
│ ⚠️  URGENT (0-7 days)       7               │
│ ⏰ FOLLOW UP (8-14 days)    12               │
│ 🟡 ESCALATED REFUNDS       2                │
│ ✅ SETTLED / CLEAR         95               │
└─────────────────────────────────────────────┘
```

**Alert List (Filterable & Sortable):**
- Alert Type (icon + color)
- PNR / Ticket No
- Passenger Name
- Days to Departure (or Days Outstanding)
- Amount at Risk
- Status
- Date Created
- Actions (View Booking, Quick Pay, Send Reminder, Mark Resolved)

**Filters:**
- Alert Type (Critical, Urgent, Follow-Up, Escalated, Settled)
- Date Range
- Agent
- Amount Range
- Status (Active, Resolved, Archived)

**Sort Options:**
- Severity (Critical first)
- Days to Departure (soonest first)
- Amount (largest at risk first)
- Age (oldest first)

---

#### 3.7.3 Departure Alerts (0-14 Day Window)
**Purpose:** Dedicated view of all departures within 14 days, auto-flagged with payment status.

**Display Columns:**
- PNR
- Passenger(s)
- Departure Date
- Days to Dep (countdown)
- Airline & Sector
- Amount Due
- Payment Status
- Alert Flag (URGENT / FOLLOW UP / SETTLED)
- Agent (who booked)
- Last Action (payment received, reminder sent)

**Color Coding:**
- 🔴 Red: 0-3 days to departure + unpaid
- 🟠 Orange: 4-7 days to departure + unpaid  
- 🟡 Yellow: 8-14 days to departure + unpaid
- 🟢 Green: Fully paid
- ⚫ Black: No longer upcoming (archived)

**Quick Actions:**
- "Quick Pay" — Open payment form pre-filled with PNR & amount due
- "Send Reminder" — Email/SMS template to customer
- "Mark Resolved" — Archive alert after manual action
- "View Booking" — Open full booking detail for context

**Example View:**
```
PNR      Passenger        Dep Date    Days   Sector        Due     Status      Alert
──────────────────────────────────────────────────────────────────────────────────────
ABC123   Rajesh Sharma    20-May-26   3      FCO-DEL      €450    UNPAID      🔴 URGENT
DEF456   Meena Patel      19-May-26   2      FCO-BOM      €200    FULLY PAID  ✅ SETTLED
GHI789   Akshay Kumar     25-May-26   8      DXB-DEL      €600    PARTIAL     ⏰ FOLLOW UP
JKL012   Priya Singh      28-May-26   11     MXP-ROM      €350    UNPAID      ⏰ FOLLOW UP
MNO345   Vikram Mehta     22-May-26   5      CDG-FCO      €400    UNPAID      🔴 URGENT
```

---

#### 3.7.4 Email Alert Notifications
**Purpose:** Automated email alerts for critical situations.

**Daily Digest Email (Morning, configurable time):**
- To: Admin + Finance Manager
- Subject: "FlyForSure Daily Alert Digest — {Date}"
- Content:
  - Count of CRITICAL alerts
  - Count of URGENT departures in next 7 days
  - Top 5 outstanding amounts
  - Pending refunds > 30 days
  - Quick links to Alerts Dashboard
  - Sample urgent booking details

**Immediate Alert Email (Real-time, high-priority only):**
- Condition: Departure ≤ 24 hours AND Balance > 0
- Cc: Agent who booked
- Subject: "🔴 URGENT: Flight departs tomorrow — {PNR} {Amount} outstanding"
- Body: Booking details, payment link (if applicable), contact info
- Action: Agent must respond immediately

**Refund Escalation Email:**
- Condition: Refund processing > 45 days OR rejected
- To: Finance Manager + Peter
- Subject: "⚠️ ESCALATE: Refund stuck {X} days — {PNR} {Ticket}"
- Body: Full refund history, airline contact, suggested next steps

---

#### 3.7.5 Alert Settings & Customization
**Purpose:** Admin configures alert thresholds and notification preferences.

**Settings:**
- Critical Alert Threshold: Days to departure (default: 0 = departure day)
- Urgent Alert Threshold: Days to departure (default: 7)
- Follow-Up Threshold: Days to departure (default: 14)
- Refund Escalation Days: Processing days > X (default: 45)
- Email Recipients: Who gets which alerts (admin, agent, finance)
- Notification Method: Email, In-app, SMS (if available)
- Digest Frequency: Daily, Weekly (default: Daily at 9 AM)
- Quiet Hours: Do not send alerts between X and Y time

**Custom Rules (Phase 2):**
- Alert if balance > €X (e.g., alert if outstanding > €1000)
- Alert if collection rate < Y% (e.g., < 70%)
- Suppress alerts for specific agents (trusted, always pay on time)

---

#### 3.7.6 In-App Alert Widget
**Purpose:** Real-time alerts visible in sidebar/dashboard header.

**Display:**
```
┌─ ALERTS ──────────────────────┐
│                               │
│ 🔴 3 CRITICAL                 │
│    • ABC123 departs today     │
│    • DEF456 €450 unpaid       │
│    • GHI789 refund stuck 60d  │
│                               │
│ ⚠️  7 URGENT                   │
│    • View all →               │
│                               │
│ [Clear All Resolved]          │
└───────────────────────────────┘
```

**Click Behavior:**
- Click alert → open relevant detail page (Booking, Refund Tracker)
- Click "View All" → go to Alerts Dashboard
- Click "Clear" → mark alert as resolved (manual)
- Auto-clear → when condition resolves (payment received, departure passed)

---

### 3.8 Admin Dashboard & Analytics

#### 3.8.1 Financial Overview Dashboard
**Purpose:** Quick snapshot of key KPIs for daily operations.

**KPI Cards (Top Row):**
- Total Revenue (This Month)
- Total Collections (This Month)
- Outstanding Receivables (all-time)
- Net Profit (This Month)

**Charts (Interactive):**
1. **Revenue Trend** — Line chart showing daily revenue for current month
2. **Payment Status** — Pie chart: Fully Paid (%), Partial (%), Unpaid (%)
3. **Expense Breakdown** — Bar chart of top 5 expense categories
4. **Departure Alerts (0-14d)** — Count of unpaid bookings by days-to-dep
5. **Collections Pipeline** — Stacked bar: collections received vs. outstanding by date

**Action Buttons:**
- "New Booking" → quick add
- "Record Payment" → quick pay
- "View Alerts" → go to Alerts Dashboard
- "Download P&L" → export PDF

**Filter Bar:**
- Date Range
- Branch/Office
- Airline (if relevant)

---

#### 3.8.2 Agent Performance Dashboard
**Purpose:** Individual agent/storefront KPIs and activity.

**Agent Summary:**
```
Agent: Rajesh Sharma | Branch: Rome Storefront
────────────────────────────────────────────────
Total Bookings (YTD): 15
Total Revenue: €5,250
Total Collections: €4,800
Outstanding: €450
Collection Rate: 91.4%
Avg Payment Days: 8 days
Pending Refunds: 2 (€600 total)
```

**Charts:**
- Monthly revenue trend
- Booking volume trend (count + revenue)
- Payment timeliness (on-time vs late days)
- Refund rate (% of bookings cancelled)

**Recent Bookings:**
- Latest 10 bookings with status, amount, payment
- Filter by status (Unpaid, Partial, Paid)

**Comparison:**
- Agent's metrics vs. agency average
- Highlight outliers (best performer, slowest payment, highest refund rate)

---

#### 3.8.3 Supplier Performance Dashboard
**Purpose:** Supplier payment, volume, and relationship metrics.

**Supplier Summary:**
```
Supplier: ITA AIRWAYS
─────────────────────
Total Bookings: 28
Total Volume (COGS): €8,400
Outstanding Payable: €1,200
Payment Status: PARTIAL
Avg Payment Days: 15 days
Last Payment: 5 days ago
Penalty Refunds Retained: €340
```

**Analytics:**
- Volume trend (bookings per month)
- Payables aging (0-30d, 30-60d, 60+ days overdue)
- Payment method breakdown
- Refunds awaiting from supplier
- Penalties charged by this supplier

---

### 3.9 Reporting & Export

#### 3.9.1 Pre-Built Reports
**Purpose:** One-click downloads for common analysis needs.

**Available Reports:**
1. **Daily Summary Report** (Email-friendly)
   - Bookings added today
   - Payments received today
   - Refunds processed today
   - P&L snapshot (today vs. YTD)

2. **Weekly Agent Settlement** (PDF)
   - Per-agent: revenue, collections, outstanding, commission due
   - Total receivables
   - Action items

3. **Monthly P&L Statement** (Excel)
   - Full P&L with comparisons to prior months
   - Cash flow summary
   - Alerts/commentary

4. **Supplier Payables Report** (PDF)
   - Per-supplier: volume, payable, payments made, outstanding
   - Aging analysis
   - Payment schedule

5. **Refund Tracker Report** (Excel)
   - All refunds in period with status
   - Processing time analysis
   - Pending refund summary

6. **Tax Report** (Excel, quarterly)
   - Revenue, expenses by category
   - GST/VAT breakdowns (if applicable)
   - Commission paid to agents

---

#### 3.9.2 Custom Report Builder
**Purpose:** Create tailored reports on-demand.

**Dimensions:**
- Date Range
- Booking Status
- Payment Status
- Refund Status
- Agent(s)
- Supplier(s)
- Branch/Office

**Metrics:**
- Revenue, Collections, Outstanding
- Expense totals by category
- Refund amounts & processing days
- Commission paid
- Profit/margin

**Output Formats:**
- PDF (formatted for printing)
- Excel (raw data, sortable)
- CSV (for external tools)

---

### 4.1 Admin Permissions
✅ Full access to all features
✅ Add/Edit/Delete bookings
✅ Upload files (CSV, Excel, PDF)
✅ View all ledgers (agents + suppliers)
✅ Record payments (in + out)
✅ Process refunds
✅ Configure settings
✅ Manage users
✅ Access dashboard & analytics
✅ Send statements (manual or scheduled)
✅ Edit any booking
✅ View audit trail

### 4.2 Agent Permissions
✅ Create bookings (assigned to self)
✅ View own bookings only
✅ Edit own bookings (passenger details, flight info)
❌ Cannot edit commission/payment status (read-only)
❌ Cannot view other agents' bookings
❌ Cannot upload files
❌ Cannot access ledgers (own summary in statement only)
✅ Receive daily statements (email + in-app)
✅ Receive notifications (payment, refund updates)

### 4.3 Supplier Permissions
✅ View bookings created via their service
❌ Cannot edit booking data (read-only)
❌ Cannot see agent names or commissions
✅ View payment status on their bookings
✅ View outstanding payable amount
✅ Receive daily statements (email + in-app)
✅ Receive payment notifications
❌ Cannot access settings or user management

---

## 5. DATA MODEL & ENTITIES (Storefront-Aligned)

### 5.1 Booking Entity (tblBookings equivalent)
```
{
  id: UUID,
  booking_date: Date,
  invoice_no: String (auto: FFS-DDMMYY-NNN),
  pnr: String (unique within date window),
  
  # Passenger Details
  passenger_name: String,
  pax_type: Enum [ADT, CHD, INF],
  mobile: String,
  
  # Flight Details
  airline: String,
  ticket_no: String (unique, e-ticket number),
  ow_rt: Enum [OW, RT],
  sector: String,
  outbound_date: Date,
  inbound_date: Date (nullable),
  
  # Pricing (per passenger)
  fare_sold: Decimal (customer-facing price),
  fare_issued: Decimal (supplier cost),
  profit: Decimal (calculated: fare_sold - fare_issued),
  
  # Payment Status
  total_paid: Decimal (auto-summed from Payment Ledger),
  balance_due: Decimal (calculated: fare_sold - total_paid),
  payment_status: Enum [UNPAID, PARTIAL, FULLY_PAID] (auto-derived),
  num_instalments: Integer (auto-count from Payment Ledger),
  
  # Ticket Status
  ticket_status: Enum [PENDING, TICKETED, REISSUED] (auto-derived),
  
  # Booking Status
  booking_status: String,
  days_to_departure: Integer (calculated: outbound_date - TODAY),
  alert: Enum [URGENT, FOLLOW_UP, OVERDUE, SETTLED] (auto-calculated),
  
  # Staff Assignment
  booked_by: String,
  agent_issued_by: String,
  
  # Refund Flag
  refund_flag: Boolean (☑/☐ checkbox),
  
  # Grouping
  pnr_n: Integer (helper: which passenger number in PNR, 1st/2nd/3rd),
  
  # Timestamps
  created_at: DateTime,
  updated_at: DateTime,
  remarks: String
}
```

**Key Differences from Simple Model:**
- `fare_sold` & `fare_issued` split explicitly (internal analytics)
- `profit` calculated per passenger
- `pnr_n` helper prevents double-counting in financial summaries
- `ticket_no` enables per-passenger refund tracking
- `refund_flag` checkbox drives Cancel Type auto-detection
- `alert` auto-calculated based on departure + payment status

---

### 5.2 Payment Ledger Entity (tblPayments equivalent)
```
{
  id: UUID,
  payment_date: Date,
  pnr: String (FK to Booking),
  passenger_name: String (auto-lookup),
  
  # Payment Details (agent types only these)
  amount_paid: Decimal,
  payment_mode: Enum [CASH, BANK_TRANSFER, CREDIT_CARD, DEBIT_CARD, UPI, CHEQUE, POS_TERMINAL, ONLINE_PAYMENT],
  receipt_ref: String,
  
  # Auto-Calculated
  instalment_no: Integer (COUNTIF auto-sequence: 1, 2, 3...),
  instalment_type: String (auto: ADVANCE → 2ND → 3RD → 4TH → FINAL → EXTRA),
  received_by: String (auto-lookup from Booking.booked_by),
  cumulative_paid: Decimal (running sum per PNR),
  total_fare: Decimal (auto-sum of all fares for PNR),
  remaining_balance: Decimal (total_fare - cumulative_paid),
  
  # Metadata
  pnr_n: Integer (helper for receipt lookups),
  created_at: DateTime,
  updated_at: DateTime,
  remarks: String
}
```

**Key Features:**
- Only 5 manual fields (agent types these)
- 9 auto-calculated fields
- Multi-installment support (irregular dates, variable amounts)
- No negative payments — refunds tracked separately
- Instalment Type auto-assigned (no dropdown)

---

### 5.3 Refund Tracker Entity (tblRefunds equivalent)
```
{
  id: UUID,
  ticket_no: String (unique, PK for refund tracking),
  pnr: String (auto-lookup from Booking via ticket),
  passenger_name: String (auto-lookup),
  airline: String (auto-lookup),
  sector: String (auto-lookup),
  
  # Refund Calculation
  fare_sold: Decimal (auto-lookup),
  fare_issued: Decimal (auto-lookup),
  cancel_date: Date,
  cancel_type: Enum [FULL_BOOKING, CANCEL_PAX] (auto-derived from checkbox count),
  refund_category: Enum [NO_SHOW, FLIGHT_CANCEL, VOLUNTARY, TAX_ONLY, MEDICAL_DEATH],
  
  airline_penalty: Decimal,
  service_fee: Decimal,
  eligible_refund: Decimal (calculated: MAX(0, fare_sold - penalty - fee)),
  
  supplier_refund: Decimal (actual airline refund to agency),
  
  # Refund Lifecycle
  refund_status: Enum [TO_APPLY, APPLIED, IN_PROCESS, RCVD_FROM_SUPPLIER, REJECTED, REFUNDED_TO_CLIENT],
  status_date: Date,
  processing_days: Integer (calculated: status_date - cancel_date or TODAY - cancel_date),
  
  # Refund Payout
  refund_mode: Enum [CASH, BANK_TRANSFER, ADJUSTED_AGAINST_BOOKING, CREDIT_CARD, CHEQUE],
  
  # Metadata
  created_at: DateTime,
  updated_at: DateTime,
  remarks: String
}
```

**Key Features:**
- Ticket number as primary key (enables per-passenger refunds)
- Cancel Type auto-derived from checkbox count
- Full status chain tracking
- Processing days auto-calculated

---

### 5.4 Expense Tracker Entity (tblExpenses equivalent)
```
{
  id: UUID,
  expense_date: Date,
  category: Enum [RENT, SALARIES, UTILITIES, MARKETING, OFFICE_SUPPLIES, TRAVEL, SOFTWARE_IT, COMMISSIONS, INSURANCE, BANK_CHARGES, TAXES_FEES, MISCELLANEOUS],
  description: String,
  vendor_payee: String,
  amount_eur: Decimal,
  payment_mode: Enum [CASH, BANK_TRANSFER, CREDIT_CARD, DEBIT_CARD, UPI, CHEQUE, POS_TERMINAL, ONLINE_PAYMENT, AUTO_DEBIT],
  receipt_ref: String,
  
  branch_office: Enum [ROME_HQ, ROME_STOREFRONT, INDIA_OFFICE, REMOTE],
  recurring: Boolean (YES/NO — fixed vs variable),
  month: String (auto: TEXT(date, "MMM-YY")),
  
  created_at: DateTime,
  updated_at: DateTime,
  remarks: String
}
```

**Key Features:**
- 12 category types matching Storefront model
- Multi-branch tracking
- Fixed vs. Variable classification for P&L analysis
- Month auto-extracted

---

### 5.5 Alert Entity (Auto-Generated)
```
{
  id: UUID,
  alert_type: Enum [OVERDUE_PAYMENT, URGENT_DEPARTURE, FOLLOW_UP, VOIDED_REFUND, PENDING_REFUND, ESCALATED],
  severity: Enum [CRITICAL, URGENT, WARNING],
  pnr: String (FK),
  ticket_no: String (FK, if refund-related),
  message: String,
  amount_at_risk: Decimal,
  days_to_event: Integer (days to departure or days outstanding),
  
  created_at: DateTime,
  resolved_at: DateTime (nullable),
  resolved_by: String (nullable),
  
  # Metadata
  auto_generated: Boolean (true),
  notified: Boolean,
  notified_at: DateTime
}
```

**Key Features:**
- Auto-generated based on booking & refund state
- Tracks who resolved alert manually
- Notification tracking

---

### 5.6 Booking Status Constants (from Storefront Model)
```
# Ticket Status (auto-derived from Booking Tracker)
  PENDING     — Booking entered, no ticket yet
  TICKETED    — Ticket number(s) on file
  REISSUED    — Multiple ticket numbers for same pax (amendments)

# Payment Status (auto-derived from Payment Ledger)
  UNPAID      — Total paid = 0
  PARTIAL     — 0 < Total paid < Total fare
  FULLY PAID  — Total paid >= Total fare

# Refund Status (manual chain)
  TO APPLY         → APPLIED → IN PROCESS ──┬──→ RCVD FROM SUPPLIER → REFUNDED TO CLIENT
                                             └──→ REJECTED

# Alert Status (auto-derived)
  CRITICAL    — Departure ≤ 0d, balance > 0 (OVERDUE)
  URGENT      — Departure ≤ 7d, balance > 0
  FOLLOW UP   — 8d ≤ departure ≤ 14d, balance > 0
  ESCALATED   — Refund processing > 45d or rejected
  SETTLED     — Balance = 0 or departure passed
```

---

### 5.7 User & Agent Entities
```
# User Entity
{
  id: UUID,
  email: String (unique),
  password_hash: String,
  name: String,
  role: Enum [Admin, FinanceManager, Agent, Supplier],
  agent_id: UUID (FK, if role=Agent),
  supplier_id: UUID (FK, if role=Supplier),
  status: String (Active, Inactive),
  last_login: DateTime,
  email_preferences: JSON,
  created_at: DateTime,
  updated_at: DateTime
}

# Agent Entity (Storefront staff)
{
  id: UUID,
  name: String,
  email: String (unique),
  phone: String,
  branch: Enum [ROME_HQ, ROME_STOREFRONT, INDIA_OFFICE, REMOTE],
  role_title: String (e.g., "Storefront Agent", "Finance Manager"),
  status: String (Active, Inactive),
  created_at: DateTime,
  updated_at: DateTime
}

# Supplier Entity
{
  id: UUID,
  name: String,
  email: String,
  phone: String,
  contact_person: String,
  service_type: String (Airline, Hotel, Activity, etc.),
  payment_terms: String (e.g., "Net 30"),
  bank_account_name: String,
  bank_account_number: String,
  bank_routing_number: String,
  bank_swift: String,
  status: String (Active, Inactive),
  created_at: DateTime,
  updated_at: DateTime
}
```

---

### 5.8 Audit Log Entity
```
{
  id: UUID,
  user_id: UUID,
  action: String (Created, Updated, Deleted),
  entity_type: String (Booking, Payment, Refund, Expense, etc.),
  entity_id: UUID,
  changes: JSON (old_value, new_value),
  timestamp: DateTime,
  ip_address: String
}
```

---

## 6. TECHNICAL SPECIFICATIONS

### 6.1 Architecture & Design Philosophy

**Inspired by FlyForSure Storefront Office Model (v11):**
- **Agent simplicity first** — storefront staff enters only blue-highlighted manual fields; all calculations auto-populate
- **Formula-driven intelligence** — business logic embedded in database (stored procedures/triggers, not application code)
- **Positive-only ledger** — refunds tracked separately, never as negative entries
- **PNR grouping + Ticket keying** — both serve distinct purposes (PNR for payment grouping, ticket for refund identification)
- **Helper columns** — auto-sequence counters (instalment_no, pnr_n) prevent double-counting
- **Status auto-derivation** — payment_status, ticket_status, alert status all calculated, not selected by user
- **No CSE array formulas** — all logic uses INDEX/MATCH, SUMIF, COUNTIF patterns (compatible with all systems)

**Stack Recommendation:**
- **Frontend:** React.js or Vue.js (lightweight SPA)
  - Form handling: React Hook Form (simple, no state bloat)
  - Charting: Recharts for dashboard
  - UI: Tailwind CSS + shadcn/ui (minimal dependencies)
  
- **Backend:** Node.js + Express (matches Storefront's operational simplicity)
  - Database: PostgreSQL (financial data integrity)
  - ORM: Prisma (type-safe, clear schema)
  - Stored Procedures: Used for auto-calculations (total_paid, cumulative_paid, alert derivation)
  - Scheduled Jobs: node-cron for daily alert generation & statement dispatch
  
- **Deployment:** Single-server VPS (DigitalOcean, Linode, AWS EC2)
  - No containers initially (keep complexity low)
  - PostgreSQL + Node.js on same box
  - Daily automated backups

---

### 6.2 Calculation Engine (Auto-Populated Fields)

**Like the Storefront Model, critical calculations happen automatically:**

**On Booking Create/Update:**
```sql
-- Auto-derive payment status
UPDATE bookings 
SET payment_status = CASE
  WHEN total_paid = 0 THEN 'UNPAID'
  WHEN total_paid < fare_sold THEN 'PARTIAL'
  ELSE 'FULLY_PAID'
END
WHERE id = booking_id;

-- Auto-derive alert
UPDATE bookings
SET alert = CASE
  WHEN days_to_departure <= 0 AND balance_due > 0 THEN 'OVERDUE'
  WHEN days_to_departure <= 7 AND balance_due > 0 THEN 'URGENT'
  WHEN days_to_departure <= 14 AND balance_due > 0 THEN 'FOLLOW_UP'
  ELSE 'SETTLED'
END
WHERE id = booking_id;

-- Auto-derive ticket status
UPDATE bookings
SET ticket_status = CASE
  WHEN ticket_no IS NULL THEN 'PENDING'
  WHEN (SELECT COUNT(*) FROM bookings b2 WHERE b2.pnr = bookings.pnr AND b2.ticket_no IS NOT NULL) > 1 THEN 'REISSUED'
  ELSE 'TICKETED'
END
WHERE id = booking_id;
```

**On Payment Record:**
```sql
-- Auto-calculate instalment number
INSERT INTO payments (pnr, instalment_no)
VALUES (pnr, (SELECT COUNT(*) + 1 FROM payments WHERE pnr = $1));

-- Auto-assign instalment type
UPDATE payments
SET instalment_type = CASE
  WHEN instalment_no = 1 THEN 'ADVANCE'
  WHEN instalment_no = 2 THEN '2ND INSTALMENT'
  WHEN instalment_no = 3 THEN '3RD INSTALMENT'
  WHEN instalment_no = 4 THEN '4TH INSTALMENT'
  WHEN (SELECT SUM(amount_paid) FROM payments WHERE pnr = $1) >= (SELECT fare_sold FROM bookings WHERE pnr = $1) THEN 'FINAL'
  ELSE 'EXTRA'
END
WHERE pnr = $1 AND payment_id = $2;

-- Recalculate all booking totals & statuses
CALL refresh_booking_financials(pnr);
```

**On Refund Create:**
```sql
-- Auto-derive cancel type
INSERT INTO refunds (ticket_no, cancel_type)
SELECT ticket_no,
  CASE
    WHEN (SELECT COUNT(*) FROM bookings WHERE pnr = (SELECT pnr FROM bookings WHERE ticket_no = $1) AND refund_flag = true)
       = (SELECT COUNT(*) FROM bookings WHERE pnr = (SELECT pnr FROM bookings WHERE ticket_no = $1))
      THEN 'FULL_BOOKING'
    ELSE 'CANCEL_PAX'
  END;

-- Auto-calculate eligible refund
UPDATE refunds
SET eligible_refund = GREATEST(0, fare_sold - airline_penalty - service_fee)
WHERE ticket_no = $1;
```

---

### 6.3 Security Considerations
- **Authentication:** JWT tokens (1-hour expiry), secure HTTP-only cookies
- **Authorization:** Role-based access control (RBAC) — admin, agent, supplier, finance
- **Data Validation:** Server-side validation on all inputs (never trust frontend)
- **HTTPS:** Enforce SSL/TLS, HSTS headers
- **Audit Trail:** 100% logging of create/update/delete operations
- **Financial Integrity:** Monthly audit of payment calculations vs. bank statements
- **Password Policy:** Min 12 chars, complexity requirements, bcrypt hashing

---

### 6.4 Performance & Scalability
- **Database Indexing:** Indexes on PNR, ticket_no, payment_date, created_at, airline, alert
- **Pagination:** Limit booking list to 50 rows/page, lazy load on scroll
- **Query Optimization:** Select specific columns, pre-join critical fields (agent name, supplier name)
- **Caching:** Redis cache for agent/supplier lists (3-hour TTL)
- **File Uploads:** Limit to 20 MB per file; async processing for CSV/Excel imports
- **Report Generation:** Async task queue (Bull/Redis) for large exports

**Capacity Planning:**
| Table | Max Rows | Current | Headroom |
|-------|----------|---------|----------|
| bookings | 100,000 | 1,000 | 5-10 years |
| payments | 500,000 | 2,000 | 8-12 years |
| refunds | 100,000 | 200 | 10+ years |
| expenses | 50,000 | 100 | 10+ years |
| alerts | 1,000 | Auto-prune 30+ days old | Unlimited |

---

### 6.5 Testing Strategy
- **Unit Tests:** Payment calculations, refund eligibility, alert derivation logic
- **Integration Tests:** API endpoints (create booking, record payment, generate statement)
- **Data Integrity Tests:** Multi-installment payment sequences, partial refunds, P&L accuracy
- **Load Testing:** 1,000 concurrent users, 10,000 bookings, PDF generation
- **Manual Testing:** User workflows (booking creation to settlement)

---

## 7. FEATURE PHASES & TIMELINE (Storefront-Inspired)

### Phase 1 (MVP - 4-6 weeks)
**Focus:** Core booking entry + payment tracking + auto-calculations (like Storefront v1-v3)

**Includes:**
- ✅ Add Booking (Standard entry only, all fields capture)
- ✅ Edit Booking (update any field)
- ✅ View Bookings (list with filters, detail view)
- ✅ Payment Ledger (track payments per PNR with running balance)
- ✅ Record Payments (agent types 5 fields, system auto-calculates instalment type)
- ✅ Payment Status Auto-Derivation (UNPAID → PARTIAL → FULLY PAID)
- ✅ Invoice Receipt (printable, PNR lookup)
- ✅ Basic Financial Summary (KPI dashboard)
- ✅ Admin + Agent user roles
- ✅ Authentication & Authorization

**Out of Scope:**
- ❌ Cryptic Booking entry
- ❌ Multi-file upload
- ❌ Refund tracking
- ❌ Expense tracker & P&L
- ❌ Live alerts
- ❌ Daily statements (automated)
- ❌ Supplier role

---

### Phase 2 (Core Features - 6-8 weeks after Phase 1)
**Focus:** Refund lifecycle + expense tracking + P&L (like Storefront v10-v11)

**Includes:**
- ✅ Refund Tracker (per-ticket refund lifecycle with status chain)
- ✅ Cancel Type Auto-Detection (full vs. partial from checkbox)
- ✅ Refund Receipt (printable, auto-calculated eligible refund)
- ✅ Refund Status Chain (TO APPLY → ... → REFUNDED TO CLIENT)
- ✅ Expense Tracker (12 categories, branch tracking, fixed vs. variable)
- ✅ P&L Statement (auto-calculated revenue, COGS, expenses, net profit)
- ✅ P&L Analytics (collections, expenses by category/branch, KPIs, cash flow)
- ✅ Refund Dashboard (status summary, processing time metrics)
- ✅ Supplier user role + ledger
- ✅ Bulk CSV/Excel upload (with validation & error reporting)
- ✅ Audit trail (edit history on all records)

**Out of Scope:**
- ❌ Cryptic booking entry
- ❌ PDF extraction from documents
- ❌ Live alerts system
- ❌ Automated daily statements (scheduled)

---

### Phase 3 (Alerts & Automation - 4-6 weeks after Phase 2)
**Focus:** Live alerts + automated statements + advanced analytics (like Storefront operational v11)

**Includes:**
- ✅ Live Alerts System (auto-flag overdue, urgent, follow-up, escalated)
- ✅ Alerts Dashboard (central view with filters, drill-down)
- ✅ Departure Alerts (0-14d countdown with payment status)
- ✅ Alert Notifications (email daily digest, immediate alerts for critical)
- ✅ Automated Daily Statements (scheduled + manual trigger)
- ✅ Statement Email Delivery (PDF + HTML, branded templates)
- ✅ In-App Notifications (alert widget, badge counts)
- ✅ Cryptic Booking Entry (with regex/NLP parsing, confidence levels)
- ✅ PDF Upload & Extraction (OCR for e-tickets, confirmations)
- ✅ Custom Fields (admin configurable)
- ✅ Custom Refund Statuses (admin defines workflow)
- ✅ Bulk Refund Processing
- ✅ Agent Performance Dashboard (KPIs per agent)
- ✅ Supplier Performance Dashboard (volume, payables, penalties)
- ✅ Multi-language support (optional)

**Out of Scope:**
- ❌ Third-party integrations (Amadeus API, Sabre, Galileo)
- ❌ Mobile native app (web responsive)
- ❌ Advanced ML (predictive collection, churn analysis)

---

### Phase 4 (Polish & Scale - 4-6 weeks after Phase 3, optional)
**Focus:** User experience refinement, reporting, and performance optimization

**Includes (if needed):**
- ✅ Advanced Reporting (pre-built reports, custom report builder)
- ✅ Budget vs. Actual (expense budgeting)
- ✅ Monthly P&L Comparison (trend analysis)
- ✅ Export Enhancements (XLSX with pivot tables, interactive PDFs)
- ✅ Search Optimization (full-text search on PNR, passenger, ticket)
- ✅ Mobile-responsive UI refinement
- ✅ Performance tuning (query optimization, caching)
- ✅ Security hardening (penetration testing, GDPR compliance)
- ✅ Disaster recovery & backup automation
- ✅ Multi-currency support (if global expansion)

---

## 8. ACCEPTANCE CRITERIA

### Booking Management
- [ ] Admin can create booking with all required fields
- [ ] Agent can create booking (assigned to themselves)
- [ ] System validates required fields before save
- [ ] Edit history is logged for audit trail
- [ ] PNR uniqueness is enforced
- [ ] Booking list shows all expected columns with filters working
- [ ] Bulk upload parses CSV/Excel correctly
- [ ] Duplicate PNR detection prevents re-import
- [ ] CSV upload error report is generated for failed rows
- [ ] PDF upload extracts text with confidence levels

### Financial Tracking
- [ ] Ledger shows correct transaction summary (bookings + payments)
- [ ] Outstanding amount calculation is accurate (gross - paid)
- [ ] Payment recording updates ledger immediately
- [ ] Agent can see their own ledger in statement
- [ ] Supplier can see only their payable amount
- [ ] Refund processing reverses commission correctly
- [ ] Refund status workflow follows custom definition

### Statements & Notifications
- [ ] Daily statement generates with correct data
- [ ] Email delivers with PDF attachment + HTML body
- [ ] In-app notification appears with badge
- [ ] Scheduled statement sends at correct time
- [ ] Manual statement can be triggered on-demand
- [ ] Agent receives statement with only their data
- [ ] Supplier receives statement with only their bookings
- [ ] Admin receives comprehensive summary statement
- [ ] Statement is readable on mobile (HTML is responsive)

### Dashboard
- [ ] KPI cards display accurate metrics
- [ ] Revenue chart renders with correct data
- [ ] Agent performance chart shows top agents
- [ ] Date range filter updates all charts
- [ ] Export to PDF works and is readable

### Access Control
- [ ] Admin can see all bookings
- [ ] Agent can only see their own bookings
- [ ] Supplier can only see their bookings
- [ ] Agent cannot edit payment status (read-only)
- [ ] Supplier cannot edit booking data
- [ ] Unauthorized users cannot access protected endpoints

### Performance
- [ ] Booking list loads in <2 seconds (50 rows)
- [ ] PDF generation completes in <5 seconds
- [ ] CSV upload of 1000 rows completes in <10 seconds
- [ ] Dashboard loads in <3 seconds
- [ ] Email delivery happens within 1 minute of generation

---

## 9. SUCCESS METRICS

### Business Metrics
- **User Adoption:** 80% of agents using platform within 30 days of launch
- **Payment Reconciliation:** 95% of payments recorded within 48 hours of receipt
- **Error Rate:** <1% of bookings have to be manually corrected
- **Time Savings:** Reduce manual statement prep time by 80% (estimated 5 hours/week → 1 hour/week)

### Technical Metrics
- **System Uptime:** 99.5%
- **Response Time:** 95th percentile <2 seconds
- **Data Integrity:** 100% accuracy in financial calculations (audited monthly)
- **Audit Trail:** 100% of changes logged

---

## 10. GLOSSARY & STOREFRONT TERMINOLOGY

| Term | Definition | Storefront Context |
|------|-----------|-------------------|
| **PNR** | Passenger Name Record - unique booking reference (e.g., "ABC123") | Groups passengers, links payments, not unique per passenger |
| **Ticket Number** | E-ticket number per passenger (e.g., "055-1234567890") | Primary key for refunds; enables per-passenger cancellations |
| **Fare Sold** | Customer-facing price charged to passenger | Revenue in P&L |
| **Fare Issued** | GDS/supplier cost per passenger | COGS in P&L |
| **Gross Margin** | (Fare Sold - Fare Issued) / Fare Sold × 100% | Profitability per booking |
| **Multi-Installment Payment** | Variable-amount payments on irregular dates (advance, 2nd, 3rd, final) | Core feature; no fixed payment schedule |
| **Instalment Type** | Auto-assigned sequence: ADVANCE → 2ND → 3RD → 4TH → FINAL → EXTRA | No agent selection; system auto-derives |
| **Payment Status** | UNPAID / PARTIAL / FULLY PAID (auto-derived from ledger) | Never manually selected |
| **Ticket Status** | PENDING (no ticket) / TICKETED (has ticket) / REISSUED (multiple) | Auto-derived from ticket_no count |
| **Alert** | Auto-flagged status: URGENT (0-7d), FOLLOW UP (8-14d), OVERDUE (departed), SETTLED | Real-time operational signal |
| **Days to Departure** | Days remaining until flight departure = outbound_date - TODAY() | Drives alert severity |
| **Outstanding Amount / Balance Due** | Total Fare - Payments Received (per PNR) | Key metric for collections |
| **Cancel Type** | FULL BOOKING (all passengers) vs CANCEL PAX (one or more passengers) | Auto-detected from refund checkbox count |
| **Eligible Refund** | MAX(0, Fare Sold - Airline Penalty - Service Fee) | Amount customer can receive |
| **Refund Status Chain** | TO APPLY → APPLIED → IN PROCESS → RCVD FROM SUPPLIER / REJECTED → REFUNDED TO CLIENT | Defined lifecycle; never skip steps |
| **Processing Days** | Days since cancellation request to current status (auto-calculated) | Escalates if > 45 days |
| **Branch / Office** | Multi-location classification: Rome HQ, Rome Storefront, India Office, Remote | Expense tracking, P&L by location |
| **Recurring Expense** | YES (fixed: rent, salary, utilities) vs NO (variable: supplies, travel) | P&L fixed vs variable analysis |
| **P&L** | Profit & Loss statement: Revenue - COGS - Expenses = Net Profit | Auto-calculated from bookings, payments, refunds, expenses |
| **Cash Flow** | Cash In (collections) - Cash Out (expenses) = Net Cash Flow | Separate from P&L; cash vs accrual |
| **Ledger** | Financial record of transactions (bookings, payments, refunds) | Agent Ledger (receivables), Supplier Ledger (payables) |
| **Cryptic Booking** | Raw/unstructured booking data (email, text, screenshot, SMS) | Requires parsing & manual override |
| **PNR_N Helper** | Auto-sequence counter: 1st, 2nd, 3rd passenger per PNR | Prevents double-counting in financial summaries |
| **First Passenger Only** | Financial totals (Total Paid, Balance, Status) show only on PNR_N=1 | Subsequent passengers show "—" to reduce confusion |
| **Invoice Receipt** | Printable A4 confirmation of booking & payments for customer | Auto-lookup by PNR; includes payment history |
| **Refund Receipt** | Printable A4 confirmation of cancellation & refund for customer | Auto-lookup by ticket number; shows refund calculation |
| **Storefront Agent** | Non-technical staff at booking office; enters blue fields only | Does not perform financial calculations manually |
| **Finance Manager / Peter** | Senior staff who manages refunds, expenses, P&L, escalations | Has access to all sensitive financial data |
| **Overdue Ticket** | Ticket with departure date ≤ TODAY and balance_due > 0 | Red alert; requires immediate action |
| **Fully Paid PNR** | Balance_Due = 0; all passengers on PNR have payment received | Green status; ready for travel |

---

## 11. APPENDIX: WIREFRAME NOTES

### Key Pages to Build
1. **Booking List** - Table with filters, search, action buttons
2. **Booking Form** - Create/Edit with validation
3. **Cryptic Booking Entry** - Text area with AI parsing
4. **Upload Modal** - File upload with preview
5. **Ledger View** - Transaction table with summary cards
6. **Payment Recording** - Form for recording in/out payments
7. **Dashboard** - KPI cards, charts, recent activity
8. **Settings Panel** - Config for statuses, custom fields, email
9. **User Directory** - Agents/Suppliers list with bulk actions
10. **Daily Statement** - PDF template for email

---

## 12. ROLLOUT & LAUNCH PLAN

### Pre-Launch (Week 1-2)
- [ ] Set up dev/staging environment
- [ ] Create sample data (10 agents, 5 suppliers, 100 bookings)
- [ ] Internal testing with team
- [ ] Documentation & user guides
- [ ] Training for admin users

### Launch (Phase 1)
- [ ] Deploy to production
- [ ] Monitor system performance & errors
- [ ] Support users with onboarding
- [ ] Collect feedback

### Post-Launch
- [ ] Weekly bug fix releases
- [ ] Gather user feedback
- [ ] Plan Phase 2 features
- [ ] Optimize based on usage data

---

**Document Version:** 1.0  
**Last Updated:** May 2026  
**Status:** Ready for Development  
**Next Steps:** Share with development team, assign sprints, begin Phase 1 implementation
