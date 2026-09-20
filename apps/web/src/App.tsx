import { useEffect, useState, useCallback } from 'react';
import { createAudit, getAudit, getCapabilities, getHealth, type AuditResponse, type Capabilities, type CreateAuditInput, type Health, type Report } from './lib/api.js';
import { Header } from './components/Header.js';
import { AuditForm } from './components/AuditForm.js';
import { ReportView } from './components/ReportView.js';
import { StatusBar } from './components/StatusBar.js';
import { Footer } from './components/Footer.js';
import { FixPlanView } from './components/FixPlanView.js';
import { AuditHistoryView } from './components/AuditHistoryView.js';
import { AuditDiffView } from './components/AuditDiffView.js';
import { I18nProvider, useI18n } from './i18n.js';

type View = 'report' | 'history' | 'diff';

function LoadingCard() {
  const { t } = useI18n();
  return (
    <div className="card">
      <strong>{t.loadingTitle}</strong>
      <div className="meta" style={{ marginBottom: 14 }}>{t.loadingBody}</div>
      <div className="skeleton" aria-hidden="true">
        <div className="skeleton-line" style={{ width: '72%' }} />
        <div className="skeleton-line" style={{ width: '94%' }} />
        <div className="skeleton-line" style={{ width: '88%' }} />
        <div className="skeleton-line" style={{ width: '46%' }} />
      </div>
    </div>
  );
}

function EmptyCard() {
  const { t } = useI18n();
  return (
    <div className="empty">
      <strong>{t.emptyTitle}</strong>
      <span>{t.emptyBody}</span>
    </div>
  );
}

function Shell() {
  const { t } = useI18n();
  const [health, setHealth] = useState<Health | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('report');
  const [diffBase, setDiffBase] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => undefined);
    getCapabilities().then(setCaps).catch(() => undefined);
  }, []);

  const onSubmit = useCallback(async (input: CreateAuditInput) => {
    setError(null);
    setReport(null);
    setJobId(null);
    setDiffBase(null);
    setView('report');
    setLoading(true);
    try {
      // First call (no payment) — server returns a 402 with a challenge.
      const first = await createAudit(input);
      if ('payment' in first && first.payment) {
        setJobId(first.jobId);
        setPaymentId(first.payment.paymentId);
        // In mock mode, auto-replay with X-PAYMENT to get a synchronous report.
        if (first.payment.mode === 'mock') {
          const paid = await createAudit(input, `mock:${first.payment.paymentId}`);
          if ('report' in paid && paid.report) {
            setReport(paid.report);
            setJobId(paid.jobId);
            setPaymentId(null);
          } else if ('error' in paid) {
            setError(paid.error ?? 'Audit failed');
          }
        } else {
          // OKX mode: caller must sign and replay. We expose a "Pay & re-run" button.
        }
      } else if ('report' in first && first.report) {
        setReport(first.report);
        setJobId(first.jobId);
      } else {
        setError('Unexpected response from server');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    if (!jobId) return;
    try {
      const r: AuditResponse = await getAudit(jobId);
      if ('report' in r && r.report) {
        setReport(r.report);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [jobId]);

  const onCompare = useCallback((baseJobId: string) => {
    setDiffBase(baseJobId);
    setView('diff');
  }, []);

  const showNav = Boolean(report && jobId);

  return (
    <div className="container">
      <Header health={health} caps={caps} />
      <StatusBar health={health} caps={caps} />

      <section className="hero">
        <h1>{t.heroTitle}</h1>
        <p>{t.heroSubtitle}</p>
      </section>

      <AuditForm
        disabled={loading}
        onSubmit={onSubmit}
      />

      {loading && <LoadingCard />}

      {error && (
        <div className="card error">
          <strong>{t.errorTitle}.</strong>
          <div className="meta">{error}</div>
        </div>
      )}

      {paymentId && caps?.paymentMode === 'okx' && (
        <div className="card">
          <strong>Payment required.</strong>
          <p>
            Run the OKX Agent Payments Protocol CLI to settle the payment, then click Refresh:
          </p>
          <pre>onchainos payment pay --payment-id {paymentId} --yes</pre>
          <p className="meta">After it completes, click Refresh to fetch the report.</p>
          <button className="secondary" onClick={onRefresh}>Refresh status</button>
        </div>
      )}

      {showNav && (
        <nav className="view-nav">
          <button
            className={view === 'report' ? 'ghost is-active' : 'ghost'}
            onClick={() => setView('report')}
          >
            {t.navReport}
          </button>
          <button
            className={view === 'history' ? 'ghost is-active' : 'ghost'}
            onClick={() => setView('history')}
          >
            {t.navHistory}
          </button>
          {diffBase && (
            <button
              className={view === 'diff' ? 'ghost is-active' : 'ghost'}
              onClick={() => setView('diff')}
            >
              {t.navDiff}
            </button>
          )}
        </nav>
      )}

      {report && view === 'report' && (
        <>
          <ReportView report={report} />
          {jobId && <FixPlanView jobId={jobId} />}
        </>
      )}

      {report && view === 'history' && (
        <AuditHistoryView
          owner={report.repository.owner}
          repo={report.repository.name}
          currentJobId={jobId}
          onCompare={onCompare}
        />
      )}

      {report && view === 'diff' && diffBase && jobId && (
        <>
          <button className="ghost" onClick={() => setView('history')}>
            ← {t.navHistory}
          </button>
          <AuditDiffView headJobId={jobId} baseJobId={diffBase} />
        </>
      )}

      {!report && !loading && <EmptyCard />}

      <Footer />
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
