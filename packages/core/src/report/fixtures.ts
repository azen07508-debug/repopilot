/**
 * Fixture findings, grouped for reading.
 *
 * The split in `builder.ts` keeps fixture findings out of the release
 * gate. It does not make them readable. A real run against a repository
 * whose only sin was testing its own scanner produced 542 of them — 500
 * of those were `sha512-` integrity digests from a single
 * `pnpm-lock.yaml`. Rendered one per row that is a wall, and a wall is
 * the same as nothing.
 *
 * So the report carries both forms:
 *
 *   fixtureFindings   every finding, unchanged. The quality contract and
 *                     the diff need them individually, and
 *                     `security.scanFixtures` counts them.
 *   fixtureSummary    the same findings grouped by (file, rule). This is
 *                     what a human or an agent actually reads.
 *
 * Grouping is a pure function of the list, so it could be derived on
 * read. It is stored instead because the web bundle cannot import from
 * `@repopilot/core` at runtime — the package pulls `@octokit/rest`,
 * which must never reach the browser, which is why `apps/web` imports
 * core type-only. Data is the only channel that reaches a browser and an
 * MCP client alike without a second copy of the rule.
 */
import type { FixtureGroup, Finding, Severity } from '../schemas/report.js';

/**
 * How many line numbers a group keeps.
 *
 * A lockfile group can hold five hundred hits; the count is the
 * interesting number there and the lines are not, so listing them all
 * would rebuild the wall this exists to avoid. A three-hit test file is
 * the opposite case, and ten is comfortably more than that. `count`
 * always reports the true total, so a reader can tell the difference.
 */
export const MAX_GROUP_LINES = 10;

/**
 * Worst first. Written out rather than derived from `SeveritySchema`'s
 * order, because that array is a wire format and reordering it would
 * silently reorder every report.
 */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function fileOf(finding: Finding): string {
  return finding.evidence[0]?.file ?? '';
}

/**
 * A group while it is still being built.
 *
 * A separate interface rather than an intersection with `FixtureGroup`:
 * the finished group carries `lines: number[]` and the builder collects
 * a `Set<number>`, so `FixtureGroup & { lines: Set<number> }` demands
 * that `lines` be both at once and satisfies neither.
 */
interface GroupBuilder {
  file: string;
  ruleId: string;
  title: string;
  count: number;
  severity: Severity;
  lines: Set<number>;
}

/**
 * Group findings by the file and the rule that produced them.
 *
 * Order is severity first so the worst group leads, which is the only
 * reason to open this section at all. Within a severity, file then rule
 * keeps the output stable across runs — the same input must produce the
 * same report, or a stored report stops being comparable to a fresh one.
 */
export function summarizeFixtures(findings: Finding[]): FixtureGroup[] {
  const groups = new Map<string, GroupBuilder>();

  for (const finding of findings) {
    const file = fileOf(finding);
    const ruleId = finding.ruleId ?? '';
    // NUL separator: a path may contain nearly any character, and a
    // printable separator would let two different files collide on one
    // key.
    const key = `${file}\u0000${ruleId}`;

    const existing = groups.get(key);
    const group: GroupBuilder =
      existing ?? {
        file,
        ruleId,
        title: finding.title,
        count: 0,
        severity: finding.severity,
        lines: new Set<number>(),
      };
    if (!existing) groups.set(key, group);

    group.count += 1;
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[group.severity]) {
      group.severity = finding.severity;
    }

    const line = finding.evidence[0]?.line;
    if (typeof line === 'number' && line > 0) group.lines.add(line);
  }

  return [...groups.values()]
    .map(({ lines, ...group }): FixtureGroup => ({
      ...group,
      lines: [...lines].sort((a, b) => a - b).slice(0, MAX_GROUP_LINES),
    }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.file.localeCompare(b.file) ||
        a.ruleId.localeCompare(b.ruleId)
    );
}
