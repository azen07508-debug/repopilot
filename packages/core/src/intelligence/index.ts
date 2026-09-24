/**
 * Repository Intelligence.
 *
 * The layers that read a repository to answer "what is this, and where
 * do I start?" — as opposed to `analyzers/`, which answers "is this ready
 * to ship?". Both are static and deterministic; neither replaces the
 * other.
 *
 * Deliberately inside `packages/core` rather than its own package: the
 * builders need the same `entries + contents` shapes the analyzers use,
 * and splitting them out now would buy a build-order problem and a
 * circular dependency, not a boundary (docs/REPOSITORY_INTELLIGENCE_PLAN.md §0.3).
 */
export * from './repository-map/index.js';
