import { useEffect, useState, useCallback } from 'react';
import { createAudit, getAudit, getCapabilities, getHealth, settleAudit, type Capabilities, type CreateAuditInput, type Health, type Report } from './lib/api.js';
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
        const challenge = first.payment;
        setJobId(first.jobId);
        setPaymentId(challenge.paymentId);
        if (challenge.mode === 'mock') {
          // Settle the challenge, then read the report. The replay is still
          // asynchronous — it answers 202 with a statusUrl — so the report
          // has to be polled for. Assuming it came back synchronously is what
          // made this button a silent no-op: neither the report branch nor
          // the error branch matched, and nothing was rendered or said.
          //
          // The replay reuses the challenge's jobId (the route finds the job
          // by paymentId), so `first.jobId` stays authoritative.
          const paid = await createAudit(input, `mock:${challenge.paymentId}`);
          setReport(await settleAudit(paid));
          setPaymentId(null);
        }
        // OKX mode: the caller must sign and replay. The payment card below
        // exposes a "Refresh status" button for that.
      } else if ('error' in first) {
        throw new Error(first.error.message);
      } else {
        setJobId(first.jobId);
        setReport(await settleAudit(first));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    if (!jobId) return;
    setError(null);
    setLoading(true);
    try {
      // Poll rather than read once: the user may click Refresh the moment the
      // payment lands, while the worker is still running.
      setReport(await settleAudit(await getAudit(jobId)));
      setPaymentId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const onCompare = useCallback((baseJobId: string) => {
    setDiffBase(baseJobId);
    setView('diff');
  }, []);

  const showNav = Boolean(report && jobId);
  /*
   * Once a report exists the page has a subject, and the subject is the
   * repository — not the pitch.
   *
   * Measured before this change, on a 9219px report page: the hero (h1, 34px)
   * and the input form occupied the first 741px, the report's own title was an
   * h2 at 20px sitting 612px below the marketing h1, and the report began at
   * 8% page depth. The copy and the form are unchanged; the form just moves
   * one click away instead of holding the top of the document.
   */
  const collapsed = showNav;

  return (
    <div className="container">
      <Header health={health} caps={caps} />
      <StatusBar health={health} caps={caps} />

      {collapsed ? (
        <details className="rerun">
          <summary>{t.rerunTitle}</summary>
          <p className="meta">{t.heroSubtitle}</p>
          <AuditForm disabled={loading} onSubmit={onSubmit} />
        </details>
      ) : (
        <>
          <section className="hero">
            <h1>{t.heroTitle}</h1>
            <p>{t.heroSubtitle}</p>
          </section>
          <AuditForm disabled={loading} onSubmit={onSubmit} />
        </>
      )}

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
