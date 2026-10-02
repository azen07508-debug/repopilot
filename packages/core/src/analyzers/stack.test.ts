import { describe, it, expect } from 'vitest';
import { detectStack, stackLabels } from '../analyzers/stack.js';

describe('detectStack', () => {
  it('detects Node.js via package.json', () => {
    const entries = [{ path: 'package.json', size: 100 }];
    const contents = new Map([['package.json', '{"dependencies": {"react": "^18.0.0"}}']]);
    const signals = detectStack(entries, contents);
    const labels = stackLabels(signals);
    expect(labels).toContain('Node.js');
    expect(labels).toContain('React');
  });

  it('detects TypeScript via .ts files', () => {
    const entries = [{ path: 'src/index.ts', size: 100 }];
    const contents = new Map<string, string>();
    const signals = detectStack(entries, contents);
    const labels = stackLabels(signals);
    expect(labels).toContain('TypeScript');
  });

  it('detects Foundry', () => {
    const entries = [{ path: 'foundry.toml', size: 200 }];
    const contents = new Map([['foundry.toml', '[profile.default]\n']]);
    const signals = detectStack(entries, contents);
    expect(stackLabels(signals)).toContain('Foundry');
  });

  it('detects Hardhat', () => {
    const entries = [{ path: 'hardhat.config.ts', size: 100 }];
    const contents = new Map<string, string>();
    const signals = detectStack(entries, contents);
    expect(stackLabels(signals)).toContain('Hardhat');
  });

  it('detects Solidity via .sol files', () => {
    const entries = [{ path: 'contracts/Foo.sol', size: 100 }];
    const contents = new Map<string, string>();
    const signals = detectStack(entries, contents);
    expect(stackLabels(signals)).toContain('Solidity');
  });

  it('detects Railway from railway.toml', () => {
    const entries = [{ path: 'railway.toml', size: 50 }];
    const contents = new Map<string, string>();
    const signals = detectStack(entries, contents);
    expect(stackLabels(signals)).toContain('Railway');
  });

  it('detects GitHub Actions', () => {
    const entries = [{ path: '.github/workflows/ci.yml', size: 100 }];
    const contents = new Map<string, string>();
    const signals = detectStack(entries, contents);
    expect(stackLabels(signals)).toContain('GitHub Actions');
  });
});

/**
 * A fixture tree describes a different project.
 *
 * `fixtures/web3-hackathon/` is a fake Solidity project that RepoPilot
 * audits inside its own test suite. Counting it as evidence made the
 * self-audit report `Solidity, Foundry` for a repository with no contracts,
 * and the launch checklist then ticked "Contracts covered by tests".
 *
 * The negative case is the one that matters most here: an exclusion that is
 * too wide would silently stop detecting real projects, and nothing would
 * go red.
 */
describe('sample material is not project evidence', () => {
  it('ignores a Solidity sample under fixtures/', () => {
    const entries = [
      { path: 'packages/core/src/index.ts', size: 100 },
      { path: 'fixtures/web3-hackathon/foundry.toml', size: 200 },
      { path: 'fixtures/web3-hackathon/contracts/Counter.sol', size: 300 },
      { path: 'fixtures/web3-hackathon/test/Counter.t.sol', size: 300 },
    ];
    const labels = stackLabels(detectStack(entries, new Map()));
    expect(labels).toContain('TypeScript');
    expect(labels).not.toContain('Solidity');
    expect(labels).not.toContain('Foundry');
  });

  it("still reads a project's own test directory as evidence", () => {
    // `test/` is NOT excluded, and must not be. A project's own tests say
    // something about the project; stand-in material for another project
    // does not. `isFixturePath` — which does match `test/` — is the wrong
    // predicate here, and this test is what keeps them apart.
    const entries = [
      { path: 'contracts/Counter.sol', size: 300 },
      { path: 'test/Counter.t.sol', size: 300 },
    ];
    const labels = stackLabels(detectStack(entries, new Map()));
    expect(labels).toContain('Solidity');
    expect(labels).toContain('Foundry');
  });

  it('does not let a fixture config file stand in for a deployment target', () => {
    const entries = [{ path: 'fixtures/deploy-sample/railway.toml', size: 50 }];
    expect(stackLabels(detectStack(entries, new Map()))).not.toContain('Railway');
  });
});
