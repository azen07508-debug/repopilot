import { useEffect, useState } from 'react';
import { getAuditDiff, type AuditDiff } from '../lib/api.js';
import { useI18n } from '../i18n.js';

/**
 * Score movement is coloured the way a Chinese reader expects: a rise is
 * red, a fall is green. Note this is the opposite of the --ok / --bad
 * status colours, so the delta classes use their own tokens.
 */
function deltaClass(n: number): string {
  if (n > 0) return 'delta-up';
  if (n < 0) return 'delta-down';
  return 'delta-flat';
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function shortSha(sha: string | null): string {
  if (!sha) return 'unknown';
  return sha.slice(0, 7);
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
}

export function AuditDiffView({ headJobId, baseJobId }: { headJobId: string; baseJobId: string }) {
  const { t } = useI18n();
  const [diff, setDiff] = useState<AuditDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const next = await getAuditDiff(headJobId, baseJobId);
        if (!cancelled) {
          setDiff(next);
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
  }, [headJobId, baseJobId]);

  if (loading) {
    return (
      <div className="card">
        <div className="skeleton" aria-hidden="true">
          <div className="skeleton-line" style={{ width: '40%' }} />
          <div className="skeleton-line" style={{ width: '78%' }} />
        </div>
      </div>
    );
  }

  if (error) return <div className="empty">{error}</div>;
  if (!diff) return null;

  const verdictLabel =
    diff.verdict === 'improved'
      ? t.verdictImproved
      : diff.verdict === 'regressed'
        ? t.verdictRegressed
        : t.verdictUnchanged;

  const dimensions: { key: keyof typeof diff.dimensionDeltas; label: string }[] = [
    { key: 'documentation', label: t.scoreDocumentation },
    { key: 'reproducibility', label: t.scoreReproducibility },
    { key: 'securityHygiene', label: t.scoreSecurity },
    { key: 'deploymentReadiness', label: t.scoreDeployment },
  ];

  return (
    <section>
      <div className="card elevated">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="meta">{t.diffTitle}</div>
            <div style={{ fontSize: 18, fontWeight: 650, marginTop: 2 }}>{verdictLabel}</div>
            <div className="meta" style={{ marginTop: 6 }}>
              {shortSha(diff.base.commitSha)} → {shortSha(diff.head.commitSha)}
            </div>
            <div className="meta">
              {when(diff.base.generatedAt)} → {when(diff.head.generatedAt)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={`score ${deltaClass(diff.scoreDelta)}`}>{signed(diff.scoreDelta)}</div>
            <div className="meta">
              {diff.base.overall} → {diff.head.overall}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>{t.diffDimensions}</h3>
        {dimensions.map((d) => (
          <div className="subscore" key={d.key}>
            <span>{d.label}</span>
            <span className={`delta-value ${deltaClass(diff.dimensionDeltas[d.key])}`}>
              {signed(diff.dimensionDeltas[d.key])}
            </span>
          </div>
        ))}
      </div>

      <h3 className="section-title">{t.diffRules}</h3>
      {diff.ruleDeltas.length === 0 ? (
        <div className="empty">{t.diffRulesEmpty}</div>
      ) : (
        <div className="card tight">
          <table className="diff-table">
            <thead>
              <tr>
                <th>{t.diffRule}</th>
                <th>{t.diffBefore}</th>
                <th>{t.diffAfter}</th>
                <th>{t.diffChange}</th>
              </tr>
            </thead>
            <tbody>
              {diff.ruleDeltas.map((r) => (
                <tr key={`${r.dimension}-${r.rule}`}>
                  <td>
                    <code>{r.rule}</code>
                    <div className="meta">{r.reason}</div>
                  </td>
                  <td className="num">{r.before}</td>
                  <td className="num">{r.after}</td>
                  <td className={`num delta-value ${deltaClass(r.delta)}`}>{signed(r.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">{t.diffFindings}</h3>
      <div className="card">
        <div className="diff-group">
          <div className="meta">{t.diffResolved}</div>
          {diff.resolved.length === 0 ? (
            <span className="meta">—</span>
          ) : (
            <ul className="plan-criteria">{diff.resolved.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
          )}
        </div>
        <div className="diff-group">
          <div className="meta">{t.diffNew}</div>
          {diff.new.length === 0 ? (
            <span className="meta">—</span>
          ) : (
            <ul className="plan-criteria">{diff.new.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
          )}
        </div>
        <div className="diff-group">
          <div className="meta">{t.diffPersistent}</div>
          {diff.persistent.length === 0 ? (
            <span className="meta">—</span>
          ) : (
            <ul className="plan-criteria">{diff.persistent.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
          )}
        </div>
        {/*
          A moved finding has a different fingerprint before and after, so
          `resolved` and `new` both list it — the schema says so, and says
          the consumer subtracts. This view cannot: the fingerprints are
          opaque, and `moved` carries no fingerprints to subtract with.
          Without this group the panel reads "1 resolved, 1 new" on a diff
          whose verdict is "unchanged", which looks like two events and is
          one. Showing the annotation is what reconciles them.
        */}
        <div className="diff-group">
          <div className="meta">{t.diffMoved}</div>
          {diff.moved.length === 0 ? (
            <span className="meta">—</span>
          ) : (
            <>
              <ul className="plan-criteria">
                {diff.moved.map((m, i) => (
                  <li key={`${i}-${m.ruleId}-${m.file}-${m.fromLine}`}>
                    <code>{m.ruleId}</code>{' '}
                    <span className="meta">
                      {m.file}:{m.fromLine ?? '—'} → {m.toLine ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="meta">{t.diffMovedHint}</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
