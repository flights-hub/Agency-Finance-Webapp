import assert from 'node:assert/strict';
import { parseBookingText } from './bookingParser.js';

const brusselsItineraryText = `
ALMATE SRL VIA NICCOLO TOMMASEO 22 IT-35100 PADOVA ITALY
BOOKING REF: YOEPAZ DATE: 23 MAY 2026 CAMARA/FAMARA
FLIGHT SN 2608 - BRUSSELS AIRLINES SUN 24 MAY 2026
-----------------------------------------------------------------------------
DEPARTURE: FRANKFURT, DE (FRANKFURT INTL), TERMINAL 1 24 MAY 09:00
ARRIVAL: BRUSSELS, BE (BRUSSELS AIRPORT) 24 MAY 10:10
FLIGHT BOOKING REF: SN/YOEPAZ DURATION: 01:10
BAGGAGE ALLOWANCE: 2PC SN-LH992220179444801 FOR CAMARA/FAMARA
NON STOP FRANKFURT TO BRUSSELS
FLIGHT SN 203 - BRUSSELS AIRLINES SUN 24 MAY 2026
-----------------------------------------------------------------------------
DEPARTURE: BRUSSELS, BE (BRUSSELS AIRPORT) 24 MAY 12:25
ARRIVAL: BANJUL, GM (INTERNATIONAL) 24 MAY 18:10
FLIGHT BOOKING REF: SN/YOEPAZ DURATION: 07:45
STOP 1 BRUSSELS TO DAKAR STOP 2 DAKAR TO BANJUL
FLIGHT SN 204 - BRUSSELS AIRLINES WED 17 JUNE 2026
-----------------------------------------------------------------------------
DEPARTURE: BANJUL, GM (INTERNATIONAL) 17 JUN 19:35
ARRIVAL: BRUSSELS, BE (BRUSSELS AIRPORT) 18 JUN 05:00
FLIGHT BOOKING REF: SN/YOEPAZ DURATION: 07:25
STOP 1 BANJUL TO DAKAR STOP 2 DAKAR TO BRUSSELS
FLIGHT SN 2607 - BRUSSELS AIRLINES THU 18 JUNE 2026
-----------------------------------------------------------------------------
DEPARTURE: BRUSSELS, BE (BRUSSELS AIRPORT) 18 JUN 06:20
ARRIVAL: FRANKFURT, DE (FRANKFURT INTL), TERMINAL 1 18 JUN 07:30
FLIGHT BOOKING REF: SN/YOEPAZ DURATION: 01:10
FLIGHT TICKET(S)
-----------------------------------------------------------------------------
TICKET: SN/ETKT 082 3592408765 FOR CAMARA/FAMARA
`;

const result = parseBookingText({ text: brusselsItineraryText, source: 'PDF' });
const segments = result.raw.segments;

assert.equal(result.raw.pnr, 'YOEPAZ');
assert.equal(result.raw.passengers[0].passenger_name, 'CAMARA/FAMARA');
assert.equal(result.raw.passengers[0].ticket_no, '0823592408765');
assert.equal(segments.length, 4);
assert.deepEqual(
  segments.map((segment) => `${segment.departure_city}-${segment.arrival_city}`),
  ['FRA-BRU', 'BRU-BJL', 'BJL-BRU', 'BRU-FRA'],
);
assert.deepEqual(
  segments.map((segment) => segment.departure_date),
  ['2026-05-24', '2026-05-24', '2026-06-17', '2026-06-18'],
);
assert.deepEqual(
  segments.map((segment) => segment.arrival_date),
  ['2026-05-24', '2026-05-24', '2026-06-18', '2026-06-18'],
);
assert.deepEqual(
  segments.map((segment) => segment.departure_time),
  ['09:00', '12:25', '19:35', '06:20'],
);
assert.equal(result.drafts[0].sector, 'FRA-BJL');
assert.equal(result.drafts[0].inbound_date, '2026-06-17');

console.log('bookingParser PDF itinerary checks passed');

const emiratesItineraryText = `
Itinerary for Record Locator 26ON4T Emirates Record Locator FAPE5N
Reservation Airline Flight # Departing Arriving Class Cabin Meals Airport Date & Time Airport Date & Time
Emirates 92 Milan Malpensa Apt, IT Terminal:1 TUE 16JUN 22:15 Dubai International, AE Terminal:3 WED 17JUN 06:45 L Y M
MRS ANU KUMAR (ADT) FF# Not Set Seat 81F - Confirmed
MISS SAANCH KUMAR (CHD) FF# Not Set Seat 81E - Confirmed
MR SANDEEP KUMAR (ADT) FF# Not Set Seat 81D - Confirmed Special Service: INFANT - Confirmed KUMAR/JAPJI 27MAR25
Emirates 516 Dubai International, AE Terminal:3 WED 17JUN 09:50 Delhi, IN Terminal:3 WED 17JUN 14:45 L Y M
Emirates 511 Delhi, IN Terminal:3 THU 16JUL 11:00 Dubai International, AE Terminal:3 THU 16JUL 13:00 T Y M
Emirates 91 Dubai International, AE Terminal:3 THU 16JUL 15:35 Milan Malpensa Apt, IT Terminal:1 THU 16JUL 20:15 T Y M
MRS ANU KUMAR (ADT) Document Number Issuance Date Electronic Ticket 1769292691472 23MAY26
Endorsements: NON-END/SAVER/REWARD UPGDS ALLOWED
Baggage Information Airport Codes Travelers 1st Bag 2nd Bag Checked Allowance Carry-on Allowance Most Significant Carrier
MXP-DEL MRS ANU KUMAR (ADT) 45KG 1PC EK
DEL-MXP MRS ANU KUMAR (ADT) 45KG 1PC EK
MISS SAANCH KUMAR (CHD) Document Number Issuance Date Electronic Ticket 1769292691473 23MAY26
MXP-DEL MISS SAANCH KUMAR (CHD) 45KG 1PC EK
DEL-MXP MISS SAANCH KUMAR (CHD) 45KG 1PC EK
MR SANDEEP KUMAR (ADT) Document Number Issuance Date Electronic Ticket 1769292691474 23MAY26
MXP-DEL MR SANDEEP KUMAR (ADT) 45KG 1PC EK
DEL-MXP MR SANDEEP KUMAR (ADT) 45KG 1PC EK
JAPJI KUMAR (INF) Document Number Issuance Date Electronic Ticket 1769292691475 23MAY26
MXP-DEL JAPJI KUMAR (INF) 10KG 1PC EK
DEL-MXP JAPJI KUMAR (INF) 10KG 1PC EK
`;

const emiratesResult = parseBookingText({ text: emiratesItineraryText, source: 'PDF' });
const emiratesSegments = emiratesResult.raw.segments;

assert.equal(emiratesResult.raw.pnr, '26ON4T');
assert.equal(emiratesResult.raw.passengers.length, 4);
assert.equal(emiratesSegments.length, 4);
assert.deepEqual(
  emiratesSegments.map((segment) => `${segment.airline}${segment.flight_number}:${segment.departure_city}-${segment.arrival_city}`),
  ['EK92:MXP-DXB', 'EK516:DXB-DEL', 'EK511:DEL-DXB', 'EK91:DXB-MXP'],
);
assert.deepEqual(
  emiratesSegments.map((segment) => segment.departure_date),
  ['2026-06-16', '2026-06-17', '2026-07-16', '2026-07-16'],
);
assert.equal(emiratesResult.drafts[0].sector, 'MXP-DEL');
assert.equal(emiratesResult.drafts[0].inbound_date, '2026-07-16');
assert.equal(emiratesResult.raw.passengers.find((passenger) => passenger.passenger_name === 'KUMAR/JAPJI').ticket_no, '1769292691475');
assert.deepEqual(
  emiratesResult.raw.passengers.find((passenger) => passenger.passenger_name === 'KUMAR/JAPJI').baggage.map((item) => `${item.route}:${item.check_in_baggage}:${item.cabin_baggage}`),
  ['MXP-DEL:10KG:1PC', 'DEL-MXP:10KG:1PC'],
);
assert.deepEqual(
  emiratesSegments.map((segment) => segment.check_in_baggage),
  ['45KG', '45KG', '45KG', '45KG'],
);

console.log('bookingParser Emirates PDF checks passed');

const qatarItineraryText = `
ALMATE SRL BOOKING REF: ZUONFC DATE: 19 MAY 2026 KAUR/PARAMJIT TELEPHONE: 049.8840733
FLIGHT QR 116 - QATAR AIRWAYS MON 25 MAY 2026
-----------------------------------------------------------------------------
DEPARTURE: ROME, IT (FIUMICINO), TERMINAL 3 25 MAY 10:45
ARRIVAL: DOHA, QA (HAMAD INTERNATIONAL) 25 MAY 17:20
BAGGAGE ALLOWANCE: 40 KG
FLIGHT QR 548 - QATAR AIRWAYS MON 25 MAY 2026
-----------------------------------------------------------------------------
DEPARTURE: DOHA, QA (HAMAD INTERNATIONAL) 25 MAY 19:50
ARRIVAL: AMRITSAR, PB (SRI GURU RAM DASS JEE) 26 MAY 02:30
BAGGAGE ALLOWANCE: 40 KG
FLIGHT QR 549 - QATAR AIRWAYS THU 09 JULY 2026
-----------------------------------------------------------------------------
DEPARTURE: AMRITSAR, PB (SRI GURU RAM DASS JEE) 09 JUL 03:35
ARRIVAL: DOHA, QA (HAMAD INTERNATIONAL) 09 JUL 04:50
BAGGAGE ALLOWANCE: 40 KG
FLIGHT QR 131 - QATAR AIRWAYS THU 09 JULY 2026
-----------------------------------------------------------------------------
DEPARTURE: DOHA, QA (HAMAD INTERNATIONAL) 09 JUL 09:15
ARRIVAL: ROME, IT (FIUMICINO), TERMINAL 3 09 JUL 14:15
BAGGAGE ALLOWANCE: 40 KG
`;

const qatarResult = parseBookingText({ text: qatarItineraryText, source: 'PDF' });
const qatarSegments = qatarResult.raw.segments;

assert.equal(qatarResult.raw.pnr, 'ZUONFC');
assert.equal(qatarResult.raw.passengers[0].passenger_name, 'KAUR/PARAMJIT');
assert.equal(qatarSegments.length, 4);
assert.deepEqual(
  qatarSegments.map((segment) => `${segment.airline}${segment.flight_number}:${segment.departure_city}-${segment.arrival_city}`),
  ['QR116:FCO-DOH', 'QR548:DOH-ATQ', 'QR549:ATQ-DOH', 'QR131:DOH-FCO'],
);
assert.equal(qatarResult.drafts[0].sector, 'FCO-ATQ');
assert.equal(qatarResult.drafts[0].inbound_date, '2026-07-09');
assert.deepEqual(
  qatarSegments.map((segment) => segment.check_in_baggage),
  ['40 KG', '40 KG', '40 KG', '40 KG'],
);

console.log('bookingParser Qatar PDF checks passed');

const emiratesCodeshareText = `
Itinerary for Record Locator OJLKNU Emirates Record Locator P2IIBB
Reservation Airline Flight # Departing Arriving Class Cabin Meals Airport Date & Time Airport Date & Time
Emirates 94 Bologna Guglielmo Marconi, IT SUN 07JUN 15:35 Dubai International, AE Terminal:3 SUN 07JUN 23:55 L Y M
MR MANJINDER SINGH (ADT) FF# Not Set No Seat Assigned
Emirates 510 Dubai International, AE Terminal:3 MON 08JUN 03:55 Delhi, IN Terminal:3 MON 08JUN 09:05 L Y M
MR MANJINDER SINGH (ADT) FF# Not Set No Seat Assigned
Emirates Operated By: Flydubai 442 2125 Delhi, IN Terminal:3 SAT 20JUN 04:10 Dubai International, AE Terminal:2 SAT 20JUN 06:25 L Y M
MR MANJINDER SINGH (ADT) FF# Not Set No Seat Assigned
Emirates 93 Dubai International, AE Terminal:3 SAT 20JUN 08:55 Bologna Guglielmo Marconi, IT SAT 20JUN 13:40 L Y M
MR MANJINDER SINGH (ADT) FF# Not Set No Seat Assigned
Invoice Information
MR MANJINDER SINGH (ADT) Document Number Issuance Date Electronic Ticket 1769292691468 20MAY26
Baggage Information Airport Codes Travelers 1st Bag 2nd Bag Checked Allowance Carry-on Allowance Most Significant Carrier
BLQ-DEL MR MANJINDER SINGH (ADT) 45KG 1PC EK
DEL-BLQ MR MANJINDER SINGH (ADT) 25KG 1PC EK
`;

const codeshareResult = parseBookingText({ text: emiratesCodeshareText, source: 'PDF' });
const codeshareSegments = codeshareResult.raw.segments;

assert.equal(codeshareResult.raw.pnr, 'OJLKNU');
assert.equal(codeshareResult.raw.passengers[0].passenger_name, 'SINGH/MANJINDER');
assert.equal(codeshareSegments.length, 4);
assert.deepEqual(
  codeshareSegments.map((segment) => `${segment.airline}${segment.flight_number}:${segment.departure_city}-${segment.arrival_city}`),
  ['EK94:BLQ-DXB', 'EK510:DXB-DEL', 'EK2125:DEL-DXB', 'EK93:DXB-BLQ'],
);
assert.equal(codeshareSegments[2].departure_date, '2026-06-20');
assert.equal(codeshareSegments[2].departure_time, '04:10');
assert.equal(codeshareSegments[2].arrival_date, '2026-06-20');
assert.equal(codeshareSegments[2].arrival_time, '06:25');
assert.equal(codeshareResult.drafts[0].sector, 'BLQ-DEL');
assert.equal(codeshareResult.drafts[0].inbound_date, '2026-06-20');
assert.deepEqual(
  codeshareSegments.map((segment) => `${segment.check_in_baggage}/${segment.cabin_baggage}`),
  ['45KG/1PC', '45KG/1PC', '25KG/1PC', '25KG/1PC'],
);

console.log('bookingParser Emirates codeshare PDF checks passed');

const amadeusFamilyPnr = `
TST RLR ---
RP/MILIG2427/MILIG2427            AK/SU  25MAY26/1051Z   ZQFV6U
  1.HARPREET SINGH/MR   2.SANDEEP KAUR/MRS
  3.SINGH/GURASEES(CHD/28DEC21)   4.SINGH/GURFATEH(CHD/27AUG17)
  5  AZ1616 V 25MAY 1 BRIFCO HK4          1520 1625   *1A/E*
  6  AI 122 G 25MAY 1 FCODEL HK4  1950 3  2050 0855+1 *1A/E*
  7 AP BRI +39 3274106407 - KAMBOJ VIAGGI - A
  8 TK PAX OK25MAY/MILIG22CU//ETAI/S5-6/P1-2
  9 TK OK25MAY/MILIG22CU//ETAI
 10 SSR CHLD AZ HK1 28DEC21/P3
 11 SSR CHLD AZ HK1 27AUG17/P4
 12 SSR CHLD AI HK1 28DEC21/P3
 13 SSR CHLD AI HK1 27AUG17/P4
 14 SSR OTHS 1A QUEUED BY AZ AS INELIGIBLE SPLIT
 15 RMZ CONF*FORMAT:PDF
 16 RM *CLT**156**
 17 FA PAX 098-9497419318/ETAI/EUR636.92/25MAY26/MILIG22CU/38288
       740/S5-6/P1
 18 FA PAX 098-9497419319/ETAI/EUR636.92/25MAY26/MILIG22CU/38288
       740/S5-6/P2
 19 FA PAX 098-9497419320/ETAI/EUR523.24/25MAY26/MILIG22CU/38288
       740/S5-6/P3
 20 FA PAX 098-9497419321/ETAI/EUR523.24/25MAY26/MILIG22CU/38288
)>
`;

const amadeusResult = parseBookingText({ text: amadeusFamilyPnr, source: 'CRYPTIC', provider: 'amadeus' });

assert.equal(amadeusResult.raw.pnr, 'ZQFV6U');
assert.equal(amadeusResult.raw.passengers.length, 4);
assert.deepEqual(
  amadeusResult.raw.passengers.map((passenger) => `${passenger.p_ref}:${passenger.passenger_name}:${passenger.pax_type}:${passenger.ticket_no}:${passenger.fare_issued}`),
  [
    '1:SINGH/HARPREET:ADT:098-9497419318:636.92',
    '2:KAUR/SANDEEP:ADT:098-9497419319:636.92',
    '3:SINGH/GURASEES:CHD:098-9497419320:523.24',
    '4:SINGH/GURFATEH:CHD:098-9497419321:523.24',
  ],
);
assert.deepEqual(
  amadeusResult.raw.segments.map((segment) => `${segment.airline}${segment.flight_number}:${segment.departure_city}-${segment.arrival_city}:${segment.departure_time}-${segment.arrival_time}:${segment.arrival_date}`),
  [
    'AZ1616:BRI-FCO:15:20-16:25:2026-05-25',
    'AI122:FCO-DEL:19:50-08:55:2026-05-26',
  ],
);
assert.equal(amadeusResult.drafts[0].sector, 'BRI-DEL');
assert.equal(amadeusResult.drafts[0].outbound_date, '2026-05-25');
assert.equal(amadeusResult.raw.supplierName, 'KAMBOJ VIAGGI');

console.log('bookingParser Amadeus family PNR checks passed');

const wrappedAmadeusPnr = `
RP/VCEIG2265/VCEIG2265            DM/SU  26MAY26/0829Z   ZPHEF2
  1.KAUR/NARINDER   2.SINGH/MANRAJ(CHD/03FEB17)
  3.SINGH/REPARMANJIT
  4  QR 116 O 12JUN 5 FCODOH HK3       3  1045 1720   *1A/E*
  5  QR 548 O 12JUN 5 DOHATQ
AMRITSAR, SRI GURU RAM DASS JEE
 HK3          2010 0230+1 *1A/E*
  6 AP VCE 049.8840733 -  ALMATE SRL - A
  7 TK PAX OK26MAY/MILIG21AG//ETQR/S4-5/P1,3
  8 TK OK26MAY/MILIG21AG//ETQR
  9 SSR CHLD QR HK1 03FEB17/P2
 10 SSR OTHS 1A 657173425545 - FARE RULE OVERRIDES TKT DEADLINE
       IF MORE RESTRICTIVE
 11 SSR CTCE QR HK1 BOOKINGS//FLYFORSURE.COM/P1
 12 SSR CTCM QR HK1 00393805932640/IT/P1
 13 RMZ CONF*FORMAT:PDF
 14 RMZ CONF*LANG:EN
 15 FA PAX 157-9497449356/ETQR/26MAY26/MILIG21AG/38237931
       /S4-5/P1
 16 FA PAX 157-9497449357/ETQR/26MAY26/MILIG21AG/38237931
       /S4-5/P3
 17 FA PAX 157-9497449358/ETQR/26MAY26/MILIG21AG/38237931
       /S4-5/P2
 18 FB PAX 0000000000 TTP/RT OK ETICKET/S4-5/P1,3
)>
`;

const wrappedAmadeusResult = parseBookingText({ text: wrappedAmadeusPnr, source: 'CRYPTIC', provider: 'amadeus' });

assert.equal(wrappedAmadeusResult.raw.pnr, 'ZPHEF2');
assert.equal(wrappedAmadeusResult.meta.ticketCount, 3);
assert.equal(wrappedAmadeusResult.meta.segmentCount, 2);
assert.deepEqual(
  wrappedAmadeusResult.raw.passengers.map((passenger) => `${passenger.p_ref}:${passenger.passenger_name}:${passenger.pax_type}:${passenger.ticket_no}:${passenger.fare_issued}:${passenger.ticket_issue_date}:${passenger.ticket_status}`),
  [
    '1:KAUR/NARINDER:ADT:157-9497449356::2026-05-26:TICKETED',
    '2:SINGH/MANRAJ:CHD:157-9497449358::2026-05-26:TICKETED',
    '3:SINGH/REPARMANJIT:ADT:157-9497449357::2026-05-26:TICKETED',
  ],
);
assert.deepEqual(
  wrappedAmadeusResult.raw.segments.map((segment) => `${segment.airline}${segment.flight_number}:${segment.departure_city}-${segment.arrival_city}:${segment.departure_time}-${segment.arrival_time}:${segment.arrival_date}`),
  [
    'QR116:FCO-DOH:10:45-17:20:2026-06-12',
    'QR548:DOH-ATQ:20:10-02:30:2026-06-13',
  ],
);
assert.equal(wrappedAmadeusResult.drafts[0].sector, 'FCO-ATQ');
assert.equal(wrappedAmadeusResult.drafts[0].outbound_date, '2026-06-12');

console.log('bookingParser wrapped Amadeus segment and fareless FA checks passed');

const displayTitleNamePnr = `
- TST RLR ---
RP/MILIG21AG/MILIG21AG     DM/SU  27JUN26/1056Z  YHMYGD
 1.GURMAIL KAUR/MS  2.MANN/KULWANT SINGH
 3.SUKHMINDER SINGH/MR
 4  AI 137 Q 28JUN 7 DELMXP HK3  1150 3  1250 1930  *1A/E*
 5 AP MIL 0240701719 - TRAVEL EXPERTS - A
 6 TK OK27JUN/MILIG21AG//ETAI
 7 SSR CTCE AI HK1 BOOKINGS//FLYFORSURE.COM/P1
 8 SSR CTCM AI HK1 00393805932640/IT/P1
 9 RMZ CONF*FORMAT:PDF
10 RMZ CONF*LANG:EN
11 FA PAX 098-9497915117/ETAI/EUR598.05/27JUN26/MILIG21AG/38237
       931/S4/P1
12 FA PAX 098-9497915118/ETAI/EUR598.05/27JUN26/MILIG21AG/38237
       931/S4/P2
13 FA PAX 098-9497915119/ETAI/EUR598.05/27JUN26/MILIG21AG/38237
       931/S4/P3
`;

const displayTitleResult = parseBookingText({ text: displayTitleNamePnr, source: 'CRYPTIC', provider: 'amadeus' });

assert.equal(displayTitleResult.raw.pnr, 'YHMYGD');
assert.equal(displayTitleResult.meta.passengerCount, 3);
assert.equal(displayTitleResult.meta.ticketCount, 3);
assert.equal(displayTitleResult.meta.segmentCount, 1);
assert.equal(displayTitleResult.drafts.length, 3);
assert.deepEqual(
  displayTitleResult.raw.passengers.map((passenger) => `${passenger.p_ref}:${passenger.passenger_name}:${passenger.pax_type}:${passenger.ticket_no}`),
  [
    '1:KAUR/GURMAIL:ADT:098-9497915117',
    '2:MANN/KULWANT SINGH:ADT:098-9497915118',
    '3:SINGH/SUKHMINDER:ADT:098-9497915119',
  ],
);
assert.deepEqual(
  displayTitleResult.raw.segments.map((segment) => `${segment.airline}${segment.flight_number}:${segment.departure_city}-${segment.arrival_city}:${segment.departure_time}-${segment.arrival_time}`),
  ['AI137:DEL-MXP:11:50-19:30'],
);
assert.equal(displayTitleResult.drafts[0].sector, 'DEL-MXP');
assert.equal(displayTitleResult.drafts[0].outbound_date, '2026-06-28');
assert.deepEqual(displayTitleResult.warnings, []);

console.log('bookingParser display-title names and spaced-airport segment checks passed');

const infantFaTicketPnr = `
RP/MILIG21AG/MILIG21AG     DM/SU  01JUL26/1056Z  YINFNT
 1.KAUR/NARINDER   2.SINGH/MANRAJ
 3  QR 116 O 01JUL 5 FCODOH HK4       3  1045 1720   *1A/E*
 4  QR 548 O 01JUL 5 DOHATQ HK4          2010 0230+1 *1A/E*
 5 AP VCE 049.8840733 -  ALMATE SRL - A
 6 TK PAX OK01JUL/MILIG21AG//ETQR/S3-4/P1-2
 7 SSR INFT QR HK1 KAUR/BABY 12MAR26/P1
 8 SSR INFT QR HK1 SINGH/CHILD 05JAN26/P2
 16 FA PAX 157-9497963758/ETQR/01JUL26/MILIG21AG/38237931
       /S3-4/P1
 17 FA PAX 157-9497963759/ETQR/01JUL26/MILIG21AG/38237931
       /S3-4/P2
 20 FA INF 157-9497963760/ETQR/01JUL26/MILIG21AG/38237931
       /S3-4/P2
 21 FA INF 157-9497963761/ETQR/01JUL26/MILIG21AG/38237931
       /S3-4/P1
)>
`;

const infantFaResult = parseBookingText({ text: infantFaTicketPnr, source: 'CRYPTIC', provider: 'amadeus' });
const infantPax = infantFaResult.raw.passengers.find((passenger) => passenger.passenger_name === 'KAUR/BABY');
const infantByAdult = new Map(
  infantFaResult.raw.passengers
    .filter((passenger) => passenger.pax_type === 'INF')
    .map((passenger) => [passenger.infant_of_p_ref, passenger]),
);

// Adult tickets from FA PAX lines are unchanged / not clobbered by the infant lines
assert.equal(infantFaResult.raw.passengers.find((p) => p.passenger_name === 'KAUR/NARINDER').ticket_no, '157-9497963758');
assert.equal(infantFaResult.raw.passengers.find((p) => p.passenger_name === 'SINGH/MANRAJ').ticket_no, '157-9497963759');
// Infant tickets on FA INF lines are retrieved and routed to the infant of the referenced adult
assert.ok(infantPax, 'infant passenger should be created from SSR INFT');
assert.equal(infantByAdult.get(1).ticket_no, '157-9497963761'); // FA INF .../P1 -> infant of adult 1
assert.equal(infantByAdult.get(2).ticket_no, '157-9497963760'); // FA INF .../P2 -> infant of adult 2
assert.equal(infantFaResult.meta.ticketCount, 4);
assert.ok(!infantFaResult.warnings.includes('AMBIGUOUS_FA_LINE'));

console.log('bookingParser FA INF infant ticket checks passed');

// Header variants that the stricter regex used to reject: indented RP line, a duty
// code containing a digit (1A/SU), and a single-digit day (1JUL).
const looseHeaderPnr = `
--- RLR ---
   RP/LON1A0980/LON1A0980            1A/SU  1JUL26/0900Z   ABC123
 1.KAUR/NARINDER
 2  QR 116 O 01JUL 5 FCODOH HK1       3  1045 1720   *1A/E*
 3 FA PAX 157-9497963758/ETQR/01JUL26/LON1A0980/38237931
       /S2/P1
)>
`;

const looseHeaderResult = parseBookingText({ text: looseHeaderPnr, source: 'CRYPTIC', provider: 'amadeus' });
assert.equal(looseHeaderResult.raw.pnr, 'ABC123');
assert.ok(!looseHeaderResult.warnings.includes('No record locator was detected.'));

console.log('bookingParser loose RP header record-locator checks passed');

// Multi-word surname before the slash (PATEL KHAMBHOLJA/DHYAN) must still be detected,
// while GIVEN SURNAME/TITLE display names keep going to the title handler.
const multiWordSurnamePnr = `
TST RLR MSC SFP ---
RP/VCEIG2265/VCEIG2265            SY/SU  1JUL26/1440Z   XKTRGO
 1.PATEL KHAMBHOLJA/DHYAN
 2  AA 125 L 02JUL 4 MADORD HK1     4S 1335 1600   *1A/E*
 3  AA4590 L 28AUG 5 ORDJFK HK1      3 1115 1455   *1A/E*
 4  AA 094 L 28AUG 5 JFKMAD HK1      8 1630 0535+1 *1A/E*
 5 AP VCE 049.8840733 -  ALMATE SRL - A
 7 TK OK01JUL/VCEIG2265//ETAA
`;

const multiWordSurnameResult = parseBookingText({ text: multiWordSurnamePnr, source: 'CRYPTIC', provider: 'amadeus' });
assert.equal(multiWordSurnameResult.raw.pnr, 'XKTRGO');
assert.equal(multiWordSurnameResult.raw.passengers.length, 1);
assert.deepEqual(
  multiWordSurnameResult.raw.passengers.map((p) => `${p.last_name}|${p.first_name}|${p.passenger_name}`),
  ['PATEL KHAMBHOLJA|DHYAN|PATEL KHAMBHOLJA/DHYAN'],
);
assert.ok(!multiWordSurnameResult.warnings.includes('No passenger names were detected.'));

console.log('bookingParser multi-word surname passenger checks passed');

// Conjunction tickets (014-9497880800-01) on a 6-coupon itinerary, with FA lines
// wrapped mid-invoice-number (".../MILIG21AG/3" + "8237931/S4-9/P1"). Both the
// wrap join and the ticket regex must handle these, including the FA INF line.
const conjunctionTicketPnr = `
--- TST RLR MSC SFP ---
RP/ROMIG21NZ/ROMIG21NZ            DM/SU  25JUN26/0802Z   ZW9XE5
  1.SINGH/HARLEEN(INFDHILLON/GURFATEH/30APR25)   2.DHILLON/JASKARAN
  3.DHILLON/KIRPAL(CHD/11MAR19)
  4  AC 891 K 09JUL 4 FCOYYZ HK3       3  1225 1600   *1A/E*
  5  AC 123 K 09JUL 4 YYZYVR HK3       1  1830 2035   *1A/E*
  6  AC8349 K 09JUL 4 YVRYXS HK3       M  2210 2329   *1A/E*
  7  AC8342 T 11AUG 2 YXSYVR HK3          0550 0715   *1A/E*
  8  AC 034 T 11AUG 2 YVRYYZ HK3       M  0900 1624   *1A/E*
  9  AC 890 T 11AUG 2 YYZFCO HK3       1  2000 1020+1 *1A/E*
 10 AP ROM TBA - SKY HIGH JOURNEYS - A
 11 TK PAX OK25JUN/MILIG21AG//ETAC/S4-9/P1-3
 13 SSR CHLD AC HK1 11MAR19/P3
 16 SSR INFT AC HK1 DHILLON/GURFATEH 30APR25/S4/P1
 28 FA PAX 014-9497880800-01/ETAC/EUR1209.81/25JUN26/MILIG21AG/3
       8237931/S4-9/P1
 29 FA PAX 014-9497880802-03/ETAC/EUR1209.81/25JUN26/MILIG21AG/3
       8237931/S4-9/P2
 30 FA PAX 014-9497880804-05/ETAC/EUR1009.23/25JUN26/MILIG21AG/3
       8237931/S4-9/P3
 31 FA INF 014-9497880806-07/ETAC/EUR112.71/25JUN26/MILIG21AG/38
       237931/S4-9/P1
)>
`;

const conjunctionResult = parseBookingText({ text: conjunctionTicketPnr, source: 'CRYPTIC', provider: 'amadeus' });
assert.equal(conjunctionResult.raw.pnr, 'ZW9XE5');
assert.equal(conjunctionResult.meta.ticketCount, 4);
const conjunctionTickets = new Map(
  conjunctionResult.raw.passengers.map((p) => [`${p.passenger_name}:${p.pax_type}`, p.ticket_no]),
);
assert.equal(conjunctionTickets.get('SINGH/HARLEEN:ADT'), '014-9497880800-01');
assert.equal(conjunctionTickets.get('DHILLON/JASKARAN:ADT'), '014-9497880802-03');
assert.equal(conjunctionTickets.get('DHILLON/KIRPAL:CHD'), '014-9497880804-05');
assert.equal(conjunctionTickets.get('DHILLON/GURFATEH:INF'), '014-9497880806-07');
assert.ok(conjunctionResult.raw.passengers.every((p) => p.ticket_status === 'TICKETED'));
assert.equal(conjunctionResult.raw.passengers.find((p) => p.pax_type === 'INF').fare_issued, 112.71);
assert.ok(!conjunctionResult.warnings.includes('TICKET_COUNT_MISMATCH'));

console.log('bookingParser conjunction ticket checks passed');

const fullMonthRoundtripText = `
ALMATE SRL BOOKING REF: ZY2FM4 VIA NICCOLO TOMMASEO 22 DATE: 01 JULY 2026 IT-35100 PADOVA ITALY SINGH/JASKARAN SINGH/SURINDER FLIGHT AI 122 - AIR INDIA FRI 31 JULY 2026 ----------------------------------------------------------------------------- DEPARTURE: ROME, IT (FIUMICINO), TERMINAL 3 31 JUL 20:50 ARRIVAL: DELHI, DL (INDIRA GANDHI INTL), TERMINAL 3 01 AUG 09:45 FLIGHT BOOKING REF: AI/ZY2FM4 LAST CHECK IN TIME: 19:50 RESERVATION CONFIRMED, ECONOMY (L) DURATION: 09:25 - - - BAGGAGE ALLOWANCE: 2PC NON STOP ROME TO DELHI, DL EQUIPMENT: BOEING 787-8 FLIGHT AI 123 - AIR INDIA MON 24 AUGUST 2026 ----------------------------------------------------------------------------- DEPARTURE: DELHI, DL (INDIRA GANDHI INTL), TERMINAL 3 24 AUG 13:10 ARRIVAL: ROME, IT (FIUMICINO), TERMINAL 3 24 AUG 19:00 FLIGHT BOOKING REF: AI/ZY2FM4 LAST CHECK IN TIME: 12:10 RESERVATION CONFIRMED, ECONOMY (G) DURATION: 09:20 - - - BAGGAGE ALLOWANCE: 2PC NON STOP DELHI, DL TO ROME EQUIPMENT: BOEING 787-8 FLIGHT TICKET(S) ----------------------------------------------------------------------------- TICKET: AI/ETKT 098 9497963763 FOR SINGH/JASKARAN TICKET: AI/ETKT 098 9497963764 FOR SINGH/SURINDER
`;

const fullMonthResult = parseBookingText({ text: fullMonthRoundtripText, source: 'PDF' });
const fullMonthSegments = fullMonthResult.raw.segments;
assert.equal(fullMonthResult.raw.pnr, 'ZY2FM4');
assert.equal(fullMonthSegments.length, 2);
assert.deepEqual(
  fullMonthSegments.map((segment) => `${segment.departure_city}-${segment.arrival_city}`),
  ['FCO-DEL', 'DEL-FCO'],
);
assert.deepEqual(
  fullMonthSegments.map((segment) => segment.departure_date),
  ['2026-07-31', '2026-08-24'],
);
assert.equal(fullMonthResult.drafts[0].trip_type, 'ROUNDTRIP');

console.log('bookingParser full month name roundtrip checks passed');

const eurowingsReceiptText = `
Passenger Receipt Confirmation of Booking Hello ghai travels, Thank you for booking with Eurowings. Overview of your flight information Your booking code for check-in: JG2WSI Date of booking: 01.07.2026 20:52 (CEST) Date of change: 01.07.2026 20:52 (CEST) Flight data (times are local times) Flight: 03.07.2026 | Flight Number EW 7886 (BASIC\\ G ) * Operated by GetJet (GW) Departure 12:00 Hamburg Arrival 14:15 Rome Fiumicino Passenger: Passenger 1 : MRS arvinder kaur arvinder kaur Additionally booked extras: Hamburg ( HAM ) - Rome Fiumicino ( FCO ) (BASIC)
`;

const eurowingsResult = parseBookingText({ text: eurowingsReceiptText, source: 'PDF' });
assert.equal(eurowingsResult.raw.pnr, 'JG2WSI');
assert.equal(eurowingsResult.raw.passengers.length, 1);
assert.equal(eurowingsResult.raw.passengers[0].passenger_name, 'KAUR/ARVINDER');
assert.equal(eurowingsResult.raw.segments.length, 1);
const eurowingsSegment = eurowingsResult.raw.segments[0];
assert.equal(`${eurowingsSegment.airline} ${eurowingsSegment.flight_number}`, 'EW 7886');
assert.equal(`${eurowingsSegment.departure_city}-${eurowingsSegment.arrival_city}`, 'HAM-FCO');
assert.equal(eurowingsSegment.departure_date, '2026-07-03');
assert.equal(eurowingsSegment.departure_time, '12:00');
assert.equal(eurowingsSegment.arrival_time, '14:15');
assert.equal(eurowingsSegment.booking_class, 'G');
assert.equal(eurowingsResult.drafts[0].booking_date, '2026-07-01');

console.log('bookingParser Eurowings receipt checks passed');

// Ryanair roundtrip confirmation: side-by-side flight cards arrive interleaved
// from OCR/pdf.js reading order.
const ryanairRoundtripText = `
RYANAIR myRyanair Destination:: Athens Reservation: C3385T Your flight information To Athens FR1198 To Rome (Fiumicino) FR1299 Rome (Fiumicino) - Athens Athens - Rome (Fiumicino) Wed, 12 Aug 26 Sat, 05 Sep 26 Departure time - 13:00 Departure time - 18:50 Arrival time - 16:00 Arrival time - 20:00 (FCO) - (ATH) (ATH) - (FCO) Passenger(s): Mr SARVJIT SINGH Flight out: FR1198 Flight back: FR1299 Receipt: Total price of your trip purchased via PayPal Billing Agreement ending in: 0000 177.65 EUR
`;

const ryanairRoundtrip = parseBookingText({ text: ryanairRoundtripText, source: 'PDF' });
assert.equal(ryanairRoundtrip.raw.pnr, 'C3385T');
assert.equal(ryanairRoundtrip.raw.passengers[0].passenger_name, 'SINGH/SARVJIT');
assert.equal(ryanairRoundtrip.raw.passengers[0].ticket_no, 'C3385T');
assert.equal(ryanairRoundtrip.raw.passengers[0].fare_issued, 177.65);
assert.deepEqual(
  ryanairRoundtrip.raw.segments.map((s) => `${s.airline}${s.flight_number} ${s.departure_city}-${s.arrival_city} ${s.departure_date} ${s.departure_time}`),
  ['FR1198 FCO-ATH 2026-08-12 13:00', 'FR1299 ATH-FCO 2026-09-05 18:50'],
);
assert.equal(ryanairRoundtrip.drafts[0].trip_type, 'ROUNDTRIP');
assert.ok(!ryanairRoundtrip.warnings.includes('NO_TICKET_FOUND'));

const ryanairOneWayText = `
myRyanair Destination:: Girona (Barcelona) Reservation: Y4R4XW Your flight information To Girona (Barcelona) FR4966 Bari - Girona (Barcelona) Sat, 04 Jul 26 Departure time - 20:05 Arrival time - 22:15 (BRI) - (GRO) Passenger(s): Mr RAMJIT SINGH Flight out: FR4966 Checked Bag (20kg) Receipt: Total price of your trip purchased via PayPal Billing Agreement ending in: 0000 66.98 EUR
`;

const ryanairOneWay = parseBookingText({ text: ryanairOneWayText, source: 'PDF' });
assert.equal(ryanairOneWay.raw.pnr, 'Y4R4XW');
assert.equal(ryanairOneWay.raw.passengers[0].passenger_name, 'SINGH/RAMJIT');
assert.equal(ryanairOneWay.raw.passengers[0].ticket_no, 'Y4R4XW');
assert.equal(ryanairOneWay.raw.segments.length, 1);
assert.equal(ryanairOneWay.raw.segments[0].check_in_baggage, '20KG');
assert.equal(ryanairOneWay.raw.segments[0].departure_date, '2026-07-04');
assert.equal(ryanairOneWay.drafts[0].trip_type, 'ONE_WAY');

console.log('bookingParser Ryanair confirmation checks passed');
