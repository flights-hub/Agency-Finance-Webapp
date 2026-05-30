import { Link } from 'react-router-dom';
import { getBookings, getPayments, getRefunds, getExpenses } from '../helpers/storage';
import { getRoleDashboardSummary } from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { canCreateBookings, canRecordPayments, scopedFinanceData } from '../helpers/access';
import { AlertCircle, ArrowRight, CreditCard, Euro, Plane, RefreshCcw, TrendingUp, Users } from 'lucide-react';

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function getDashboardSummary(user) {
  const scopedData = scopedFinanceData(user, {
    bookings: getBookings(),
    payments: getPayments(),
    refunds: getRefunds(),
    expenses: getExpenses(),
  });
  return getRoleDashboardSummary(user, scopedData);
}

export default function Dashboard() {
  const { user } = useAuth();
  const summary = getDashboardSummary(user);
  const { bookings, refundStats } = summary;
  const allowRecordPayment = canRecordPayments(user);
  const allowBookingEntry = canCreateBookings(user);
  const recentBookings = [...bookings].slice(-4).reverse();
  const icons = [TrendingUp, Euro, CreditCard, AlertCircle];

  const kpis = summary.kpis.map(([label, value, note], index) => ({
    label,
    value: typeof value === 'number' && label !== 'Active alerts' && !label.toLowerCase().includes('bookings')
      ? money.format(value)
      : value,
    note,
    icon: icons[index] || TrendingUp,
    tone: ['coral', 'green', 'amber', 'blue'][index] || 'blue',
  }));

  const formatDetailValue = (value) => (
    typeof value === 'number' ? money.format(Math.abs(value)) : value
  );

  return (
    <div className="page-container fade-in">
      <section className="dashboard-hero">
        <div>
          <span className="page-kicker">{summary.kicker}</span>
          <h1>{summary.title}</h1>
          <p>{summary.description}</p>
        </div>
        <div className="hero-actions">
          {allowRecordPayment && (
            <Link className="btn btn-secondary" to="/payments">
              <CreditCard size={16} />
              Record payment
            </Link>
          )}
          {allowBookingEntry && (
            <Link className="btn btn-primary" to="/bookings">
              <Plane size={16} />
              New booking
            </Link>
          )}
        </div>
      </section>

      <section className="grid-4 metric-grid">
        {kpis.map((item) => (
          <article className="card stat-card" key={item.label}>
            <div className={`stat-icon tone-${item.tone}`}>
              <item.icon size={22} />
            </div>
            <div className="stat-content">
              <p className="stat-label">{item.label}</p>
              <h3 className="stat-value">{item.value}</h3>
              <span className="stat-note">{item.note}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="card pnl-card">
          <div className="card-head">
            <div>
              <span className="page-kicker">{summary.detailsKicker}</span>
              <h3>{summary.detailsTitle}</h3>
            </div>
            <span className="badge badge-pass">{summary.roleView}</span>
          </div>

          <div className="ledger-list">
            {summary.details.map(([label, value], index) => (
              <div className={index === summary.details.length - 1 ? 'ledger-total' : ''} key={label}>
                <span>{label}</span>
                <strong>{typeof value === 'number' && value < 0 ? '- ' : ''}{formatDetailValue(value)}</strong>
              </div>
            ))}
          </div>
        </article>

        {summary.showRefundPanel && (
          <article className="card">
            <div className="card-head">
              <div>
                <span className="page-kicker">Refund desk</span>
                <h3>Processing health</h3>
              </div>
              <RefreshCcw size={20} />
            </div>

            <div className="refund-panel">
              <div>
                <span>Total issued</span>
                <strong>{money.format(refundStats.total)}</strong>
              </div>
              <div>
                <span>Pending</span>
                <strong>{refundStats.pendingCount}</strong>
              </div>
              <div>
                <span>Average time</span>
                <strong>{refundStats.avgDays} days</strong>
              </div>
              <div className={refundStats.overdueCount > 0 ? 'refund-risk' : ''}>
                <span>Overdue</span>
                <strong>{refundStats.overdueCount}</strong>
              </div>
            </div>

            <Link className="text-link" to="/refunds">
              Review refund queue
              <ArrowRight size={15} />
            </Link>
          </article>
        )}

        <article className="card recent-card">
          <div className="card-head">
            <div>
              <span className="page-kicker">Recent tickets</span>
              <h3>Latest bookings</h3>
            </div>
            <Users size={20} />
          </div>

          <div className="booking-feed">
            {recentBookings.map((booking) => (
              <div className="booking-feed-row" key={booking.id}>
                <div>
                  <strong>{booking.pnr}</strong>
                  <span>{booking.passenger_name}</span>
                </div>
                <div>
                  <span>{booking.sector || booking.airline}</span>
                  <strong>{money.format(booking[summary.valueKey] || 0)}</strong>
                </div>
                <span className={`badge ${String(booking.payment_status || 'settled').toLowerCase()}`}>
                  {String(booking.payment_status || 'Passenger row').replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
