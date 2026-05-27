import { Link } from 'react-router-dom';
import { getBookings, getPayments, getRefunds, getExpenses } from '../helpers/storage';
import { generateAlerts, getBookingLedger, getPnlAnalytics, getRefundLedger } from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { canCreateBookings, canRecordPayments, scopedFinanceData } from '../helpers/access';
import { AlertCircle, ArrowRight, CreditCard, Euro, Plane, RefreshCcw, TrendingUp, Users } from 'lucide-react';

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function getDashboardSummary(user) {
  const { bookings, payments, refunds, expenses } = scopedFinanceData(user, {
    bookings: getBookings(),
    payments: getPayments(),
    refunds: getRefunds(),
    expenses: getExpenses(),
  });
  const refundLedger = getRefundLedger(bookings, refunds);
  const pendingRefunds = refundLedger.filter((refund) => (
    refund.refund_status !== 'REFUNDED_TO_CLIENT' && refund.refund_status !== 'REJECTED'
  ));
  const totalRefunded = refundLedger
    .filter((refund) => refund.refund_status === 'REFUNDED_TO_CLIENT')
    .reduce((sum, refund) => sum + (refund.eligible_refund || 0), 0);
  const processedRefunds = refundLedger.filter((refund) => refund.refund_status === 'REFUNDED_TO_CLIENT');
  const avgDays = processedRefunds.length > 0
    ? Math.round(processedRefunds.reduce((sum, refund) => sum + (refund.processing_days || 0), 0) / processedRefunds.length)
    : 0;

  return {
    bookings: getBookingLedger(bookings, payments),
    pnl: getPnlAnalytics(bookings, payments, refunds, expenses),
    alerts: generateAlerts(bookings, payments, refunds),
    refundStats: {
      total: totalRefunded,
      pendingCount: pendingRefunds.length,
      avgDays,
      overdueCount: pendingRefunds.filter((refund) => (refund.processing_days || 0) > 30).length,
    },
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const summary = getDashboardSummary(user);
  const { bookings, pnl, alerts, refundStats } = summary;
  const allowRecordPayment = canRecordPayments(user);
  const allowBookingEntry = canCreateBookings(user);
  const outstanding = pnl.outstanding;
  const paidBookings = pnl.paidPnrs;
  const recentBookings = [...bookings].slice(-4).reverse();
  const margin = Math.round(pnl.grossMargin || 0);

  const kpis = [
    {
      label: 'Effective revenue',
      value: money.format(pnl.effectiveRevenue || 0),
      note: `${margin}% gross margin`,
      icon: TrendingUp,
      tone: 'coral',
    },
    {
      label: 'Net profit',
      value: money.format(pnl.netProfit || 0),
      note: `${money.format(pnl.totalExpenses || 0)} expenses`,
      icon: Euro,
      tone: 'green',
    },
    {
      label: 'Outstanding',
      value: money.format(outstanding),
      note: `${paidBookings} paid PNRs, ${pnl.partialPnrs} partial`,
      icon: CreditCard,
      tone: 'amber',
    },
    {
      label: 'Active alerts',
      value: alerts.length,
      note: `${refundStats.pendingCount} refunds pending`,
      icon: AlertCircle,
      tone: 'blue',
    },
  ];

  return (
    <div className="page-container fade-in">
      <section className="dashboard-hero">
        <div>
          <span className="page-kicker">Finance command center</span>
          <h1>Today&apos;s booking-to-cash picture</h1>
          <p>
            Track revenue, unsettled balances, refunds, and operating costs from one clean workspace.
          </p>
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
              <span className="page-kicker">P&L</span>
              <h3>Profit breakdown</h3>
            </div>
            <span className={pnl.netProfit >= 0 ? 'badge badge-pass' : 'badge badge-fail'}>
              {pnl.netProfit >= 0 ? 'Profitable' : 'Loss'}
            </span>
          </div>

          <div className="ledger-list">
            <div>
              <span>Sales revenue</span>
              <strong>{money.format(pnl.revenue || 0)}</strong>
            </div>
            <div>
              <span>Ticket cost</span>
              <strong>- {money.format(pnl.cogs || 0)}</strong>
            </div>
            <div>
              <span>Gross profit</span>
              <strong>{money.format(pnl.grossProfit || 0)}</strong>
            </div>
            <div>
              <span>Collections</span>
              <strong>{money.format(pnl.collections || 0)}</strong>
            </div>
            <div>
              <span>Operating expenses</span>
              <strong>- {money.format(pnl.totalExpenses || 0)}</strong>
            </div>
            <div>
              <span>Cash flow</span>
              <strong>{money.format(pnl.cashFlow || 0)}</strong>
            </div>
            <div className="ledger-total">
              <span>Net profit</span>
              <strong>{money.format(pnl.netProfit || 0)}</strong>
            </div>
          </div>
        </article>

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
                  <strong>{money.format(booking.fare_sold || 0)}</strong>
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
