import { useMemo, useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { hasPermission } from '../helpers/permissions';
import { deleteBankAccount, getBankAccounts, saveBankAccount } from '../helpers/storage';
import { PAYMENT_CURRENCIES } from '../helpers/paymentVerification';

const EMPTY_BANK = { label: '', currency: 'EUR', account_ref: '' };

// Configurable internal bank accounts. These feed the "Received Into (Bank
// Account)" and cheque "Deposit Account" dropdowns in the payment modal.
function BankAccountsCard({ canManage }) {
  const [accounts, setAccounts] = useState(() => getBankAccounts());
  const [draft, setDraft] = useState(EMPTY_BANK);
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sorted = useMemo(
    () => [...accounts].sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''))),
    [accounts],
  );

  const refresh = () => setAccounts([...getBankAccounts()]);

  const addAccount = () => {
    if (saving) return;
    const label = draft.label.trim();
    if (!label) {
      setError('Enter a name for the bank account.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      saveBankAccount({
        label,
        currency: draft.currency,
        account_ref: draft.account_ref.trim(),
        active: true,
      });
      setDraft(EMPTY_BANK);
      refresh();
    } catch (saveError) {
      setError(saveError.message || 'Unable to add bank account.');
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (account) => {
    if (busyId) return;
    if (!window.confirm(`Delete "${account.label}"? It will no longer be selectable on new payments.`)) return;
    setBusyId(account.id);
    setError('');
    try {
      await deleteBankAccount(account.id);
      refresh();
    } catch (deleteError) {
      setError(deleteError.message || 'Unable to delete bank account.');
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h3>Bank Accounts</h3>
      <p className="settings-help">
        Internal accounts money is received into or paid from. These appear in the payment
        record dropdowns for bank transfers and cheque deposits.
      </p>

      <div className="settings-list">
        {sorted.length === 0 && (
          <div><span>No bank accounts yet</span><strong>Add one below</strong></div>
        )}
        {sorted.map((account) => (
          <div key={account.id} className="settings-bank-row">
            <div>
              <strong>{account.label}</strong>
              <span>
                {account.currency}
                {account.account_ref ? ` · ${account.account_ref}` : ''}
              </span>
            </div>
            {canManage && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => removeAccount(account)}
                disabled={busyId === account.id}
                title="Delete bank account"
              >
                {busyId === account.id ? <Loader2 size={14} /> : <Trash2 size={14} />}
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <>
          <div className="booking-form-grid" style={{ marginTop: '12px' }}>
            <label>
              <span>Account Name</span>
              <input
                value={draft.label}
                placeholder="e.g. Revolut EUR"
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label>
              <span>Currency</span>
              <select
                value={draft.currency}
                onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))}
              >
                {PAYMENT_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label className="span-2">
              <span>Account Number / IBAN (optional)</span>
              <input
                value={draft.account_ref}
                placeholder="IT60 X054 2811 1010 0000 0123 456"
                onChange={(event) => setDraft((current) => ({ ...current, account_ref: event.target.value }))}
              />
            </label>
          </div>
          {error && <p className="settings-help" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>}
          <div className="form-actions" style={{ marginTop: '10px' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={addAccount} disabled={saving}>
              {saving ? <Loader2 size={14} /> : <Plus size={14} />}
              Add Bank Account
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const canManageBanks = user?.role === 'ADMIN'
    || hasPermission(user, 'configure_settings')
    || hasPermission(user, 'edit_financials');

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Configure application preferences for finance operations.</p>
        </div>
      </header>

      <div className="grid-2">
        <div className="card">
          <h3>Application Preferences</h3>
          <div className="booking-form-grid">
            <label>
              <span>Default Currency</span>
              <select defaultValue="EUR">
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
              </select>
            </label>
            <label>
              <span>Alert Threshold</span>
              <input type="number" defaultValue={14} min={1} />
            </label>
          </div>
          <p className="settings-help">
            Number of days before departure to trigger a follow-up alert for unpaid balances.
          </p>
        </div>

        <BankAccountsCard canManage={canManageBanks} />

        <div className="card">
          <h3>Security Boundary</h3>
          <div className="settings-list">
            <div>
              <span>User management</span>
              <strong>Moved to Users</strong>
            </div>
            <div>
              <span>Authentication</span>
              <strong>Supabase via BFF</strong>
            </div>
            <div>
              <span>Session transport</span>
              <strong>HTTP-only cookie</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
