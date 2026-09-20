import { useState } from 'react';
import type { CreateAuditInput, Mode, Target, Language } from '../lib/api.js';
import { useI18n } from '../i18n.js';

const SAMPLE_URLS = [
  'https://github.com/okx/repopilot',
  'https://github.com/ethereum/go-ethereum',
  'https://github.com/foundry-rs/foundry',
];

export function AuditForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (i: CreateAuditInput) => void }) {
  const { t } = useI18n();
  const [repoUrl, setRepoUrl] = useState('https://github.com/okx/repopilot');
  const [mode, setMode] = useState<Mode>('quick');
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
