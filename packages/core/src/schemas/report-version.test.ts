import { describe, expect, it } from 'vitest';
import { makeReport } from '../test-utils/report-factory.js';
import { REPORT_VERSION, SUPPORTED_REPORT_VERSIONS } from '../utils/constants.js';
import { FreeCheckReportSchema } from './inputs.js';
import type { Report } from './report.js';
import { ReportSchema } from './report.js';

function withVersion(version: Report['reportVersion']) {
  return makeReport({ reportVersion: version });
}

/**
 * A version no build ever wrote. Built without the type, because the type
 * only admits the versions that are supposed to work — which is the
 * point of the test.
 */
function withUnknownVersion(version: string) {
  return { ...makeReport(), reportVersion: version };
}

describe('report version', () => {
  it('writes 1.1 on anything newly built', () => {
    expect(REPORT_VERSION).toBe('1.1');
  });

  it('parses a 1.1 report', () => {
    expect(() => ReportSchema.parse(withVersion('1.1'))).not.toThrow();
    expect(ReportSchema.parse(withVersion('1.1')).reportVersion).toBe('1.1');
  });

  it('still parses a 1.0 report', () => {
    // The new finding fields are additive, so an older report has to keep
    // working — otherwise every stored report becomes unreadable.
    expect(() => ReportSchema.parse(withVersion('1.0'))).not.toThrow();
    expect(ReportSchema.parse(withVersion('1.0')).reportVersion).toBe('1.0');
  });

  it('rejects a version it does not know', () => {
    expect(() => ReportSchema.parse(withUnknownVersion('9.9'))).toThrow();
  });

  it('accepts every version it claims to support', () => {
    for (const v of SUPPORTED_REPORT_VERSIONS) {
      expect(() => ReportSchema.parse(withVersion(v))).not.toThrow();
    }
  });

  it('parses the version it writes', () => {
    expect(() => ReportSchema.parse(withVersion(REPORT_VERSION))).not.toThrow();
  });
});

describe('free-check report version', () => {
  function freeCheckReport(reportVersion: string) {
    return {
      reportVersion,
      kind: 'free-check',
      repository: {
        url: 'https://github.com/octocat/Hello-World',
        host: 'github.com',
        owner: 'octocat',
        name: 'Hello-World',
        valid: true,
      },
      metadata: null,
      stack: null,
      checks: [],
      score: { value: 0, passed: 0, total: 5 },
      generatedAt: '2026-01-01T00:00:00Z',
    };
  }

  it('stays at 1.0', () => {
    expect(() => FreeCheckReportSchema.parse(freeCheckReport('1.0'))).not.toThrow();
  });

  it('does not inherit the audit report versions', () => {
    // Free Check is a different document and its shape has not changed,
    // so it must not accept a version it never emits. Sharing
    // SUPPORTED_REPORT_VERSIONS would do exactly that, and would widen
    // again the next time the audit report moves.
    expect(REPORT_VERSION as string).not.toBe('1.0');
    expect(() => FreeCheckReportSchema.parse(freeCheckReport(REPORT_VERSION))).toThrow();
  });
});
