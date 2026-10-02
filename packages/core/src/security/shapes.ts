/**
 * Shapes — the answer to "this run of characters is high-entropy, but what
 * is it actually?"
 *
 * Why this module exists
 * ----------------------
 * The generic entropy heuristic is the only rule that catches credential
 * formats nobody has written a pattern for yet, and that is also why it is
 * the rule that produces almost all of the false positives. Every fix to it
 * so far has been the same move: name the *shape* the run actually has, and
 * exclude that shape.
 *
 *   a URL              → not a credential
 *   a checksum         → designed to look random; public by construction
 *   a path or a name   → separator-joined dictionary words
 *   a placeholder      → the value literally says `your-key-here`
 *
 * The 2026-10-01 review fixed five of these by hand, each inside the
 * scanner's own loop. The 2026-10-02 batch found four more. A rule that
 * keeps growing `if` statements inside a 40-line loop is a rule that will be
 * edited wrong, so the shapes live here instead: one predicate, one entry in
 * the registry, one test pair.
 *
 * **The reason is the load-bearing part.** Each shape carries `why`, because
 * "this is a UUID" and "this is a path" are different arguments and the next
 * person to add a shape needs to see the form of the previous ones. A bare
 * list of exclusions would record the exclusions and lose the reasoning.
 *
 * What a shape is not
 * -------------------
 * A shape is not a severity decision. `severityForPath` (severity.ts) decides
 * whether a *real* finding blocks a release, based on where it lives. A shape
 * says the run is not a credential at all, in any file.
 *
 * A shape also never replaces a vendor pattern. `ghp_` + 36 base62 characters
 * is a GitHub token regardless of shape, so the shapes below are consulted
 * only by the entropy catch-all — never by the explicit patterns. See the
 * comment on `nonCredentialShape`.
 *
 * Adding a shape
 * --------------
 * One predicate, one `CANDIDATE_SHAPES` entry, and a test pair in
 * `shapes.test.ts`: a real false-positive sample that must be suppressed, and
 * a same-shape true positive that must still be reported. The pair is the
 * point — a shape with only a negative test is indistinguishable from a
 * shape that suppresses everything.
 */

/**
 * What a shape may look at besides the candidate itself.
 *
 * Most shapes only need the candidate. Two need more:
 *   - `path-or-name-run` reads the line, to see whether the run is part of a
 *     file path (`docs/REPOSITORY_INTELLIGENCE_PLAN` is followed by `.md`);
 *   - `bip39-wordlist-file` reads the whole file, because "this file is a
 *     dictionary of mnemonics" is a property of the file and not of the run.
 */
export interface ShapeContext {
  /** The whole line the candidate came from. */
  line: string;
  /** Repo-relative path, or a path from a commit patch. */
  filePath: string;
  /** The text being scanned. For a tree scan this is the whole file. */
  fileContent: string;
}

export interface Shape {
  /** Stable id, used in tests and in the `why` a reader follows. */
  id: string;
  /** Why matching this shape means the run is not a credential. */
  why: string;
  test(candidate: string, ctx: ShapeContext): boolean;
}

/* ─────────────────────────── line-level helpers ─────────────────────────── */

/**
 * A URL, so it can be moved out of the entropy heuristic's way.
 *
 * URL paths mix case, digits and separators, which pushes Shannon entropy
 * over any threshold worth naming. A real audit of pinojs/pino turned
 * `com/nodejs/node/blob/main/SECURITY` and
 * `fastify/github-action-merge-dependabot` into suspected API keys.
 *
 * Only the entropy heuristic strips these. The vendor patterns still see the
 * raw line, because a token can genuinely live inside a URL — a lockfile
 * registry entry like `https://svc:ghp_…@npm.example.com` is a real
 * credential and must stay visible.
 */
const URL_RE = /\bhttps?:\/\/[^\s)>\]}"'`]+/gi;

export function withoutUrls(line: string): string {
  return line.replace(URL_RE, ' ');
}

/* ──────────────────────────── file-level shapes ─────────────────────────── */

/**
 * Files whose contents are expected to hold placeholders.
 *
 * A `.env.example` exists to show the SHAPE of a connection string or a
 * password field. Reporting those as critical buries the findings that
 * matter — a real run against a repository whose only sin was a
 * well-written `.env.example` produced 547 blockers, which makes the gate
 * useless.
 */
export const ALLOWLIST_FILES = new Set(['.env.example', 'example.env', 'sample.env']);

/** True when a path's basename is a known placeholder file. */
export function isAllowlistedPath(filePath: string): boolean {
  return ALLOWLIST_FILES.has(filePath.split('/').pop() ?? '');
}

/**
 * Kinds that are always the template inside an allowlisted placeholder file.
 *
 * Token-shaped patterns still apply here, because a private key or a cloud
 * key is never a template.
 */
export const TEMPLATE_ONLY_KINDS = new Set(['db_url', 'hardcoded_password']);

/* ────────────────────────── candidate-level shapes ──────────────────────── */

/**
 * Substrings that mark a value as a deliberate placeholder.
 *
 * Kept as substrings rather than whole-word matches on purpose: a sample
 * token is usually embedded in something longer (`your-key-here`,
 * `EXAMPLE_TOKEN_123`).
 */
const SAMPLE_SUBSTRINGS = [
  'example',
  'sample',
  'placeholder',
  'changeme',
  'change-me',
  'change_me',
  'xxxxx',
  '00000',
  '11111',
  'foo',
  'bar',
  'baz',
  '<your',
  '${',
  'process.env',
  'env.get',
];

/**
 * Placeholder shapes that an enumeration always misses one of.
 *
 * `SAMPLE_SUBSTRINGS` carried `your-key` and `your_key` but not
 * `your-password`, so a real audit reported pino's documented
 * `password: 'your-password'` as a hardcoded credential. A pattern covers
 * the family; a list only covers the members someone happened to think of.
 */
const SAMPLE_PATTERNS = [
  /your[-_]?(?:key|token|password|passwd|secret|api|user|name|host|domain|email|account|project|bucket)/i,
  /^<[^>]*>$/,
  /^(?:x{5,}|0{5,}|1{5,})$/i,
];

export function looksLikeSample(value: string): boolean {
  const lower = value.toLowerCase();
  if (SAMPLE_SUBSTRINGS.some((k) => lower.includes(k))) return true;
  return SAMPLE_PATTERNS.some((re) => re.test(value));
}

/**
 * Integrity digests are not credentials.
 *
 * Lockfiles are mostly `sha512-<base64>` lines. A checksum is *designed*
 * to look random, so every entropy heuristic ever written flags it — one
 * real audit produced 557 findings from a single `pnpm-lock.yaml`, 87% of
 * the whole report. The digests are also public by construction: they are
 * in the lockfile precisely so that anyone can verify them.
 *
 * This stays narrow on purpose. A real credential in a lockfile — a
 * registry token inside a `resolved:` URL — is still reported; it is just
 * not reported as a checksum.
 */
const CHECKSUM_RE = /^(?:sha\d{3}|md5|blake\d?|integrity)[-:]/i;

/**
 * Identifiers and paths are not tokens.
 *
 * `fastify/github-action-merge-dependabot` is a GitHub Actions reference.
 * The entropy heuristic saw a 38-character mixed-case run and called it a
 * suspected API key. Stripping URLs does not help here — there is no
 * scheme — so the candidate itself has to be judged.
 *
 * The discriminator is word structure. A real opaque token is random and
 * does not contain separator-joined dictionary words. Three or more
 * lowercase letters, a `/` or `-`, then three more lowercase letters is
 * the signature of a path segment or a kebab-case name.
 *
 * The cost is bounded: for a 40-character base64url token the chance of
 * containing this shape anywhere is well under 1%, so this trades a
 * negligible number of true positives for the whole class.
 */
const IDENTIFIER_LIKE_RE = /[a-z]{3,}[-/][a-z]{3,}/;

/**
 * A connection string aimed at localhost, or one whose password is
 * literally the word "password", is documentation rather than a
 * credential. A leaked URL points at a real host and carries a password
 * that does not spell itself out.
 */
export function looksLikePlaceholderDbUrl(match: string): boolean {
  const lower = match.toLowerCase();
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) return true;

  // Docker Compose and Compose-style local stacks address each other by
  // service name, so `@db:5432` is a container link rather than a public
  // host. A real leaked URL does not point at a service called `db`.
  if (/@(?:db|database|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|host):\d+/i.test(match)) {
    return true;
  }

  return /:\/\/[^:@/]*:(?:password|passwd|pass|secret|changeme|change[_-]me|your[-_]?password)@/i.test(
    match
  );
}

/* ───────────────────────────── the registry ─────────────────────────────── */

/**
 * Shapes the entropy catch-all consults, most specific first.
 *
 * Order matters where two shapes could both match: `uuid` is checked before
 * `path-or-name-run`, because `okx_5bed368d-cefc-464a-b8c0-ee93d11f0c25`
 * satisfies both and the UUID is the more precise answer. The outcome is the
 * same either way, but the *reason* recorded in a test failure is not.
 */
export const CANDIDATE_SHAPES: Shape[] = [
  {
    id: 'sample-placeholder',
    why: 'the value says it is a placeholder (`your-key-here`, `EXAMPLE_TOKEN_123`, `${ENV_VAR}`)',
    test: (c) => looksLikeSample(c),
  },
  {
    id: 'integrity-digest',
    why: 'a content digest is designed to look random and is public by construction',
    test: (c) => CHECKSUM_RE.test(c),
  },
  {
    id: 'separator-identifier',
    why: 'a path segment or kebab-case name: lowercase words joined by `/` or `-`',
    test: (c) => IDENTIFIER_LIKE_RE.test(c),
  },
];

/**
 * The first shape the candidate matches, or `undefined` if it is a possible
 * credential.
 *
 * **Only the entropy catch-all calls this.** A vendor pattern is already a
 * statement about a specific format — `ghp_` + 36 base62 characters is a
 * GitHub token no matter what shape it also has — so running these over a
 * pattern match could only ever suppress a real credential. The one shape
 * that does apply to pattern matches is `looksLikeSample`, called directly,
 * because a placeholder is a placeholder in any format.
 */
export function nonCredentialShape(
  candidate: string,
  ctx: ShapeContext
): Shape | undefined {
  return CANDIDATE_SHAPES.find((s) => s.test(candidate, ctx));
}
