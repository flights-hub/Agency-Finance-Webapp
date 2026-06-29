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
