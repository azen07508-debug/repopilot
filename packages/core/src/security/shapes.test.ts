/**
 * Shape tests.
 *
 * Every shape gets a pair, and the pair is the point:
 *
 *   1. a **real false positive** — a value copied from a live audit that
 *      must stop being reported;
 *   2. a **same-shape true positive** — a value that looks similar enough
 *      that a lazily written shape would swallow it, and that must still be
 *      reported.
 *
 * A shape with only a negative test is indistinguishable from a shape that
 * suppresses everything, which is the failure mode this whole module exists
 * to avoid. Several of the positives below are literal: they are the
 * strings the shapes are most likely to eat by accident.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assignmentValue,
  CANDIDATE_SHAPES,
  isWordlistFile,
  nonCredentialShape,
  type ShapeContext,
} from './shapes.js';
import { scanForSecrets, scanTextForSecrets } from './secret-scanner.js';

function ctx(line: string): ShapeContext {
  return { line };
}

/** The id of the shape that suppresses this candidate, or `undefined`. */
function shapeFor(candidate: string, line = candidate): string | undefined {
  return nonCredentialShape(candidate, ctx(line))?.id;
}

/** Does the entropy heuristic still report this line? */
function reported(line: string, filePath = 'src/index.ts'): boolean {
  return scanTextForSecrets(line, { path: filePath }).some(
    (h) => h.kind === 'generic_high_entropy'
  );
}

/**
 * A 36-character token with no shape: mixed case, digits, no separators, no
 * dictionary words. Every "still reported" test below uses it as the
 * control, so if this constant ever stops being reported the whole file's
 * negatives become meaningless.
 */
const OPAQUE_TOKEN = 'Xk9vQ2mZ7pL4wN8rT3yB6cH1jF5dS0gA2e';

describe('shapes', () => {
  describe('the registry itself', () => {
    it('gives every shape a unique id', () => {
      const ids = CANDIDATE_SHAPES.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every shape a reason, because the reason is the argument', () => {
      for (const shape of CANDIDATE_SHAPES) {
        expect(shape.why.length, `${shape.id} has no why`).toBeGreaterThan(20);
      }
    });

    it('leaves a genuinely shapeless token alone', () => {
      expect(shapeFor(OPAQUE_TOKEN)).toBeUndefined();
    });
  });

  describe('sample-placeholder', () => {
    it('suppresses a value that says it is a placeholder', () => {
      expect(shapeFor('YOUR_API_KEY_HERE_PLACEHOLDER_1234')).toBe('sample-placeholder');
    });

    it('still reports an opaque token', () => {
      expect(reported(OPAQUE_TOKEN)).toBe(true);
    });
  });

  describe('integrity-digest', () => {
    it('suppresses a lockfile digest', () => {
      expect(shapeFor(`sha512-${OPAQUE_TOKEN}${OPAQUE_TOKEN}`)).toBe('integrity-digest');
    });

    it('still reports the same bytes without the digest prefix', () => {
      expect(reported(`${OPAQUE_TOKEN}${OPAQUE_TOKEN}`)).toBe(true);
    });
  });

  describe('separator-identifier', () => {
    it('suppresses a GitHub Actions reference', () => {
      // The real one, from the pinojs/pino audit.
      expect(shapeFor('fastify/github-action-merge-dependabot')).toBe('separator-identifier');
    });

    it('still reports an opaque token that happens to contain a slash', () => {
      // Two segments, so `path-or-name-run` does not claim it either.
      expect(reported(`${OPAQUE_TOKEN}/Xk9vQ2mZ7pL4wN8rT3y`)).toBe(true);
    });
  });

  describe('uuid', () => {
    it('suppresses a payment id', () => {
      // The real one, from the OKX seller smoke artefact.
      expect(shapeFor('okx_5bed368d-cefc-464a-b8c0-ee93d11f0c25')).toBe('uuid');
    });

    it('suppresses a bare UUID', () => {
      expect(shapeFor('5bed368d-cefc-464a-b8c0-ee93d11f0c25')).toBe('uuid');
    });

    it('still reports a 40-character opaque token', () => {
      // Same length as the prefixed UUID above, and this is the mistake a
      // length-based shape would make.
      expect(shapeFor('Xk9vQ2mZ7pL4wN8rT3yB6cH1jF5dS0gA2eXk9vQ2mZ')).toBeUndefined();
      expect(reported('Xk9vQ2mZ7pL4wN8rT3yB6cH1jF5dS0gA2eXk9vQ2mZ')).toBe(true);
    });

    it('still reports a hex run that is not a canonical UUID', () => {
      // 32 hex characters with no dashes is a plausible key; it must not be
      // read as a UUID's first group.
      expect(shapeFor('9f2c1a7b4e6d80351c9a2f7b4e6d8035')).toBeUndefined();
    });
  });

  describe('evm-address', () => {
    it('suppresses USDT on Ethereum', () => {
      expect(shapeFor('0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe('evm-address');
    });

    it('suppresses an address carrying its variable name', () => {
      // The entropy regex does not stop at `=`, so the run arrives whole.
      expect(
        shapeFor(
          'OKX_PAYMENT_ADDRESS=0x3a4434baad765136a40f597e29d325b41b9dec61',
          '- `OKX_PAYMENT_ADDRESS=0x3a4434baad765136a40f597e29d325b41b9dec61`'
        )
      ).toBe('evm-address');
    });

    it('still reports a 32-byte private key, which is also 0x-prefixed hex', () => {
      // 0x + 64 hex. If this ever stops being reported, the shape has eaten
      // private keys.
      const privateKey = `0x${'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(2)}`;
      expect(privateKey.length).toBe(66);
      expect(shapeFor(privateKey)).toBeUndefined();
      expect(reported(`const key = '${privateKey}'`)).toBe(true);
    });
  });

  describe('path-or-name-run', () => {
    it('suppresses a filename that names this repository\'s own plan', () => {
      // 16 of the 31 high-entropy findings in the self-audit were this one
      // string, because the repository cites its own plan document.
      expect(
        shapeFor(
          'docs/REPOSITORY_INTELLIGENCE_PLAN',
          'See `docs/REPOSITORY_INTELLIGENCE_PLAN.md` §9.2 for the phasing.'
        )
      ).toBe('path-or-name-run');
    });

    it('suppresses a chain list', () => {
      expect(shapeFor('XLayer/Ethereum/Base/Arbitrum/BSC')).toBe('path-or-name-run');
    });

    it('still reports a vendor example token with digits in most segments', () => {
      // Telegram's own documented example, which the CHANGELOG records as an
      // accepted residual of the unknown-format catch-all. It has three
      // segments but only one purely alphabetic one, and it must stay.
      expect(shapeFor('ABC-DEF1234ghIkl-zyx57W2v1u123ew11')).toBeUndefined();
      expect(reported('botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"')).toBe(true);
    });

    it('still reports a two-segment opaque run', () => {
      expect(shapeFor(`${OPAQUE_TOKEN}/Xk9vQ2mZ`)).toBeUndefined();
    });

    it('still reports a run followed by a full stop and a word', () => {
      // The reason the extension list is explicit rather than `\.[a-z]+`.
      expect(
        shapeFor(
          'Xk9vQ2mZ7pL4wN8rT3yB6cH1jF5dS0gA2eXk9vQ2mZ',
          'The key is Xk9vQ2mZ7pL4wN8rT3yB6cH1jF5dS0gA2eXk9vQ2mZ. Rotate it.'
        )
      ).toBeUndefined();
    });
  });

  describe('assignmentValue', () => {
    it('splits NAME=value at the first `=`', () => {
      expect(assignmentValue('POSTGRES_PASSWORD=repopilot_test')).toBe('repopilot_test');
      expect(assignmentValue('OKX_PAYMENT_ADDRESS=0x3a4434baad765136a40f597e29d325b41b9dec61')).toBe(
        '0x3a4434baad765136a40f597e29d325b41b9dec61'
      );
    });

    it('does not read base64 padding as an assignment', () => {
      // The `=` is in the candidate class for exactly this reason.
      expect(assignmentValue(`sha512-${OPAQUE_TOKEN}==`)).toBeUndefined();
    });

    it('does not split a run whose left side is not an identifier', () => {
      expect(assignmentValue(`${OPAQUE_TOKEN}=Xk9vQ2mZ`)).toBeUndefined();
      expect(assignmentValue('=leading')).toBeUndefined();
      expect(assignmentValue('NAME=')).toBeUndefined();
      expect(assignmentValue(OPAQUE_TOKEN)).toBeUndefined();
    });
  });

  describe('the heuristic measures the value, not the variable name', () => {
    function kindsIn(content: string): string[] {
      return scanForSecrets([{ path: 'config.ts', content }]).map((d) => d.kind);
    }

    it('does not call a short test password high-entropy', () => {
      // From apps/api/src/tests/postgres.integration.test.ts, a `docker run`
      // line in a doc comment. Reported as a 33-character possible API key;
      // 18 of those characters were the variable name.
      expect(kindsIn('-e POSTGRES_PASSWORD=repopilot_test')).not.toContain('generic_high_entropy');
    });

    it('still reports a long opaque value behind a variable name', () => {
      const kinds = kindsIn(`SERVICE_PASSWORD=${OPAQUE_TOKEN}`);
      expect(kinds).toContain('generic_high_entropy');
    });

    it('reports the value length, not the length of the assignment', () => {
      const hit = scanTextForSecrets(`SERVICE_PASSWORD=${OPAQUE_TOKEN}`, { path: 'config.ts' })[0];
      expect(hit?.reason).toContain(`${OPAQUE_TOKEN.length} chars`);
      expect(hit?.reason).not.toContain(`${OPAQUE_TOKEN.length + 17} chars`);
    });
  });

  /**
   * The module that defines the rules must not trip them.
   *
   * This is not a stylistic check. `shapes.ts` documents each shape by citing
   * a real false positive, and every one of those citations is a string the
   * scanner sees — so a citation of a run the shape does *not* cover is a
   * finding in the file that defines the rule. Two of them existed until
   * 2026-10-02. Add a shape, cite its example in the form the shape
   * recognises, and this stays green.
   */
  describe('shapes.ts does not flag itself', () => {
    const source = readFileSync(fileURLToPath(new URL('./shapes.ts', import.meta.url)), 'utf8');

    it('produces no high-entropy finding anywhere in its own source', () => {
      const hits = scanTextForSecrets(source, { path: 'packages/core/src/security/shapes.ts' });
      const entropy = hits.filter((h) => h.kind === 'generic_high_entropy');
      expect(entropy.map((h) => `line ${h.line}: ${h.reason}`)).toEqual([]);
    });

    it('produces no finding of any kind', () => {
      // `shapes.ts` is neither a fixture nor a document, so nothing here is
      // downgraded — any hit would count at full severity.
      expect(scanTextForSecrets(source, { path: 'packages/core/src/security/shapes.ts' })).toEqual(
        []
      );
    });
  });

  /**
   * R-29: the mnemonic rule fires on the wordlist that defines it.
   *
   * The rule's candidate regex is "twelve lowercase words" and the BIP-39
   * wordlist is a file of twelve-word lines, so the two are the same string.
   * No per-match check can separate them. The file-level predicate can: a
   * seed phrase is a line in a document, a wordlist is a file whose every
   * word is a BIP-39 word.
   */
  describe('isWordlistFile', () => {
    const wordlist = readFileSync(
      fileURLToPath(new URL('./bip39-english.ts', import.meta.url)),
      'utf8'
    );
    const PHRASE =
      'abandon ability able about above absent absorb abstract absurd abuse access accident';

    it('recognises the wordlist itself', () => {
      expect(isWordlistFile(wordlist)).toBe(true);
    });

    it('does not recognise a document that contains a phrase', () => {
      expect(
        isWordlistFile(
          `A seed phrase looks like this: ${PHRASE} — twelve words, all in the list. ` +
            'The point of this paragraph is that it is prose, and the rest of it is not ' +
            'mnemonic words at all, which is what makes the file a document rather than a ' +
            'dictionary of them. It needs more than fifty words to be judged at all, so the ' +
            'sentence keeps going for a while yet.'
        )
      ).toBe(false);
    });

    it('does not judge a file too short to be a dictionary', () => {
      // Twelve BIP-39 words and nothing else is a perfect 1.0 fraction. It is
      // also what a test fixture looks like, which is why there is a floor.
      expect(isWordlistFile(PHRASE)).toBe(false);
    });

    it('leaves a real phrase in a document reported', () => {
      // The guard must not suppress the rule it guards. This is the positive
      // fixture from secret-scanner.test.ts, moved to a document.
      const kinds = scanForSecrets([{ path: 'notes.md', content: PHRASE }]).map((d) => d.kind);
      expect(kinds).toContain('mnemonic');
    });

    it('reports nothing from the wordlist file', () => {
      const hits = scanForSecrets([
        { path: 'packages/core/src/security/bip39-english.ts', content: wordlist },
      ]);
      expect(hits.filter((h) => h.kind === 'mnemonic')).toEqual([]);
    });
  });
});
