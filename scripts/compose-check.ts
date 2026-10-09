#!/usr/bin/env tsx
/**
 * compose:check — static review of docker-compose.yml and the deploy topology.
 *
 * - Parses the YAML (no Docker CLI required)
 * - Asserts services: block is present
 * - Asserts each service has a `healthcheck` block
 * - Asserts API depends on DB with `service_healthy` condition
 * - Asserts no hardcoded secrets in env: blocks (looks for `*_KEY=` or
 *   `*_SECRET=` or `*_PASSWORD=` literals)
 * - Asserts no bind mount of `.env` or `node_modules` into the image
 * - Asserts the edge topology: a `web` service on the Dockerfile's `web`
 *   stage, and an API that is not published on every host interface
 * - Asserts the schema bootstrap runs before anything that queries the
 *   database, and is a job rather than a server
 * - Asserts `deploy/nginx/repopilot.conf` routes what the `web` service
 *   promises, that every `include` in it has a file behind it, and that the
 *   Dockerfile copies both into the image
 *
 * The last two groups exist because a compose file is only correct together
 * with the config inside the image it builds: a `web` service whose nginx does
 * not proxy `/api/` is a UI that cannot reach its own backend, and the YAML
 * would still look perfectly fine.
 *
 * Use this in CI when Docker CLI is not installed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReporter, reportAndExit } from './issues.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const COMPOSE_PATH = join(REPO, 'docker-compose.yml');

const { issues, err, warn, info } = createReporter();

const raw = readFileSync(COMPOSE_PATH, 'utf8');
let parsed: Record<string, unknown>;
try {
  parsed = parseYaml(raw) as Record<string, unknown>;
} catch (e) {
  err('yaml', `failed to parse: ${(e as Error).message}`);
  printAndExit();
}

const services = (parsed['services'] ?? {}) as Record<string, Record<string, unknown>>;
if (Object.keys(services).length === 0) {
  err('services', 'no services defined');
}
/**
 * Services that are jobs, not servers. They are expected to have no
 * healthcheck — they exit — and are required to be waited on with
 * `service_completed_successfully`. Asserted below.
 */
const ONE_SHOT_SERVICES = new Set(['migrate']);
for (const [name, svc] of Object.entries(services)) {
  if (!svc['healthcheck'] && !ONE_SHOT_SERVICES.has(name)) {
    warn(name, 'no healthcheck block');
  }
  if (!svc['image'] && !svc['build']) {
    err(name, 'no image or build directive');
  }
  // env: literal secrets check
  const env = (svc['environment'] ?? {}) as Record<string, string | number>;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    if (/KEY=|SECRET=|PASSWORD=|TOKEN=/.test(v) && !/^\$\{[A-Z_]+(:-.*)?\}$/.test(v) && v.length > 0) {
      err(name, `env.${k} looks like a hardcoded secret (use \${VAR} form)`);
    }
  }
  // mount security
  const mounts = (svc['volumes'] ?? []) as Array<string | { source: string; target: string }>;
  for (const m of mounts) {
    const s = typeof m === 'string' ? m : m.source;
    if (s && (s.includes('.env') || s.endsWith('/.env') || s.includes('node_modules'))) {
      err(name, `mount ${s} exposes secrets or build cache into the image`);
    }
  }
}

// API depends on DB with service_healthy
const api = services['api'];
if (api) {
  const dep = (api['depends_on'] ?? {}) as Record<string, { condition?: string } | string>;
  if (!dep['db']) {
    warn('api.depends_on', 'no db dependency declared');
  } else if (typeof dep['db'] === 'object' && dep['db'].condition !== 'service_healthy') {
    warn('api.depends_on.db', `expected service_healthy, got ${dep['db'].condition ?? 'none'}`);
  }
}

// ---------------------------------------------------------------------------
// Topology: the edge owns the public port.
// ---------------------------------------------------------------------------

const web = services['web'];
if (!web) {
  err('services.web', 'no `web` service — nothing serves apps/web/dist or proxies /api');
} else {
  const build = (web['build'] ?? {}) as Record<string, unknown>;
  const target = build['target'];
  if (target !== 'web') {
    err('web.build.target', `expected the Dockerfile's \`web\` stage, got \`${String(target ?? 'none')}\``);
  }
  const ports = (web['ports'] ?? []) as unknown[];
  if (ports.length === 0) {
    err('web.ports', 'the edge publishes no port — nothing is reachable from outside');
  }
  if (!web['healthcheck']) {
    err('web.healthcheck', 'no healthcheck: a container that cannot say whether it serves the UI');
  }
  const wdep = (web['depends_on'] ?? {}) as Record<string, { condition?: string } | string>;
  const apiDep = wdep['api'];
  if (!apiDep) {
    warn('web.depends_on', 'no api dependency declared');
  } else if (typeof apiDep === 'object' && apiDep.condition !== 'service_healthy') {
    warn('web.depends_on.api', `expected service_healthy, got ${apiDep.condition ?? 'none'}`);
  }
}

// ---------------------------------------------------------------------------
// Schema bootstrap must complete before anything queries the database.
// ---------------------------------------------------------------------------
//
// `api` and `worker` both start a process that reads tables, and neither
// applies migrations. A compose file that starts them immediately is one whose
// first boot answers `degraded` on `/health` and fails every audit at the
// database layer — and no container ever reports unhealthy, because `/health`
// returns HTTP 200 whether or not the schema exists. Silent, and it only shows
// up as "the product does not work". So the ordering is asserted, not trusted.
const BOOTSTRAP = 'migrate';
const migrate = services[BOOTSTRAP];
if (!migrate) {
  err(
    `services.${BOOTSTRAP}`,
    'no schema-bootstrap service: nothing applies migrations, so a fresh `up` serves a degraded API'
  );
} else {
  const command = JSON.stringify(migrate['command'] ?? '');
  if (!command.includes('db/migrate.js')) {
    err(`${BOOTSTRAP}.command`, `expected the compiled migration runner, got ${command}`);
  }
  if (migrate['restart'] !== 'no') {
    err(
      `${BOOTSTRAP}.restart`,
      `a migration job must not restart — its exit code is the signal (got \`${String(migrate['restart'] ?? 'unset')}\`)`
    );
  }
}
for (const name of ['api', 'worker']) {
  const svc = services[name];
  if (!svc) continue;
  const dep = (svc['depends_on'] ?? {}) as Record<string, { condition?: string } | string>;
  const bootstrapDep = dep[BOOTSTRAP];
  if (!bootstrapDep) {
    err(
      `${name}.depends_on`,
      `does not wait for \`${BOOTSTRAP}\`: it can start against an unmigrated database`
    );
  } else if (
    typeof bootstrapDep === 'object' &&
    bootstrapDep.condition !== 'service_completed_successfully'
  ) {
    err(
      `${name}.depends_on.${BOOTSTRAP}`,
      `expected service_completed_successfully, got \`${bootstrapDep.condition ?? 'none'}\``
    );
  }
}

// Nothing except the edge may be published on every host interface.
//
// `trustProxy: true` (`apps/api/src/server.ts`) makes Fastify believe
// `X-Forwarded-For`, and `@fastify/rate-limit` compares its `allowList`
// against the key that the `keyGenerator` produced — not against `req.ip`
// (`@fastify/rate-limit@10.3.0/index.js:233` is
// `params.allowList.indexOf(key)`). The generator prefers
// `X-Forwarded-For`. So a directly reachable API lets any client send
// `X-Forwarded-For: 127.0.0.1`, match the loopback allowList, and skip the
// limit entirely. R-24 records the same trap from the proxy side.
for (const [name, svc] of Object.entries(services)) {
  if (name === 'web') continue;
  const ports = (svc['ports'] ?? []) as Array<string | Record<string, unknown>>;
  for (const p of ports) {
    if (typeof p === 'string') {
      // Short syntax is `container`, `host:container` or `ip:host:container`.
      const parts = p.split(':');
      const hostIp = parts.length >= 3 ? parts[0] : null;
      if (!hostIp || hostIp === '0.0.0.0' || hostIp === '::') {
        err(`${name}.ports`, `"${p}" publishes on every host interface; bind it to 127.0.0.1 (R-24)`);
      }
    } else if (p && typeof p === 'object') {
      if (!p['host_ip']) {
        err(
          `${name}.ports`,
          `published_port ${String(p['published'] ?? '?')} has no host_ip; bind it to 127.0.0.1 (R-24)`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The edge config must actually route what the `web` service promises.
// ---------------------------------------------------------------------------

const NGINX_CONF = join(REPO, 'deploy/nginx/repopilot.conf');
const SNIPPETS = join(REPO, 'deploy/nginx/snippets');

if (!existsSync(NGINX_CONF)) {
  err('deploy/nginx/repopilot.conf', 'missing — the `web` image would have nothing to copy');
} else {
  const conf = readFileSync(NGINX_CONF, 'utf8');
  const required: Array<[string, RegExp, string]> = [
    ['upstream', /upstream\s+repopilot_api\s*\{/, 'the API upstream is not declared'],
    ['api:4000', /server\s+api:4000\s*;/, 'the upstream does not point at the compose service `api`'],
    ['location /api/', /location\s+\/api\/\s*\{/, 'nothing proxies /api/ — every UI request would 404'],
    ['location = /health', /location\s+=\s+\/health\s*\{/, 'nothing proxies /health'],
    ['location /docs/', /location\s+\/docs\/\s*\{/, 'nothing proxies /docs/'],
    ['SPA fallback', /try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/, 'no SPA fallback: a deep link would 404'],
    [
      'X-Forwarded-For',
      /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for\s*;/,
      'X-Forwarded-For is not forwarded, which silently disables rate limiting (R-24)',
    ],
  ];
  for (const [label, re, message] of required) {
    if (!re.test(conf)) err(`nginx:${label}`, message);
  }

  // An `include` pointing at a file that does not exist makes nginx refuse to
  // start, and it is invisible in the config's own text.
  for (const m of conf.matchAll(/include\s+(\/etc\/nginx\/snippets\/([\w.-]+));/g)) {
    const [, target, base] = m as unknown as [string, string, string];
    if (!existsSync(join(SNIPPETS, base))) {
      err('nginx:include', `\`${target}\` has no file at deploy/nginx/snippets/${base} — nginx would not start`);
    }
  }
}

// The image is built from these paths; if the Dockerfile stops copying one of
// them the build still succeeds and the container is silently wrong.
const DOCKERFILE = join(REPO, 'Dockerfile');
if (!existsSync(DOCKERFILE)) {
  err('Dockerfile', 'missing');
} else {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  const mustCopy: Array<[string, string]> = [
    ['AS web', 'no `web` build stage'],
    ['deploy/nginx/repopilot.conf', 'the edge config is not copied into the image'],
    ['deploy/nginx/snippets/', 'the header snippet is not copied into the image'],
    ['apps/web/dist', 'the built UI is not copied into the image'],
  ];
  for (const [needle, message] of mustCopy) {
    if (!dockerfile.includes(needle)) err('Dockerfile', `${message} (no \`${needle}\`)`);
  }
}

printAndExit();

/**
 * Print the collected issues and exit with the code they imply.
 *
 * `: never` is the point of the signature, and it is why the failed-parse
 * branch above can leave `parsed` assigned: the compiler needs to know this
 * call does not come back. `reportAndExit` carries the same signature for the
 * same reason, so this wrapper keeps it.
 */
function printAndExit(): never {
  reportAndExit(issues, {
    header: 'compose:check',
    okMessage: 'OK — docker-compose.yml looks sane',
    fieldWidth: 30,
  });
}
