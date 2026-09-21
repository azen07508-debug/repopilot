/**
 * Severity adjustments based on where a finding lives.
 *
 * Shared by the secret scanner and the AI-pattern rules, and read by the
 * quality contract. All three need the same answer to "is this path a
 * context where the finding means something different?" — a test file, a
 * fixture or a document is not production source.
 *
 * It lives on its own rather than inside the secret scanner because the
 * AI-pattern rules should not have to import the secret scanner to find
 * out whether they are looking at a test file.
 */

/**
 * Paths whose job is to contain deliberately bad code.
 *
 * A scanner's own test suite has to hold realistic-looking keys to prove
 * it detects them; so do fixtures, sample apps and deployment docs. A
 * real run against a repository whose only sin was testing its own
 * scanner reported 542 live credentials.
 *
 * Documents count too: a connection string in a deployment guide is an
 * illustration, and the previous round of false positives came from
 * exactly that.
 */
import type { Severity } from '../schemas/report.js';

const FIXTURE_PATH =
  /\.(test|spec)\.[a-z]+$|(^|\/)(__tests__|tests?|fixtures?|testdata|examples?)\/|\.(md|mdx|rst|txt|adoc)$/i;

export function isFixturePath(path: string): boolean {
  return FIXTURE_PATH.test(path);
}

/**
 * Downgrade, never drop.
 *
 * A real credential committed into a test file is still a real
 * credential and still belongs in the report. It just stops being a
 * release blocker, because "there is a fake AWS key in the scanner's own
 * test suite" is not a reason to hold a ship.
 *
 * A contract can opt back in with `security.scanFixtures`.
 */
export function severityForPath(path: string, severity: Severity): Severity {
  if (!FIXTURE_PATH.test(path)) return severity;
  // A fixture never blocks. Critical becomes medium so it still reads as
  // worth a look; everything else drops to low.
  return severity === 'critical' ? 'medium' : 'low';
}
