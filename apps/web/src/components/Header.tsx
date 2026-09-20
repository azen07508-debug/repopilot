import type { Capabilities, Health } from '../lib/api.js';
import { useI18n, type UiLanguage } from '../i18n.js';

export function Header({ health, caps }: { health: Health | null; caps: Capabilities | null }) {
  const { lang, setLang, t } = useI18n();
  const next: UiLanguage = lang === 'en' ? 'zh-CN' : 'en';

  return (
    <header className="site-header">
      <div>
        <span className="wordmark">{t.appName}</span>
        <span className="pill" style={{ marginLeft: 8 }}>v{health?.version ?? caps?.version ?? '0.1.0'}</span>
      </div>
      <div className="row">
        <div className="statusbar">
          {health && <span className="pill ok">{t.statusApiOk}</span>}
          {health?.database === 'ok' && <span className="pill ok">{t.statusDbOk}</span>}
          {health && <span className="pill">{t.statusPayment}: {health.paymentMode}</span>}
        </div>
        <button className="ghost" onClick={() => setLang(next)} title={t.langToggleTo}>
          {t.langToggle}
        </button>
      </div>
    </header>
  );
}
