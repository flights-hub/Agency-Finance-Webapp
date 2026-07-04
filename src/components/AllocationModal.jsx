// Allocation screen (spec §32): explains WHICH open items a payment or a
// refund credit settles. Saving writes allocation records only — the ledger
// balance never changes here.

import { useMemo, useState } from 'react';
import { CheckCircle2, Trash2, Wand2, X } from 'lucide-react';
import { formatCurrency } from '../helpers/format';
import { saveAllocation } from '../helpers/storage';
import {
  allocationProblems,
  allocationsForSource,
  buildAllocationRecords,
  buildAutoAllocation,
  numeric,
  paymentAllocationSummary,
  refundCreditSummary,
} from '../helpers/ledger';

export default function AllocationModal({ user, source, sourceType, account, model, onClose, onSaved }) {
  const sourceLabel = sourceType === 'PAYMENT' ? 'Payment' : 'Refund credit';
  const reference = sourceType === 'PAYMENT'
    ? (source.payment_reference || source.receipt_ref || source.id)
    : (source.refund_number || source.id);

  const summary = useMemo(() => (
    sourceType === 'PAYMENT'
      ? paymentAllocationSummary(source, model)
      : (() => {
        const credit = refundCreditSummary(source, model);
        return {
          amount: credit.credit,
          allocated: credit.credit - credit.available,
          unallocated: credit.available,
        };
      })()
  ), [source, sourceType, model]);

  const existingAllocations = useMemo(
    () => allocationsForSource(model.allocations, sourceType, source.id),
    [model, sourceType, source.id],
  );

  // Only debit-side items with something outstanding can be settled.
  const targetItems = useMemo(
    () => account.openItems.filter((item) => item.side === 'DEBIT'),
    [account],
  );

  const [amounts, setAmounts] = useState({}); // open_item_id -> string
  const [error, setError] = useState('');

  const lines = targetItems
    .filter((item) => numeric(amounts[item.open_item_id]) > 0)
    .map((item) => ({ open_item: item, amount: numeric(amounts[item.open_item_id]) }));
  const totalSelected = lines.reduce((sum, line) => sum + line.amount, 0);
  const overBy = Math.round((totalSelected - summary.unallocated) * 100) / 100;

  const setAmount = (item, value) => {
    setAmounts((current) => ({ ...current, [item.open_item_id]: value }));
    setError('');
  };

  const toggleItem = (item) => {
    setAmounts((current) => {
      const next = { ...current };
      if (numeric(next[item.open_item_id]) > 0) {
        delete next[item.open_item_id];
      } else {
        const remaining = Math.max(0, summary.unallocated - totalSelected);
        next[item.open_item_id] = String(Math.min(item.outstanding_amount, remaining || item.outstanding_amount));
      }
      return next;
    });
    setError('');
  };

  const autoAllocate = (mode) => {
    const auto = buildAutoAllocation(summary.unallocated, targetItems, mode);
    if (!auto.length) {
      setError('Nothing to auto-allocate: no open items with outstanding amounts.');
      return;
    }
    setAmounts(Object.fromEntries(auto.map(({ open_item: item, amount }) => [item.open_item_id, String(amount)])));
    setError('');
  };

  const handleSave = () => {
    const problems = allocationProblems({ available: summary.unallocated, lines });
    if (problems.length) {
      setError(problems.join('\n'));
      return;
    }
    const records = buildAllocationRecords({
      source,
      sourceType,
      account,
      lines,
      allocations: model.allAllocations || model.allocations,
      user,
    });
    records.forEach((record) => saveAllocation(record));
    onSaved();
  };

  const handleRemove = (allocation) => {
    if (!window.confirm(`Remove allocation ${allocation.allocation_number} (${formatCurrency(allocation.amount)}) and reopen the item?`)) return;
    saveAllocation({
      ...allocation,
      status: 'REVERSED',
      reversed_by: user?.name || user?.email || '',
      reversed_by_user_id: user?.id || null,
      reversed_at: new Date().toISOString(),
    });
    onSaved({ keepOpen: true });
  };

  return (
    <div className="modal-backdrop allocation-backdrop">
      <div className="card modal-card allocation-modal">
        <div className="allocation-modal-head">
          <div>
            <h3>Allocate {sourceLabel}</h3>
            <p className="allocation-subtitle">
              {reference} · {account.name} · Allocation explains settlement — it never changes the ledger balance.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <div className="allocation-summary-row">
          <div className="card stat-card"><div className="stat-content"><p className="stat-label">{sourceLabel} amount</p><h3 className="stat-value">{formatCurrency(summary.amount)}</h3></div></div>
          <div className="card stat-card"><div className="stat-content"><p className="stat-label">Allocated</p><h3 className="stat-value">{formatCurrency(summary.allocated)}</h3></div></div>
          <div className="card stat-card"><div className="stat-content"><p className="stat-label">Unallocated</p><h3 className="stat-value">{formatCurrency(summary.unallocated)}</h3></div></div>
        </div>

        <div className="allocation-toolbar">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => autoAllocate('OLDEST_FIRST')}>
            <Wand2 size={14} /> Auto allocate — oldest first
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => autoAllocate('DUE_DATE_FIRST')}>
            <Wand2 size={14} /> Auto allocate — due date first
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setAmounts({}); setError(''); }}>Clear</button>
        </div>

        <div className="table-scroll allocation-table-scroll">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th></th>
                <th>Ticket No</th>
                <th>PNR</th>
                <th>Passenger</th>
                <th>Issue Date</th>
                <th>Original</th>
                <th>Allocated</th>
                <th>Outstanding</th>
                <th>Allocate Now</th>
              </tr>
            </thead>
            <tbody>
              {targetItems.map((item) => {
                const selected = numeric(amounts[item.open_item_id]) > 0;
                const settled = item.outstanding_amount <= 0;
                return (
                  <tr key={item.open_item_id} className={settled ? 'allocation-row-settled' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={settled}
                        onChange={() => toggleItem(item)}
                      />
                    </td>
                    <td>{item.ticket_no || '-'}</td>
                    <td>{item.pnr || '-'}</td>
                    <td>{item.passenger_name || '-'}</td>
                    <td>{item.issue_date || '-'}</td>
                    <td>{formatCurrency(item.original_amount)}</td>
                    <td>{formatCurrency(item.allocated_amount)}</td>
                    <td>{formatCurrency(item.outstanding_amount)}</td>
                    <td>
                      <input
                        className="allocation-amount-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={amounts[item.open_item_id] ?? ''}
                        disabled={settled}
                        onChange={(event) => setAmount(item, event.target.value)}
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                );
              })}
              {targetItems.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={9}>No open items for this account.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="allocation-footer">
          <div>
            <span className="allocation-total">Total selected: <strong>{formatCurrency(totalSelected)}</strong></span>
            <span className="allocation-total">Available: <strong>{formatCurrency(summary.unallocated)}</strong></span>
          </div>
          {overBy > 0 && (
            <div className="allocation-warning">
              Allocation exceeds unallocated {sourceLabel.toLowerCase()} by {formatCurrency(overBy)}. Saving is blocked.
            </div>
          )}
          {error && <div className="allocation-warning">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={overBy > 0 || lines.length === 0}
              onClick={handleSave}
            >
              <CheckCircle2 size={15} /> Save Allocation
            </button>
          </div>
        </div>

        {existingAllocations.length > 0 && (
          <div className="allocation-existing">
            <h4>Existing allocations</h4>
            <table className="data-table dense-table">
              <thead>
                <tr><th>No</th><th>Target</th><th>PNR</th><th>Amount</th><th>By</th><th></th></tr>
              </thead>
              <tbody>
                {existingAllocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td>{allocation.allocation_number}</td>
                    <td>{allocation.ticket_no || allocation.target_id}</td>
                    <td>{allocation.pnr || '-'}</td>
                    <td>{formatCurrency(allocation.amount)}</td>
                    <td>{allocation.allocated_by || '-'}</td>
                    <td>
                      <button className="icon-button" type="button" title="Remove allocation" onClick={() => handleRemove(allocation)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
