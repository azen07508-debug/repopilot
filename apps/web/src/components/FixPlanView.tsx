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
      <h3 className="section-title section-title--standalone">{t.fixPlanTitle}</h3>
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

      {/*
        The plans are ONE list, not twelve panels.

        Measured before this change: the fix plan ran 4384px — 47.6% of a
        9219px report page — as twelve `article.card` elements whose only two
        distinct heights were 343px and 368px. Twelve identically-chromed cards
        read as twelve unrelated objects, so the section that *is* the product
        was also the least scannable. As a list with a priority rail the twelve
        become one object with a readable gradient.
      */}
      {!loading && planSet && planSet.plans.length > 0 && (
        <ol className="plan-list">
          {planSet.plans.map((plan) => (
            <li className="plan-item" key={plan.planId} data-priority={plan.priority}>
              <header className="plan-head">
                <span className={`plan-priority ${priorityClass(plan.priority)}`}>{plan.priority}</span>
                <h4>{plan.title}</h4>
                <span className="pill plan-effort">{plan.estimatedEffort}</span>
              </header>

              <p className="plan-why">{plan.why}</p>

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

              <div className="meta plan-acceptance-label">{t.fixPlanAcceptance}</div>
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
            </li>
          ))}
        </ol>
      )}

      {!loading && planSet && planSet.plans.length > 0 && (
        <p className="meta">
          {t.fixPlanFooter.replace('{n}', String(planSet.plans.length))}
        </p>
      )}
    </>
  );
}
