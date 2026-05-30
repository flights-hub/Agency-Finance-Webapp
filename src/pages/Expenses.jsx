import { useMemo, useState } from 'react';
import { getExpenses, saveExpense } from '../helpers/storage';
import { BRANCH_OFFICES, EXPENSE_CATEGORIES, getExpenseLedger, monthLabel, PAYMENT_MODES } from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { canExport, filterRecordsForUser } from '../helpers/access';
import { hasPermission } from '../helpers/permissions';
import { ArrowUpDown, Download, Plus, Search, SlidersHorizontal } from 'lucide-react';

const EXPENSE_COLUMNS = [
  ['sl', 'SL'],
  ['expense_date', 'Expense Date'],
  ['category', 'Category'],
  ['description', 'Description'],
  ['vendor_payee', 'Vendor/Payee'],
  ['amount_eur', 'Amount EUR'],
  ['payment_mode', 'Payment Mode'],
  ['receipt_ref', 'Receipt Ref'],
  ['branch_office', 'Branch Office'],
  ['recurring', 'Recurring'],
  ['month', 'Month'],
  ['remarks', 'Remarks'],
];

function money(value) {
  return `EUR ${Number(value || 0).toLocaleString()}`;
}

export default function Expenses() {
  const { user } = useAuth();
  const allowEditExpenses = user?.role === 'ADMIN' || hasPermission(user, 'edit_financials');
  const allowExport = canExport(user);
  const [expenses, setExpenses] = useState(() => getExpenses());
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(EXPENSE_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('expense_date');
  const [sortDir, setSortDir] = useState('asc');
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    category: 'RENT',
    description: '',
    vendor_payee: '',
    amount_eur: '',
    payment_mode: 'BANK_TRANSFER',
    receipt_ref: '',
    branch_office: 'ROME_HQ',
    recurring: false,
    remarks: '',
  });

  const scopedExpenses = useMemo(() => filterRecordsForUser(user, expenses, 'expenses'), [expenses, user]);
  const expenseLedger = useMemo(() => getExpenseLedger(scopedExpenses), [scopedExpenses]);
  const activeColumns = useMemo(
    () => EXPENSE_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );
  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return expenseLedger
      .filter((expense) => {
        const matchesQuery = !query || ['description', 'vendor_payee', 'receipt_ref', 'remarks', 'month']
          .some((key) => String(expense[key] || '').toLowerCase().includes(query));
        return matchesQuery
          && (!categoryFilter || expense.category === categoryFilter)
          && (!branchFilter || expense.branch_office === branchFilter);
      })
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const result = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [branchFilter, categoryFilter, expenseLedger, search, sortDir, sortKey]);
  const fixedTotal = expenseLedger.filter((expense) => expense.recurring).reduce((sum, expense) => sum + Number(expense.amount_eur || 0), 0);
  const variableTotal = expenseLedger.filter((expense) => !expense.recurring).reduce((sum, expense) => sum + Number(expense.amount_eur || 0), 0);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderValue = (expense, key) => {
    if (key === 'amount_eur') return money(expense.amount_eur);
    if (key === 'recurring') return expense.recurring ? 'YES' : 'NO';
    return String(expense[key] || '').replace(/_/g, ' ');
  };

  const exportCSV = () => {
    if (!allowExport) return;
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredExpenses.map((expense) => activeColumns.map(([key]) => renderValue(expense, key)));
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    if (!allowEditExpenses) return;
    if (!form.description || !form.amount_eur) {
      alert('Description and amount are required.');
      return;
    }

    saveExpense({
      ...form,
      amount_eur: Number(form.amount_eur),
      amount: Number(form.amount_eur),
      month: monthLabel(form.expense_date),
    });
    setExpenses(getExpenses());
    setForm({
      expense_date: new Date().toISOString().split('T')[0],
      category: 'RENT',
      description: '',
      vendor_payee: '',
      amount_eur: '',
      payment_mode: 'BANK_TRANSFER',
      receipt_ref: '',
      branch_office: 'ROME_HQ',
      recurring: false,
      remarks: '',
    });
    setShowModal(false);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Expenses</h1>
          <p>Storefront-style expense tracker with branch, recurring, month, and EUR rollups.</p>
        </div>
        {allowEditExpenses && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Add Expense
          </button>
        )}
      </header>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Total Expenses</p><h3 className="stat-value">{money(fixedTotal + variableTotal)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Fixed / Recurring</p><h3 className="stat-value">{money(fixedTotal)}</h3></div></div>
        <div className="card stat-card"><div className="stat-content"><p className="stat-label">Variable</p><h3 className="stat-value">{money(variableTotal)}</h3></div></div>
      </div>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, vendor, receipt, remarks..." />
            </div>
          </label>
          <label>
            <span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label>
            <span>Branch</span>
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              <option value="">All branches</option>
              {BRANCH_OFFICES.map((branch) => <option key={branch} value={branch}>{branch.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <div className="booking-table-actions">
          <div className="table-meta">
            <span><strong>{filteredExpenses.length}</strong> of <strong>{expenseLedger.length}</strong> expenses</span>
            <span>{activeColumns.length} visible columns</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setSearch(''); setCategoryFilter(''); setBranchFilter(''); }}>Reset</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowColumns((value) => !value)}>
              <SlidersHorizontal size={15} /> Columns
            </button>
            {allowExport && (
              <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
                <Download size={15} /> Export
              </button>
            )}
          </div>
        </div>
        {showColumns && (
          <div className="column-panel">
            {EXPENSE_COLUMNS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table dense-table expense-ledger-table">
            <thead>
              <tr>{activeColumns.map(([key, label]) => (
                <th key={key}>
                  <button type="button" onClick={() => handleSort(key)}>
                    {label}
                    <ArrowUpDown size={13} />
                  </button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {filteredExpenses.map((expense) => (
                <tr key={expense.id}>
                  {activeColumns.map(([key]) => (
                    <td key={key}>{renderValue(expense, key)}</td>
                  ))}
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length}>No expenses recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card modal-card" style={{ width: '640px' }}>
            <h3>Add Expense</h3>
            <div className="modal-form-grid">
              <label>
                <span>Expense Date</span>
                <input type="date" value={form.expense_date} onChange={(event) => updateForm('expense_date', event.target.value)} />
              </label>
              <label>
                <span>Category</span>
                <select value={form.category} onChange={(event) => updateForm('category', event.target.value)}>
                  {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Description</span>
                <input value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
              </label>
              <label>
                <span>Vendor/Payee</span>
                <input value={form.vendor_payee} onChange={(event) => updateForm('vendor_payee', event.target.value)} />
              </label>
              <label>
                <span>Amount EUR</span>
                <input type="number" value={form.amount_eur} onChange={(event) => updateForm('amount_eur', event.target.value)} />
              </label>
              <label>
                <span>Payment Mode</span>
                <select value={form.payment_mode} onChange={(event) => updateForm('payment_mode', event.target.value)}>
                  {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Receipt Ref</span>
                <input value={form.receipt_ref} onChange={(event) => updateForm('receipt_ref', event.target.value)} />
              </label>
              <label>
                <span>Branch Office</span>
                <select value={form.branch_office} onChange={(event) => updateForm('branch_office', event.target.value)}>
                  {BRANCH_OFFICES.map((branch) => <option key={branch} value={branch}>{branch.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <label>
                <span>Recurring</span>
                <input type="checkbox" checked={form.recurring} onChange={(event) => updateForm('recurring', event.target.checked)} />
              </label>
              <label>
                <span>Month</span>
                <input value={monthLabel(form.expense_date)} readOnly />
              </label>
              <label className="span-2">
                <span>Remarks</span>
                <input value={form.remarks} onChange={(event) => updateForm('remarks', event.target.value)} />
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Expense</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
