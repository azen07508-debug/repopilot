import type { Capabilities, Health } from '../lib/api.js';

export function Header({ health, caps }: { health: Health | null; caps: Capabilities | null }) {
  return (
    <header className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <strong style={{ fontSize: 18 }}>RepoPilot</strong>
        <span className="pill" style={{ marginLeft: 8 }}>v{health?.version ?? caps?.version ?? '0.1.0'}</span>
      </div>
      <div className="statusbar">
        {health && <span className="pill ok">API ok</span>}
        {health?.database === 'ok' && <span className="pill ok">DB ok</span>}
        {health && <span className="pill">payment: {health.paymentMode}</span>}
      </div>
    </header>
  );
}
