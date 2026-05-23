# Finance Webapp PRD — Complete Documentation Package

**Date:** May 2026  
**Status:** Ready for Development  
**Storefront Integration:** Complete ✅

---

## 📋 Document Overview

This package contains everything needed to develop a production-ready Finance Management Webapp for travel agencies, inspired by the **FlyForSure Storefront Office Model v11** (operational since Feb 2026).

### 3 Documents Included:

1. **Finance_Webapp_PRD.md** (Main Document)
   - 2,190 lines, 13 sections
   - Complete feature specifications, user personas, data model, technical architecture
   - 4-phase development roadmap
   - Acceptance criteria, success metrics, glossary

2. **Storefront_Integration_Summary.md** (Architecture Bridge)
   - 600 lines mapping Storefront v11 to Webapp
   - Shows how Excel formulas translate to database triggers
   - Feature-by-feature integration guide
   - Database schema alignment

3. **Feature_Translation_Matrix.md** (Developer Reference)
   - 800 lines with side-by-side feature comparison
   - SQL code examples, API endpoints, testing checklist
   - Training material for agents
   - Implementation examples (Excel formula → SQL code)

---

## 🎯 Key Features (From Storefront Model)

### ✅ Multi-Installment Payment Tracking
- Variable amounts on irregular dates (no fixed schedule)
- Auto-sequenced installments (ADVANCE → 2ND → FINAL → EXTRA)
- Running balance per PNR, cumulative across payments
- Agent enters only 5 fields; system calculates everything else

### ✅ Ticket-Number Keying
- Per-passenger refunds (ticket number as primary key, not PNR)
- Enables partial cancellations in multi-passenger bookings
- Clean handling of amendments and reissues
- Auto-detection of full vs. partial cancellations

### ✅ Built-In Expense Tracking & P&L
- 12 expense categories, multi-branch tracking
- Fixed vs. variable expense classification
- Auto-calculated P&L (Revenue - COGS - Expenses = Net Profit)
- Analytics: collections, expenses by branch, KPIs, cash flow

### ✅ Live Alerts System
- Auto-flagging: CRITICAL (overdue), URGENT (0-7d), FOLLOW UP (8-14d)
- Real-time operational signals (no manual selection)
- Email daily digest + immediate alerts
- In-app alert widget with badge counts

### ✅ Status Auto-Derivation
- Payment Status: UNPAID → PARTIAL → FULLY_PAID (never dropdown)
- Ticket Status: PENDING → TICKETED → REISSUED (auto from ticket count)
- Alert Status: URGENT, FOLLOW_UP, OVERDUE, SETTLED (auto from business logic)
- Instalment Type: ADVANCE, 2ND, FINAL, EXTRA (auto-assigned)

---

## 📊 Architecture Summary

```
┌─ Frontend (React.js)
│  ├─ Booking Form (28 fields, blue = editable, gray = auto)
│  ├─ Payment Ledger (5-field form, running balance display)
│  ├─ Refund Tracker (per-ticket refund lifecycle)
│  ├─ Expense Tracker (12 categories, branch selection)
│  ├─ Alerts Dashboard (real-time, color-coded)
│  └─ P&L Statement (auto-calculated revenue, COGS, expenses)
│
├─ Backend (Node.js + Express)
│  ├─ RESTful API endpoints (/api/bookings, /api/payments, etc.)
│  ├─ Authentication (JWT, role-based access)
│  └─ Business Logic (email, PDF generation, alerts)
│
└─ Database (PostgreSQL)
   ├─ bookings table (28 columns, auto-calculated fields)
   ├─ payments table (15 columns, instalment auto-sequence)
   ├─ refunds table (20 columns, per-ticket lifecycle)
   ├─ expenses table (12 categories, multi-branch)
   ├─ alerts table (auto-generated, never manual)
   └─ Triggers/Stored Procedures (auto-calculations)
```

**Calculation Engine:**
- Formulas from Storefront v11 (9,029 total) → PostgreSQL triggers/stored procedures
- No business logic in application code; all in database
- Consistent, auditable, testable

---

## 🚀 Development Roadmap

| Phase | Timeline | Focus | Deliverables |
|-------|----------|-------|---------------|
| **1** | 4-6 weeks | MVP | Bookings + Payments + Dashboard |
| **2** | 6-8 weeks | Core Finance | Refunds + Expenses + P&L |
| **3** | 4-6 weeks | Automation | Live Alerts + Statements + Cryptic |
| **4** | 4-6 weeks | Polish | Advanced Reports + Optimization |

---

## 👥 User Roles

| Role | Can Do | Cannot Do |
|------|--------|-----------|
| **Admin** | Everything (create, edit, delete, configure) | None |
| **Finance Manager** | Bookings, payments, refunds, expenses, P&L | User/settings config |
| **Storefront Agent** | Own bookings, payments | View other agents, edit status, access P&L |
| **Supplier** | View own bookings & payables | Edit data, see commissions |

---

## 💾 Data Model (PostgreSQL)

**Tables:** bookings, payments, refunds, expenses, alerts, users, audit_logs

**Key Features:**
- No NULL values for financial fields (default 0.00)
- Computed columns for auto-calculated fields
- Triggers for auto-population on INSERT/UPDATE
- Indexes on PNR, ticket_no, payment_date, created_at
- Audit trail on all sensitive operations

**Capacity:**
- bookings: 100,000+ rows (5-10 years of data)
- payments: 500,000+ rows
- refunds: 100,000+ rows
- expenses: 50,000+ rows

---

## 🧪 Testing Strategy

**Unit Tests:**
- Payment status derivation
- Instalment type assignment
- Alert conditions
- Refund calculations
- P&L accuracy

**Integration Tests:**
- Full booking → payment → settlement workflow
- Multi-passenger booking with partial refunds
- Expense entry → P&L recalculation
- Alert generation → email → resolution

**Load Tests:**
- 10,000 bookings: <2 seconds load time
- 50,000 payments: <1 second query
- 100,000 rows: <5 seconds PDF export

---

## 📚 How to Use This Package

### For Project Managers:
1. Read **Finance_Webapp_PRD.md** sections 1-3 (Executive Summary, Personas, Features)
2. Check **Feature Phases** (section 7) for timeline estimates
3. Review **Success Metrics** (section 9) for KPIs

### For Developers:
1. Start with **Feature_Translation_Matrix.md** (SQL examples, API endpoints)
2. Use **Storefront_Integration_Summary.md** for architectural patterns
3. Reference **Finance_Webapp_PRD.md** sections 4-6 (Data Model, Technical Specs)
4. Follow the **Development Checklist** in Feature_Translation_Matrix.md

### For QA/Testing:
1. Review **Acceptance Criteria** in PRD section 8
2. Use **Testing Checklist** in Feature_Translation_Matrix.md
3. Check **Success Metrics** for performance targets

### For Stakeholders:
1. Read **Executive Summary** (Finance_Webapp_PRD.md section 1)
2. Review **User Personas** (section 2)
3. Check **Feature Phases & Timeline** (section 7)
4. Look at **Success Metrics** for ROI indicators

---

## 🔗 Key Architectural Decisions

### ✅ Why Storefront-Aligned Architecture?

**Live and Tested:** FlyForSure Storefront v11 is operational since Feb 2026 at Ghai Travels SRL, Rome, Italy. No theoretical features — all battle-tested.

**Agent-Simple:** Storefront staff enter only blue fields; system does all calculations. Same principle in webapp — agents never manually select status, enter formulas, or make accounting decisions.

**Financial Integrity:** 9,029 formulas = 9,029 calculation rules, all consistent. In webapp, these become triggers & stored procedures — single source of truth.

**Scalable:** Storefront maxes out at 500 rows/table. Webapp scales to 500,000+ rows with same logic.

### ❌ What We Avoided

- ❌ Complex UI state management (all logic in database)
- ❌ Manual status selection (all auto-derived)
- ❌ Multiple payment ledger entries (positive-only)
- ❌ Excel-like complexity (simplified for web)
- ❌ Heavy APIs/integrations (Phase 1 focuses on core)

---

## 📞 Questions? References

**For Storefront Technical Details:**
- Reference document: FlyForSure Storefront Excel — System Architecture Document (included)
- Live system: Ghai Travels SRL, Rome, Italy
- Version: v11 (operational since Feb 2026)

**For Webapp Development:**
- Technical stack: Node.js + Express + PostgreSQL + React
- Design pattern: Formula-driven (business logic in DB, not app)
- Security: JWT auth, RBAC, full audit trail

---

## ✅ Sign-Off Checklist

Before starting development:

- [ ] All stakeholders have reviewed Finance_Webapp_PRD.md
- [ ] Development team understands Storefront architecture
- [ ] Database schema reviewed & approved
- [ ] API endpoints documented & approved
- [ ] Phase 1 timeline estimated (4-6 weeks)
- [ ] Development environment set up (Node.js, PostgreSQL, Git)
- [ ] Sample data created (10 agents, 5 suppliers, 100 bookings)
- [ ] QA team has testing checklist
- [ ] Project manager assigned (sprints, backlog)

---

**Document Status:** Complete & Ready for Handoff  
**Prepared By:** AI Assistant  
**Date:** May 2026  
**Next Steps:** Share with dev team, schedule architecture kickoff, begin Phase 1

---

*For the latest Storefront Office Model architecture details, refer to the system architecture document (v11.0, Feb 2026).*
