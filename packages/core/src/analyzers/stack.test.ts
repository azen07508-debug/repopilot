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
