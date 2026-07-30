import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { LockKeyhole, LogIn } from 'lucide-react';
import { useAuth } from '../AuthContext';
const brandLogo = '/Fly for Sure Logo no background no tagline.png';

export default function Login() {
  const [params] = useSearchParams();
  const { user, login } = useAuth();
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const temporary = useMemo(() => params.get('temporary') === '1', [params]);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img src={brandLogo} alt="FlyForSure" className="auth-logo" />
        <div>
          <span className="page-kicker">Admin dashboard</span>
          <h1>{temporary ? 'Finish your invite' : 'Sign in'}</h1>
          <p>{temporary ? 'Use the temporary password from your admin. You will change it after sign in.' : 'Use your FlyForSure dashboard account.'}</p>
        </div>
        {error && <div className="notice error"><LockKeyhole size={16} /> {error}</div>}
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </label>
        <label>
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
        </label>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          <LogIn size={17} /> {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
