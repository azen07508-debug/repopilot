import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PaymentConfig } from '@repopilot/okx-adapter';
import type { FreeCheckSource, RepoMetadata } from '@repopilot/core';
import { buildMcpServer, BILLING } from './index.js';
import {
  MAX_CONTEXT_DEPENDENCIES,
  type RepositorySnapshot,
  type SnapshotLoader,
} from './intelligence.js';

const payment: PaymentConfig = {
  mode: 'mock',
  okx: { recipientAddress: '', network: 'xlayer', x402Version: 2 },
  pricing: {
    quickScan: { amount: '0.02', currency: 'USDT' },
    fullAudit: { amount: '0.10', currency: 'USDT' },
  },
};

const ALLOWED_HOSTS = ['github.com', 'raw.githubusercontent.com'];

beforeAll(() => {
  process.env['ALLOWED_REPO_HOSTS'] = ALLOWED_HOSTS.join(',');
});

/**
 * The MCP tool surface, written out by hand and deliberately not derived from
 * the code it checks.
 *
 * One list, not two. It used to be copied into both the "registers every
 * advertised tool" test and the "registers nothing unadvertised" test, and two
 * copies of a list that must stay in step with a third place (the header) is
 * one copy too many — a tool added to one and not the other would have passed.
 *
 * Keeping it hand-written is the point: it is the only place in the suite that
 * says what the product *should* expose, so a tool that is deleted by accident
 * fails here and makes someone decide, instead of every assertion being
 * computed from the same wrong value. The other two statements of this list —
 * the `server.tool()` registrations and the `BILLING` map — are compared
 * against it, and against each other, in the tests below.
 */
const ADVERTISED_TOOLS = [
  'audit_github_repository',
  'reaudit_repository',
  'free_check',
  'get_fix_plan',
  'quality_status',
  'release_check',
  'compare_audits',
  'list_audit_history',
  'get_audit_status',
  'get_repopilot_capabilities',
  'get_repository_context',
  'get_repository_map',
  'get_symbol_map',
  'get_dependency_graph',
];

interface RegisteredTool {
  callback: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
}

/**
 * The SDK's internal registry.
 *
 * Reached through the same two shapes the SDK has used, because the field has
 * moved once already and a test that breaks on an upgrade for the wrong reason
 * is worse than one that checks both.
 */
function registryOf(server: unknown): Record<string, RegisteredTool> {
  const s = server as {
    _registeredTools?: Record<string, RegisteredTool>;
    server?: { _registeredTools?: Record<string, RegisteredTool> };
  };
  return s._registeredTools ?? s.server?._registeredTools ?? {};
}

function toolNames(server: unknown): string[] {
  return Object.keys(registryOf(server));
}

/** Call a tool the way the transport would, and parse the JSON it answered with. */
async function callTool<T = unknown>(
  loader: SnapshotLoader,
  name: string,
  args: Record<string, unknown> = {},
  freeCheckSource?: FreeCheckSource
): Promise<T> {
  const { server } = buildMcpServer({
    payment,
    allowedHosts: ALLOWED_HOSTS,
    snapshotLoader: loader,
    ...(freeCheckSource === undefined ? {} : { freeCheckSource }),
  });
  const tool = registryOf(server)[name];
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const result = await tool.callback(args);
  return JSON.parse(result.content[0]?.text ?? 'null') as T;
}

function metadata(name: string): RepoMetadata {
  return {
    owner: 'repopilot',
    name,
    defaultBranch: 'main',
    license: null,
    lastUpdatedAt: null,
    visibility: 'public',
    archived: false,
    stars: 0,
    openIssues: 0,
    openPulls: 0,
    description: null,
    primaryLanguage: null,
    url: `https://github.com/repopilot/${name}`,
  };
}

function snapshotOf(files: Record<string, string>, name = 'sample'): RepositorySnapshot {
  return {
    owner: 'repopilot',
    repo: name,
    ref: 'main',
    metadata: metadata(name),
    entries: Object.entries(files).map(([path, content]) => ({ path, size: content.length })),
    contents: new Map(Object.entries(files)),
    truncated: false,
    degraded: false,
  };
}

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'sample',
    version: '1.0.0',
    dependencies: { express: '^4.19.0' },
    devDependencies: { vitest: '^2.1.8' },
  },
  null,
  2
);

const SAMPLE: Record<string, string> = {
  'package.json': PACKAGE_JSON,
  'README.md': '# sample\n\nA sample.\n',
  'src/index.ts': [
    "import express from 'express';",
    "import { helper } from './util.js';",
    '',
    'export function main(): void {',
    '  helper();',
    '}',
    '',
  ].join('\n'),
  'src/util.ts': ['export function helper(): string {', "  return 'x';", '}', ''].join('\n'),
  // The third file in `src`, and the reason it is here: a directory needs
  // three files before the map calls it a module (MIN_MODULE_FILES), and
  // "modules with an importance score" is the headline of two of the tools.
  'src/config.ts': 'export const DEFAULT_TIMEOUT = 30;\n',
};

/** A loader that answers with the same snapshot for every repository. */
function loaderOf(snapshot: RepositorySnapshot): SnapshotLoader & { calls: number } {
  const loader = vi.fn(async () => snapshot) as unknown as SnapshotLoader & { calls: number };
  return loader;
}

describe('MCP server', () => {
  it('builds and registers tools', () => {
    const { server } = buildMcpServer({ payment, allowedHosts: ALLOWED_HOSTS });
    expect(server).toBeTruthy();
    expect(toolNames(server).length).toBeGreaterThan(0);
  });

  it('exposes the quality gate', () => {
    const { server } = buildMcpServer({ payment, allowedHosts: ALLOWED_HOSTS });
    const names = toolNames(server);
    expect(names).toContain('quality_status');
    expect(names).toContain('release_check');
  });

  it('registers every tool in the frozen list', () => {
    // `ADVERTISED_TOOLS` is the public surface, pinned by hand on purpose: a
    // tool that disappears should fail a test and make someone decide,
    // rather than quietly disappear from the product. It is the *oracle*
    // here, so it is deliberately not derived from the code it checks.
    const { server } = buildMcpServer({ payment, allowedHosts: ALLOWED_HOSTS });
    const names = toolNames(server);
    for (const tool of ADVERTISED_TOOLS) {
      expect(names, `missing tool: ${tool}`).toContain(tool);
    }
  });

  it('registers nothing outside the frozen list', () => {
    const { server } = buildMcpServer({ payment, allowedHosts: ALLOWED_HOSTS });
    const advertised = new Set(ADVERTISED_TOOLS);
    for (const name of toolNames(server)) {
      expect(advertised, `undocumented tool: ${name}`).toContain(name);
    }
  });

  it('bills exactly the tools it registers', () => {
    // The two checks above compare the registrations against a hand-written
    // list. Neither of them ever looked at `BILLING`, which is the other
    // place the same list is written down — so the map an agent reads to
    // decide what it can afford was asserted by nothing. This is the check
    // the old test's name claimed to be.
    const { server } = buildMcpServer({ payment, allowedHosts: ALLOWED_HOSTS });
    expect([...Object.keys(BILLING)].sort()).toEqual([...toolNames(server)].sort());
    expect([...Object.keys(BILLING)].sort()).toEqual([...ADVERTISED_TOOLS].sort());
  });
});

/**
 * The free check, on the AI-agent channel.
 *
 * `MARKETPLACE_LISTING.md` calls Free Check "the entry point used by other AI
 * agents to triage a repo before deciding to pay for a full audit". MCP is that
 * channel and the tool was absent from it, so these tests exist to keep it
 * there — and to keep it honest about being the cheap one: it reads a tree
 * listing and never asks the snapshot loader for file contents.
 */
describe('the free check tool', () => {
  const FILES = ['README.md', 'LICENSE', '.env.example', 'package.json', 'pnpm-lock.yaml'];

  function freeCheckSourceOf(files: string[]): FreeCheckSource & { refs: string[] } {
    const state = { refs: [] as string[] };
    const source: FreeCheckSource = {
      metadata: async () => metadata('sample'),
      tree: async (_owner, _repo, ref) => {
        state.refs.push(ref);
        return files.map((path) => ({ path, size: 10 }));
      },
    };
    return Object.assign(source, state);
  }

  interface FreeCheckAnswer {
    kind: string;
    reportVersion: string;
    checks: { id: string; passed: boolean; evidence: string | null }[];
    score: { value: number; passed: number; total: number };
  }

  it('answers with a FreeCheckReport, not a job', async () => {
    const source = freeCheckSourceOf(FILES);
    const result = await callTool<FreeCheckAnswer>(
      loaderOf(snapshotOf(SAMPLE)),
      'free_check',
      { repo_url: 'https://github.com/repopilot/sample' },
      source
    );

    expect(result.kind).toBe('free-check');
    expect(result.reportVersion).toBe('1.0');
    expect(result.checks.map((c) => c.id)).toEqual([
      'has-readme',
      'has-license',
      'has-env-example',
      'has-lockfile',
      'has-ci',
    ]);
    // Four of five: there is no CI configuration in FILES.
    expect(result.score).toEqual({ value: 80, passed: 4, total: 5 });
  });

  it('reads the tree and never asks for file contents', async () => {
    // The header claims `free_check` is the cheapest repository-reading tool
    // because presence is a question about names. If it ever starts routing
    // through the snapshot loader, that claim is false and the tool silently
    // became a tarball download.
    const loader = loaderOf(snapshotOf(SAMPLE));
    const source = freeCheckSourceOf(FILES);
    await callTool(loader, 'free_check', { repo_url: 'https://github.com/repopilot/sample' }, source);

    expect(loader).not.toHaveBeenCalled();
    expect(source.refs).toEqual(['main']);
  });

  it('returns a structured error rather than throwing when the fetch fails', async () => {
    const source: FreeCheckSource = {
      metadata: async () => metadata('sample'),
      tree: async () => {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      },
    };

    const result = await callTool<{ error: string; message: string }>(
      loaderOf(snapshotOf(SAMPLE)),
      'free_check',
      { repo_url: 'https://github.com/repopilot/missing' },
      source
    );

    expect(result.error).toBe('repository_unavailable');
    expect(result.message).toBe('[404] Not Found');
  });

  it('is advertised as free in the capabilities billing map', () => {
    expect(BILLING.free_check.paid).toBe(false);
  });
});

describe('the intelligence tools', () => {
  it('answers get_repository_context from the repository itself', async () => {
    const context = await callTool<{
      repository: { name: string; ref: string; url: string };
      symbolTotal: number;
      symbolCounts: { type: string; count: number }[];
      fileCount: number;
    }>(loaderOf(snapshotOf(SAMPLE)), 'get_repository_context', {
      repo_url: 'https://github.com/repopilot/sample',
    });

    expect(context.repository.name).toBe('sample');
    expect(context.repository.ref).toBe('main');
    expect(context.fileCount).toBe(5);
    // Three declarations — two functions and a constant — and the counts are
    // what let a caller decide whether the full symbol list is worth a second
    // call.
    expect(context.symbolTotal).toBe(3);
    expect(context.symbolCounts).toEqual([
      { type: 'function', count: 2 },
      { type: 'constant', count: 1 },
    ]);
  });

  it('reports declared dependencies with their version and kind', async () => {
    // The reason the context tool reads the map and not the graph: a manifest
    // says what version was asked for, and whether it is a runtime dependency.
    // Collapsing these to names would throw away both.
    const context = await callTool<{
      declaredDependencies: { name: string; version: string | null; kind: string }[];
    }>(loaderOf(snapshotOf(SAMPLE)), 'get_repository_context', {
      repo_url: 'https://github.com/repopilot/sample',
    });

    expect(context.declaredDependencies).toEqual([
      { name: 'express', version: '^4.19.0', kind: 'runtime' },
      { name: 'vitest', version: '^2.1.8', kind: 'dev' },
    ]);
  });

  it('caps the declared dependencies, and says that it did', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_CONTEXT_DEPENDENCIES + 5; i += 1) {
      many[`pkg-${String(i).padStart(3, '0')}`] = `^${i}.0.0`;
    }
    const snapshot = snapshotOf({
      'package.json': JSON.stringify({ name: 'wide', version: '1.0.0', dependencies: many }),
      'src/index.ts': 'export const x = 1;\n',
    });

    const context = await callTool<{
      declaredDependencies: unknown[];
      declaredDependenciesTrimmed: { returned: number; total: number; omitted: number; note: string };
      limitations: string[];
    }>(loaderOf(snapshot), 'get_repository_context', {
      repo_url: 'https://github.com/repopilot/wide',
    });

    expect(context.declaredDependencies).toHaveLength(MAX_CONTEXT_DEPENDENCIES);
    expect(context.declaredDependenciesTrimmed).toEqual({
      returned: MAX_CONTEXT_DEPENDENCIES,
      total: MAX_CONTEXT_DEPENDENCIES + 5,
      omitted: 5,
      note: `Declared dependencies: the first ${MAX_CONTEXT_DEPENDENCIES} of ${
        MAX_CONTEXT_DEPENDENCIES + 5
      } are listed; 5 more were withheld.`,
    });
    // The list was cut, so the cut has to be visible in the one place a caller
    // reads for caveats — not only in the field beside the list.
    expect(context.limitations).toContain(context.declaredDependenciesTrimmed.note);
  });

  it('ranks the heaviest imports into the context', async () => {
    const context = await callTool<{ topEdges: { from: string; to: string; weight: number }[] }>(
      loaderOf(snapshotOf(SAMPLE)),
      'get_repository_context',
      { repo_url: 'https://github.com/repopilot/sample' }
    );

    expect(context.topEdges).toContainEqual({ from: 'src/index.ts', to: 'src/util.ts', weight: 1 });
  });

  it('answers get_repository_map with modules, entrypoints and dependencies', async () => {
    const map = await callTool<{
      modules: { path: string; kind: string }[];
      entrypoints: { path: string; kind: string }[];
      importantFiles: { path: string }[];
      externalDependencies: { name: string; manifest: string }[];
      repository: { name: string };
    }>(loaderOf(snapshotOf(SAMPLE)), 'get_repository_map', {
      repo_url: 'https://github.com/repopilot/sample',
    });

    expect(map.repository.name).toBe('sample');
    // The repository root is a module in its own right — the manifests and the
    // README live there — and `src` earns its place with three files.
    expect(map.modules.map((m) => `${m.path}:${m.kind}`)).toEqual(['.:package', 'src:directory']);
    expect(map.entrypoints).toContainEqual(
      expect.objectContaining({ path: 'src/index.ts', kind: 'library' })
    );
    expect(map.importantFiles.map((f) => f.path)).toEqual(['src/index.ts', 'package.json']);
    expect(map.externalDependencies).toContainEqual(
      expect.objectContaining({ name: 'express', manifest: 'package.json' })
    );
  });

  it('answers get_symbol_map with line ranges', async () => {
    const view = await callTool<{
      symbols: { name: string; path: string; startLine: number; type: string }[];
      symbolsTrimmed: { note: string | null };
      failures: unknown[];
    }>(loaderOf(snapshotOf(SAMPLE)), 'get_symbol_map', {
      repo_url: 'https://github.com/repopilot/sample',
    });

    expect(view.symbols).toContainEqual(
      expect.objectContaining({ name: 'helper', path: 'src/util.ts', startLine: 1, type: 'function' })
    );
    expect(view.symbolsTrimmed.note).toBeNull();
    expect(view.failures).toEqual([]);
  });

  it('names the languages it cannot read instead of guessing', async () => {
    // A map that silently returns nothing for a language reads as "this
    // repository declares nothing", which is the opposite of the truth.
    const snapshot = snapshotOf({
      'src/app.ts': 'export const a = 1;\n',
      'src/legacy.c': 'int legacy(void) { return 1; }\n',
    });

    const view = await callTool<{ symbols: { name: string }[]; failures: { language: string; reason: string }[] }>(
      loaderOf(snapshot),
      'get_symbol_map',
      { repo_url: 'https://github.com/repopilot/sample' }
    );

    expect(view.symbols.map((s) => s.name)).toEqual(['a']);
    expect(view.failures.map((f) => f.language)).toEqual(['C']);
    expect(view.failures[0]?.reason).toContain('No extractor');
  });

  it('narrows the symbol map by path_prefix rather than raising the cap', async () => {
    const view = await callTool<{
      symbols: { name: string; path: string }[];
      symbolsTrimmed: { returned: number; total: number; note: string | null };
    }>(loaderOf(snapshotOf(SAMPLE)), 'get_symbol_map', {
      repo_url: 'https://github.com/repopilot/sample',
      path_prefix: 'src',
    });

    // `package.json` and `README.md` are at the root and are not under `src`.
    expect(view.symbols.map((s) => s.path)).toEqual([
      'src/config.ts',
      'src/index.ts',
      'src/util.ts',
    ]);
    // The note counts what was filtered, not the whole map: a caller who
    // narrowed is told about what it narrowed to.
    expect(view.symbolsTrimmed).toEqual({ returned: 3, total: 3, omitted: 0, note: null });
  });

  it('takes "." as the whole repository, which is how the map spells the root', async () => {
    const view = await callTool<{ symbols: { name: string }[] }>(
      loaderOf(snapshotOf(SAMPLE)),
      'get_symbol_map',
      { repo_url: 'https://github.com/repopilot/sample', path_prefix: '.' }
    );

    expect(view.symbols.map((s) => s.name)).toEqual(['DEFAULT_TIMEOUT', 'main', 'helper']);
  });

  it('answers get_dependency_graph with externals pulled out of the nodes', async () => {
    const graph = await callTool<{
      nodes: { id: string; kind: string }[];
      edges: { from: string; to: string; evidence: { line: number }[] }[];
      externalDependencies: string[];
      limitations: string[];
    }>(loaderOf(snapshotOf(SAMPLE)), 'get_dependency_graph', {
      repo_url: 'https://github.com/repopilot/sample',
    });

    expect(graph.externalDependencies).toEqual(['express']);
    // The external is in the flat list and not in `nodes`, so the node cap is
    // spent on the repository rather than on `express`.
    expect(graph.nodes.map((n) => n.id)).toEqual(['src/index.ts', 'src/util.ts']);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: 'src/index.ts',
        to: 'src/util.ts',
        evidence: [expect.objectContaining({ line: 2 })],
      })
    );
  });

  it('merges what every artifact could not read into the context', async () => {
    // Three different kinds of "I could not tell you", and the one call that
    // must not lose any of them: an import that matches no file (the graph), a
    // language with no extractor (the symbols), and whatever the map reports.
    const snapshot = snapshotOf(
      {
        'src/app.ts': ["import { missing } from './nowhere.js';", '', 'export const app = missing;', ''].join(
          '\n'
        ),
        'src/legacy.c': 'int legacy(void) { return 1; }\n',
      },
      'messy'
    );

    const context = await callTool<{ limitations: string[] }>(
      loaderOf(snapshot),
      'get_repository_context',
      { repo_url: 'https://github.com/repopilot/messy' }
    );

    expect(context.limitations.some((line) => line.includes('./nowhere.js'))).toBe(true);
    expect(context.limitations.some((line) => line.startsWith('C: '))).toBe(true);
  });

  it('returns a structured error rather than throwing when the fetch fails', async () => {
    // A tool that throws gives an agent nothing to retry with.
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    const loader = vi.fn(async () => {
      throw notFound;
    }) as unknown as SnapshotLoader;

    const result = await callTool<{ error: string; message: string }>(
      loader,
      'get_repository_map',
      { repo_url: 'https://github.com/repopilot/missing' }
    );

    expect(result.error).toBe('repository_unavailable');
    // The status is the difference between "check the URL" and "wait and retry".
    expect(result.message).toBe('[404] Not Found');
  });

  it('describes a thrown non-Error without inventing a message', async () => {
    const loader = vi.fn(async () => {
      throw 'gateway went away';
    }) as unknown as SnapshotLoader;

    const result = await callTool<{ error: string; message: string }>(
      loader,
      'get_repository_map',
      { repo_url: 'https://github.com/repopilot/sample' }
    );

    expect(result.message).toBe('gateway went away');
  });

  it('reads a repository once however many tools ask about it', async () => {
    const loader = loaderOf(snapshotOf(SAMPLE));
    const { server } = buildMcpServer({
      payment,
      allowedHosts: ALLOWED_HOSTS,
      snapshotLoader: loader,
    });
    const registry = registryOf(server);

    for (const name of [
      'get_repository_context',
      'get_repository_map',
      'get_symbol_map',
      'get_dependency_graph',
    ]) {
      await registry[name]?.callback({ repo_url: 'https://github.com/repopilot/sample' });
    }

    expect(loader).toHaveBeenCalledTimes(1);
  });
});
