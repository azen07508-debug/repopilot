import type { Report, Finding } from '../lib/api.js';

function severityClass(s: Finding['severity']) {
  return `finding ${s}`;
}

function scoreClass(n: number) {
  if (n >= 80) return 'ok';
  if (n >= 50) return 'warn';
  return 'bad';
}

export function ReportView({ report }: { report: Report }) {
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
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>{report.repository.name}</h2>
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
            <div className="meta">overall / 100</div>
            <button className="secondary" style={{ marginTop: 8 }} onClick={downloadJson}>Download JSON</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Summary</h3>
        <p style={{ marginBottom: 0 }}>{report.summary}</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Scores</h3>
        <div className="subscore">
          <span>Documentation</span>
          <span className={`pill ${scoreClass(report.scores.documentation)}`}>{report.scores.documentation}</span>
        </div>
        <div className="subscore">
          <span>Reproducibility</span>
          <span className={`pill ${scoreClass(report.scores.reproducibility)}`}>{report.scores.reproducibility}</span>
        </div>
        <div className="subscore">
          <span>Security hygiene</span>
          <span className={`pill ${scoreClass(report.scores.securityHygiene)}`}>{report.scores.securityHygiene}</span>
        </div>
        <div className="subscore">
          <span>Deployment readiness</span>
          <span className={`pill ${scoreClass(report.scores.deploymentReadiness)}`}>{report.scores.deploymentReadiness}</span>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Detected stack</h3>
        {report.detectedStack.length === 0 ? (
          <div className="meta">No specific stack detected.</div>
        ) : (
          <div className="row">
            {report.detectedStack.map((s) => <span key={s} className="pill">{s}</span>)}
          </div>
        )}
      </div>

      <h3 className="section-title">Blockers</h3>
      {report.blockers.length === 0 ? (
        <div className="card">No critical or high-severity blockers detected.</div>
      ) : (
        <ul className="findings">
          {report.blockers.map((f) => (
            <li key={f.id} className={severityClass(f.severity)}>
              <h4>[{f.severity}] {f.title}</h4>
              <div>{f.description}</div>
              <div className="meta">Evidence: {f.evidence.map((e) => <code key={`${e.file}-${e.line}`}>{e.file}{e.line ? `:${e.line}` : ''}</code>).reduce((a, b) => <>{a} {b}</>, <></>)}</div>
              <div className="meta">Recommended: {f.recommendedAction}</div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">Documentation gaps</h3>
      {report.documentationGaps.length === 0 ? (
        <div className="card">All baseline documentation is present.</div>
      ) : (
        <ul className="findings">
          {report.documentationGaps.map((f) => (
            <li key={f.id} className={severityClass(f.severity)}>
              <h4>[{f.severity}] {f.title}</h4>
              <div>{f.description}</div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">Security findings</h3>
      {report.securityFindings.length === 0 ? (
        <div className="card">No secrets or prompt-injection patterns detected.</div>
      ) : (
        <ul className="findings">
          {report.securityFindings.map((f) => (
            <li key={f.id} className={severityClass(f.severity)}>
              <h4>[{f.severity}] {f.title}</h4>
              <div>{f.description}</div>
              <div className="meta">Evidence: {f.evidence.map((e) => <code key={`${e.file}-${e.line}`}>{e.file}{e.line ? `:${e.line}` : ''}</code>).reduce((a, b) => <>{a} {b}</>, <></>)}</div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="section-title">Launch checklist</h3>
      <ul className="findings">
        {report.launchChecklist.map((c) => (
          <li key={c.id} className={`finding ${c.done ? 'low' : 'high'}`}>
            <h4>{c.done ? '✅' : '⬜'} {c.title}</h4>
            {c.evidence.length > 0 && <div className="meta">{c.evidence.join('; ')}</div>}
          </li>
        ))}
      </ul>

      {report.launchCopy.oneSentencePitch && (
        <>
          <h3 className="section-title">Launch copy</h3>
          <div className="card">
            <div><strong>One-sentence pitch:</strong> {report.launchCopy.oneSentencePitch}</div>
            <div style={{ marginTop: 8 }}><strong>Short description:</strong> {report.launchCopy.shortDescription}</div>
            <div style={{ marginTop: 8 }}><strong>X post:</strong> {report.launchCopy.xPost}</div>
          </div>
        </>
      )}

      {report.limitations.length > 0 && (
        <>
          <h3 className="section-title">Limitations</h3>
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
