import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../helpers/api';
import { useAuth } from '../AuthContext';

export default function ChangePassword() {
  const { refresh, logout, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.changePassword(password);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-icon"><KeyRound size={24} /></div>
        <div>
          <span className="page-kicker">Password required</span>
          <h1>Set a new password</h1>
          <p>{user?.email} must replace the temporary password before opening the dashboard.</p>
        </div>
        {error && <div className="notice error">{error}</div>}
        <label>
          <span>New password</span>
          <input type="password" value={password} minLength={10} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" />
        </label>
        <label>
          <span>Confirm password</span>
          <input type="password" value={confirm} minLength={10} onChange={(event) => setConfirm(event.target.value)} required autoComplete="new-password" />
        </label>
        <div className="form-actions split">
          <button className="btn btn-secondary" type="button" onClick={logout}>Log out</button>
          <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save password'}</button>
        </div>
      </form>
    </div>
  );
}
