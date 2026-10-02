/**
 * Path predicates that more than one analyzer needs.
 *
 * These answer "whose code is this?", which is a different question from
 * the one `security/severity.ts` answers ("how much does a finding here
 * matter?"). They live together because the analyzers have to agree: stack
 * detection and web3 detection disagreeing is how the self-audit reported
 * `Solidity` and `Foundry` for a repository with no contracts, and then
 * ticked "Contracts covered by tests (Foundry / Hardhat)" — a green tick
 * over a capability that does not exist.
 */

/**
 * Directories holding material that belongs to a DIFFERENT project.
 *
 * `fixtures/web3-hackathon/` is a fake Solidity project that RepoPilot
 * audits inside its own test suite. Reading it as evidence tells you what
 * the fixtures are written in, not what RepoPilot is built with.
 *
 * Deliberately narrower than `isFixturePath`. That predicate includes
 * `test/` and `tests/`, which is right for severity — a credential in a
 * test file should not block a release. It is wrong here: a repository's
 * own `test/` directory holds tests OF that repository, and a
 * `test/Counter.sol` there really does mean the project is Solidity. Only
 * directories whose name declares them as stand-in data are excluded.
 *
 * `examples/` and `mocks/` are deliberately NOT here. A library's examples
 * are usually written in the library's own stack, and a Solidity project's
 * mocks are still Solidity. Excluding them would lose real signal to fix a
 * problem they do not cause.
 */
const SAMPLE_MATERIAL_PATH =
  /(^|\/)(fixtures?|__fixtures__|test-?data|test-fixtures)\//i;

/** True when the path is stand-in material for testing, not project code. */
export function isSampleMaterialPath(path: string): boolean {
  return SAMPLE_MATERIAL_PATH.test(path);
}

/**
 * The names a README, a license, or an env template may have.
 *
 * One list each, shared by the free check and the full audit, because the
 * two used to carry their own and disagreed about the same repository:
 *
 *   - `free-check` accepted a bare `README`; the audit did not. That is not
 *     hypothetical. `octocat/Hello-World` — the repository this project's
 *     own MCP script audits by default — has exactly one file, called
 *     `README`. The free check said `has-readme: PASS`, the paid audit
 *     reported `[high] README.md is missing or empty` as its top blocker,
 *     and the documentation score fell to 5.5.
 *   - The license lists differed too: one accepted `COPYING`, the other
 *     `LICENCE`. A repository with only a `COPYING` file would have passed
 *     one entry point and failed the other.
 *
 * These are the unions, so unifying did not make either entry point
 * stricter than it already was. Case variants are listed explicitly rather
 * than matched case-insensitively, because the audit looks these names up
 * by exact path.
 */
export const README_FILENAMES: readonly string[] = [
  'README.md',
  'README.markdown',
  'README.rst',
  'README.txt',
  'README',
  'readme.md',
  'readme.markdown',
  'readme.rst',
  'readme.txt',
  'readme',
];

export const LICENSE_FILENAMES: readonly string[] = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
  'license',
  'License',
];

export const ENV_EXAMPLE_FILENAMES: readonly string[] = [
  '.env.example',
  '.env.sample',
  'example.env',
  'sample.env',
  'env.example',
];
