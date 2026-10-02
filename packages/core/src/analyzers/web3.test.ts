import { describe, it, expect } from 'vitest';
import { analyzeWeb3 } from './web3.js';

/**
 * The web3 analyzer had the same fixture problem as stack detection, and
 * the consequence was worse.
 *
 * `fixtures/web3-hackathon/` supplies a `contracts/` directory and a
 * `test/*.t.sol` file. Read as evidence, that made the self-audit report
 * `hasContracts: true` and `hasContractTests: true` for a repository with
 * neither — and the launch checklist renders exactly that pair as
 * "Contracts covered by tests (Foundry / Hardhat) ✓".
 *
 * A false alarm costs someone a look. A false tick is a claim that a
 * capability exists when it does not, and it is the one the reader is least
 * likely to question.
 */
describe('analyzeWeb3 sample material', () => {
  it("does not count a Solidity sample under fixtures/ as this project's contracts", () => {
    const entries = [
      { path: 'packages/core/src/index.ts', size: 100 },
      { path: 'fixtures/web3-hackathon/contracts/Counter.sol', size: 300 },
      { path: 'fixtures/web3-hackathon/test/Counter.t.sol', size: 300 },
    ];
    const web3 = analyzeWeb3(entries, new Map());
    expect(web3.hasContracts).toBe(false);
    expect(web3.hasContractTests).toBe(false);
  });

  it("still counts the project's own contracts and tests", () => {
    const entries = [
      { path: 'contracts/Counter.sol', size: 300 },
      { path: 'test/Counter.t.sol', size: 300 },
    ];
    const web3 = analyzeWeb3(entries, new Map());
    expect(web3.hasContracts).toBe(true);
    expect(web3.hasContractTests).toBe(true);
  });

  it('reports a missing test suite when only the contracts are real', () => {
    // The pair is only meaningful if the two halves can disagree.
    const entries = [{ path: 'contracts/Counter.sol', size: 300 }];
    const web3 = analyzeWeb3(entries, new Map());
    expect(web3.hasContracts).toBe(true);
    expect(web3.hasContractTests).toBe(false);
  });
});
