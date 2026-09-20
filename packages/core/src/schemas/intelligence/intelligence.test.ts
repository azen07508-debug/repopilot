/**
 * Schema tests for the Repository Intelligence artifacts.
 *
 * The most important assertions here are the backward-compatibility
 * ones: v1 `Evidence` must survive a round trip through v2, and no
 * intelligence schema may be coupled to `Report.reportVersion`.
 */
import { describe, it, expect } from 'vitest';
import {
  EvidenceV2Schema,
  EvidenceSourceSchema,
  toEvidenceV2,
  toLegacyEvidence,
  RepositoryMapSchema,
  REPOSITORY_MAP_SCHEMA_VERSION,
  ModuleSchema,
  SymbolMapSchema,
  SymbolSchema,
  symbolId,
  DependencyGraphSchema,
  ArchitectureGraphSchema,
  emptyArchitectureGraph,
  ChangeImpactSchema,
  unavailableChangeImpact,
  AgentContextPackSchema,
  AGENT_CONTEXT_SCHEMA_VERSION,
} from './index.js';

const minimalRepository = {
  url: 'https://github.com/octocat/Hello-World',
  owner: 'octocat',
  name: 'Hello-World',
  defaultBranch: 'master',
};

describe('EvidenceV2', () => {
  it('upgrades a v1 evidence entry and preserves the legacy mirrors', () => {
    const v2 = toEvidenceV2({ file: 'src/auth/login.ts', line: 82, reason: 'no test coverage' });
    expect(v2.path).toBe('src/auth/login.ts');
    expect(v2.startLine).toBe(82);
    expect(v2.file).toBe('src/auth/login.ts');
    expect(v2.line).toBe(82);
    expect(v2.source).toBe('static-analysis');
    expect(() => EvidenceV2Schema.parse(v2)).not.toThrow();
  });

  it('round-trips v1 -> v2 -> v1 without loss', () => {
    const v1 = { file: 'src/api/user.ts', line: 12, reason: 'unused import' };
    expect(toLegacyEvidence(toEvidenceV2(v1))).toEqual(v1);
  });

  it('accepts an explicit source and confidence', () => {
    const v2 = toEvidenceV2(
      { file: 'README.md', line: null, reason: 'docs mention removed flag' },
      { source: 'documentation-analysis', confidence: 0.7 }
    );
    expect(v2.source).toBe('documentation-analysis');
    expect(v2.confidence).toBe(0.7);
    expect(v2.startLine).toBeNull();
  });

  it('rejects endLine before startLine', () => {
    const parsed = EvidenceV2Schema.safeParse({
      path: 'a.ts',
      startLine: 10,
      endLine: 5,
      reason: 'x',
      source: 'static-analysis',
      confidence: 0.5,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an out-of-range confidence', () => {
    const parsed = EvidenceV2Schema.safeParse({
      path: 'a.ts',
      startLine: 1,
      endLine: 1,
      reason: 'x',
      source: 'static-analysis',
      confidence: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown evidence source', () => {
    expect(EvidenceSourceSchema.safeParse('vibes').success).toBe(false);
    expect(EvidenceSourceSchema.safeParse('llm-inference').success).toBe(true);
  });
});

describe('RepositoryMapSchema', () => {
  it('fills defaults for a minimal repository', () => {
    const map = RepositoryMapSchema.parse({
      schemaVersion: REPOSITORY_MAP_SCHEMA_VERSION,
      generatedAt: '2026-09-19T00:00:00.000Z',
      repository: minimalRepository,
    });
    expect(map.entrypoints).toEqual([]);
    expect(map.modules).toEqual([]);
    expect(map.externalDependencies).toEqual([]);
    expect(map.degraded).toBe(false);
    expect(map.repository.commitSha).toBeNull();
  });

  it('pins its own schemaVersion independent of reportVersion', () => {
    expect(REPOSITORY_MAP_SCHEMA_VERSION).toBe('1.0');
    expect(
      RepositoryMapSchema.safeParse({
        schemaVersion: '2.0',
        generatedAt: 'now',
        repository: minimalRepository,
      }).success
    ).toBe(false);
  });

  it('rejects an importance outside 0..1', () => {
    expect(
      ModuleSchema.safeParse({
        name: 'authentication',
        path: 'packages/auth',
        kind: 'package',
        importance: 1.4,
        fileCount: 3,
      }).success
    ).toBe(false);
  });
});

describe('SymbolMapSchema', () => {
  it('builds a stable symbol id', () => {
    expect(symbolId('src/auth/login.ts', 'login', 12)).toBe('src/auth/login.ts#login#12');
  });

  it('parses a symbol with the typescript compiler parser', () => {
    const symbol = SymbolSchema.parse({
      id: symbolId('src/auth/login.ts', 'login', 12),
      name: 'login',
      type: 'function',
      path: 'src/auth/login.ts',
      startLine: 12,
      endLine: 40,
      parser: 'typescript-compiler',
      parserConfidence: 0.95,
    });
    expect(symbol.exported).toBe(false);
    expect(symbol.references).toBe(0);
  });

  it('reports a single-language failure as degraded, not as a crash', () => {
    const map = SymbolMapSchema.parse({
      schemaVersion: '1.0',
      languageCoverage: [
        { language: 'TypeScript', fileCount: 12, parser: 'typescript-compiler' },
        { language: 'Solidity', fileCount: 3, parser: 'regex', degraded: true },
      ],
      degraded: true,
      failures: [{ language: 'Solidity', reason: 'solidity parser unavailable' }],
    });
    expect(map.degraded).toBe(true);
    expect(map.failures).toHaveLength(1);
    expect(map.symbols).toEqual([]);
  });

  it('rejects endLine before startLine', () => {
    expect(
      SymbolSchema.safeParse({
        id: 'a#b#5',
        name: 'b',
        type: 'function',
        path: 'a.ts',
        startLine: 5,
        endLine: 2,
        parser: 'regex',
        parserConfidence: 0.4,
      }).success
    ).toBe(false);
  });
});

describe('ArchitectureGraphSchema', () => {
  it('accepts the empty graph helper', () => {
    const graph = ArchitectureGraphSchema.parse(emptyArchitectureGraph());
    expect(graph.llmUsed).toBe(false);
    expect(graph.nodes).toEqual([]);
  });

  it('refuses to be produced by an LLM', () => {
    expect(
      ArchitectureGraphSchema.safeParse({ ...emptyArchitectureGraph(), llmUsed: true }).success
    ).toBe(false);
  });

  it('keeps every edge traceable to evidence', () => {
    const graph = DependencyGraphSchema.parse({
      schemaVersion: '1.0',
      nodes: [{ id: 'file:src/a.ts', kind: 'file', name: 'a.ts', path: 'src/a.ts' }],
      edges: [
        {
          from: 'file:src/a.ts',
          to: 'pkg:react',
          kind: 'imports',
          evidence: [
            {
              path: 'src/a.ts',
              startLine: 1,
              endLine: 1,
              reason: 'import statement',
              source: 'static-analysis',
              confidence: 0.98,
            },
          ],
        },
      ],
    });
    expect(graph.edges[0]?.kind).toBe('imports');
    expect(graph.edges[0]?.weight).toBe(1);
  });
});

describe('ChangeImpactSchema', () => {
  it('degrades instead of throwing when git info is unavailable', () => {
    const impact = ChangeImpactSchema.parse(
      unavailableChangeImpact('main', 'feature/auth', 'Compare API unavailable')
    );
    expect(impact.degraded).toBe(true);
    expect(impact.risk).toBe('none');
    expect(impact.changedFiles).toEqual([]);
    expect(impact.limitations).toContain('Compare API unavailable');
  });

  it('parses a populated impact', () => {
    const impact = ChangeImpactSchema.parse({
      schemaVersion: '1.0',
      base: 'main',
      head: 'feature/auth',
      changedFiles: [{ path: 'src/auth/login.ts', status: 'modified', additions: 12, deletions: 3 }],
      affectedModules: [{ name: 'authentication', path: 'packages/auth', reason: 'direct', distance: 1 }],
      risk: 'medium',
      riskReasons: ['authentication flow changed without a test change'],
    });
    expect(impact.changedFiles[0]?.additions).toBe(12);
    expect(impact.risk).toBe('medium');
    expect(impact.changedSymbols).toEqual([]);
  });

  it('rejects an unknown risk level', () => {
    expect(
      ChangeImpactSchema.safeParse({ schemaVersion: '1.0', base: 'a', head: 'b', risk: 'catastrophic' })
        .success
    ).toBe(false);
  });
});

describe('AgentContextPackSchema', () => {
  it('produces a valid pack from required fields only', () => {
    const pack = AgentContextPackSchema.parse({
      contextVersion: AGENT_CONTEXT_SCHEMA_VERSION,
      generatedAt: '2026-09-19T00:00:00.000Z',
      repository: minimalRepository,
    });
    expect(pack.importantFiles).toEqual([]);
    expect(pack.knownRisks).toEqual([]);
    expect(pack.testStrategy.runner).toBeNull();
  });

  it('never carries file bodies', () => {
    const pack = AgentContextPackSchema.parse({
      contextVersion: AGENT_CONTEXT_SCHEMA_VERSION,
      generatedAt: '2026-09-19T00:00:00.000Z',
      repository: minimalRepository,
      importantFiles: [{ path: 'src/auth/login.ts', reason: 'entrypoint for auth' }],
    });
    expect(Object.keys(pack)).not.toContain('files');
    expect(JSON.stringify(pack)).not.toContain('export function login');
  });
});
