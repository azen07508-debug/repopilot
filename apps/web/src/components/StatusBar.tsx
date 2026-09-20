import type { Capabilities, Health } from '../lib/api.js';
import { useI18n } from '../i18n.js';

export function StatusBar({ health, caps }: { health: Health | null; caps: Capabilities | null }) {
  const { t } = useI18n();
  if (!caps) return null;
  return (
    <div className="statusbar" style={{ marginBottom: 20 }}>
      <span className="pill">{t.statusQuickScan}: {caps.pricing.quickScan.amount} {caps.pricing.quickScan.currency}</span>
      <span className="pill">{t.statusFullAudit}: {caps.pricing.fullAudit.amount} {caps.pricing.fullAudit.currency}</span>
      <span className="pill">{t.statusMaxFiles}: {caps.limits.maxFiles}</span>
      <span className="pill">{t.statusRate}: {caps.limits.rateLimitPerMinute}/min</span>
      {health?.paymentMode === 'mock' && <span className="pill warn">{t.statusMockPayment}</span>}
    </div>
  );
}
