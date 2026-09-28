/**
 * The three intelligence artifacts, snapshotted over the real fixtures.
 *
 * `docs/REPOSITORY_INTELLIGENCE_PLAN.md` §10.3 asks V0.2-g for exactly this,
 * and the builder tests next door deliberately are not it: they assert what
 * has to hold for *any* repository — schema-valid, reproducible, no path the
 * tree does not have — which is the right thing to assert but says nothing
 * about whether the answer is still the *same* answer.
 *
 * A snapshot says that. The value is not the file; it is the diff. Every
 * builder here is a pure function of the tree, so when one of them starts
 * reporting a module it did not report before, or stops reporting an edge, the
 * change shows up as a reviewable diff on a small real repository instead of
 * as a silent change in what the product tells an agent. That is the whole
 * point of running it over fixtures rather than over a mock: the fixtures are
 * eight-file and two-file repositories, small enough that a human can read the
 * diff and say whether the new answer is a better one.
 *
 * Two things make the snapshots stable, and both are load-bearing elsewhere:
 * `generatedAt` is injected (a builder that reads the clock cannot be
 * snapshotted), and every artifact sorts its output (D-021, D-025, D-027).
 *
 * Regenerate with `pnpm test -u` — but read the diff first. A snapshot that
 * was updated without being read is a test that has stopped testing.
 */
import { describe, it, expect } from 'vitest';
import { buildRepositoryMap } from './repository-map/index.js';
import { buildSymbolMap } from './symbols/index.js';
import { buildDependencyGraph } from './graph/index.js';
import { FIXTURE_NAMES, GENERATED_AT, loadFixture, metadataFor } from '../test-utils/fixtures.js';

describe('the intelligence artifacts, over the real fixtures', () => {
  /**
   * The fixture list itself is snapshotted, so adding a fixture is a visible
   * change. `toMatchSnapshot` inside the loop below would otherwise accept a
   * new fixture by quietly writing a new snapshot for it.
   */
  it('covers every fixture on disk', () => {
    expect(FIXTURE_NAMES).toMatchSnapshot();
  });

  for (const name of FIXTURE_NAMES) {
    describe(name, () => {
      const { entries, contents } = loadFixture(name);

      it('Repository Map', () => {
        expect(
          buildRepositoryMap({ metadata: metadataFor(name), entries, contents, generatedAt: GENERATED_AT })
        ).toMatchSnapshot();
      });

      it('Symbol Map', () => {
        expect(buildSymbolMap({ entries, contents })).toMatchSnapshot();
      });

      it('Dependency Graph', () => {
        expect(buildDependencyGraph({ entries, contents })).toMatchSnapshot();
      });
    });
  }
});
