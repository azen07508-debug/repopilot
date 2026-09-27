/**
 * Dependency Graph builder (V0.2-f).
 *
 * A pure derivation of `entries + contents`: for every file that declares
 * imports, which files or packages it reaches. Nothing is fetched, nothing is
 * executed, and nothing is inferred from a name alone.
 *
 * The shape of the artifact follows from three choices:
 *
 *  - **A node exists because an edge touches it.** A file with no imports and
 *    nothing importing it carries no information the file list does not
 *    already have — the Repository Map lists files — so it is not a node.
 *    Absence from the graph is the answer to "what does this import?", and it
 *    is a cheaper answer than a node per file in a two-thousand-file tree.
 *  - **The unit of an edge is the unit the language imports.** TypeScript
 *    imports a file, so the target is a `file` node. Go imports a package,
 *    which is a directory, so the target is a `module` node. A bare specifier
 *    that names nothing in this repository is an `external-dependency`.
 *  - **An unresolved import is not an edge.** A relative specifier that names
 *    no file is reported in `limitations`, with the file and line that wrote
 *    it. Turning it into an edge to the nearest-looking path would be the
 *    one failure mode this artifact must not have.
 */
import {
  GRAPH_SCHEMA_VERSION,
  DependencyGraphSchema,
  type DependencyGraph,
  type GraphNode,
} from '../../schemas/intelligence/graph.js';
import type { EvidenceV2 } from '../../schemas/intelligence/evidence-v2.js';
import { classifyFile, detectLanguage, type FileEntry } from '../../git/files.js';
import { isProgrammingLanguage } from '../languages.js';
import { DEFAULT_MAX_FILE_BYTES } from '../limits.js';
import { compareStrings } from '../order.js';
import { extractImports, supportsImports } from './imports.js';
import { indexTree, resolveSpecifier, type Resolution, type TreeIndex } from './resolve.js';

/** A file importing more than this is generated, not written. */
export const MAX_IMPORTS_PER_FILE = 500;

export const MAX_NODES = 10000;
export const MAX_EDGES = 20000;

/** One line per broken import is enough to act on; more is a wall. */
const MAX_UNRESOLVED_LINES = 10;
const MAX_FAILURE_LINES = 20;

export interface DependencyGraphInput {
  entries: FileEntry[];
  contents: Map<string, string>;
  maxFileBytes?: number;
  /**
   * Module name → the directory it owns, from the Repository Map. Without it
   * every bare specifier is an external dependency, which is the honest
   * answer for a caller that has not built a map.
   */
  modules?: ReadonlyMap<string, string>;
  /** Import prefixes that stand for the repository root, e.g. a `go.mod` module path. */
  rootPrefixes?: readonly string[];
  /** Injectable so the caps can be tested without building 20 000 edges. */
  maxEdges?: number;
  maxNodes?: number;
  maxImportsPerFile?: number;
}

export function buildDependencyGraph(input: DependencyGraphInput): DependencyGraph {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxEdges = input.maxEdges ?? MAX_EDGES;
  const maxNodes = input.maxNodes ?? MAX_NODES;
  const maxImportsPerFile = input.maxImportsPerFile ?? MAX_IMPORTS_PER_FILE;

  const tree = indexTree(input.entries);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, MutableEdge>();
  const limitations: string[] = [];

  const oversizeByLanguage = new Map<string, number>();
  const unsupported = new Map<string, number>();
  const failures: string[] = [];
  const unresolved: string[] = [];
  const perFileCapped: string[] = [];

  // Sorted so the result does not depend on the order the tree was listed in.
  for (const entry of [...input.entries].sort((a, b) => compareStrings(a.path, b.path))) {
    if (classifyFile(entry.path, entry.size).kind !== 'text') continue;

    const language = detectLanguage(entry.path);
    if (language === null || !isProgrammingLanguage(language)) continue;

    const content = input.contents.get(entry.path);
    // No content means the fetch never brought this file back. That is the
    // caller's degradation to report, not this builder's.
    if (content === undefined) continue;

    if (entry.size > maxFileBytes) {
      oversizeByLanguage.set(language, (oversizeByLanguage.get(language) ?? 0) + 1);
      continue;
    }

    if (!supportsImports(language)) {
      unsupported.set(language, (unsupported.get(language) ?? 0) + 1);
      continue;
    }

    let records;
    try {
      records = extractImports(entry.path, content, language);
    } catch (error) {
      // A failure in one file must never fail the whole graph (D-018).
      failures.push(`${entry.path}: ${describe(error)}`);
      continue;
    }
    if (records === null) {
      unsupported.set(language, (unsupported.get(language) ?? 0) + 1);
      continue;
    }

    const kept = records.slice(0, maxImportsPerFile);
    if (kept.length < records.length) perFileCapped.push(entry.path);

    for (const record of kept) {
      const resolution = resolveSpecifier({
        specifier: record.specifier,
        fromPath: entry.path,
        language,
        tree,
        modules: input.modules,
        rootPrefixes: input.rootPrefixes,
      });

      if (resolution.kind === 'unresolved') {
        // Only a specifier that had to resolve somewhere is worth reporting.
        // `from a.b import c` also tries `a.b.c`, and `c` not being a
        // submodule is the normal case, not a broken import.
        if (record.certain) {
          unresolved.push(`${entry.path}:${record.line} imports "${record.raw}" — ${resolution.reason}`);
        }
        continue;
      }

      // An uncertain record is a guess that a name might be a submodule. When
      // the guess misses, the honest answer is "that is a name inside the
      // module already recorded" — not "that is a third-party package".
      // `from fastapi import FastAPI` must not add an edge to
      // `external:fastapi.FastAPI`, and `from pkg.util import Thing` must not
      // add one to `external:pkg.util.Thing` when `Thing` is a class.
      if (!record.certain && resolution.kind === 'external') continue;

      addEdge(nodes, edges, entry.path, resolution, record.line, record.raw, language);
    }
  }

  for (const [language, count] of oversizeByLanguage) {
    limitations.push(
      `${count} ${language} file(s) exceeded the ${maxFileBytes}-byte limit and were not read for imports (R-18).`
    );
  }
  for (const [language, count] of unsupported) {
    limitations.push(
      `No import extractor is implemented for ${language}; ${count} file(s) contributed no edges.`
    );
  }
  for (const line of failures.slice(0, MAX_FAILURE_LINES)) {
    limitations.push(`An import extractor failed and the file contributed no edges — ${line}.`);
  }
  if (failures.length > MAX_FAILURE_LINES) {
    limitations.push(`…and ${failures.length - MAX_FAILURE_LINES} more file(s) whose extractor failed.`);
  }
  for (const path of perFileCapped.slice(0, MAX_FAILURE_LINES)) {
    limitations.push(
      `${path} declares more than ${maxImportsPerFile} imports; only the first ${maxImportsPerFile} are listed.`
    );
  }
  if (perFileCapped.length > MAX_FAILURE_LINES) {
    limitations.push(`…and ${perFileCapped.length - MAX_FAILURE_LINES} more file(s) with capped imports.`);
  }

  const orderedEdges = [...edges.values()].sort(compareEdges);
  const keptEdges = orderedEdges.slice(0, maxEdges);
  if (keptEdges.length < orderedEdges.length) {
    limitations.push(
      `The dependency graph lists the first ${maxEdges} of ${orderedEdges.length} edges.`
    );
  }

  const orderedNodes = [...nodes.values()].sort((a, b) => compareStrings(a.id, b.id));
  const keptNodes = orderedNodes.slice(0, maxNodes);
  if (keptNodes.length < orderedNodes.length) {
    limitations.push(`The dependency graph lists the first ${maxNodes} of ${orderedNodes.length} nodes.`);
  }

  for (const line of unresolved.slice(0, MAX_UNRESOLVED_LINES)) {
    limitations.push(`${line}. No edge was emitted for it.`);
  }
  if (unresolved.length > MAX_UNRESOLVED_LINES) {
    limitations.push(`…and ${unresolved.length - MAX_UNRESOLVED_LINES} more import(s) that match no file.`);
  }

  // Validated at the boundary, like every other artifact: a builder that can
  // emit a shape the schema rejects is a builder whose return type is a lie.
  return DependencyGraphSchema.parse({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: keptNodes,
    edges: keptEdges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: 'imports' as const,
      weight: edge.evidence.length,
      evidence: edge.evidence,
    })),
    limitations,
  });
}

interface MutableEdge {
  from: string;
  to: string;
  evidence: EvidenceV2[];
}

/**
 * One edge per `(from, to)`, however many statements produced it.
 *
 * `weight` is the number of import statements, so five `import … from 'x'`
 * lines are one edge of weight five rather than five identical edges. Every
 * occurrence keeps its own evidence: the count is the summary, the lines are
 * the proof, and a consumer that needs to jump to a specific import must not
 * be handed only the first one.
 */
function addEdge(
  nodes: Map<string, GraphNode>,
  edges: Map<string, MutableEdge>,
  fromPath: string,
  resolution: Exclude<Resolution, { kind: 'unresolved' }>,
  line: number,
  raw: string,
  language: string
): void {
  const target = nodeFor(nodes, resolution);
  ensureFileNode(nodes, fromPath);

  const key = `${fromPath}\u0000${target.id}`;
  const evidence = evidenceFor(fromPath, line, raw, language, resolution);

  const existing = edges.get(key);
  if (existing) {
    existing.evidence.push(evidence);
    return;
  }
  edges.set(key, { from: fromPath, to: target.id, evidence: [evidence] });
}

function nodeFor(
  nodes: Map<string, GraphNode>,
  resolution: Exclude<Resolution, { kind: 'unresolved' }>
): GraphNode {
  if (resolution.kind === 'file') return ensureFileNode(nodes, resolution.path);

  if (resolution.kind === 'module') {
    const id = `module:${resolution.path}`;
    const existing = nodes.get(id);
    if (existing) return existing;
    const node: GraphNode = { id, kind: 'module', name: resolution.name, path: resolution.path };
    nodes.set(id, node);
    return node;
  }

  const id = `external:${resolution.package}`;
  const existing = nodes.get(id);
  if (existing) return existing;
  const node: GraphNode = { id, kind: 'external-dependency', name: resolution.package, path: null };
  nodes.set(id, node);
  return node;
}

function ensureFileNode(nodes: Map<string, GraphNode>, path: string): GraphNode {
  const existing = nodes.get(path);
  if (existing) return existing;

  const cut = path.lastIndexOf('/');
  const node: GraphNode = {
    id: path,
    kind: 'file',
    name: cut === -1 ? path : path.slice(cut + 1),
    path,
  };
  nodes.set(path, node);
  return node;
}

/**
 * How sure the edge is.
 *
 * A path that matched a real file in the tree is certain. A directory match
 * says the package is right and the file is not named — Go imports a package,
 * and a workspace module is reached through a directory. A bare specifier
 * that is not in this repository is certain to be external; what it resolves
 * to outside the repository is not this graph's business.
 */
function evidenceFor(
  fromPath: string,
  line: number,
  raw: string,
  language: string,
  resolution: Exclude<Resolution, { kind: 'unresolved' }>
): EvidenceV2 {
  const confidence = resolution.kind === 'file' ? 1 : resolution.kind === 'module' ? 0.9 : 0.95;
  return {
    path: fromPath,
    startLine: line,
    endLine: line,
    reason: `${language} imports "${raw}"`,
    source: 'dependency-analysis',
    confidence,
    symbol: null,
    module: null,
    file: fromPath,
    line,
  };
}

function compareEdges(a: MutableEdge, b: MutableEdge): number {
  return compareStrings(a.from, b.from) || compareStrings(a.to, b.to);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
