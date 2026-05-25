# Manual Booking Entry Form Documentation

This document explains the Manual booking entry form on the Bookings page. It covers only the Manual flow and excludes PDF upload and Cryptic/PNR parsing.

The Manual form creates one or more booking ledger rows. One row is created for each selected passenger type with a passenger count greater than zero. If `Amount Paid` is greater than zero, the form also creates a payment ledger row for the saved PNR.

## Completion Rules

A manual booking can be saved only when these rules pass:

- `Bill To` is selected. If `Typed customer` is selected, `Customer Name` must be populated.
- At least one passenger count is greater than zero.
- For every selected passenger type, `Passenger Name`, `Buying / Pax`, and `Selling / Pax` are populated.
- Supplier and PNR are populated.
- In multi-supplier mode, every journey section has both supplier and PNR.
- The first flight connection has `Airline`, `Flight Number`, `Departure City`, and `Arrival City`.

When these rules pass, the system saves the booking rows, recalculates booking ledger values, optionally saves a payment row, clears the form, and returns the user to the booking list.

## Manual Booking Entry

| Field | Required | Populated by | Purpose | Validation and save behavior |
| --- | --- | --- | --- | --- |
| Bill To | Yes | User, using agent/customer selector | Identifies who the booking is billed to. Usually an agent; can also be a typed customer. | Save is blocked if empty. If an existing agent is selected, `bill_to_type` is saved as `AGENT` and `bill_to_name` is saved as the selected name. |
| Customer Name | Conditional | User | Captures a custom customer name when `Typed customer` is selected. | Required only when `Bill To` is `Typed customer`. Saved as `bill_to_name`; `bill_to_type` is saved as `CUSTOMER`. |
| Booking Date | Optional, defaults to today | System default, editable by user | Date used for the booking and for the first payment if an amount is paid during booking creation. | Saved as `booking_date`. If `Amount Paid > 0`, the same value is used as `payment_date`. |
| Trip Type | Yes, defaults to One Way | User | Controls route shape and supplier mode behavior. Options are `One Way`, `Roundtrip`, and `Multicity`. | Updates route/supplier sections. `One Way` disables return date and forces single supplier mode. Roundtrip creates onward and return sections. Multicity allows extra legs. |

## Route & Passengers

| Field | Required | Populated by | Purpose | Validation and save behavior |
| --- | --- | --- | --- | --- |
| Departure City | Required for complete flight connection | User via airport autocomplete | Origin airport/city for the route and first flight connection. | Used to build `sector` and the first connection. Save is blocked if the first connection departure city is empty. |
| Arrival City | Required for complete flight connection | User via airport autocomplete | Final airport/city for the route and last flight connection. | Used to build `sector` and the last connection. Save is blocked if the first connection arrival city is empty. |
| Onward Date | Operationally required | User | Main outbound travel date. | Saved as `outbound_date` when present. The current save validation does not block directly on this field, but QA should treat it as required for a complete booking. |
| Return Date | Conditional | User | Return travel date for roundtrip or multicity bookings. | Disabled for one-way bookings. When populated for non-one-way trips, saved as `inbound_date` and causes `OW/RT` to calculate as `RT`. |
| Adult | Required through passenger count rule | User | Number of adult passengers to create in the booking. Defaults to `1`. | At least one of Adult, Child, or Infant must be greater than zero. If Adult count is greater than zero, Adult pricing row must include passenger name, buying price, and selling price. |
| Child | Optional unless count is greater than zero | User | Number of child passengers to create in the booking. Defaults to `0`. | If greater than zero, Child pricing row becomes required and creates a `CHD` booking row. |
| Infant | Optional unless count is greater than zero | User | Number of infant passengers to create in the booking. Defaults to `0`. | If greater than zero, Infant pricing row becomes required and creates an `INF` booking row. |

## Pricing & Supplier

### Passenger Pricing

| Field | Required | Populated by | Purpose | Validation and save behavior |
| --- | --- | --- | --- | --- |
| Type | System display | System | Shows the passenger category: Adult, Child, or Infant. | Saved as `pax_type` using `ADT`, `CHD`, or `INF`. |
| Passenger Name | Required for each selected passenger type | User | Passenger name for the booking row. | Save is blocked if missing for any passenger type with count greater than zero. Saved as `passenger_name`. |
| Count | Required through passenger count rule | User | Number of passengers in that passenger type row. | Saved as `pax_count`. The system creates one booking row per selected passenger type, not one row per individual passenger. |
| Buying / Pax | Required for each selected passenger type | User | Supplier cost per passenger for that type. | Save is blocked if missing or zero. Saved as `buying_price_per_pax`; multiplied by count to create `fare_issued`. |
| Selling / Pax | Required for each selected passenger type | User | Sale price per passenger for that type. | Save is blocked if missing or zero. Saved as `selling_price_per_pax`; multiplied by count to create `fare_sold`. |
| Total | System display | System calculation | Shows count multiplied by selling price. | Display only. The persisted total selling value is `fare_sold`. |

### Supplier

| Field | Required | Populated by | Purpose | Validation and save behavior |
| --- | --- | --- | --- | --- |
| Supplier Mode | Conditional | User | Controls whether one supplier/PNR applies to the full booking or each journey section has its own supplier/PNR. | Available for non-one-way trips. `Single Supplier` saves one supplier segment. `Multi Supplier` validates every segment. |
| Supplier | Yes | User via supplier lookup/autocomplete | Supplier used to issue or source the booking. Supplier options come from supplier users and existing booking supplier names. | Save is blocked if empty. Saved as `supplier_name` and `supplier`. |
| PNR | Yes | User | Supplier or airline booking reference. | Save is blocked if empty. Value is uppercased in the form and saved as `pnr`. |
| Segment Supplier | Required in multi-supplier mode | User via supplier lookup/autocomplete | Supplier for a specific journey section, such as Onward, Return, or a multicity leg. | Save is blocked if any segment supplier is empty. Saved inside `supplier_segments`. The first populated segment is used as the primary supplier. |
| Segment PNR | Required in multi-supplier mode | User | PNR for a specific journey section. | Save is blocked if any segment PNR is empty. Saved inside `supplier_segments`. The primary segment PNR becomes the booking row `pnr`. |
| Buying Allocation | Optional | User | Optional cost allocation for a supplier segment. | Saved inside `supplier_segments` only. It does not currently replace the passenger pricing `Buying / Pax` calculation. |

## Flight Details

The form supports one or more flight segments. Each segment can contain one or more connections. Multicity adds more journey legs, and the plus button on a segment adds another connection.

| Field | Required | Populated by | Purpose | Validation and save behavior |
| --- | --- | --- | --- | --- |
| Airline | Required on first connection | User via airline autocomplete | Operating or marketing airline for the connection. | Save is blocked if the first connection airline is empty. The first connection airline is saved as booking row `airline`. |
| Flight Number | Required on first connection | User | Flight number for the connection. | Save is blocked if the first connection flight number is empty. All populated flight numbers are joined with commas and currently saved as `ticket_no`. |
| Departure City | Required on first connection | User via airport autocomplete | Connection origin. | Save is blocked if first connection departure city is empty. Used in `flight_segments` and route sector calculation. |
| Arrival City | Required on first connection | User via airport autocomplete | Connection destination. | Save is blocked if first connection arrival city is empty. Used in `flight_segments` and route sector calculation. |
| Departure Date | Optional | User | Scheduled departure date for the connection. | Saved inside `flight_segments`. If route `Onward Date` is empty, the first connection departure date may become `outbound_date`. |
| Arrival Date | Optional | User | Scheduled arrival date for the connection. | Saved inside `flight_segments`. |
| Departure Time | Optional | User | Scheduled departure time. | Saved inside `flight_segments`. Also used by the system to calculate `Duration` when enough route/timezone data exists. |
| Arrival Time | Optional | User | Scheduled arrival time. | Saved inside `flight_segments`. Also used by the system to calculate `Duration` when enough route/timezone data exists. |
| Departure Terminal | Optional | User | Departure terminal information. | Saved inside `flight_segments`. |
| Arrival Terminal | Optional | User | Arrival terminal information. | Saved inside `flight_segments`. |
| Duration | Auto | System calculation | Read-only connection duration. | Calculated from departure/arrival city, date, and time when possible. Saved inside `flight_segments`. |
| Check-in Baggage | Optional | User | Checked baggage allowance. | Saved inside `flight_segments`. |
| Cabin Baggage | Optional | User | Cabin baggage allowance. | Saved inside `flight_segments`. |

## Contact & Payment

| Field | Required | Populated by | Purpose | Validation and save behavior |
| --- | --- | --- | --- | --- |
| Mobile | Optional | User | Passenger or customer contact number. | Saved as `mobile`. |
| Booked By | Optional | User via employee selector | Staff member who booked the travel. Employee options come from admin, employee, and finance-manager users, plus existing booking staff names. | Saved as `booked_by`. If empty, system saves the selected bill-to name as `booked_by`. |
| Issued By | Optional | User via employee selector | Staff member who issued or handled the ticket/payment. | Saved as `agent_issued_by`. If `Amount Paid > 0`, used as payment `received_by`; if empty, payment `received_by` defaults to `Finance Desk`. |
| Mode of Payment | Optional unless amount is paid | User | Payment method for the initial amount collected during booking creation. | Saved only to the payment row when `Amount Paid > 0`. Options exclude `AUTO_DEBIT` in the Manual form. |
| Amount Paid | Optional | User | Initial amount collected at booking creation. | If greater than zero, the system creates a payment row for the saved PNR. If empty or zero, no payment row is created and booking remains unpaid. |
| Remarks | Optional | User | Free text notes for booking and payment context. | Saved as booking `remarks`. If `Amount Paid > 0`, also copied to the payment row remarks. |

## Auto Calculated Fields

These fields are not typed directly by the user. They are shown in the Auto Calculated Fields preview and/or calculated in the booking ledger after save.

| Field | Source | Purpose | Calculation or behavior |
| --- | --- | --- | --- |
| SL | System | Booking ledger serial number. | Row index plus one. |
| Invoice No | System | Generated invoice reference. | Generated as `INV-` plus a five-digit sequence based on row index. |
| OW/RT | System | Indicates one-way or return-trip display value. | `RT` when `inbound_date` exists; otherwise `OW`. |
| Profit | System | Gross profit for the booking row. | `fare_sold - fare_issued`. |
| Total Paid | Payment ledger | Total paid against the PNR. | Sum of payment rows for the normalized PNR. In the booking ledger this is shown on the first row for a PNR group. |
| Balance Due | Payment ledger | Remaining receivable for the PNR. | Total PNR `fare_sold` minus total paid, never below zero. |
| Payment Status | System | Collection status. | `UNPAID` if total paid is zero, `PARTIAL` if paid is less than total fare, `FULLY_PAID` when paid is greater than or equal to total fare. |
| Num Instalments | Payment ledger | Count of payments collected for the PNR. | Number of payment rows matching the normalized PNR. |
| Ticket Status | System | Indicates whether the booking has a ticket reference. | `TICKETED` when `ticket_no` has a value; otherwise `PENDING`. In the current Manual form, populated flight numbers are saved into `ticket_no`. |
| Days To Departure | System | Days remaining until outbound date. | Difference between today and `outbound_date`. Empty when outbound date is missing. |
| Alert | System | Payment/departure follow-up status. | `SETTLED` when no balance is due; `OVERDUE` at or after departure with balance due; `URGENT` within 7 days; `FOLLOW_UP` within 14 days. |
| PNR_N | System | PNR group occurrence number. | Normalized PNR occurrence count in the booking ledger. Used so PNR-level totals/status appear on the first row only. |
| Rows To Save | System preview | Shows how many booking rows will be created. | Count of passenger types with passenger count greater than zero. |

## Saved Booking Row Shape

Each saved manual booking row includes these main values:

- Billing: `bill_to_type`, `bill_to_name`, `booking_date`.
- Passenger: `passenger_name`, `pax_type`, `pax_count`, `mobile`.
- Route: `trip_type`, `sector`, `outbound_date`, `inbound_date`, `flight_segments`.
- Supplier: `supplier_name`, `supplier`, `supplier_segments`, `pnr`.
- Pricing: `buying_price_per_pax`, `selling_price_per_pax`, `fare_issued`, `fare_sold`, `profit`.
- Staff and notes: `booked_by`, `agent_issued_by`, `remarks`, `refund_flag`.
- System fields: `invoice_no`, `pnr_n`, `total_paid`, `balance_due`, `payment_status`, `ow_rt`, `num_instalments`, `ticket_status`, `created_at`.

## Payment Row Created From Manual Entry

When `Amount Paid` is greater than zero, the system creates a payment row with:

- `payment_date`: same as `Booking Date`.
- `pnr`: first saved booking row PNR, normalized.
- `amount_paid`: numeric value from `Amount Paid`.
- `payment_mode`: selected `Mode of Payment`.
- `receipt_ref`: empty.
- `received_by`: selected `Issued By`, or `Finance Desk` if empty.
- `remarks`: copied from Manual form remarks.
- Auto payment values: instalment number, instalment type, cumulative paid, total fare, and remaining balance.

## QA Checklist

- Save is blocked when `Bill To` is missing.
- Save is blocked when all passenger counts are zero.
- Save is blocked when a selected passenger type is missing passenger name, buying price, or selling price.
- Save is blocked when supplier or PNR is missing.
- Save is blocked in multi-supplier mode when any journey section is missing supplier or PNR.
- Save is blocked when the first flight connection is missing airline, flight number, departure city, or arrival city.
- A one-way booking saves with empty return date and `OW/RT = OW`.
- A roundtrip booking with return date saves with `OW/RT = RT`.
- Passenger rows save with correct `fare_sold`, `fare_issued`, and `profit`.
- `Amount Paid = 0` creates booking rows only.
- `Amount Paid > 0` creates booking rows plus one payment row and updates total paid, balance due, payment status, and instalment count.
