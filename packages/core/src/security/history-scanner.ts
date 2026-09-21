/**
 * Commit-history secret scanner.
 *
 * Finds credentials that were committed and later removed. The working
 * tree can be spotless while the secret stays reachable through history,
 * so a tree-only scan misses exactly the case that matters most.
 *
 * Remote-only by construction: this reads unified diffs through the
 * GitHub API. It never clones, never runs `git`, and never needs a local
 * working tree. See docs/ARCHITECTURE.md for the constraint.
 *
 * Like the working-tree scanner, the matched value is never read,
 * copied, returned or logged — only the kind, severity and a short
 * low-entropy reason.
 */
import type { Finding, Severity } from '../schemas/report.js';
import {
  isAllowlistedPath,
  scanTextForSecrets,
  slugify,
  titleForKind,
  type SecretKind,
} from './secret-scanner.js';

export interface ScannedCommitFile {
  filename: string;
  /** Unified diff, or null when GitHub omitted it. */
  patch: string | null;
}

export interface ScannedCommit {
  sha: string;
  subject: string;
  date: string | null;
  files: ScannedCommitFile[];
}

export interface HistorySecretHit {
  kind: SecretKind;
  severity: Severity;
  reason: string;
  commitSha: string;
  commitSubject: string;
  commitDate: string | null;
  file: string;
  /** Line number in the version of the file this commit produced. */
  line: number | null;
}

/**
 * Extract the lines a patch ADDS, with their line numbers in the new file.
 *
 * Only added lines are scanned. A secret's first appearance is always an
 * addition, so this catches every introduction; scanning removed lines as
 * well would double-report the same credential on every later edit.
 */
export function addedLines(patch: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    // File headers, not content.
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    // "\ No newline at end of file" — carries no line of its own.
    if (raw.startsWith('\\')) continue;

    if (raw.startsWith('+')) {
      out.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      // A deletion does not advance the new file's line counter.
      continue;
    }
    // Context line.
    newLine += 1;
  }

  return out;
}

/**
 * Scan commits for credentials.
 *
 * Deduplicated across commits by (kind, file, reason) rather than by line
 * number: the same credential usually shows up in several commits as it
 * gets edited, and reporting it once per commit would bury the signal.
 * The earliest commit that introduced it wins, because that is the one a
 * responder needs.
 */
export function scanCommitsForSecrets(commits: ScannedCommit[]): HistorySecretHit[] {
  const hits: HistorySecretHit[] = [];
  const seen = new Set<string>();

  // Oldest first, so the introducing commit is the one we keep.
  const ordered = [...commits].sort((a, b) => (a.date ?? '') .localeCompare(b.date ?? ''));

  for (const commit of ordered) {
    for (const file of commit.files) {
      if (!file.patch) continue;
      const allowlist = isAllowlistedPath(file.filename);

      for (const added of addedLines(file.patch)) {
        for (const hit of scanTextForSecrets(added.text, { allowlist })) {
          const key = `${hit.kind}::${file.filename}::${hit.reason}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            kind: hit.kind,
            severity: hit.severity,
            reason: hit.reason,
            commitSha: commit.sha,
            commitSubject: commit.subject,
            commitDate: commit.date,
            file: file.filename,
            line: added.line,
          });
        }
      }
    }
  }

  return hits;
}

/**
 * Aggregate history hits into the canonical Finding shape.
 *
 * The id embeds the short commit sha: the same credential committed in
 * two different commits is two findings, because it is two separate
 * introductions to clean up. Re-auditing the same history yields the
 * same ids.
 *
 * The remediation wording differs from the working-tree rule on purpose.
 * A secret in the tree is fixed by moving it to the environment; a secret
 * in history is fixed by rotating it and then rewriting history, which is
 * destructive and needs coordination.
 */
export function toHistoryFindings(hits: HistorySecretHit[]): Finding[] {
  const byKey = new Map<string, Finding>();

  for (const h of hits) {
    const shortSha = h.commitSha.slice(0, 7);
    const id = `secret-history-${h.kind}-${shortSha}-${slugify(h.file)}`;
    if (byKey.has(id)) continue;

    byKey.set(id, {
      id,
      category: 'security',
      severity: h.severity,
      title: `Secret in commit history: ${titleForKind(h.kind)}`,
      description:
        `${titleForKind(h.kind)} was committed in ${shortSha} and remains reachable through the ` +
        'repository history. Removing it from the working tree does not remove it from history.',
      evidence: [
        {
          file: h.file,
          line: h.line,
          reason:
            `${h.reason} — introduced in ${shortSha} ("${h.commitSubject}", ` +
            `${h.commitDate ?? 'date unknown'})`,
          source: 'git_history',
        },
      ],
      recommendedAction:
        'Rotate the credential at the issuing service first — history rewriting does not undo ' +
        'an exposure. Then purge it from history (git filter-repo or BFG) and force-push, after ' +
        'agreeing the rewrite with everyone who has a clone.',
      acceptanceCriteria: [
        'The credential is revoked or rotated at the issuing service.',
        'The secret is no longer reachable from any commit on any branch.',
        'Any published artefact that contained it (release, package, image) has been replaced.',
      ],
    });
  }

  return [...byKey.values()];
}
