/**
 * Hackathon readiness analyzer.
 *
 * Scans a repository for the artefacts judges and other hackers expect:
 * demo URL, demo video, contract address, network, architecture, screenshots,
 * social post, license, test results, etc.
 */
import type { FileEntry } from '../git/files.js';
import type { Finding } from '../schemas/report.js';
import { extractSectionsFromMd } from '../utils/markdown.js';

export interface HackathonAnalysis {
  findings: Finding[];
  hasDemoUrl: boolean;
  hasDemoVideo: boolean;
  hasContractAddress: boolean;
  hasNetwork: boolean;
  hasArchitecture: boolean;
  hasScreenshots: boolean;
  hasSocialPost: boolean;
  hasLicense: boolean;
  hasTestResults: boolean;
  hasSubmissionDescription: boolean;
  demoUrls: string[];
  videoUrls: string[];
  contractAddresses: string[];
  networks: string[];
}

const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s)<>"']+/i;

const DEMO_HOSTS = /(demo|app|preview|vercel|netlify|github\.io|cloudflare|pages\.dev|repl\.it|onrender|fly\.dev|herokuapp)/i;
const VIDEO_HOSTS = /(youtu\.?be|loom\.com|vimeo\.com|streamable\.com)/i;

const NETWORK_KEYWORDS: Record<string, RegExp> = {
  ethereum: /\b(ethereum|mainnet)\b/i,
  sepolia: /\bsepolia\b/i,
  base: /\bbase\b/i,
  baseSepolia: /\bbase[- ]?sepolia\b/i,
  arbitrum: /\barbitrum\b/i,
  optimism: /\boptimism\b/i,
  polygon: /\bpolygon\b/i,
  bsc: /\b(bsc|bnb|bsc-?testnet)\b/i,
  xlayer: /\bx[- ]?layer\b/i,
  solana: /\bsolana\b/i,
};

export function analyzeHackathon(
  entries: FileEntry[],
  fileContents: Map<string, string>,
  web3Chains: string[],
  web3Addresses: string[]
): HackathonAnalysis {
  const findings: Finding[] = [];
  let hasDemoUrl = false;
  let hasDemoVideo = false;
  let hasContractAddress = false;
  let hasNetwork = false;
  let hasArchitecture = false;
  let hasScreenshots = entries.some((e) => /\.(png|jpe?g|gif|webp|svg)$/i.test(e.path));
  let hasSocialPost = false;
  let hasLicense = entries.some((e) => /(^|\/)(LICENSE|LICENSE\.md|LICENSE\.txt|COPYING)$/i.test(e.path));
  let hasTestResults = false;
  let hasSubmissionDescription = false;

  const demoUrls: string[] = [];
  const videoUrls: string[] = [];
  const networks = new Set<string>(web3Chains);
  const contractAddresses = new Set<string>(web3Addresses);

  // README + .env example + docs are the main sources of truth.
  for (const [path, content] of fileContents) {
    if (!/(^|\/)(README|\.env|docs\/|ARCHITECTURE)/i.test(path)) continue;

    const urls = content.match(/https?:\/\/[^\s)<>"']+/g) ?? [];
    for (const u of urls) {
      if (DEMO_HOSTS.test(u)) {
        hasDemoUrl = true;
        demoUrls.push(u);
      }
      if (VIDEO_HOSTS.test(u)) {
        hasDemoVideo = true;
        videoUrls.push(u);
      }
    }

    const addrs = content.match(ADDRESS_RE);
    if (addrs) {
      hasContractAddress = true;
      for (const a of addrs) contractAddresses.add(a);
    }

    for (const [name, re] of Object.entries(NETWORK_KEYWORDS)) {
      if (re.test(content)) networks.add(name);
    }

    if (/^#{1,3}\s.*(architecture|how it works|system design|tech stack)/im.test(content)) {
      hasArchitecture = true;
    }
    if (/\b(built with|made with|submission|track|project description)\b/i.test(content)) {
      hasSubmissionDescription = true;
    }
    if (/\b(twitter|x\.com\/|farcaster|warpcast|lenster)\b/i.test(content)) {
      hasSocialPost = true;
    }
    if (/passing|✅|tests? pass|\b\d+\s+passing\b/i.test(content)) {
      hasTestResults = true;
    }
  }

  // Badges in README are not enough — but a "Demo:" line is.
  if (!hasDemoUrl) {
    findings.push({
      id: 'hack-no-demo',
      category: 'hackathon',
      severity: 'high',
      title: 'No demo URL detected',
      description: 'Judges and reviewers need a live demo URL. The README does not mention one.',
      evidence: [{ file: 'README.md', line: null, reason: 'No URL matching a known demo host was found' }],
      recommendedAction: 'Deploy a preview build and add a "Demo:" line at the top of the README.',
      acceptanceCriteria: ['A live URL is reachable and returns 2xx.'],
    });
  }
  if (!hasDemoVideo) {
    findings.push({
      id: 'hack-no-video',
      category: 'hackathon',
      severity: 'medium',
      title: 'No demo video linked',
      description: 'Most hackathons accept a 1–3 minute demo video as a substitute for live demo time.',
      evidence: [{ file: 'README.md', line: null, reason: 'No YouTube/Loom/Vimeo link found' }],
      recommendedAction: 'Record a 60–180s walkthrough and link it from the README.',
      acceptanceCriteria: ['A video URL is reachable.'],
    });
  }
  if (!hasArchitecture) {
    findings.push({
      id: 'hack-no-architecture',
      category: 'hackathon',
      severity: 'medium',
      title: 'No "Architecture" / "How it works" section',
      description: 'Judges want to understand the system at a glance.',
      evidence: [{ file: 'README.md', line: null, reason: 'No architecture-style heading found' }],
      recommendedAction: 'Add an "Architecture" or "How it works" section with a simple diagram (or list of components).',
      acceptanceCriteria: ['README has a section describing the architecture.'],
    });
  }
  if (!hasScreenshots) {
    findings.push({
      id: 'hack-no-screenshots',
      category: 'hackathon',
      severity: 'low',
      title: 'No screenshots or diagrams in the repository',
      description: 'Screenshots help reviewers and judges visualize the product quickly.',
      evidence: [{ file: 'README.md', line: null, reason: 'No .png/.jpg/.gif/.webp/.svg in the tree' }],
      recommendedAction: 'Add 1–3 screenshots to a docs/ or assets/ folder and reference them from the README.',
      acceptanceCriteria: ['At least one image is included in the repository and referenced in the README.'],
    });
  }
  if (!hasSocialPost) {
    findings.push({
      id: 'hack-no-social',
      category: 'hackathon',
      severity: 'low',
      title: 'No social post / launch announcement',
      description: 'Optional but a strong signal of community engagement.',
      evidence: [{ file: 'README.md', line: null, reason: 'No Twitter / Farcaster / X link found' }],
      recommendedAction: 'Draft a launch post and link it from the README.',
      acceptanceCriteria: ['A social post link is present.'],
    });
  }
  if (!hasLicense) {
    findings.push({
      id: 'hack-no-license',
      category: 'hackathon',
      severity: 'high',
      title: 'No LICENSE file',
      description: 'Without a license, judges cannot reuse or fork your code safely.',
      evidence: [{ file: 'LICENSE', line: null, reason: 'No LICENSE / LICENSE.md file' }],
      recommendedAction: 'Add an MIT or Apache-2.0 LICENSE at the repo root.',
      acceptanceCriteria: ['LICENSE exists at the repo root.'],
    });
  }
  if (networks.size === 0 && contractAddresses.size === 0) {
    findings.push({
      id: 'hack-no-chain',
      category: 'hackathon',
      severity: 'low',
      title: 'No chain or contract address mentioned',
      description: 'If this is an on-chain hackathon project, the README should name the network and the deployed contract address.',
      evidence: [{ file: 'README.md', line: null, reason: 'no chain keyword or 0x address' }],
      recommendedAction: 'If on-chain, add a "Network" and "Contract" line to the README.',
      acceptanceCriteria: ['README names the network and (if applicable) the contract address.'],
    });
  }
  if (contractAddresses.size > 0) hasContractAddress = true;
  if (networks.size > 0) hasNetwork = true;

  return {
    findings,
    hasDemoUrl,
    hasDemoVideo,
    hasContractAddress,
    hasNetwork,
    hasArchitecture,
    hasScreenshots,
    hasSocialPost,
    hasLicense,
    hasTestResults,
    hasSubmissionDescription,
    demoUrls,
    videoUrls,
    contractAddresses: [...contractAddresses],
    networks: [...networks],
  };
}

export function hasHackathonKeywords(fileContents: Map<string, string>): boolean {
  for (const content of fileContents.values()) {
    if (/\b(hackathon|hack[a-z\s-]*project|track:|submission:)\b/i.test(content)) {
      return true;
    }
  }
  return false;
}

export { extractSectionsFromMd };
