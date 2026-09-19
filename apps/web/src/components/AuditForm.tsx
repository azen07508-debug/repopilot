import { useState } from 'react';
import type { CreateAuditInput, Mode, Target, Language } from '../lib/api.js';

const SAMPLE_URLS = [
  'https://github.com/okx/repopilot',
  'https://github.com/ethereum/go-ethereum',
  'https://github.com/foundry-rs/foundry',
];

export function AuditForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (i: CreateAuditInput) => void }) {
  const [repoUrl, setRepoUrl] = useState('https://github.com/okx/repopilot');
  const [mode, setMode] = useState<Mode>('quick');
  const [target, setTarget] = useState<Target>('open_source');
  const [outputLanguage, setOutputLanguage] = useState<Language>('en');
  const [includeLaunchCopy, setIncludeLaunchCopy] = useState(true);

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ repoUrl, mode, target, outputLanguage, includeLaunchCopy });
      }}
    >
      <div>
        <label htmlFor="repo">GitHub repository URL</label>
        <input
          id="repo"
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          required
        />
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="mode">Mode</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="quick">Quick Scan</option>
            <option value="full">Full Launch Audit</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="target">Target</label>
          <select id="target" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            <option value="open_source">Open Source</option>
            <option value="hackathon">Hackathon</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="lang">Language</label>
          <select id="lang" value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value as Language)}>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <label>
          <input
            type="checkbox"
            checked={includeLaunchCopy}
            onChange={(e) => setIncludeLaunchCopy(e.target.checked)}
          />{' '}
          Include launch copy
        </label>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" disabled={disabled || !repoUrl}>
          {disabled ? 'Auditing…' : `Run ${mode === 'quick' ? 'Quick Scan' : 'Full Audit'}`}
        </button>
        <span className="meta">Try: {SAMPLE_URLS.map((u, i) => <a key={u} href="#" onClick={(e) => { e.preventDefault(); setRepoUrl(u); }}>{i === 0 ? ' ' : ' · '}{u.replace('https://github.com/', '')}</a>)}</span>
      </div>
    </form>
  );
}
