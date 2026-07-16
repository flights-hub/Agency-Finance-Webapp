# Amendment Workflow — A Plain-English Guide

*Who this is for:* anyone new to the system — a school student learning how the app works, or a new operator on their first week. No coding knowledge needed.

## 1. What is an "amendment," really?

Think of a flight booking like a signed permission slip: it says who is flying, on what dates, on what flight, and what it costs.

Sometimes, after the slip is signed, something needs to change — the passenger wants a different date, their name was misspelled, they want a different cabin, extra baggage, or a different route.

An **amendment** is the app's official *change request form* for that booking. It is not just a quick edit — it's a little case file that:

1. Records **what** is changing and **why**.
2. Records **how much extra it costs** (or how much money comes back).
3. Walks through an **approval process** before anything becomes final.
4. Keeps a permanent history — old amendments are never deleted or overwritten, only closed.

Every amendment gets its own ID, like `AMD-000001`, `AMD-000002`, and so on, in the order they were created.

You can only start an amendment on a booking that is **Held** or **Ticketed** — in other words, a booking that is real enough to be worth changing.

## 2. Two "flavors" of amendment

The app supports several types of change, but they split into two groups that behave differently:

| Group | Amendment types | How it behaves |
| --- | --- | --- |
| **A. Date changes** (the modern, careful flow) | `DATE_CHANGE` (covers outbound only, inbound only, or both) | The system actually rewrites the passenger's itinerary, PNR, and ticket number when the change is finalized — this is the biggest, riskiest kind of change, so it gets the most careful process. |
| **B. Everything else** (the simple flow) | Name Correction, Name Change, Route Change, Cabin Change, Baggage Change, Other | These record the request and the price, and post the money once confirmed. The actual airline paperwork (new boarding pass, reissued ticket, etc.) is finished by staff outside the system, then marked "Completed." |

Both groups share the same set of status labels (see below) — they just use them a little differently, which is explained as we go.

## 3. The status labels — what each one means

Every amendment carries one **status** at all times. Think of it like a traffic light with extra stops. Here is what each label means in plain terms:

| Status | Plain-English meaning | Can the customer be charged yet? |
| --- | --- | --- |
| **DRAFT** | Just a work-in-progress note. Nothing is decided, nothing is priced, nothing is locked. Anyone can still edit or delete this freely. | No |
| **QUOTE_PENDING** | *(Older records only.)* "We're waiting to hear a price back from the airline/supplier." New amendments created today skip straight past this — it exists so old cases still display correctly. | No |
| **QUOTED** | "We priced it." An operator has typed in the extra fees (fare difference, change fee, service fee, etc.) so the customer can be shown a price. | No — this is just a quote, like a shop giving you an estimate before you agree to buy. |
| **CUSTOMER_APPROVED** | "The customer said yes to that price." An optional checkpoint — proof that the customer agreed before anyone commits to the change. | No, still just approval to proceed. |
| **REJECTED** | "This request was turned down." Either the customer or the agency said no. The case is closed here — nothing changes, no money moves. | No — closed, dead end. |
| **CONFIRMED** | "We're doing this." For *Group B* (name/route/cabin/baggage/other) amendments, this is the exact moment the charge or credit becomes real and hits the customer's account (the ledger). For *Group A* (date changes), clicking "Confirm" doesn't post money by itself — it kicks off the careful finalize process described in Section 4. | **Yes, for Group B.** Not yet for Group A. |
| **FINALIZING** | *(Date changes only, and only ever seen for a moment.)* "The system is actively rewriting the ticket right now — please don't close this or click twice." It's a safety lock so two people can't finalize the same change at the same time, and so the process can pick back up safely if it gets interrupted. | In progress. |
| **COMPLETED** | "All done." For Group B, this is a manual "yes, the airline paperwork is finished" click by staff after CONFIRMED. For Group A (date changes), this happens automatically the instant the finalize process succeeds — and that is also the moment the money posts. | **Yes, for Group A this is when the charge posts.** For Group B the money already posted at CONFIRMED. |
| **CANCELLED** | "This case was called off." The system recognizes this label and treats it as closed, but the current screens don't have a button that sets it — it mostly shows up on older/legacy records. | No — closed, dead end. |

### The color badges you'll see on screen

| Badge color | Statuses | What it's telling you at a glance |
| --- | --- | --- |
| Grey (neutral) | DRAFT | Still being worked on |
| Yellow (warn) | QUOTE_PENDING | Waiting on something |
| Blue (info) | QUOTED, CUSTOMER_APPROVED, CONFIRMED | Moving forward, in progress |
| Green (pass) | COMPLETED | Finished successfully |
| Red (fail) | REJECTED, CANCELLED | Stopped / did not go through |

## 4. The life cycle, step by step

### Group B — the simple path (name / route / cabin / baggage / other changes)

```
DRAFT → QUOTED → (CUSTOMER_APPROVED) → CONFIRMED → COMPLETED
                        ↓                    ↑ (only from here can it be rejected)
                    REJECTED
```

1. **DRAFT** — an operator opens "Request Amendment," picks the type, selects who/what is affected, and writes a reason. They can save it as a Draft to come back to later.
2. **QUOTED** — the operator fills in the price fields (fare difference, fees, markup, etc.) and clicks "Create Quote." The total is calculated automatically and shown to the customer.
3. **CUSTOMER_APPROVED** *(optional)* — once the customer agrees to the quoted price, staff can mark it approved before locking anything in.
4. **CONFIRMED** — clicking "Confirm Amendment" locks the price and posts it to the customer's ledger immediately — as a **charge** if the total is positive, or a **credit** if the total is negative. From this point the amount, currency, and customer can no longer be edited on this case; a mistake has to be fixed with a brand-new amendment, never by editing this one (so there is always an honest paper trail).
5. **COMPLETED** — once the physical ticket/paperwork side is actually finished (new baggage tag issued, cabin upgraded, etc.), staff click "Mark Completed" to close the case.
6. **REJECTED** — at any point before Confirmed, the case can instead be rejected and closed with no money movement.

### Group A — the careful path (date changes)

```
DRAFT → QUOTED → (CUSTOMER_APPROVED) → [Confirm Amendment] → FINALIZING → COMPLETED
                        ↓
                    REJECTED
```

Date changes follow the same first three steps, but "Confirm Amendment" behaves very differently:

1. **DRAFT → QUOTED → (CUSTOMER_APPROVED)** — same as above: describe the new itinerary, price it, get customer sign-off.
2. Clicking **"Confirm Amendment"** does **not** immediately save a normal edit. Instead it triggers **finalization** — a special, extra-safe process, because this step is the only place in the whole app that actually rewrites a passenger's live PNR, ticket number, and flight itinerary.
   - The case briefly moves to **FINALIZING** while the system:
     a. Checks the new itinerary makes sense (connections line up, times are valid, inbound is after outbound, etc.)
     b. Checks every affected passenger currently matches the *original* itinerary recorded on the case (nobody's ticket moved out from under it since the quote was made).
     c. Rewrites each affected passenger's PNR, ticket number, and flight segments to the new itinerary.
     d. Posts the price (charge or credit) to the ledger.
   - All of that happens together, as one atomic unit — either every part of it succeeds, or none of it does. There is no in-between state where the ticket changed but the money didn't, or the reverse.
3. If everything succeeds, the status becomes **COMPLETED** and `finalized_at` / `finalized_by` are stamped — this is the permanent record of exactly when and who executed the change.
4. If something interrupts the process (lost connection, browser closed, server hiccup) *while* it's FINALIZING, the case simply stays in **FINALIZING**. Nothing is lost, and nothing gets applied twice. The next time someone opens the case, they'll see a **"Retry Finalization"** button instead of "Confirm Amendment," which safely resumes exactly where it left off.
5. **REJECTED** is still available any time before "Confirm Amendment" is clicked.

> **Why so careful?** Because date changes touch a live PNR and ticket number — the same identifiers airlines, suppliers, and the customer all rely on. If the same finalize request were accidentally run twice (e.g., a doubled click, or a retried network request), it must **not** re-apply the change a second time or double-charge the customer. The system prevents this with an internal fingerprint check that recognizes "this exact request already went through" and simply returns the existing result instead of doing it again.

### A rule that keeps date changes honest: "one itinerary at a time"

If a date-change amendment covers more than one passenger, all of those passengers must currently share the *exact same* itinerary (same flights, same dates). If someone tries to select passengers whose current tickets don't match, the app blocks it with a message like *"Selected passengers have different current itineraries — handle one compatible passenger itinerary cohort at a time."* The fix is simply to split them into two separate amendment cases. This stops a single case from silently applying the wrong change to the wrong passenger.

Once a date-change case is past DRAFT, its "original itinerary" snapshot becomes locked — it's the audit baseline that finalization keeps checking against. You can still adjust who's included, but only in a way that lines up with that original snapshot; otherwise you're told to start a new case.

## 5. Money: when does it become real?

| Amendment group | When the charge/credit actually posts |
| --- | --- |
| Group B (name/route/cabin/baggage/other) | The moment it reaches **CONFIRMED** |
| Group A (date change) | Only once it reaches **COMPLETED** (i.e., after finalization fully succeeds) |

Two more things worth knowing:

- **Negative total = a credit, not an automatic refund.** If the amendment's total financial impact is negative (the change actually saves the customer money), the system posts an "amendment credit" open item. It is **never** automatically turned into a cash refund payout — a human has to review and process that separately.
- **Once posted, the numbers are frozen.** After a case posts money (CONFIRMED for Group B, COMPLETED for Group A), the amount, currency, and customer on that case can't be edited anymore. A correction always means opening a *new* amendment case, which keeps the financial history honest and traceable — nothing is silently rewritten after the fact.

## 6. Who is allowed to do what

- **Viewing** an amendment just requires the general "view bookings" permission — most staff can see amendment cases.
- **Creating or editing** an amendment (through DRAFT/QUOTED/CUSTOMER_APPROVED/REJECTED/CONFIRMED for Group B) requires either the "edit bookings" or "process refunds" permission.
- **Finalizing a date change** (the Group A "Confirm Amendment" → FINALIZING → COMPLETED step) is treated as a sensitive finance action. It requires write access to both bookings *and* amendments, and every finalize attempt is written to the permanent audit log — recording who did it, when, the booking reference, and the before/after status. Administrators always have full access.

## 7. Where to actually see all this in the app

Open any booking's detail page:

- The **"Servicing cases"** panel lists every amendment (and cancellation, and refund) tied to that booking, each with its number, type, a one-line summary, and its colored status badge. Clicking a case reopens it for editing (if it isn't locked) or lets you view it read-only (if it is).
- The **Activity Timeline** further down the page shows amendments mixed in with payments, refunds, and notes, in date order — so you can see the whole story of a booking in one scroll. For completed date changes it shows the passenger's PNR/ticket "before → after," the itinerary that changed, and whether a charge or credit posted. For all other amendment cases it shows the type of change, the affected tickets, and the amount (marked "(quote)" if it hasn't posted yet, or "posted" if it has).

## 8. Walkthroughs / example use cases

### Use case 1 — Fixing a typo in a passenger's name (Group B, simple)
1. Operator opens the booking, clicks "Request Amendment," picks **Name Correction**, selects the passenger, and writes a remark ("Misspelled surname, needs a 1-letter fix").
2. No fee applies, so the quote totals €0. Operator clicks **Create Quote**, the customer doesn't need to approve a €0 change, so staff click **Confirm Amendment** directly.
3. Status is now **CONFIRMED**. Nothing posts to the ledger because the total is €0, but the case is on record.
4. Once the airline confirms the corrected name on the ticket, staff open the case again and click **Mark Completed**.

### Use case 2 — Moving one passenger's outbound flight (Group A, date change)
1. Operator opens "Request Amendment," the type defaults to **Date Change**. They set Application Scope to **Selected passengers** and pick just the one traveler, and Travel Direction to **Outbound**.
2. They fill in the new outbound flight's connection details (airline, flight number, airports, dates/times) using the itinerary editor, and enter the price difference the airline is charging.
3. Operator clicks **Create Quote**, shares the price, customer agrees — staff mark **Customer Approved**.
4. Operator fills in the passenger's new PNR and new ticket number (the reissue mapping), then clicks **Confirm Amendment**.
5. The case flashes through **FINALIZING** — the app checks everything lines up, rewrites that passenger's PNR/ticket/itinerary, and posts the charge — landing on **COMPLETED**, all in one step.

### Use case 3 — A family of four wants to postpone their whole return trip
1. Since all four passengers currently share the identical itinerary, the operator can pick **PNR-wide** scope and **Both** directions in one single case, instead of four separate ones.
2. If it later turns out one family member had already been separately rebooked (so their current itinerary no longer matches the other three), the app will refuse to let them stay in the same case — the operator splits that one passenger into their own new amendment case instead, keeping the other three together.

### Use case 4 — The price comes down, not up
1. A date change actually makes the fare cheaper (a negative fare difference). The total financial impact comes out negative.
2. When this case reaches COMPLETED, the system posts an **amendment credit**, not a cash refund. A staff member with refund permissions must separately review and decide whether/how to actually pay that credit back to the customer.

### Use case 5 — A finalize attempt gets interrupted
1. An operator clicks **Confirm Amendment** on a date change, but their internet drops right as it starts processing.
2. Instead of losing the request or accidentally double-processing it, the case is simply left sitting at **FINALIZING**.
3. The operator reopens the case, sees a **Retry Finalization** button instead of the usual Confirm button, clicks it, and the process safely picks up and completes — without re-charging the customer or re-writing the ticket a second time.

### Use case 6 — A quote gets turned down
1. Operator quotes a cabin upgrade at €150. The customer says it's too expensive.
2. Staff click **Reject**. Status becomes **REJECTED**, the case is closed, and no money ever moved.

## 9. Frequently asked questions

**Q: Can I edit an amendment after it's Confirmed or Completed?**
No. Once money has posted (CONFIRMED for simple amendments, COMPLETED for date changes), the case is locked. If something was wrong, open a brand-new amendment case instead — this keeps a clean, honest history instead of silently changing old records.

**Q: What's the difference between QUOTED and CONFIRMED?**
QUOTED is just a price estimate shown to the customer — like a shop quote. Nothing is charged yet. CONFIRMED is the "yes, go ahead" moment — for simple amendments the charge posts right then; for date changes it's the trigger that starts the careful finalize process.

**Q: Why do date changes have an extra FINALIZING status that other amendments don't?**
Because a date change is the only type of amendment that rewrites a passenger's live ticket number, PNR, and itinerary — not just a price. FINALIZING is a short safety lock that guarantees that rewrite and the money posting happen together, exactly once, even if something goes wrong halfway through.

**Q: What happens to the money if an amendment is rejected or cancelled?**
Nothing — REJECTED and CANCELLED cases never post any charge or credit. They're simply closed records of a request that didn't go ahead.

**Q: Who can approve the actual ticket rewrite (finalize a date change)?**
Only staff with both booking-edit and amendment-edit permissions (in practice, finance-level access), and every finalize action is permanently logged with who did it and when.

## 10. Glossary

| Term | Plain meaning |
| --- | --- |
| **Amendment case** | The change-request record itself — one per requested change, with its own ID like AMD-000001. |
| **Amendment type** | What kind of change it is: Date Change, Name Correction, Name Change, Route Change, Cabin Change, Baggage Change, or Other. |
| **Application scope** | For date changes: whether the change applies to the whole PNR (everyone on the booking) or only to hand-picked passengers. |
| **Travel direction** | For date changes: whether the outbound flight, the inbound flight, or both are being changed. |
| **Original itinerary** | A frozen snapshot of the itinerary exactly as it was before the change — the baseline the system keeps checking against. |
| **Replacement itinerary** | The new flights being proposed to replace the original ones. |
| **Passenger reissue mapping** | The "before → after" record for a passenger's PNR and ticket number once a date change is finalized. |
| **Finalize / finalization** | The one-time, all-or-nothing process that actually rewrites tickets and posts money for a date-change amendment. |
| **Posted** | The charge or credit has actually hit the customer's ledger — it's real money owed, not just a quote. |
| **Ledger** | The running account of everything a customer or agent owes or is owed — like a running tab. |
| **Amendment credit** | Money owed back to the customer because a change reduced the price. It sits as a credit and must be manually processed as a refund if it's ever paid out. |

---
*This guide describes the amendment workflow as implemented in the booking servicing module. If the on-screen buttons or labels ever look different from what's described here, trust the screen — this document may need an update.*
