/**
 * URL parsing & host allowlisting — SSRF defense.
 *
 * RepoPilot must never be tricked into fetching an internal IP or a non-GitHub
 * host. Every GitHub URL passes through `parseRepoUrl`, which:
 *   1) validates the protocol (https only),
 *   2) matches the host against a configurable allowlist,
 *   3) extracts owner/repo and rejects bad shapes.
 */
import { RepoUrlSchema } from '../schemas/inputs.js';

export interface ParsedRepoUrl {
  raw: string;
  host: string;
  owner: string;
  repo: string;
  defaultBranchHint: string | null;
}

const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);

export function parseRepoUrl(input: string, allowedHosts: string[]): ParsedRepoUrl {
  const normalized = input.trim();
  const validation = RepoUrlSchema.safeParse(normalized);
  if (!validation.success) {
    throw new InvalidRepoUrlError(
      `Invalid repository URL: ${validation.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  const url = new URL(normalized.replace(/\.git$/, ''));
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new InvalidRepoUrlError('Repository URL must include owner and repo name');
  }
  const owner = segments[0]!;
  const repo = segments[1]!;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    throw new InvalidRepoUrlError('Owner or repo name contains illegal characters');
  }

  const host = url.hostname.toLowerCase();
  const allow = new Set(allowedHosts.map((h) => h.toLowerCase()));
  if (!allow.has(host)) {
    throw new InvalidRepoUrlError(
      `Host "${host}" is not in the allowlist. Allowed: ${[...allow].join(', ')}`
    );
  }

  return {
    raw: normalized,
    host,
    owner,
    repo,
    defaultBranchHint: null,
  };
}

export class InvalidRepoUrlError extends Error {
  readonly code = 'INVALID_REPO_URL';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRepoUrlError';
  }
}

export function isDefaultBranchGuess(branch: string): boolean {
  return DEFAULT_BRANCHES.has(branch.toLowerCase());
}
