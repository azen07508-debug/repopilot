import type { Capabilities, Health } from '../lib/api.js';

export function StatusBar({ health, caps }: { health: Health | null; caps: Capabilities | null }) {
  if (!caps) return null;
  return (
    <div className="statusbar" style={{ marginBottom: 16 }}>
      <span className="pill">Quick Scan: {caps.pricing.quickScan.amount} {caps.pricing.quickScan.currency}</span>
      <span className="pill">Full Audit: {caps.pricing.fullAudit.amount} {caps.pricing.fullAudit.currency}</span>
      <span className="pill">Max files: {caps.limits.maxFiles}</span>
      <span className="pill">Rate: {caps.limits.rateLimitPerMinute}/min</span>
      {health?.paymentMode === 'mock' && <span className="pill warn">Mock payment (dev only)</span>}
    </div>
  );
}
