/**
 * The default `mode` is a promise to a buyer, so it gets a test.
 *
 * R-37: the paid service is sold as `mode=full` — the registration copy names
 * the deployment plan and the launch copy — while this schema defaulted to
 * `quick`. A caller that omitted the field paid the same 1 USDT and received
 * less than the description they paid against. Changing the default is a
 * one-line edit, which is exactly why it needs something that fails when
 * someone edits it back: nothing else in the suite reads the default, so
 * reverting it would have been silent.
 */
import { describe, it, expect } from 'vitest';
import { CreateAuditInputSchema } from './inputs.js';

const REPO = 'https://github.com/octocat/Hello-World';

describe('CreateAuditInputSchema', () => {
  it('defaults mode to full — the shape the paid service is sold as', () => {
    expect(CreateAuditInputSchema.parse({ repoUrl: REPO }).mode).toBe('full');
  });

  it('still accepts an explicit quick as an opt-out', () => {
    expect(CreateAuditInputSchema.parse({ repoUrl: REPO, mode: 'quick' }).mode).toBe('quick');
  });
});
