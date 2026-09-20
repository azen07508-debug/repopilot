/**
 * Dependency graph and architecture graph.
 *
 * Both share the same node/edge model; the architecture graph adds the
 * derived structural signals (entrypoints, cycles, coupling).
 *
 * `llmUsed` is pinned to `false` in the architecture graph on purpose:
 * architecture detection is a static-analysis fact (D-018, and the
 * "LLM explains, never decides" rule from D-009). Keeping it as a
 * literal makes an accidental LLM dependency a type error rather than
 * a silent behaviour change.
 */
import { z } from 'zod';
import { EvidenceV2Schema } from './evidence-v2.js';

export const GRAPH_SCHEMA_VERSION = '1.0' as const;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['file', 'module', 'function', 'class', 'package', 'external-dependency', 'contract']),
  name: z.string().min(1),
  path: z.string().nullable().default(null),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeKindSchema = z.enum([
  'imports',
  'calls',
  'extends',
  'implements',
  'depends_on',
  'tests',
  'exports',
]);
export type GraphEdgeKind = z.infer<typeof GraphEdgeKindSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: GraphEdgeKindSchema,
  weight: z.number().int().positive().default(1),
  /** Every edge is traceable back to a file and a line. */
  evidence: z.array(EvidenceV2Schema).default([]),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const DependencyGraphSchema = z.object({
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  nodes: z.array(GraphNodeSchema).default([]),
  edges: z.array(GraphEdgeSchema).default([]),
});
export type DependencyGraph = z.infer<typeof DependencyGraphSchema>;

export const ArchitectureGraphSchema = DependencyGraphSchema.extend({
  entrypoints: z.array(z.string()).default([]),
  /** Each element is one cycle, as an ordered list of node ids. */
  circularDependencies: z.array(z.array(z.string())).default([]),
  highCoupling: z
    .array(
      z.object({
        node: z.string().min(1),
        degree: z.number().int().nonnegative(),
        reason: z.string().min(1),
      })
    )
    .default([]),
  isolatedModules: z.array(z.string()).default([]),
  /** Architecture detection never consults an LLM. */
  llmUsed: z.literal(false),
  limitations: z.array(z.string()).default([]),
});
export type ArchitectureGraph = z.infer<typeof ArchitectureGraphSchema>;

/**
 * Build an empty graph of the requested flavour.
 *
 * Used as the safe default when the graph builder degrades — callers
 * always receive a schema-valid document instead of an exception.
 */
export function emptyArchitectureGraph(): ArchitectureGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    entrypoints: [],
    circularDependencies: [],
    highCoupling: [],
    isolatedModules: [],
    llmUsed: false,
    limitations: [],
  };
}
