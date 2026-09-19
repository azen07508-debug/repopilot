/**
 * Tiny markdown helpers — section extraction and basic escaping.
 * RepoPilot never trusts repository content, so any markdown we render in
 * the admin UI must be HTML-escaped first.
 */

export function extractSectionsFromMd(content: string): string[] {
  const out: string[] = [];
  const re = /^#{1,3}\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push((m[1] ?? '').trim());
  }
  return out;
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const URL_RE = /\bhttps?:\/\/[^\s)<>"']+/i;

export function extractFirstUrl(content: string): string | null {
  const m = content.match(URL_RE);
  return m ? m[0] : null;
}
