import { useState } from 'react';
import type { CreateAuditInput, Mode, Target, Language } from '../lib/api.js';
import { useI18n } from '../i18n.js';

/**
 * The first entry is the form's initial value, so it is the repository a
 * visitor's first click audits — which makes it the one default on this screen
 * that has to be a repository that exists.
 *
 * It was `okx/repopilot`, a placeholder from the initial import. No such
 * repository has ever existed, so the first click failed with a 404 on the one
 * screen whose whole job is to show what the gate does. `pinojs/pino` is a
 * real, ordinary repository this project already audits in its own
 * three-repository comparison (`screenshots/README.md`), so the demo returns a
 * realistic report rather than the one-file, 45.2/100 result that the
 * canonical `octocat/Hello-World` gives.
 */
const DEFAULT_REPO_URL = 'https://github.com/pinojs/pino';

const SAMPLE_URLS = [
  DEFAULT_REPO_URL,
  'https://github.com/ethereum/go-ethereum',
  'https://github.com/foundry-rs/foundry',
];

export function AuditForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (i: CreateAuditInput) => void }) {
  const { t } = useI18n();
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO_URL);
  const [mode, setMode] = useState<Mode>('full');
  const [target, setTarget] = useState<Target>('open_source');
  const [outputLanguage, setOutputLanguage] = useState<Language>('en');
  const [includeLaunchCopy, setIncludeLaunchCopy] = useState(true);

  const actionLabel = disabled
    ? t.actionRunning
    : mode === 'quick'
      ? t.actionRunQuick
      : t.actionRunFull;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ repoUrl, mode, target, outputLanguage, includeLaunchCopy });
      }}
    >
      <div>
        <label htmlFor="repo">{t.formRepoUrl}</label>
        <input
          id="repo"
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder={t.formRepoPlaceholder}
          required
        />
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="mode">{t.formMode}</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="quick">{t.modeQuick}</option>
            <option value="full">{t.modeFull}</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="target">{t.formTarget}</label>
          <select id="target" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            <option value="open_source">{t.targetOpenSource}</option>
            <option value="hackathon">{t.targetHackathon}</option>
            <option value="production">{t.targetProduction}</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="lang">{t.formLanguage}</label>
          <select id="lang" value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value as Language)}>
            <option value="en">{t.langEn}</option>
            <option value="zh-CN">{t.langZh}</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <label style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={includeLaunchCopy}
            onChange={(e) => setIncludeLaunchCopy(e.target.checked)}
          />{' '}
          {t.formIncludeLaunchCopy}
        </label>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button type="submit" disabled={disabled || !repoUrl}>
          {actionLabel}
        </button>
        <span className="meta">
          {t.formTry}: {SAMPLE_URLS.map((u, i) => (
            <a key={u} href="#" onClick={(e) => { e.preventDefault(); setRepoUrl(u); }}>
              {i === 0 ? ' ' : ' · '}{u.replace('https://github.com/', '')}
            </a>
          ))}
        </span>
      </div>
    </form>
  );
}
