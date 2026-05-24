export default function SettingsPage() {
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
