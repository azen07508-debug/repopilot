import { useI18n } from '../i18n.js';

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <p>{t.footerDisclaimer}</p>
      <p>{t.footerPayments}</p>
    </footer>
  );
}
