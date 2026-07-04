// Refund case creation modal (servicing spec §14–§22, §29). Replaces the old
// "Apply refund" one-click flow: this only CREATES a refund case (status
// REQUESTED) with input-driven amounts and per-ticket lines. Approval — the
// only step that posts a REFUND_CREDIT ledger entry — happens on the Refunds
// page, and payout is a separate verified event after that.

import { useMemo, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { formatCurrency } from '../helpers/format';
import { saveRefund, saveBooking } from '../helpers/storage';
import {
  CANCELLATION_CATEGORIES,
  bookingCounterparty,
  getAccountOpenItems,
  nextRefundNumber,
  numeric,
  ticketOpenItemId,
} from '../helpers/ledger';
import AffectedItemsPicker, { bookingGroupOptions, selectedItems, readAttachment } from './AffectedItemsPicker';

const LINE_FEE_FIELDS = [
  ['airline_cancellation_fee', 'Airline Fee'],
  ['flyforsure_cancellation_fee', 'FlyforSure Fee'],
  ['agent_cancellation_markup', 'Agent Markup'],
  ['processing_fee', 'Processing Fee'],
  ['other_deductions', 'Other Deduction'],
];

const round2 = (value) => Math.round(numeric(value) * 100) / 100;

export default function RefundCaseModal({ user, booking, group, model, refunds, onClose, onSaved }) {
  const options = useMemo(() => bookingGroupOptions(group), [group]);
  const party = bookingCounterparty(booking);
  const actor = user?.name || user?.email || '';

  // Original financial position per ticket, fetched from the ledger model —
  // never manually entered (spec §16).
  const positionByTicket = useMemo(() => {
    const account = model.accounts.get(party.key);
    const items = account ? getAccountOpenItems(account, model) : [];
    const map = new Map();
    options.tickets.forEach(({ id, booking: row }) => {
      const item = items.find((entry) => entry.open_item_id === ticketOpenItemId(row));
      map.set(id, {
        original: item ? item.original_amount : numeric(row.fare_sold),
        paymentAllocated: item ? item.payment_allocated : 0,
        creditAllocated: item ? item.credit_allocated : 0,
        outstanding: item ? item.outstanding_amount : numeric(row.fare_sold),
      });
    });
    return map;
  }, [model, options.tickets, party.key]);

  // Refund credits already granted against this booking's tickets.
  const previousCredits = useMemo(() => {
    const ticketIds = new Set(options.tickets.map((t) => t.id.toLowerCase()));
    return round2(refunds
      .filter((refund) => refund.ticket_no && ticketIds.has(String(refund.ticket_no).toLowerCase()))
      .reduce((sum, refund) => sum + numeric(refund.net_refund_credit ?? refund.eligible_refund), 0));
  }, [refunds, options.tickets]);

  const [header, setHeader] = useState({
    refund_category: 'VOLUNTARY',
    remarks: '',
    adjustment_amount: '',
    adjustment_reason: '',
    other_deduction_reason: '',
    supporting_document: null,
  });
  const [affected, setAffected] = useState({ passengers: [], tickets: [], segments: [] });
  const [lines, setLines] = useState({}); // ticket_no -> { gross_refund_amount, ...fees }
  const [error, setError] = useState('');

  const updateHeader = (key, value) => { setHeader((c) => ({ ...c, [key]: value })); setError(''); };

  const toggleAffected = (next) => {
    setAffected(next);
    setLines((current) => {
      const kept = {};
      next.tickets.forEach((ticketNo) => {
        kept[ticketNo] = current[ticketNo] || {
          gross_refund_amount: '',
          airline_cancellation_fee: '',
          flyforsure_cancellation_fee: '',
          agent_cancellation_markup: '',
          processing_fee: '',
          other_deductions: '',
        };
      });
      return kept;
    });
    setError('');
  };

  const updateLine = (ticketNo, key, value) => {
    setLines((current) => ({ ...current, [ticketNo]: { ...current[ticketNo], [key]: value } }));
    setError('');
  };

  const selectedTickets = selectedItems(options.tickets, affected.tickets);

  const lineNet = (ticketNo) => {
    const line = lines[ticketNo] || {};
    return Math.max(0, round2(
      numeric(line.gross_refund_amount)
      - LINE_FEE_FIELDS.reduce((sum, [key]) => sum + numeric(line[key]), 0),
    ));
  };

  // Case totals = sum of ticket lines, plus the case-level adjustment.
  // Recomputed per keystroke — a handful of rows, so no memoization needed.
  const sum = (key) => round2(selectedTickets.reduce((acc, { id }) => acc + numeric(lines[id]?.[key]), 0));
  const position = (key) => round2(selectedTickets.reduce((acc, { id }) => acc + (positionByTicket.get(id)?.[key] || 0), 0));
  const netBeforeAdjustment = round2(selectedTickets.reduce((acc, { id }) => acc + lineNet(id), 0));
  const net = Math.max(0, round2(netBeforeAdjustment + numeric(header.adjustment_amount)));
  const outstanding = position('outstanding');
  const offset = Math.min(net, outstanding);
  const remaining = round2(net - offset);
  const totals = {
    gross: sum('gross_refund_amount'),
    ...Object.fromEntries(LINE_FEE_FIELDS.map(([key]) => [key, sum(key)])),
    net,
    originalSell: position('original'),
    paymentAllocated: position('paymentAllocated'),
    creditAllocated: position('creditAllocated'),
    outstanding,
    offset,
    remaining,
    accountCredit: party.type === 'AGENT' ? remaining : 0,
    payoutDue: party.type === 'AGENT' ? 0 : remaining,
    balanceAfter: round2(outstanding - offset),
  };

  const validate = () => {
    if (!affected.passengers.length) return 'Select at least one affected passenger.';
    if (!selectedTickets.length) return 'Select at least one affected ticket.';
    if (!header.remarks.trim()) return 'Remarks are required.';
    for (const { id } of selectedTickets) {
      const line = lines[id] || {};
      if (line.gross_refund_amount === '' || line.gross_refund_amount === undefined) return `Enter a gross refund amount for ticket ${id}.`;
      if (numeric(line.gross_refund_amount) < 0) return `Gross refund amount for ${id} cannot be negative.`;
      if (LINE_FEE_FIELDS.some(([key]) => numeric(line[key]) < 0)) return `Fee values for ${id} cannot be negative.`;
    }
    if (numeric(header.adjustment_amount) !== 0 && !header.adjustment_reason.trim()) return 'An adjustment requires an override reason.';
    return '';
  };

  const handleCreate = () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    const today = new Date().toISOString().slice(0, 10);
    const first = selectedTickets[0];

    saveRefund({
      refund_number: nextRefundNumber(refunds),
      booking_id: booking.id,
      pnr: booking.pnr,
      ticket_no: first.id,
      passenger_name: selectedItems(options.passengers, affected.passengers)[0]?.label || booking.passenger_name || '',
      airline: booking.airline,
      sector: booking.sector,
      refund_party_type: party.type,
      refund_status: 'REQUESTED',
      refund_category: header.refund_category,
      cancel_date: today,
      status_date: today,
      currency: 'EUR',
      original_sale_amount: totals.originalSell,
      gross_refund_amount: totals.gross,
      airline_cancellation_fee: totals.airline_cancellation_fee,
      flyforsure_cancellation_fee: totals.flyforsure_cancellation_fee,
      agent_cancellation_markup: totals.agent_cancellation_markup,
      processing_fee: totals.processing_fee,
      other_deductions: totals.other_deductions,
      other_deduction_reason: header.other_deduction_reason,
      adjustment_amount: numeric(header.adjustment_amount),
      adjustment_reason: header.adjustment_reason,
      net_refund_credit: totals.net,
      supporting_document: header.supporting_document,
      affected_passengers: selectedItems(options.passengers, affected.passengers),
      affected_tickets: selectedTickets.map(({ id, label }) => ({ id, label })),
      affected_segments: selectedItems(options.segments, affected.segments),
      // Per-ticket calculation lines (spec §29): the case holds totals, the
      // lines hold ticket-wise numbers so partial-booking refunds stay exact.
      refund_lines: selectedTickets.map(({ id, label, booking: row }) => {
        const line = lines[id] || {};
        const position = positionByTicket.get(id) || {};
        return {
          ticket_no: id,
          booking_id: row.id,
          pnr: row.pnr,
          passenger_name: label,
          currency: 'EUR',
          original_sell_amount: position.original || 0,
          allocated_payment_amount: position.paymentAllocated || 0,
          outstanding_before_refund: position.outstanding || 0,
          gross_refund_amount: numeric(line.gross_refund_amount),
          airline_cancellation_fee: numeric(line.airline_cancellation_fee),
          flyforsure_cancellation_fee: numeric(line.flyforsure_cancellation_fee),
          agent_cancellation_markup: numeric(line.agent_cancellation_markup),
          processing_fee: numeric(line.processing_fee),
          other_deductions: numeric(line.other_deductions),
          net_refund_credit: lineNet(id),
        };
      }),
      // Legacy-compatible mirrors (P&L, old refund ledger).
      fare_sold: totals.originalSell,
      fare_issued: numeric(booking.fare_issued),
      airline_penalty: totals.airline_cancellation_fee,
      service_fee: totals.flyforsure_cancellation_fee,
      eligible_refund: totals.net,
      created_by: actor,
      remarks: header.remarks,
    });

    selectedTickets.forEach(({ booking: row }) => saveBooking({ ...row, refund_flag: true }));
    onSaved();
  };

  return (
    <div className="modal-backdrop allocation-backdrop">
      <div className="card modal-card modal-card-wide servicing-modal">
        <div className="allocation-modal-head">
          <div>
            <h3>Create Refund Case</h3>
            <p className="allocation-subtitle">
              {party.type} · {party.name} · PNR {booking.pnr || '-'} · Creates a case for review (REQUESTED). Only approval posts a refund credit; payout is a separate verified event.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <h4 className="servicing-section-title">Refund case header</h4>
        <div className="modal-form-grid">
          <label>
            <span>Refund Number</span>
            <input value={nextRefundNumber(refunds)} readOnly disabled />
          </label>
          <label>
            <span>Refund Party</span>
            <input value={`${party.type} · ${party.name}`} readOnly disabled />
          </label>
          <label>
            <span>Refund Category *</span>
            <select value={header.refund_category} onChange={(e) => updateHeader('refund_category', e.target.value)}>
              {CANCELLATION_CATEGORIES.filter((c) => c !== 'DUPLICATE_BOOKING').map((category) => (
                <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label>
            <span><Upload size={12} style={{ marginRight: 4 }} />Supporting Document</span>
            {header.supporting_document ? (
              <span className="attachment-name">
                {header.supporting_document.name}
                <button type="button" className="icon-button" onClick={() => updateHeader('supporting_document', null)} aria-label="Remove document"><X size={13} /></button>
              </span>
            ) : (
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => readAttachment(e, (doc) => updateHeader('supporting_document', doc))} />
            )}
          </label>
          <label className="span-2">
            <span>Remarks *</span>
            <textarea rows={2} value={header.remarks} onChange={(e) => updateHeader('remarks', e.target.value)} />
          </label>
        </div>

        <AffectedItemsPicker
          options={options}
          value={affected}
          onChange={toggleAffected}
          required={{ passengers: true, tickets: true, segments: false }}
        />

        <h4 className="servicing-section-title">Refund calculation — per ticket (input-driven)</h4>
        {selectedTickets.length === 0 ? (
          <p className="reconciliation-note">Select at least one affected ticket to enter refund amounts.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table dense-table refund-lines-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Original Sell</th>
                  <th>Paid / Allocated</th>
                  <th>Outstanding</th>
                  <th>Gross Refund *</th>
                  {LINE_FEE_FIELDS.map(([key, label]) => <th key={key}>{label}</th>)}
                  <th>Net Credit</th>
                </tr>
              </thead>
              <tbody>
                {selectedTickets.map(({ id, label }) => {
                  const position = positionByTicket.get(id) || {};
                  const line = lines[id] || {};
                  return (
                    <tr key={id}>
                      <td title={label}>{id}</td>
                      <td>{formatCurrency(position.original || 0)}</td>
                      <td>{formatCurrency((position.paymentAllocated || 0) + (position.creditAllocated || 0))}</td>
                      <td>{formatCurrency(position.outstanding || 0)}</td>
                      <td>
                        <input className="allocation-amount-input" type="number" min="0" step="0.01" placeholder="0.00"
                          value={line.gross_refund_amount ?? ''}
                          onChange={(e) => updateLine(id, 'gross_refund_amount', e.target.value)} />
                      </td>
                      {LINE_FEE_FIELDS.map(([key]) => (
                        <td key={key}>
                          <input className="allocation-amount-input" type="number" min="0" step="0.01" placeholder="0.00"
                            value={line[key] ?? ''}
                            onChange={(e) => updateLine(id, key, e.target.value)} />
                        </td>
                      ))}
                      <td><strong>{formatCurrency(lineNet(id))}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-form-grid">
          <label>
            <span>Other Deduction Reason</span>
            <input value={header.other_deduction_reason} onChange={(e) => updateHeader('other_deduction_reason', e.target.value)} />
          </label>
          <label>
            <span>Adjustment / Override (±)</span>
            <input type="number" step="0.01" value={header.adjustment_amount} onChange={(e) => updateHeader('adjustment_amount', e.target.value)} placeholder="0.00" />
          </label>
          <label className="span-2">
            <span>Override Reason {numeric(header.adjustment_amount) !== 0 ? '*' : ''}</span>
            <input value={header.adjustment_reason} onChange={(e) => updateHeader('adjustment_reason', e.target.value)} />
          </label>
        </div>

        <div className="refund-detail-grid">
          <div className="card">
            <h4>Original financial position (from ledger)</h4>
            <div className="auto-preview-list compact-preview">
              <div><span>Original sell amount</span><strong>{formatCurrency(totals.originalSell)}</strong></div>
              <div><span>Payment allocated to selected items</span><strong>{formatCurrency(totals.paymentAllocated)}</strong></div>
              <div><span>Credit already allocated</span><strong>{formatCurrency(totals.creditAllocated)}</strong></div>
              <div><span>Outstanding before refund</span><strong>{formatCurrency(totals.outstanding)}</strong></div>
              <div><span>Previous refund credits</span><strong>{formatCurrency(previousCredits)}</strong></div>
            </div>
          </div>

          <div className="card">
            <h4>Refund settlement preview</h4>
            <div className="auto-preview-list compact-preview">
              <div><span>Net refund credit</span><strong>{formatCurrency(totals.net)}</strong></div>
              <div><span>Original receivable offset</span><strong>{formatCurrency(totals.offset)}</strong></div>
              <div><span>{party.type === 'AGENT' ? 'Agent account credit' : 'Customer account credit'}</span><strong>{formatCurrency(totals.accountCredit)}</strong></div>
              <div><span>Refund payout due</span><strong>{formatCurrency(totals.payoutDue)}</strong></div>
              <div className="preview-total"><span>Remaining balance due after offset</span><strong>{formatCurrency(totals.balanceAfter)}</strong></div>
            </div>
          </div>
        </div>

        {error && <div className="allocation-warning">{error}</div>}

        <div className="form-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={handleCreate}>Create Refund Case</button>
        </div>
        <p className="reconciliation-note">
          Approve / reject and payouts live on the Refunds page. Approval posts the REFUND_CREDIT entry and auto-offsets the outstanding tickets; payouts enter the payment verification queue.
        </p>
      </div>
    </div>
  );
}
