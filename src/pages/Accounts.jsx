// Counterparty accounts: one continuous ledger per customer, agent, and
// supplier, with open items, allocations, and the reconciliation control
// check (spec §33–§39, §45).

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenText,
  CircleCheck,
  CircleAlert,
  Link2,
  Search,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { formatCurrency } from '../helpers/format';
import { getAllocations, getBookings, getPayments, getRefunds } from '../helpers/storage';
import { canManageAllocations } from '../helpers/access';
import {
  balanceDisplay,
  buildFinanceModel,
  isRefundCreditPosted,
  refundCreditSummary,
} from '../helpers/ledger';
import AllocationModal from '../components/AllocationModal';

const money = (value) => formatCurrency(value);

function useFinanceModel(refreshKey) {
  return useMemo(
    () => buildFinanceModel({
      bookings: getBookings(),
      payments: getPayments(),
      refunds: getRefunds(),
      allocations: getAllocations(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshKey],
  );
}

function typeBadge(type) {
  const tone = type === 'AGENT' ? 'badge-info' : type === 'SUPPLIER' ? 'badge-warn' : 'badge-pass';
  return <span className={`badge ${tone}`}>{type}</span>;
}

function positionBadge(display) {
  if (display.direction === 'SETTLED') return <span className="badge badge-pass">Settled</span>;
  const tone = display.direction === 'OWES_US' ? 'badge-warn' : 'badge-info';
  return <span className={`badge ${tone}`}>{display.label} {money(display.amount)}</span>;
}

export default function Accounts() {
  const { accountKey } = useParams();
  if (accountKey) return <AccountDetail accountKey={decodeURIComponent(accountKey)} />;
  return <AccountList />;
}

function AccountList() {
  const [refreshKey] = useState(0);
  const model = useFinanceModel(refreshKey);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const accounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return model.accountList
      .filter((account) => (!typeFilter || account.type === typeFilter)
        && (!query || account.name.toLowerCase().includes(query)))
      .sort((a, b) => a.type.localeCompare(b.type) || b.open_receivable - a.open_receivable);
  }, [model, search, typeFilter]);

  const totals = useMemo(() => {
    const receivable = model.accountList
      .filter((account) => account.type !== 'SUPPLIER')
      .reduce((sum, account) => sum + Math.max(0, account.balance), 0);
    const payable = model.accountList
      .filter((account) => account.type === 'SUPPLIER')
      .reduce((sum, account) => sum + Math.max(0, account.balance), 0);
    const credits = model.accountList
      .filter((account) => account.type !== 'SUPPLIER')
      .reduce((sum, account) => sum + Math.max(0, -account.balance), 0);
    const unallocated = model.accountList.reduce((sum, account) => sum + account.unallocated_payments, 0);
    const mismatches = model.accountList.filter((account) => !account.control.matched).length;
    return { receivable, payable, credits, unallocated, mismatches };
  }, [model]);

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Ledgers</h1>
        <p>Continuous counterparty ledgers: receivables, payables, open items, and allocation status per account.</p>
      </header>

      <div className="stats-row ledger-stats-row">
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Receivable (customers + agents)</p><h3 className="stat-value">{money(totals.receivable)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Counterparty credits held</p><h3 className="stat-value">{money(totals.credits)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Supplier payable</p><h3 className="stat-value">{money(totals.payable)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Unallocated payments</p><h3 className="stat-value">{money(totals.unallocated)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Reconciliation errors</p><h3 className="stat-value">{totals.mismatches}</h3></div></div>
      </div>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Account name..." />
            </div>
          </label>
          <label>
            <span>Counterparty Type</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">All types</option>
              <option value="CUSTOMER">Customer</option>
              <option value="AGENT">Agent</option>
              <option value="SUPPLIER">Supplier</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Net Position</th>
                <th>Open Items</th>
                <th>Overdue</th>
                <th>Unallocated Payments</th>
                <th>Credit Available</th>
                <th>Control</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const display = balanceDisplay(account.balance, account.type);
                return (
                  <tr key={account.key}>
                    <td>
                      <Link className="account-link" to={`/accounts/${encodeURIComponent(account.key)}`}>
                        <BookOpenText size={14} /> {account.name}
                      </Link>
                    </td>
                    <td>{typeBadge(account.type)}</td>
                    <td>{positionBadge(display)}</td>
                    <td>{account.open_ticket_count}</td>
                    <td>{account.overdue_ticket_count > 0 ? <span className="badge badge-fail">{account.overdue_ticket_count}</span> : '0'}</td>
                    <td>{money(account.unallocated_payments)}</td>
                    <td>{money(account.refund_credit_available)}</td>
                    <td>
                      {account.control.matched
                        ? <span className="badge badge-pass">Matched</span>
                        : <span className="badge badge-fail">Diff {money(account.control.difference)}</span>}
                    </td>
                  </tr>
                );
              })}
              {accounts.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={8}>No counterparty accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const RECEIVABLE_TABS = ['LEDGER', 'OPEN ITEMS', 'PAYMENTS', 'REFUND CREDITS', 'ALLOCATIONS', 'RECONCILIATION'];
const SUPPLIER_TABS = ['LEDGER', 'OPEN ITEMS', 'PAYMENTS', 'ALLOCATIONS', 'RECONCILIATION'];

function AccountDetail({ accountKey }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const model = useFinanceModel(refreshKey);
  const [tab, setTab] = useState('LEDGER');
  const [allocationTarget, setAllocationTarget] = useState(null); // { source, sourceType }
  const canAllocate = canManageAllocations(user);

  const account = model.accountList.find((entry) => entry.key === accountKey);

  if (!account) {
    return (
      <div className="page-container fade-in">
        <div className="empty-state">
          <h5>Account not found</h5>
          <p>This counterparty has no financial documents yet.</p>
          <button className="btn btn-secondary" type="button" onClick={() => navigate('/accounts')}>Back to ledgers</button>
        </div>
      </div>
    );
  }

  const display = balanceDisplay(account.balance, account.type);
  const tabs = account.type === 'SUPPLIER' ? SUPPLIER_TABS : RECEIVABLE_TABS;
  const isSupplier = account.type === 'SUPPLIER';

  const refundRows = account.refunds
    .filter(({ refund }) => isRefundCreditPosted(refund))
    .map(({ refund, booking }) => ({ refund, booking, summary: refundCreditSummary(refund, model, booking) }));

  const accountAllocations = (model.allAllocations || [])
    .filter((allocation) => allocation.counterparty_type === account.type
      && String(allocation.counterparty_name || '').trim().toLowerCase() === account.name.trim().toLowerCase())
    .sort((a, b) => String(b.allocated_at || '').localeCompare(String(a.allocated_at || '')));

  const handleAllocationSaved = (options = {}) => {
    setRefreshKey((value) => value + 1);
    if (!options.keepOpen) setAllocationTarget(null);
  };

  const summaryCards = isSupplier
    ? [
      ['Current payable', money(Math.max(0, account.balance))],
      ['Open ticket payables', money(account.open_receivable)],
      ['Unallocated payments', money(account.unallocated_payments)],
      ['Unreconciled tickets', account.open_ticket_count],
      ['Pending verification', account.pending_verification_count],
    ]
    : [
      ['Current receivable', money(account.open_receivable)],
      [`${account.type === 'AGENT' ? 'Agent' : 'Customer'} credit`, money(account.refund_credit_available)],
      ['Net position', `${money(display.amount)} ${display.direction === 'OWES_US' ? 'owed to FlyForSure' : display.direction === 'WE_OWE' ? 'owed to counterparty' : ''}`],
      ['Unallocated payments', money(account.unallocated_payments)],
      ['Open tickets', account.open_ticket_count],
      ['Overdue tickets', account.overdue_ticket_count],
    ];

  return (
    <div className="page-container fade-in">
      <header className="page-header account-detail-header">
        <div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/accounts')}>
            <ArrowLeft size={14} /> Ledgers
          </button>
          <h1>{account.name} {typeBadge(account.type)}</h1>
          <p>{display.direction === 'SETTLED' ? 'Account fully settled.' : `${display.label}: ${money(display.amount)}`}</p>
        </div>
        <div className="account-control-pill">
          {account.control.matched
            ? <span className="badge badge-pass"><CircleCheck size={13} /> Ledger reconciled</span>
            : <span className="badge badge-fail"><CircleAlert size={13} /> Reconciliation error {money(account.control.difference)}</span>}
        </div>
      </header>

      <div className="stats-row ledger-stats-row">
        {summaryCards.map(([label, value]) => (
          <div className="card stat-card" key={label}>
            <div className="stat-content"><p className="stat-label">{label}</p><h3 className="stat-value">{value}</h3></div>
          </div>
        ))}
      </div>

      <div className="tab-row">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            className={`tab-button ${tab === name ? 'active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'LEDGER' && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>Date</th><th>Entry No</th><th>Type</th><th>PNR</th><th>Ticket</th><th>Description</th>
                  <th>{isSupplier ? 'Charge' : 'Debit'}</th>
                  <th>{isSupplier ? 'Payment / Credit' : 'Credit'}</th>
                  <th>Running Balance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {account.ledger.map((entry) => (
                  <tr key={entry.entry_no}>
                    <td>{entry.entry_date || '-'}</td>
                    <td>{entry.entry_no}</td>
                    <td>{entry.entry_type.replace(/_/g, ' ')}</td>
                    <td>{entry.pnr || '-'}</td>
                    <td>{entry.ticket_no || '-'}</td>
                    <td>{entry.description}</td>
                    <td>{entry.debit ? money(entry.debit) : '-'}</td>
                    <td>{entry.credit ? money(entry.credit) : '-'}</td>
                    <td>
                      {entry.running_balance < 0 && !isSupplier
                        ? <span className="ledger-credit-balance">{money(Math.abs(entry.running_balance))} CR</span>
                        : money(entry.running_balance)}
                    </td>
                    <td><span className={`badge ${entry.posting_status === 'POSTED' ? 'badge-pass' : 'badge-fail'}`}>{entry.posting_status}</span></td>
                  </tr>
                ))}
                {account.ledger.length === 0 && (
                  <tr><td className="empty-table-cell" colSpan={10}>No posted ledger entries.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'OPEN ITEMS' && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>Item</th><th>PNR</th><th>Ticket</th><th>Passenger</th><th>Issue Date</th><th>Due Date</th>
                  <th>Original</th><th>Payment Allocated</th><th>Credit Allocated</th><th>Outstanding</th><th>Status</th><th>Days Overdue</th>
                </tr>
              </thead>
              <tbody>
                {account.openItems.map((item) => (
                  <tr key={item.open_item_id}>
                    <td>{item.item_type.replace(/_/g, ' ')}</td>
                    <td>{item.pnr || '-'}</td>
                    <td>{item.ticket_no || '-'}</td>
                    <td>{item.passenger_name || '-'}</td>
                    <td>{item.issue_date || '-'}</td>
                    <td>{item.due_date || '-'}</td>
                    <td>{money(item.original_amount)}</td>
                    <td>{money(item.payment_allocated)}</td>
                    <td>{money(item.credit_allocated)}</td>
                    <td>{money(item.outstanding_amount)}</td>
                    <td><span className={`badge ${item.outstanding_amount <= 0 ? 'badge-pass' : item.allocated_amount > 0 ? 'badge-info' : 'badge-warn'}`}>{item.reconciliation_status.replace(/_/g, ' ')}</span></td>
                    <td>{item.days_overdue > 0 ? <span className="badge badge-fail">{item.days_overdue}</span> : '-'}</td>
                  </tr>
                ))}
                {account.openItems.length === 0 && (
                  <tr><td className="empty-table-cell" colSpan={12}>No open items.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'PAYMENTS' && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>Payment No</th><th>Date</th><th>Method</th><th>Amount</th><th>Verification</th><th>Posting</th>
                  <th>Allocated</th><th>Unallocated</th><th>Allocation Status</th><th>Recorded By</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {account.paymentSummaries.map(({ payment, allocated, unallocated, allocation_status: allocationStatus }) => (
                  <tr key={payment.id}>
                    <td>{payment.payment_reference || payment.receipt_ref || payment.id.slice(0, 8)}</td>
                    <td>{payment.payment_date || '-'}</td>
                    <td>{String(payment.payment_method || payment.payment_mode || '').replace(/_/g, ' ')}</td>
                    <td>{money(payment.amount_paid)}</td>
                    <td><span className={`badge ${(payment.verification_status || 'VERIFIED') === 'VERIFIED' ? 'badge-pass' : 'badge-warn'}`}>{(payment.verification_status || 'VERIFIED').replace(/_/g, ' ')}</span></td>
                    <td><span className={`badge ${allocationStatus === 'NOT_POSTED' ? 'badge-warn' : 'badge-pass'}`}>{allocationStatus === 'NOT_POSTED' ? 'NOT POSTED' : 'POSTED'}</span></td>
                    <td>{money(allocated)}</td>
                    <td>{money(unallocated)}</td>
                    <td><span className={`badge ${allocationStatus === 'FULLY_ALLOCATED' ? 'badge-pass' : allocationStatus === 'PARTIALLY_ALLOCATED' ? 'badge-info' : 'badge-warn'}`}>{allocationStatus.replace(/_/g, ' ')}</span></td>
                    <td>{payment.recorded_by || payment.received_by || '-'}</td>
                    <td>
                      {canAllocate && allocationStatus !== 'NOT_POSTED' && allocationStatus !== 'FULLY_ALLOCATED' && unallocated > 0 && (
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAllocationTarget({ source: payment, sourceType: 'PAYMENT' })}>
                          <Link2 size={13} /> Allocate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {account.paymentSummaries.length === 0 && (
                  <tr><td className="empty-table-cell" colSpan={11}>No payments for this account.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'REFUND CREDITS' && !isSupplier && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>Refund No</th><th>PNR</th><th>Ticket</th><th>Passenger</th><th>Refund Credit</th>
                  <th>Used vs Original</th><th>Used vs Future</th><th>Paid Out</th><th>Available Credit</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {refundRows.map(({ refund, summary }) => (
                  <tr key={refund.id}>
                    <td>{refund.refund_number || refund.id.slice(0, 8)}</td>
                    <td>{refund.pnr || '-'}</td>
                    <td>{refund.ticket_no || '-'}</td>
                    <td>{refund.passenger_name || '-'}</td>
                    <td>{money(summary.credit)}</td>
                    <td>{money(summary.used_original)}</td>
                    <td>{money(summary.used_future)}</td>
                    <td>{money(summary.paid_out)}</td>
                    <td>{money(summary.available)}</td>
                    <td><span className={`badge ${summary.settlement_status === 'SETTLED' ? 'badge-pass' : 'badge-info'}`}>{summary.settlement_status.replace(/_/g, ' ')}</span></td>
                    <td>
                      {canAllocate && summary.available > 0 && (
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAllocationTarget({ source: refund, sourceType: 'REFUND_CREDIT' })}>
                          <Link2 size={13} /> Allocate Credit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {refundRows.length === 0 && (
                  <tr><td className="empty-table-cell" colSpan={11}>No posted refund credits.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ALLOCATIONS' && (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>No</th><th>Source</th><th>Type</th><th>Target Ticket</th><th>PNR</th><th>Amount</th><th>Allocated By</th><th>Date</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {accountAllocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td>{allocation.allocation_number}</td>
                    <td>{allocation.source_reference || allocation.source_id}</td>
                    <td>{String(allocation.allocation_type || '').replace(/_/g, ' ')}</td>
                    <td>{allocation.ticket_no || allocation.target_id}</td>
                    <td>{allocation.pnr || '-'}</td>
                    <td>{money(allocation.amount)}</td>
                    <td>{allocation.allocated_by || '-'}</td>
                    <td>{String(allocation.allocated_at || '').slice(0, 10)}</td>
                    <td><span className={`badge ${allocation.status === 'REVERSED' ? 'badge-fail' : 'badge-pass'}`}>{allocation.status || 'ACTIVE'}</span></td>
                  </tr>
                ))}
                {accountAllocations.length === 0 && (
                  <tr><td className="empty-table-cell" colSpan={9}>No allocations recorded for this account.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'RECONCILIATION' && (
        <div className="reconciliation-grid">
          <div className="card">
            <h4>Golden control rule</h4>
            <p className="reconciliation-note">Ledger net balance must equal open debit items − open credit items, bridged only by unallocated posted payments.</p>
            <div className="auto-preview-list compact-preview">
              <div><span>Ledger net balance</span><strong>{money(account.control.ledger_balance)}</strong></div>
              <div><span>Open position (debit − credit items)</span><strong>{money(account.control.open_position)}</strong></div>
              <div><span>Unallocated posted payments</span><strong>{money(account.control.unallocated_payments)}</strong></div>
              <div><span>Residual difference</span><strong>{money(account.control.difference)}</strong></div>
            </div>
            <div className="reconciliation-status">
              {account.control.matched
                ? <span className="badge badge-pass"><CircleCheck size={13} /> MATCHED — account is reconciled</span>
                : <span className="badge badge-fail"><CircleAlert size={13} /> RECONCILIATION ERROR — {money(account.control.difference)} difference</span>}
            </div>
          </div>
          <div className="card">
            <h4>Work queue</h4>
            <ul className="reconciliation-queue">
              <li>
                <span>Unallocated posted payments</span>
                <strong>{money(account.unallocated_payments)}</strong>
              </li>
              <li>
                <span>Payments awaiting verification</span>
                <strong>{account.pending_verification_count}</strong>
              </li>
              <li>
                <span>Open items with outstanding balance</span>
                <strong>{account.openItems.filter((item) => item.outstanding_amount > 0).length}</strong>
              </li>
              <li>
                <span>Overdue tickets</span>
                <strong>{account.overdue_ticket_count}</strong>
              </li>
            </ul>
            <p className="reconciliation-note">
              Allocate payments and credits from the Payments and Refund Credits tabs until every open item is settled.
            </p>
          </div>
        </div>
      )}

      {allocationTarget && (
        <AllocationModal
          user={user}
          source={allocationTarget.source}
          sourceType={allocationTarget.sourceType}
          account={account}
          model={model}
          onClose={() => setAllocationTarget(null)}
          onSaved={handleAllocationSaved}
        />
      )}
    </div>
  );
}
