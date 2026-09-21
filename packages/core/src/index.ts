/**
 * Core package entrypoint.
 *
 * The public surface is intentionally narrow. Most consumers should use
 * the named subpath exports (./schemas, ./scoring, ./analyzers, ./report,
 * ./security, ./git, ./llm).
 */
export * from './schemas/index.js';
export * from './scoring/index.js';
export * from './analyzers/index.js';
export * from './report/index.js';
export * from './security/index.js';
export * from './git/index.js';
export * from './llm/index.js';
export * from './pipeline.js';
export * from './free-check.js';
export * from './findings/enrich.js';
export * from './findings/fingerprint.js';
export * from './findings/rule-registry.js';
export * from './fixplan/builder.js';
export * from './fixplan/template.js';
export * from './diff/reports.js';
export * from './quality/evaluate.js';
export * from './quality/compare.js';
export * from './utils/index.js';
export const VERSION = '0.1.0';
