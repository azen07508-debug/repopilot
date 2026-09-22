import type { Report, Finding } from '../lib/api.js';
import { useI18n } from '../i18n.js';

function severityClass(s: Finding['severity']) {
  return `finding ${s}`;
}

function scoreClass(n: number) {
  if (n >= 80) return 'ok';
  if (n >= 50) return 'warn';
  return 'bad';
}

function EvidenceList({ evidence }: { evidence: Finding['evidence'] }) {
  return (
    <>
      {evidence.map((e) => (
        <code key={`${e.file}-${e.line}`}>{e.file}{e.line ? `:${e.line}` : ''}</code>
      ))}
    </>
  );
}

export function ReportView({ report }: { report: Report }) {
  const { t } = useI18n();

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repopilot-${report.repository.owner}-${report.repository.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="card elevated">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, letterSpacing: '-0.01em' }}>{report.repository.name}</h2>
            <div className="meta">
              <a href={report.repository.url} target="_blank" rel="noreferrer">{report.repository.url}</a>
              {report.repository.license && <> · {report.repository.license}</>}
              {report.repository.primaryLanguage && <> · {report.repository.primaryLanguage}</>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="score">
              <span className={`pill ${scoreClass(report.scores.overall)}`}>{report.scores.overall}</span>
            </div>
            <div className="meta">{t.reportOverall}</div>
            <button className="secondary" style={{ marginTop: 10 }} onClick={downloadJson}>{t.reportDownload}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>{t.reportSummary}</h3>
        <p style={{ margin: 0 }}>{report.summary}</p>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>{t.reportScores}</h3>
        <div className="subscore">
          <span>{t.scoreDocumentation}</span>
          <span className={`pill ${scoreClass(report.scores.documentation)}`}>{report.scores.documentation}</span>
        </div>
        <div className="subscore">
          <span>{t.scoreReproducibility}</span>
          <span className={`pill ${scoreClass(report.scores.reproducibility)}`}>{report.scores.reproducibility}</span>
        </div>
        <div className="subscore">
          <span>{t.scoreSecurity}</span>
          <span className={`pill ${scoreClass(report.scores.securityHygiene)}`}>{report.scores.securityHygiene}</span>
        </div>
        <div className="subscore">
          <span>{t.scoreDeployment}</span>
          <span className={`pill ${scoreClass(report.scores.deploymentReadiness)}`}>{report.scores.deploymentReadiness}</span>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>{t.reportStack}</h3>
        {report.detectedStack.length === 0 ? (
          <div className="meta">{t.reportStackEmpty}</div>
        ) : (
          <div className="row">
            {report.detectedStack.map((s) => <span key={s} className="pill">{s}</span>)}
          </div>
        )}
      </div>

      <h3 className="section-title">{t.reportBlockers}</h3>
      {report.blockers.length === 0 ? (
        <div className="empty">{t.reportBlockersEmpty}</div>
      ) : (
        <ul className="findings">
          {report.blockers.map((f) => (
            <li key={f.id} className={severityClass(f.severity)}>
              <h4>{f.title}</h4>
              <div><span className="pill">{f.severity}</span></div>
              <div style={{ marginTop: 6 }}>{f.description}</div>
              <div className="meta">{t.labelEvidence}: <EvidenceList evidence={f.evidence} /></div>
              <div className="meta">{t.labelRecommended}: {f.recommendedAction}</div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">{t.reportDocGaps}</h3>
      {report.documentationGaps.length === 0 ? (
        <div className="empty">{t.reportDocGapsEmpty}</div>
      ) : (
        <ul className="findings">
          {report.documentationGaps.map((f) => (
            <li key={f.id} className={severityClass(f.severity)}>
              <h4>{f.title}</h4>
              <div>{f.description}</div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">{t.reportSecurity}</h3>
      {report.securityFindings.length === 0 ? (
        <div className="empty">{t.reportSecurityEmpty}</div>
      ) : (
        <ul className="findings">
          {report.securityFindings.map((f) => (
            <li key={f.id} className={severityClass(f.severity)}>
              <h4>{f.title}</h4>
              <div style={{ marginTop: 6 }}>{f.description}</div>
              <div className="meta">{t.labelEvidence}: <EvidenceList evidence={f.evidence} /></div>
            </li>
          ))}
        </ul>
      )}

      {/*
        Fixture findings, collapsed and grouped.

        Collapsed because they are real but do not gate a release, and
        the report has to stay readable: one real scan produced 542 of
        them. Grouped by file and rule because 542 rows is a wall, and a
        wall is the same as nothing — the grouping is done in core and
        arrives as `fixtureSummary`.

        No empty state. The security section above already makes the
        absence claim, and a section whose only content is "nothing here"
        is noise.
      */}
      {report.fixtureFindings.length > 0 && (
        <details className="fixture-section">
          <summary>
            {t.reportFixtures} ·{' '}
            {t.reportFixturesSummary.replace('{n}', String(report.fixtureFindings.length))}
          </summary>
          <p className="meta" style={{ margin: '10px 0 0' }}>{t.reportFixturesHint}</p>
          {report.fixtureSummary.length > 0 ? (
            <ul className="findings">
              {report.fixtureSummary.map((g) => (
                <li key={`${g.file}-${g.ruleId}`} className={`finding ${g.severity}`}>
                  <h4>
                    {g.title} <span className="pill">{g.count}×</span>
                  </h4>
                  <div className="meta">
                    <code>{g.file}</code>
                    {g.lines.length > 0 && <span className="mono">:{g.lines.join(', ')}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            // A report stored before the summary existed. Reading the
            // raw list is worse than reading the groups, but hiding it
            // would be worse than either: the whole point of this
            // section is that these findings are deprioritised, not
            // dropped.
            <ul className="findings">
              {report.fixtureFindings.map((f) => (
                <li key={`${f.evidence[0]?.file}-${f.id}`} className={severityClass(f.severity)}>
                  <h4>{f.title}</h4>
                  <div className="meta"><EvidenceList evidence={f.evidence} /></div>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      <h3 className="section-title">{t.reportChecklist}</h3>
      <ul className="findings">
        {report.launchChecklist.map((c) => (
          <li key={c.id} className={`finding ${c.done ? 'low' : 'high'}`}>
            <h4>
              <span
                className="checkmark"
                data-state={c.done ? 'done' : 'pending'}
                aria-label={c.done ? t.stateDone : t.statePending}
              />
              {c.title}
            </h4>
            {c.evidence.length > 0 && <div className="meta">{c.evidence.join('; ')}</div>}
          </li>
        ))}
      </ul>

      {report.launchCopy.oneSentencePitch && (
        <>
          <h3 className="section-title">{t.reportLaunchCopy}</h3>
          <div className="card">
            <div><strong>{t.copyOneSentence}:</strong> {report.launchCopy.oneSentencePitch}</div>
            <div style={{ marginTop: 8 }}><strong>{t.copyShort}:</strong> {report.launchCopy.shortDescription}</div>
            <div style={{ marginTop: 8 }}><strong>{t.copyXPost}:</strong> {report.launchCopy.xPost}</div>
          </div>
        </>
      )}

      {report.limitations.length > 0 && (
        <>
          <h3 className="section-title">{t.reportLimitations}</h3>
          <ul className="findings">
            {report.limitations.map((l, i) => (
              <li key={i} className="finding low">
                <div>{l}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
