import { useEffect, useState } from 'react';
import { getFixPlan, type FixPlanSet } from '../lib/api.js';
import { useI18n } from '../i18n.js';

function priorityClass(priority: string): string {
  if (priority === 'P0') return 'bad';
  if (priority === 'P1') return 'warn';
  return '';
}

export function FixPlanView({ jobId }: { jobId: string }) {
  const { t } = useI18n();
  const [planSet, setPlanSet] = useState<FixPlanSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const next = await getFixPlan(jobId);
        if (!cancelled) {
          setPlanSet(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // The clipboard can be blocked; the text stays selectable either way.
    }
  };

  return (
    <>
      <h3 className="section-title">{t.fixPlanTitle}</h3>
      <p className="meta" style={{ marginTop: -4 }}>{t.fixPlanHint}</p>

      {loading && (
        <div className="card">
          <div className="skeleton" aria-hidden="true">
            <div className="skeleton-line" style={{ width: '58%' }} />
            <div className="skeleton-line" style={{ width: '86%' }} />
          </div>
        </div>
      )}

      {error && <div className="empty">{error}</div>}

      {!loading && !error && planSet && planSet.plans.length === 0 && (
        <div className="empty">{t.fixPlanEmpty}</div>
      )}

      {!loading &&
        planSet?.plans.map((plan) => (
          <article className="card" key={plan.planId}>
            <header className="plan-head">
              <span className={`pill ${priorityClass(plan.priority)}`}>{plan.priority}</span>
              <span className="pill">{plan.estimatedEffort}</span>
              <h4>{plan.title}</h4>
            </header>

            <p style={{ margin: '8px 0' }}>{plan.why}</p>

            <div className="meta">
              {t.labelEvidence}:{' '}
              {plan.evidence.map((e) => (
                <code key={`${e.file}-${e.line}`}>
                  {e.file}
                  {e.line ? `:${e.line}` : ''}
                </code>
              ))}
            </div>

            <ol className="plan-steps">
              {plan.steps.map((step) => (
                <li key={step.order}>
                  {step.action}
                  {step.target && <span className="meta"> — {step.target}</span>}
                </li>
              ))}
            </ol>

            {plan.testsToAdd.length > 0 && (
              <div className="meta">
                {t.fixPlanTests}: {plan.testsToAdd.map((p) => <code key={p}>{p}</code>)}
              </div>
            )}

            <div className="meta" style={{ marginTop: 8 }}>{t.fixPlanAcceptance}</div>
            <ul className="plan-criteria">
              {plan.acceptanceCriteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>

            {plan.risks.length > 0 && (
              <div className="meta">
                {t.fixPlanRisks}: {plan.risks.join(' ')}
              </div>
            )}

            <details className="plan-instructions">
              <summary>{t.fixPlanInstructions}</summary>
              <pre>{plan.agentInstructions}</pre>
              <button className="secondary" onClick={() => copy(plan.agentInstructions, plan.planId)}>
                {copied === plan.planId ? t.copied : t.copyInstructions}
              </button>
            </details>
          </article>
        ))}

      {!loading && planSet && planSet.plans.length > 0 && (
        <p className="meta">
          {t.fixPlanFooter.replace('{n}', String(planSet.plans.length))}
        </p>
      )}
    </>
  );
}
