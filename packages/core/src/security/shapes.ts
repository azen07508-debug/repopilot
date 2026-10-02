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
 * is a GitHub token regardless of shape. The rules that consult the
 * judgements in this module are therefore the two whose pattern is a
 * *candidate shape* rather than a format claim: the entropy catch-all, and
 * the mnemonic rule, whose candidate regex is "twelve lowercase words" and
 * so cannot tell a seed phrase from a dictionary. A vendor pattern is never
 * filtered. See the comment on `nonCredentialShape`.
 *
 * Adding a shape
 * --------------
 * One predicate, one `CANDIDATE_SHAPES` entry, and a test pair in
 * `shapes.test.ts`: a real false-positive sample that must be suppressed, and
 * a same-shape true positive that must still be reported. The pair is the
 * point — a shape with only a negative test is indistinguishable from a
 * shape that suppresses everything.
 *
 * **The example you cite has to be one the shape suppresses.** This module's
 * own prose is scanned like any other source, so a bare citation of a run the
 * shape does not cover becomes a finding *in the file that defines the rule*.
 * That is what happened here: two findings, both this file, until
 * 2026-10-02. Write the citation in the form the shape recognises —
 * `docs/REPOSITORY_INTELLIGENCE_PLAN.md`, not the bare stem — and
 * `shapes.test.ts` will keep you honest, because it scans this file.
 */
import { BIP39_ENGLISH } from './bip39-english.js';

/**
 * What a shape may look at besides the candidate itself.
 *
 * Most shapes only need the candidate. Two need more:
 *   - `path-or-name-run` reads the line, to see whether the run is the stem
 *     of a file path — `docs/REPOSITORY_INTELLIGENCE_PLAN.md` is a document,
 *     and the shape reads the `.md` to say so;
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
 * The fraction of a file's words that must be BIP-39 words before the file is
 * read as the wordlist rather than as a document that happens to contain a
 * phrase.
 *
 * Measured over this repository's 307 tracked files: the wordlist itself is
 * **0.956**, and the next-highest of the 248 files with at least 50 words is
 * **0.447**. Nothing measured lands between them, so the band is wide and the
 * exact digit does not carry the decision — 0.75 is the midpoint, chosen so
 * that a file drifting either way is caught by the band rather than by the
 * digit.
 */
const WORDLIST_SHARE = 0.75;

/**
 * Below this many words a file is not judged at all.
 *
 * Without it, a five-word test fixture made entirely of BIP-39 words would
 * score 1.0 and be read as the dictionary. The wordlist has thousands of
 * words; a file with a handful cannot be one.
 */
const WORDLIST_MIN_WORDS = 50;

/** The same word shape the mnemonic candidate regex looks for. */
const WORD_TOKEN = /[a-z]{3,12}/g;

/**
 * Is this file the wordlist, rather than a file that quotes a phrase?
 *
 * The mnemonic rule's candidate regex is "twelve lowercase words", and the
 * BIP-39 wordlist is itself a file of twelve-word lines. So the rule fires on
 * the dictionary that defines it: 165 critical findings, every one of them a
 * line of `bip39-english.ts`, in this repository's own audit.
 *
 * The candidate regex cannot be tightened — twelve lowercase BIP-39 words is
 * exactly what a seed phrase is. The distinguishing fact is not about the
 * *run*, it is about the *file*: a seed phrase is a line in a document, and a
 * wordlist is a file whose every word is a BIP-39 word. That is what this
 * asks.
 *
 * It is deliberately a property of the file rather than of the path. A path
 * exclusion (`**\/bip39-english.ts`) would not fire for a wordlist fetched
 * into a temporary directory, or renamed, or vendored under another name —
 * and the whole class is "a file that is a dictionary", which the path does
 * not name.
 */
export function isWordlistFile(content: string): boolean {
  const words = content.toLowerCase().match(WORD_TOKEN) ?? [];
  if (words.length < WORDLIST_MIN_WORDS) return false;
  const known = words.filter((w) => BIP39_ENGLISH.has(w)).length;
  return known / words.length >= WORDLIST_SHARE;
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

/* ─────────────────────── decomposing a candidate ───────────────────────── */

/**
 * The value half of an assignment, or `undefined` when the run is not one.
 *
 * The entropy candidate regex includes `=` in its character class, because
 * base64 padding ends in it. The side effect is that `NAME=value` arrives as
 * a single run — and then the heuristic measures the variable NAME as if it
 * were part of the secret. A real audit of this repository reported
 * `POSTGRES_PASSWORD=repopilot_test`, a throwaway password in a developer's
 * `docker run` command, as a 33-character possible API key. Eighteen of
 * those 33 characters were the name.
 *
 * So the heuristic asks this first, and when it answers, both the length test
 * and the entropy test run against the value. The name is not a secret and
 * must not lend the run either its length or its character variety.
 *
 * Trailing `=` is stripped before looking for the separator, so base64
 * padding is not mistaken for an assignment: a `sha512-…==` digest has no
 * `=` left to find and is judged whole.
 *
 * The left side must also look like a name rather than like data, or the
 * split would be a way to lose findings: an opaque token that happens to
 * contain an `=` would be read as `NAME=value`, its left half discarded, and
 * a short right half would drop the whole run below the floor.
 */
export function assignmentValue(candidate: string): string | undefined {
  const trimmed = candidate.replace(/=+$/, '');
  const at = trimmed.indexOf('=');
  if (at <= 0) return undefined;
  if (!looksLikeVariableName(trimmed.slice(0, at))) return undefined;
  const value = trimmed.slice(at + 1);
  return value.length > 0 ? value : undefined;
}

/**
 * Is this a name, or is it data?
 *
 * `POSTGRES_PASSWORD` and `PASSWORD` are names. A run that mixes letters and
 * digits with no `_` to separate them is not — that is what an opaque token
 * looks like, and reading one as a variable name would silently discard the
 * half that might have been the secret.
 */
function looksLikeVariableName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return /^[A-Za-z_]+$/.test(name) || name.includes('_');
}

/* ───────────────────────────── the registry ─────────────────────────────── */

/**
 * Extensions that make a preceding run the stem of a file path.
 *
 * An explicit list rather than `\.[a-z]{1,8}`, because the weaker pattern
 * would also fire on a token that happens to be followed by a full stop and
 * a word — `the key is aB3…xyz. Rotate it` — and the whole point of this
 * shape is to be the narrow, certain one.
 */
const FILE_EXTENSIONS = [
  'md', 'mdx', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh', 'py', 'rb', 'go',
  'rs', 'java', 'kt', 'php', 'sql', 'sol', 'txt', 'html', 'css', 'scss', 'vue',
  'svelte', 'xml', 'lock', 'log', 'map', 'snap', 'patch', 'diff', 'env', 'example',
  'sample', 'local', 'bak', 'gitignore', 'dockerignore', 'dockerfile',
];

const EXTENSION_AFTER = new RegExp(`^\\.(?:${FILE_EXTENSIONS.join('|')})\\b`, 'i');

const NAME_SEGMENT = /^[A-Za-z0-9]{2,}$/;
const ALPHA_SEGMENT = /^[A-Za-z]{3,}$/;

/**
 * The run is part of a file path, or it is a separator-joined name.
 *
 * `docs/REPOSITORY_INTELLIGENCE_PLAN.md` is 36 characters, mixed case, with
 * an underscore — its 33-character stem scores entropy 4.07 — and it is a
 * filename. The stem alone accounted for 16 of the 31 high-entropy findings
 * in RepoPilot's own audit, because this repository cites its own plan
 * document constantly. The heuristic cannot know that
 * `REPOSITORY_INTELLIGENCE_PLAN` is three English words, because to it a
 * word is any run of characters.
 *
 * Note how the citation above is written: with the `.md`. The stem on its
 * own is exactly the run this shape does *not* cover (two segments, no
 * extension), so citing it bare would put two findings in this file. See the
 * module header.
 *
 * Two acceptance paths, because the two signals are not equally strong:
 *
 *   1. **A file extension follows.** `.md`, `.ts`, `.json` … is a direct
 *      statement that the run is the stem of a path. Needs no other
 *      evidence.
 *   2. **Three or more separator-joined segments, at least two of them
 *      purely alphabetic.** `XLayer/Ethereum/Base/Arbitrum/BSC` is a list of
 *      chains. An opaque token does not split into three word-shaped pieces.
 *
 * The cost is that a base64 token containing two `/` characters and two
 * letter-only segments would be missed. That is acceptable here and only
 * here, because the vendor patterns run separately and unconditionally: a
 * real `sk-ant-…` key never reaches the entropy heuristic at all.
 */
const EVM_ADDRESS = /(?:^|[^0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const EVM_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=?)?$/;

const UUID_RE =
  /(?:^|[^0-9a-fA-F])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9a-fA-F-])/;
const UUID_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*)?$/;

function pathOrNameRun(candidate: string, ctx: ShapeContext): boolean {
  const at = ctx.line.indexOf(candidate);
  if (at >= 0 && EXTENSION_AFTER.test(ctx.line.slice(at + candidate.length))) return true;

  const segments = candidate.split(/[-/]/);
  if (segments.length < 3) return false;
  if (!segments.every((s) => NAME_SEGMENT.test(s))) return false;
  return segments.filter((s) => ALPHA_SEGMENT.test(s)).length >= 2;
}

/**
 * An EVM address, optionally with the variable name it is assigned to.
 *
 * `0xdAC17F958D2ee523a2206206994597C13D831ec7` is USDT's contract address
 * on Ethereum — 42 characters, entropy 4.06. It appears in `okx-adapter.ts`
 * twice (Ethereum and Base) and in three API tests.
 *
 * A 20-byte address is public by construction: it is in the source so a
 * reader can verify which contract is being called. The shape is anchored
 * so that a 32-byte **private** key — `0x` plus 64 hex characters — does
 * not match; the trailing guard rejects a 41st hex digit.
 *
 * The run may carry an assignment prefix, because the entropy regex does
 * not stop at `=`: `OKX_PAYMENT_ADDRESS=0x3a44…` is captured whole.
 */
function evmAddress(candidate: string): boolean {
  const m = EVM_ADDRESS.exec(candidate);
  if (!m) return false;
  return EVM_PREFIX.test(candidate.replace(m[0], ''));
}

/**
 * A canonical UUID, optionally with the name it is assigned to.
 *
 * `okx_5bed368d-cefc-464a-b8c0-ee93d11f0c25` is a payment id in the OKX
 * seller smoke output — 40 characters, entropy 4.15, three occurrences in
 * one artefact.
 *
 * The honest caveat: **a UUID can be a session token.** 122 bits of
 * randomness is enough to be one, and no scanner can tell an identifier
 * from a secret when the two are the same shape. The shape is excluded
 * anyway because UUIDs are overwhelmingly identifiers — request ids, trace
 * ids, payment ids, row ids — and this heuristic's false positives are why
 * a clean repository's security score reads 0.0. The residual is recorded
 * in RISKS.md rather than hidden here.
 */
function canonicalUuid(candidate: string): boolean {
  const m = UUID_RE.exec(candidate);
  if (!m) return false;
  return UUID_PREFIX.test(candidate.replace(m[0], ''));
}

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
  {
    id: 'uuid',
    why: 'a canonical UUID is an identifier (request id, trace id, payment id)',
    test: (c) => canonicalUuid(c),
  },
  {
    id: 'evm-address',
    why: 'a 20-byte contract address is public by construction; a private key is 32 bytes',
    test: (c) => evmAddress(c),
  },
  {
    id: 'path-or-name-run',
    why: 'the run is the stem of a file path, or separator-joined words that name something',
    test: (c, ctx) => pathOrNameRun(c, ctx),
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
