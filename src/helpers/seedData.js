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
      passenger_name: "Rahul Verma",
      pax_type: "ADT",
      mobile: "+39 345 1234567",
      airline: "ITA Airways",
      ticket_no: "055-1234567890",
      ow_rt: "RT",
      sector: "FCO-DEL",
      outbound_date: getRelativeDate(-2), // Departed 2 days ago
      inbound_date: getRelativeDate(10),
      fare_sold: 450,
      fare_issued: 400,
      total_paid: 0,
      balance_due: 450,
      payment_status: "UNPAID",
      ticket_status: "TICKETED",
      booked_by: "Rajesh Sharma",
      created_at: getRelativeDate(-10)
    },
    {
      pnr: "DEF456",
      passenger_name: "Anita Singh",
      pax_type: "ADT",
      mobile: "+39 345 9876543",
      airline: "Air India",
      ticket_no: "098-0987654321",
      ow_rt: "OW",
      sector: "DEL-FCO",
      outbound_date: getRelativeDate(5), // Departs in 5 days
      fare_sold: 500,
      fare_issued: 420,
      total_paid: 200,
      balance_due: 300,
      payment_status: "PARTIAL",
      ticket_status: "TICKETED",
      booked_by: "Meena Patel",
      created_at: getRelativeDate(-5)
    },
    {
      pnr: "GHI789",
      passenger_name: "Vikram Mehta",
      pax_type: "ADT",
      airline: "Emirates",
      ticket_no: "176-111222333",
      ow_rt: "RT",
      sector: "DXB-ROM",
      outbound_date: getRelativeDate(20), // Departs in 20 days
      fare_sold: 600,
      fare_issued: 550,
      total_paid: 600,
      balance_due: 0,
      payment_status: "FULLY_PAID",
      ticket_status: "TICKETED",
      booked_by: "Rajesh Sharma",
      created_at: getRelativeDate(-2)
    }
  ];

  sampleBookings.forEach(b => saveBooking(b));

  // Seed Payments
  savePayment({
    payment_date: getRelativeDate(-5),
    pnr: "DEF456",
    passenger_name: "Anita Singh",
    amount_paid: 200,
    payment_mode: "BANK_TRANSFER",
    receipt_ref: "TXN-001",
    instalment_no: 1,
    instalment_type: "ADVANCE",
    cumulative_paid: 200
  });

  savePayment({
    payment_date: getRelativeDate(-2),
    pnr: "GHI789",
    passenger_name: "Vikram Mehta",
    amount_paid: 600,
    payment_mode: "CREDIT_CARD",
    receipt_ref: "CC-999",
    instalment_no: 1,
    instalment_type: "FULL PAYMENT",
    cumulative_paid: 600
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
    refund_status: "IN_PROCESS",
    status_date: getRelativeDate(-1),
    processing_days: 1
  });

  // Seed Expenses
  saveExpense({
    expense_date: getRelativeDate(-10),
    category: "RENT",
    description: "Office Rent",
    vendor_payee: "Rome Landlord",
    amount: 1200,
    payment_mode: "BANK_TRANSFER",
    branch_office: "ROME_HQ",
    recurring: true
  });

  saveExpense({
    expense_date: getRelativeDate(-5),
    category: "MARKETING",
    description: "Facebook Ads",
    vendor_payee: "Meta Platforms",
    amount: 300,
    payment_mode: "CREDIT_CARD",
    branch_office: "ROME_HQ",
    recurring: false
  });
  
  console.log("Mock data seeded successfully.");
}
