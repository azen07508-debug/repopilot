import { useEffect, useState, useCallback } from 'react';
import { createAudit, getAudit, getCapabilities, getHealth, type AuditResponse, type Capabilities, type CreateAuditInput, type Health, type Report } from './lib/api.js';
import { Header } from './components/Header.js';
import { AuditForm } from './components/AuditForm.js';
import { ReportView } from './components/ReportView.js';
import { StatusBar } from './components/StatusBar.js';
import { Footer } from './components/Footer.js';

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => undefined);
    getCapabilities().then(setCaps).catch(() => undefined);
  }, []);

  const onSubmit = useCallback(async (input: CreateAuditInput) => {
    setError(null);
    setReport(null);
    setJobId(null);
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

  return (
    <div className="container">
      <Header health={health} caps={caps} />
      <StatusBar health={health} caps={caps} />

      <section className="hero">
        <h1>RepoPilot</h1>
        <p>
          One GitHub URL. A launch-readiness report with documented evidence,
          prioritized blockers and acceptance criteria. Static analysis only —
          your repository code is never executed.
        </p>
      </section>

      <AuditForm
        disabled={loading}
        onSubmit={onSubmit}
      />

      {error && (
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          <strong>Something went wrong.</strong>
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
          <button onClick={onRefresh}>Refresh status</button>
        </div>
      )}

      {report && <ReportView report={report} />}

      <Footer />
    </div>
  );
}
