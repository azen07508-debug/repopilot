/**
 * The asynchronous audit contract, asserted through the DOM.
 *
 * ## Why this file exists
 *
 * `POST /api/v1/audits` is asynchronous by design. `InlineAuditQueue.enqueue()`
 * "schedules the job on a small, bounded worker pool and returns immediately.
 * The HTTP request never waits for the analysis." A settled POST therefore
 * answers **202** with `statusUrl` + `pollAfterMs` — never a report.
 *
 * The UI used to assume the mock replay came back synchronously. It never did,
 * so neither the report branch nor the error branch matched `onSubmit`, and the
 * submit button became a silent no-op: no report, no message, nothing. That bug
 * was invisible to `tsc` (the response was cast), invisible to `vite build`, and
 * invisible to every existing test — because there were no web tests.
 *
 * So these tests assert **what the user sees**, not which function was called.
 * They drive the real `App` through the real `lib/api.ts` against a `fetch`
 * stub that answers with the shapes and status codes from
 * `apps/api/src/routes/audits.ts`. Nothing here touches the network, GitHub, a
 * payment provider, or a database.
 *
 * ## Coverage map
 *
 * | # | Requirement                                    | test                                          |
 * |---|------------------------------------------------|-----------------------------------------------|
 * | 1 | POST without payment → 402 challenge            | 「402 挑战 …」 / 「重放带上了 X-PAYMENT」      |
 * | 2 | replay with `X-PAYMENT` → 202 queued            | 「重放带上了 X-PAYMENT」                       |
 * | 3 | 202 carries jobId/status/statusUrl/pollAfterMs  | 「202 queued 响应带有 …」                      |
 * | 4 | statusUrl transitions queued/processing/…       | 「轮询走完 queued → processing → completed」   |
 * | 5 | `pollAfterMs` is honoured                       | 「轮询间隔遵守服务端下发的 pollAfterMs」       |
 * | 6 | completed reaches `ReportView`                  | 「completed 之后 ReportView …」                |
 * | 7 | failed shows an error, not a silent empty state | 「failed 时用户看到错误」                      |
 * | 8 | a network failure is visible                    | 「结算请求网络失败」 / 「轮询中途断网」        |
 * | 9 | refresh while running keeps polling             | 「okx 模式下点刷新」                           |
 * |10 | no duplicate polling, no races                  | 「一次提交只产生一条轮询链」                   |
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
// Named import, not the default: under this repo's `moduleResolution: NodeNext`
// the default import of `@testing-library/user-event` is typed as the whole
// module namespace, so `userEvent.setup` does not typecheck. Both the package's
// `.d.ts` and its ESM build export `userEvent` by name.
import { userEvent } from '@testing-library/user-event';
import { App } from './App.js';
import { installFakeApi, type FakeApi } from './test/fake-api.js';
import { makeCapabilities, makeReport } from './test/fixtures.js';

/* ---------- strings the user actually reads ---------- */

const ERROR_TITLE = 'Something went wrong';
/**
 * `App.tsx` writes `<strong>{t.errorTitle}.</strong>`, which React renders as
 * two adjacent text nodes — so an exact string match never fires. Match the
 * sentence instead.
 */
const ERROR_HEADING = /Something went wrong/;
const EMPTY_TITLE = 'No report yet';
const LOADING_TITLE = 'Reading the repository';
const REPO_HEADING = 'Hello-World';

let api: FakeApi | null = null;

afterEach(() => {
  api?.restore();
  api = null;
});

function boot(options: Parameters<typeof installFakeApi>[0] = {}): FakeApi {
  api = installFakeApi(options);
  render(<App />);
  return api;
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: /Run gate/i }));
}

/** The `status` field of every status-GET answer, in order. */
function polledStatuses(a: FakeApi): Array<string | undefined> {
  return a.polls.map((p) => (p.response as { status?: string } | null)?.status);
}

/* ---------- 1-3: the payment challenge, the replay, and the 202 shape ---------- */

describe('POST /api/v1/audits: 402 challenge → replay → 202 queued', () => {
  it('POST /api/v1/audits 返回 202 queued 时，用户最终可以看到 report', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['queued', 'processing', 'completed'], pollAfterMs: 10 });

    await submit(user);

    // The whole point of the regression: a 202 must end in a visible report.
    expect(await screen.findByRole('heading', { name: REPO_HEADING })).toBeTruthy();
    expect(screen.getByText('43.5')).toBeTruthy();

    // …and it took three real status reads, i.e. the client polled rather than
    // hoping the POST body contained a report.
    expect(polledStatuses(a)).toEqual(['queued', 'processing', 'completed']);
  });

  it('402 之后的重放带上了 X-PAYMENT，用的是挑战里的 paymentId', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['completed'] });

    await submit(user);
    await screen.findByRole('heading', { name: REPO_HEADING });

    expect(a.posts).toHaveLength(2);
    expect(a.posts[0]!.headers['x-payment']).toBeUndefined();
    expect(a.posts[1]!.headers['x-payment']).toBe('mock:pay-1');
    // Same repository both times: the replay must not silently change the job.
    expect(a.posts[1]!.body).toEqual(a.posts[0]!.body);
  });

  it('402 挑战里没有 statusUrl —— 客户端不能对它轮询，只能重放', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['completed'] });

    await submit(user);
    await screen.findByRole('heading', { name: REPO_HEADING });

    const challenge = a.posts[0]!;
    expect(challenge.status).toBe(402);
    expect(challenge.response).toMatchObject({ jobId: 'job-1', status: 'queued' });
    // The route deliberately omits these on the 402 (audits.ts, challenge branch).
    // A client that called `settleAudit` on the 402 would read `pollAfterMs`
    // as `undefined` and `jobId` from a response that never had a `statusUrl`.
    expect(challenge.response).not.toHaveProperty('statusUrl');
    expect(challenge.response).not.toHaveProperty('pollAfterMs');

    // Reaching the report proves the app replayed instead of settling the 402.
    expect(a.posts[1]!.headers['x-payment']).toBeDefined();
  });

  it('202 queued 响应带有 jobId/status/statusUrl/pollAfterMs，与 apps/api 发布的契约一致', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['completed'], pollAfterMs: 120 });

    await submit(user);
    await screen.findByRole('heading', { name: REPO_HEADING });

    const accepted = a.posts[1]!;
    expect(accepted.status).toBe(202);

    // The source of truth is the published OpenAPI schema, not this stub. If
    // the contract gains or loses a required field, this fails and whoever
    // changed the API is told the web fixture needs revisiting.
    const required = queuedResponseRequiredFields();
    expect(required).toEqual(['jobId', 'pollAfterMs', 'status', 'statusUrl']);
    for (const field of required) {
      expect(accepted.response, `202 body is missing the contract field \`${field}\``).toHaveProperty(field);
    }

    // And the client actually honoured `statusUrl`: the poll went to that path.
    expect(a.polls[0]!.path).toBe((accepted.response as { statusUrl: string }).statusUrl);
  });
});

/**
 * Read the `required` list of the queued-response schema out of
 * `apps/api/src/openapi.ts`.
 *
 * This is a deliberate cross-package read: the web tests cannot import
 * `apps/api` (it would drag Fastify, sqlite and the whole server graph into a
 * jsdom run), but the point of the check is to detect drift between the two,
 * so reading the published schema as text is exactly the right amount of
 * coupling. It is the only place in this suite that knows `apps/api` exists.
 */
function queuedResponseRequiredFields(): string[] {
  // `import.meta.url` is not a `file:` URL under Vite's transform, so the
  // schema is located relative to the working directory instead. `pnpm test`
  // runs from `apps/web`; the second candidate covers a repo-root invocation.
  const candidates = ['../api/src/openapi.ts', 'apps/api/src/openapi.ts'].map((p) => resolve(process.cwd(), p));
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new Error(`Could not locate apps/api/src/openapi.ts. Looked in:\n  ${candidates.join('\n  ')}`);
  }

  const source = readFileSync(path, 'utf8');
  const match = /required:\s*\[([^\]]*'statusUrl'[^\]]*)\]/.exec(source);
  if (!match) {
    throw new Error(
      'Could not find the queued-response `required` list in apps/api/src/openapi.ts. ' +
        'The schema was reformatted or the field was renamed — update this helper.'
    );
  }
  return match[1]!
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();
}

/* ---------- 4-6: the polling loop ---------- */

describe('GET statusUrl: the queued → processing → completed loop', () => {
  it('轮询走完 queued → processing → completed，期间从不显示空态', async () => {
    const user = userEvent.setup();
    // The test owns the state machine, so the assertions cannot race the loop.
    const a = boot({ jobStates: ['queued'], pollAfterMs: 15 });

    await submit(user);

    await waitFor(() => expect(polledStatuses(a)).toContain('queued'));
    expect(screen.getByText(LOADING_TITLE)).toBeTruthy();
    // The P0 in one line: a queued job must never look like "nothing happened".
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

    a.setJobState('processing');
    await waitFor(() => expect(polledStatuses(a)).toContain('processing'));
    expect(screen.getByText(LOADING_TITLE)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

    a.setJobState('completed');
    expect(await screen.findByRole('heading', { name: REPO_HEADING })).toBeTruthy();
    expect(screen.queryByText(LOADING_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('轮询间隔遵守服务端下发的 pollAfterMs', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['queued', 'completed'], pollAfterMs: 150 });

    await submit(user);
    await screen.findByRole('heading', { name: REPO_HEADING });

    expect(a.polls).toHaveLength(2);
    const gap = a.polls[1]!.at - a.polls[0]!.at;
    // Lower bound: the client must not hammer the server.
    expect(gap).toBeGreaterThanOrEqual(120);
    // Upper bound: it must not ignore the value and fall back to its 1000ms default.
    expect(gap).toBeLessThan(900);
  });

  it('completed 之后 ReportView 渲染出仓库名和总分，且文档只有一个 h1', async () => {
    const user = userEvent.setup();
    boot({ jobStates: ['completed'], report: makeReport() });

    await submit(user);

    const heading = await screen.findByRole('heading', { name: REPO_HEADING });
    expect(heading.tagName).toBe('H1');
    expect(screen.getByText('43.5')).toBeTruthy();
    expect(screen.getByText('Release gate report')).toBeTruthy();

    // The report's subject outranks the pitch: exactly one h1, and it is the
    // repository. Before the fix the marketing headline was the page's h1 and
    // the repo name was an h2, 612px further down.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.queryByText('One repo in. A launch-ready plan out.')).toBeNull();
  });
});

/* ---------- 7: failure ---------- */

describe('a failed job', () => {
  it('failed 时用户看到错误，而不是静默的「No report yet」', async () => {
    const user = userEvent.setup();
    boot({
      jobStates: ['queued', 'failed'],
      pollAfterMs: 15,
      failureMessage: 'Analyzer crashed on a malformed file',
    });

    await submit(user);

    // The route answers 200 (not 5xx) for a failed job on purpose, so the
    // client cannot confuse "this audit failed" with "the API is down". The
    // user-visible requirement is the same either way: say something.
    expect(await screen.findByText(ERROR_HEADING)).toBeTruthy();
    expect(screen.getByText('Analyzer crashed on a malformed file')).toBeTruthy();
    expect(screen.queryByText(LOADING_TITLE)).toBeNull();

    // And the empty state must be gone with it. `App.tsx` used to render it on
    // `!report && !loading` without checking `!error`, so a failed audit put
    // "No report yet — submit a public GitHub URL above to generate the first
    // audit" directly under the error, telling the user to do the thing they
    // had just done. This suite caught it; the guard is `!error` now.
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it('失败后再次提交：错误被清掉，报告正常出现', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['failed'], pollAfterMs: 15 });

    await submit(user);
    await screen.findByText(ERROR_HEADING);
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

    // The retry must not be poisoned by the previous attempt: `onSubmit` clears
    // the error before it starts, so the stale message cannot survive and the
    // suppressed empty state cannot stay suppressed.
    a.setJobState('completed');
    await submit(user);

    expect(await screen.findByRole('heading', { name: REPO_HEADING })).toBeTruthy();
    expect(screen.queryByText(ERROR_HEADING)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });
});

/* ---------- 8: transport failures ---------- */

describe('transport failures', () => {
  it('结算请求网络失败时，用户看到错误而不是静默', async () => {
    const user = userEvent.setup();
    boot({ jobStates: ['completed'], settlePost: 'network' });

    await submit(user);

    const card = await screen.findByText(ERROR_HEADING);
    expect(card).toBeTruthy();
    // The message is the raw `fetch` rejection, surfaced verbatim.
    expect(document.querySelector('.card.error')!.textContent).toContain('Failed to fetch');
    expect(screen.queryByText(LOADING_TITLE)).toBeNull();
  });

  it('结算请求返回 503 时，错误里带的是服务端的说明而不是状态码', async () => {
    const user = userEvent.setup();
    boot({ jobStates: ['completed'], settlePost: 'server-error' });

    await submit(user);

    await screen.findByText(ERROR_HEADING);
    expect(screen.getByText('Queue is not accepting jobs; please retry')).toBeTruthy();
  });

  it('轮询中途断网，用户看到错误而不是一直转圈', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['queued', 'completed'], pollAfterMs: 15, getNetworkErrorAt: 2 });

    await submit(user);

    await screen.findByText(ERROR_HEADING);
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
    // It really did drop on the second read, not on the first.
    expect(a.polls).toHaveLength(2);
    expect(screen.queryByText(LOADING_TITLE)).toBeNull();
  });
});

/* ---------- 9: refresh while the job is still running ---------- */

describe('refreshing a job that is still running', () => {
  it('okx 模式下点刷新时任务仍在跑，客户端继续轮询到完成', async () => {
    const user = userEvent.setup();
    const a = boot({
      capabilities: makeCapabilities({ paymentMode: 'okx' }),
      jobStates: ['queued', 'processing', 'completed'],
      pollAfterMs: 15,
    });

    await submit(user);

    // In okx mode the challenge has to be signed out of band, so the app
    // stops after the 402 and waits for the user. One POST, no polls.
    expect(a.posts).toHaveLength(1);
    expect(a.polls).toHaveLength(0);
    const refresh = await screen.findByRole('button', { name: /Refresh status/i });

    await user.click(refresh);

    // The refresh reads once, sees `queued`, and keeps polling — it does not
    // give up with "not ready yet".
    expect(await screen.findByRole('heading', { name: REPO_HEADING })).toBeTruthy();
    expect(polledStatuses(a)).toEqual(['queued', 'processing', 'completed']);
    // The payment card is gone once a report exists.
    expect(screen.queryByRole('button', { name: /Refresh status/i })).toBeNull();
  });
});

/* ---------- 10: no duplicate polling, no races ---------- */

describe('polling hygiene', () => {
  it('一次提交只产生一条轮询链，完成后停止', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['queued', 'completed'], pollAfterMs: 15 });

    await submit(user);
    await screen.findByRole('heading', { name: REPO_HEADING });

    // Two POSTs (challenge + replay) and two GETs (queued, completed). A
    // duplicated effect or a second submit would show up here immediately.
    expect(a.posts).toHaveLength(2);
    expect(a.polls).toHaveLength(2);

    const settled = a.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(a.polls).toHaveLength(settled);
  });

  it('加载中提交按钮被禁用，点第二次不会开出第二个任务', async () => {
    const user = userEvent.setup();
    const a = boot({ jobStates: ['queued'], pollAfterMs: 20 });

    await submit(user);

    const button = await screen.findByRole('button', { name: /Auditing/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(a.posts).toHaveLength(2);

    // Let the job finish so no poll loop outlives the test.
    a.setJobState('completed');
    expect(await screen.findByRole('heading', { name: REPO_HEADING })).toBeTruthy();
    expect(a.posts).toHaveLength(2);
  });
});
