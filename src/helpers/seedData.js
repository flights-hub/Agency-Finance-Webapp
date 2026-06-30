import { saveBooking, savePayment, saveRefund, saveExpense, saveUser, clearAllData, getBookings } from './storage.js';

export function seedDataIfEmpty() {
  const bookings = getBookings();
  if (bookings && bookings.length > 0) {
    return; // Already seeded
  }

  console.log("Seeding initial mock data...");
  clearAllData();

  // Seed Users
  const agents = [
    { name: "Rajesh Sharma", role: "AGENT", email: "rajesh@flyforsure.com" },
    { name: "Meena Patel", role: "AGENT", email: "meena@flyforsure.com" },
    { name: "Admin Peter", role: "FINANCE_MANAGER", email: "peter@flyforsure.com" }
  ];
  agents.forEach(a => saveUser(a));

  const suppliers = [
    { name: "ITA Airways", role: "SUPPLIER", email: "sales@ita-airways.com" },
    { name: "Air India", role: "SUPPLIER", email: "sales@airindia.in" },
    { name: "Emirates", role: "SUPPLIER", email: "booking@emirates.com" }
  ];
  suppliers.forEach(s => saveUser(s));

  const today = new Date();
  
  // Helper to generate dates relative to today
  const getRelativeDate = (daysOffset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().split('T')[0];
  };

  // Seed Bookings
  const sampleBookings = [
    {
      pnr: "ABC123",
      invoice_no: "INV-00001",
      booking_date: getRelativeDate(-10),
      passenger_name: "Rahul Verma",
      pax_type: "ADT",
      gender: "M",
      title: "Mr",
      mobile: "+39 345 1234567",
      airline: "ITA Airways",
      ticket_no: "055-1234567890",
      flight_no: "AZ 770",
      ow_rt: "RT",
      sector: "FCO-DEL",
      outbound_date: getRelativeDate(-2), // Departed 2 days ago
      inbound_date: getRelativeDate(10),
      dob: "1992-05-12",
      nationality: "Indian",
      passport_no: "W3344556",
      passport_expiry_date: "2032-08-02",
      wchr: "Yes",
      meal: "HNML",
      fare_type: "FLEX",
      services_incl: "2PC 23kg",
      supplier: "SU0001 - Almate SRL",
      fare_sold: 450,
      fare_issued: 400,
      total_paid: 0,
      balance_due: 450,
      payment_status: "UNPAID",
      ticket_status: "TICKETED",
      booked_by: "Rajesh Sharma",
      agent_issued_by: "Peter",
      remarks: "Wheelchair assistance requested",
      refund_flag: false,
      created_at: getRelativeDate(-10)
    },
    {
      pnr: "DEF456",
      invoice_no: "INV-00002",
      booking_date: getRelativeDate(-5),
      passenger_name: "Anita Singh",
      pax_type: "ADT",
      gender: "F",
      title: "Mrs",
      mobile: "+39 345 9876543",
      airline: "Air India",
      ticket_no: "098-0987654321",
      flight_no: "AI 1884, AI 123",
      ow_rt: "OW",
      sector: "DEL-FCO",
      outbound_date: getRelativeDate(5), // Departs in 5 days
      dob: "1976-02-27",
      nationality: "Indian",
      passport_no: "T7453002",
      passport_expiry_date: "2030-03-11",
      wchr: "No",
      meal: "VGML",
      fare_type: "BASIC",
      services_incl: "1PC 23kg",
      supplier: "SU0003 - Ghai Travels SRL",
      fare_sold: 500,
      fare_issued: 420,
      total_paid: 200,
      balance_due: 300,
      payment_status: "PARTIAL",
      ticket_status: "TICKETED",
      booked_by: "Meena Patel",
      agent_issued_by: "Peter",
      remarks: "Balance pending before departure",
      refund_flag: false,
      created_at: getRelativeDate(-5)
    },
    {
      pnr: "GHI789",
      invoice_no: "INV-00003",
      booking_date: getRelativeDate(-2),
      passenger_name: "Vikram Mehta",
      pax_type: "ADT",
      gender: "M",
      title: "Mr",
      airline: "Emirates",
      ticket_no: "176-111222333",
      flight_no: "EK 097",
      ow_rt: "RT",
      sector: "DXB-ROM",
      outbound_date: getRelativeDate(20), // Departs in 20 days
      dob: "1985-11-15",
      nationality: "Indian",
      passport_no: "P8876543",
      passport_expiry_date: "2031-02-28",
      wchr: "No",
      meal: "Standard",
      fare_type: "CLASSIC",
      services_incl: "1PC 23kg",
      supplier: "SU0002 - Bipasha Aviation",
      fare_sold: 600,
      fare_issued: 550,
      total_paid: 600,
      balance_due: 0,
      payment_status: "FULLY_PAID",
      ticket_status: "TICKETED",
      booked_by: "Rajesh Sharma",
      agent_issued_by: "Admin Peter",
      remarks: "Refund case opened",
      refund_flag: true,
      created_at: getRelativeDate(-2)
    }
  ];

  // A single booking reference (INV-00004) shared by three passengers on one PNR
  const familyPax = [
    { passenger_name: "SINGH/HARPREET", pax_type: "ADT", ticket_no: "098-9497419318", dob: "1988-04-12" },
    { passenger_name: "KAUR/SANDEEP", pax_type: "ADT", ticket_no: "098-9497419319", dob: "1990-09-03" },
    { passenger_name: "SINGH/GURASEES", pax_type: "CHD", ticket_no: "098-9497419320", dob: "2016-01-22" },
  ];
  familyPax.forEach((pax) => {
    sampleBookings.push({
      pnr: "ZQFV6U",
      invoice_no: "INV-00004",
      booking_ref: "INV-00004",
      booking_date: getRelativeDate(-1),
      passenger_name: pax.passenger_name,
      pax_type: pax.pax_type,
      gender: "M",
      mobile: "+39 345 5550100",
      airline: "ITA Airways",
      ticket_no: pax.ticket_no,
      flight_no: "AZ 765",
      ow_rt: "OW",
      sector: "BRI-DEL",
      outbound_date: getRelativeDate(14),
      dob: pax.dob,
      nationality: "Indian",
      fare_type: "BASIC",
      services_incl: "1PC 23kg",
      supplier: "SU0001 - Almate SRL",
      fare_sold: pax.pax_type === "CHD" ? 380 : 450,
      fare_issued: pax.pax_type === "CHD" ? 330 : 400,
      total_paid: 0,
      balance_due: pax.pax_type === "CHD" ? 380 : 450,
      payment_status: "UNPAID",
      ticket_status: "TICKETED",
      booked_by: "Meena Patel",
      agent_issued_by: "Admin Peter",
      remarks: "Family booking, single PNR",
      refund_flag: false,
      created_at: getRelativeDate(-1),
    });
  });

  sampleBookings.forEach(b => saveBooking(b));

  // Seed Payments
  savePayment({
    payment_date: getRelativeDate(-5),
    pnr: "DEF456",
    passenger_name: "Anita Singh",
    amount_paid: 200,
    payment_mode: "BANK_TRANSFER",
    receipt_ref: "TXN-001",
    received_by: "Finance Desk",
    instalment_no: 1,
    instalment_type: "ADVANCE",
    cumulative_paid: 200,
    remarks: "Initial advance"
  });

  savePayment({
    payment_date: getRelativeDate(-2),
    pnr: "GHI789",
    passenger_name: "Vikram Mehta",
    amount_paid: 600,
    payment_mode: "CREDIT_CARD",
    receipt_ref: "CC-999",
    received_by: "Finance Desk",
    instalment_no: 1,
    instalment_type: "FULL PAYMENT",
    cumulative_paid: 600,
    remarks: "Full payment received"
  });

  // Seed Refund
  saveRefund({
    ticket_no: "176-111222333", // Vikram Mehta
    pnr: "GHI789",
    passenger_name: "Vikram Mehta",
    airline: "Emirates",
    sector: "DXB-ROM",
    fare_sold: 600,
    fare_issued: 550,
    cancel_date: getRelativeDate(-1),
    cancel_type: "FULL_BOOKING",
    refund_category: "VOLUNTARY",
    airline_penalty: 100,
    service_fee: 50,
    eligible_refund: 450,
    supplier_refund: 450,
    refund_status: "IN_PROCESS",
    status_date: getRelativeDate(-1),
    processing_days: 1,
    refund_mode: "BANK_TRANSFER",
    remarks: "Awaiting airline confirmation"
  });

  // Seed Expenses
  saveExpense({
    expense_date: getRelativeDate(-10),
    category: "RENT",
    description: "Office Rent",
    vendor_payee: "Rome Landlord",
    amount: 1200,
    amount_eur: 1200,
    payment_mode: "BANK_TRANSFER",
    receipt_ref: "RENT-MAY",
    branch_office: "ROME_HQ",
    recurring: true,
    month: "May-26",
    remarks: "Fixed monthly rent"
  });

  saveExpense({
    expense_date: getRelativeDate(-5),
    category: "MARKETING",
    description: "Facebook Ads",
    vendor_payee: "Meta Platforms",
    amount: 300,
    amount_eur: 300,
    payment_mode: "CREDIT_CARD",
    receipt_ref: "META-ADS",
    branch_office: "ROME_HQ",
    recurring: false,
    month: "May-26",
    remarks: "Campaign spend"
  });
  
  console.log("Mock data seeded successfully.");
}
