/**
 * The issue list and the report both static checkers share.
 *
 * `env-check.ts` and `compose-check.ts` each grew a copy of the same four
 * things: an `Issue` shape, the array, three level helpers, and a renderer
 * that prints and exits. The copies were not identical — the header, the
 * column width and the "nothing to report" line all differed — which is the
 * usual way a copy ends.
 *
 * `reportAndExit` returns `never`, and that is load-bearing at the
 * `compose-check.ts` call site: the compiler needs to know the call does not
 * come back, or `parsed` reads as possibly-unassigned. Do not relax it.
 */

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  field: string;
  message: string;
}

export interface Reporter {
  /** The live array. Read it after the checks have run, not before. */
  issues: Issue[];
  err(field: string, message: string): void;
  warn(field: string, message: string): void;
  info(field: string, message: string): void;
}

export function createReporter(): Reporter {
  const issues: Issue[] = [];
  // Braced bodies, not `=> issues.push(...)`: `push` returns a number and these
  // are declared `void`, so the concise form is a `number`-returning function
  // wearing a `void` signature. The day someone writes `const n = err(...)`
  // the value would be an array length.
  return {
    issues,
    err: (field: string, message: string) => {
      issues.push({ level: 'error', field, message });
    },
    warn: (field: string, message: string) => {
      issues.push({ level: 'warning', field, message });
    },
    info: (field: string, message: string) => {
      issues.push({ level: 'info', field, message });
    },
  };
}

export interface ReportOptions {
  /** First line of the report, e.g. `env:check (NODE_ENV=production)`. */
  header: string;
  /** Printed when there is nothing at all to report. */
  okMessage: string;
  /** Width of the `field` column. */
  fieldWidth: number;
}

/**
 * Print the collected issues and exit with the code they imply: 1 for any
 * error, 2 when there are only warnings, 0 when clean.
 */
export function reportAndExit(issues: Issue[], opts: ReportOptions): never {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const infos = issues.filter((i) => i.level === 'info');

  console.log(`\n${opts.header}`);
  console.log('─'.repeat(60));
  if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
    console.log(opts.okMessage);
  } else {
    for (const e of errors) {
      console.log(`ERROR    ${e.field.padEnd(opts.fieldWidth)} ${e.message}`);
    }
    for (const w of warnings) {
      console.log(`WARNING  ${w.field.padEnd(opts.fieldWidth)} ${w.message}`);
    }
    for (const i of infos) {
      console.log(`INFO     ${i.field.padEnd(opts.fieldWidth)} ${i.message}`);
    }
  }
  console.log('─'.repeat(60));
  console.log(
    `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
  );

  if (errors.length > 0) process.exit(1);
  if (warnings.length > 0) process.exit(2);
  process.exit(0);
}
