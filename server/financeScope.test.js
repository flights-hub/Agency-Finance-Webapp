import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const calculations = await vite.ssrLoadModule('/src/helpers/calculations.js');
  const access = await vite.ssrLoadModule('/src/helpers/access.js');

  const admin = { role: 'ADMIN', name: 'Admin' };
  const agent = { role: 'AGENT', name: 'Agent One', linked_agent_id: 'AGENT-1', email: 'agent@example.com' };
  const supplier = { role: 'SUPPLIER', name: 'Supplier One', linked_supplier_id: 'SUP-1', email: 'supplier@example.com' };
  const staleAgentWithCreate = { ...agent, permissions: ['view_bookings', 'create_bookings', 'edit_bookings'] };
  const employeeWithCreate = { role: 'EMPLOYEE', name: 'Ops', permissions: ['view_bookings', 'create_bookings'] };

  const bookings = [
    {
      id: 'b1',
      pnr: 'PNR1',
      passenger_name: 'A Passenger',
      ticket_no: 'T1',
      sector: 'ROM-DXB',
      agent_id: 'AGENT-1',
      bill_to_name: 'Agent One',
      fare_sold: 1000,
      fare_issued: 700,
      supplier_segments: [
        { id: 'seg-out', supplier_id: 'SUP-1', supplier_name: 'Supplier One', buying_price: 400, segment: 'ROM-DXB' },
        { id: 'seg-ret', supplier_name: 'Supplier Two', buying_price: 300, segment: 'DXB-ROM' },
      ],
    },
    {
      id: 'b2',
      pnr: 'PNR2',
      passenger_name: 'B Passenger',
      ticket_no: 'T2',
      sector: 'ROM-DEL',
      agent_id: 'AGENT-2',
      bill_to_name: 'Other Agent',
      fare_sold: 800,
      fare_issued: 500,
      supplier_id: 'SUP-1',
      supplier_name: 'Supplier One',
    },
  ];

  const payments = [
    { payment_direction: 'AGENT_IN', pnr: 'PNR1', amount_paid: 300, payment_date: '2026-05-01' },
    { payment_direction: 'SUPPLIER_OUT', supplier_name: 'Supplier One', supplier_payment_scope: 'SUPPLIER', amount_paid: 100, payment_date: '2026-05-02' },
    { payment_direction: 'SUPPLIER_OUT', supplier_name: 'Supplier One', supplier_payment_scope: 'PNR', pnr: 'PNR1', amount_paid: 50, payment_date: '2026-05-03' },
    {
      payment_direction: 'SUPPLIER_OUT',
      supplier_name: 'Supplier One',
      supplier_payment_scope: 'SEGMENT',
      pnr: 'PNR1',
      segment_id: 'seg-out',
      amount_paid: 25,
      payment_date: '2026-05-04',
      supplier_allocations: [{ pnr: 'PNR1', segment_id: 'seg-out', supplier_name: 'Supplier One', amount_paid: 25 }],
    },
  ];

  const expenses = [{ id: 'e1', amount_eur: 200 }, { id: 'e2', amount_eur: 50 }];

  const adminScoped = access.scopedFinanceData(admin, { bookings, payments, refunds: [], expenses });
  const agentScoped = access.scopedFinanceData(agent, { bookings, payments, refunds: [], expenses });
  const supplierScoped = access.scopedFinanceData(supplier, { bookings, payments, refunds: [], expenses });

  const adminSummary = calculations.getRoleDashboardSummary(admin, adminScoped);
  assert.equal(adminSummary.roleView, 'ADMIN');
  assert.equal(adminSummary.pnl.revenue, 1800);
  assert.equal(adminSummary.pnl.cogs, 1200);

  const agentSummary = calculations.getRoleDashboardSummary(agent, agentScoped);
  assert.equal(agentSummary.roleView, 'AGENT');
  assert.equal(agentSummary.bookings.length, 1);
  assert.equal(agentSummary.kpis.find(([label]) => label === 'Agent payable')[1], 1000);
  assert.equal(agentSummary.kpis.find(([label]) => label === 'Paid to Admin')[1], 300);
  assert.equal(agentSummary.details.some(([label]) => label === 'Net profit'), false);

  const supplierSummary = calculations.getRoleDashboardSummary(supplier, supplierScoped);
  assert.equal(supplierSummary.roleView, 'SUPPLIER');
  assert.equal(supplierSummary.kpis.find(([label]) => label === 'Supplier receivable')[1], 900);
  assert.equal(supplierSummary.kpis.find(([label]) => label === 'Paid by Admin')[1], 175);
  assert.equal(supplierSummary.kpis.find(([label]) => label === 'Outstanding receivable')[1], 725);
  assert.equal(supplierSummary.details.some(([label]) => label === 'Ticket cost'), false);

  const supplierLedger = calculations.getSupplierPayableLedger(bookings, payments, supplier);
  const pnr1SupplierRow = supplierLedger.find((booking) => booking.pnr === 'PNR1');
  const pnr2SupplierRow = supplierLedger.find((booking) => booking.pnr === 'PNR2');
  assert.equal(pnr1SupplierRow.supplier_payable, 400);
  assert.equal(pnr1SupplierRow.supplier_paid, 75);
  assert.equal(pnr1SupplierRow.supplier_balance_due, 325);
  assert.equal(pnr2SupplierRow.supplier_payable, 500);
  assert.equal(pnr2SupplierRow.supplier_paid, 0);

  const supplierPayableSummary = calculations.getSupplierPayableSummary(bookings, payments, supplier);
  assert.equal(supplierPayableSummary.payable, 900);
  assert.equal(supplierPayableSummary.paid, 175);
  assert.equal(supplierPayableSummary.outstanding, 725);

  const supplierPaymentLedger = calculations.getSupplierPaymentLedger(bookings, payments);
  const supplierLevelPayment = supplierPaymentLedger.find((payment) => payment.supplier_payment_scope === 'SUPPLIER');
  const pnrPayment = supplierPaymentLedger.find((payment) => payment.supplier_payment_scope === 'PNR');
  const segmentPayment = supplierPaymentLedger.find((payment) => payment.supplier_payment_scope === 'SEGMENT');
  assert.equal(supplierLevelPayment.total_fare, 900);
  assert.equal(supplierLevelPayment.remaining_balance, 800);
  assert.equal(pnrPayment.total_fare, 400);
  assert.equal(pnrPayment.remaining_balance, 350);
  assert.equal(segmentPayment.total_fare, 400);
  assert.equal(segmentPayment.remaining_balance, 375);

  const agentColumns = calculations.getStatementColumns({ role: 'AGENT', statementType: 'agent' }).map(([key]) => key);
  const supplierColumns = calculations.getStatementColumns({ role: 'SUPPLIER', statementType: 'supplier' }).map(([key]) => key);
  assert.equal(agentColumns.includes('fare_issued'), false);
  assert.equal(agentColumns.includes('fare_sold'), true);
  assert.equal(supplierColumns.includes('fare_sold'), false);
  assert.equal(supplierColumns.includes('supplier_payable'), true);

  assert.equal(access.filterRecordsForUser(admin, expenses, 'expenses').length, 2);
  assert.equal(access.filterRecordsForUser(agent, expenses, 'expenses').length, 0);
  assert.equal(access.filterRecordsForUser(supplier, expenses, 'expenses').length, 0);
  assert.equal(access.canCreateBookings(staleAgentWithCreate), false);
  assert.equal(access.canEditBookings(staleAgentWithCreate), false);
  assert.equal(access.canCreateBookings(employeeWithCreate), true);

  console.log('Finance role scoping checks passed');
} finally {
  await vite.close();
}
