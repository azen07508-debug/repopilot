/**
 * Web3 analyzer.
 *
 * Detects contract directories, deploy scripts, ABIs, test suites, and checks
 * for consistency between frontend chain config and contract deployment.
 * RepoPilot does NOT run a security audit; it only audits engineering
 * completeness.
 */
import type { FileEntry } from '../git/files.js';
import type { Finding } from '../schemas/report.js';

export interface Web3Analysis {
  findings: Finding[];
  hasContracts: boolean;
  hasDeployScripts: boolean;
  hasAbi: boolean;
  hasContractTests: boolean;
  hasAuditNote: boolean;
  hasContractAddresses: boolean;
  chains: string[];
  contractAddresses: string[];
}

const CHAIN_KEYWORDS: Record<string, RegExp> = {
  ethereum: /\b(ethereum|mainnet|eth-mainnet|chainid[":= ]*1\b)/i,
  sepolia: /\b(sepolia|chainid[":= ]*11155111\b)/i,
  bsc: /\b(bsc|bnb|chainid[":= ]*56\b)/i,
  bscTestnet: /\b(bsc-?testnet|chainid[":= ]*97\b)/i,
  polygon: /\b(polygon|chainid[":= ]*137\b)/i,
  amoy: /\b(amoy|chainid[":= ]*80002\b)/i,
  arbitrum: /\b(arbitrum|chainid[":= ]*42161\b)/i,
  optimism: /\b(optimism|chainid[":= ]*10\b)/i,
  base: /\b(base|chainid[":= ]*8453\b)/i,
  baseSepolia: /\b(base-?sepolia|chainid[":= ]*84532\b)/i,
  xlayer: /\b(x[- ]?layer|chainid[":= ]*196\b)/i,
  solana: /\b(solana|cluster[":= ]*(mainnet|devnet)|chainid[":= ]*101\b)/i,
};

const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;

export function analyzeWeb3(
  entries: FileEntry[],
  fileContents: Map<string, string>
): Web3Analysis {
  const findings: Finding[] = [];
  let hasContracts = false;
  let hasDeployScripts = false;
  let hasAbi = false;
  let hasContractTests = false;
  let hasAuditNote = false;
  let hasContractAddresses = false;
  const chains = new Set<string>();
  const contractAddresses = new Set<string>();

  const lowerPaths = entries.map((e) => e.path);

  for (const p of lowerPaths) {
    if (/(^|\/)contracts?\//i.test(p) && /\.(sol|vy|cairo|move)$/i.test(p)) {
      hasContracts = true;
    }
    if (/(^|\/)(scripts\/deploy|deploy\/.+|migrations\/)/i.test(p)) {
      hasDeployScripts = true;
    }
    if (/\.json$/i.test(p) && /(abi|artifacts\/build-info)/i.test(p)) {
      hasAbi = true;
    }
    if (/\.sol\.json$/i.test(p) || /(^|\/)test\/.*\.(sol|t\.sol)$/i.test(p)) {
      hasContractTests = true;
    }
    if (/\b(audit|security[-_ ]?report)\.(md|pdf)$/i.test(p)) {
      hasAuditNote = true;
    }
  }

  // Frontend chain config files
  for (const [path, content] of fileContents) {
    if (!/(wagmi|viem|ethers|web3|chain|network|config)/i.test(path)) continue;
    for (const [chain, re] of Object.entries(CHAIN_KEYWORDS)) {
      if (re.test(content)) chains.add(chain);
    }
    const addrs = content.match(ADDRESS_RE);
    if (addrs) {
      for (const a of addrs) contractAddresses.add(a);
    }
  }

  // Also search for addresses in README, deploy scripts, env example
  for (const [path, content] of fileContents) {
    if (/(^|\/)(README|deploy|contracts?\/addresses|\.env|addresses)/i.test(path)) {
      const addrs = content.match(ADDRESS_RE);
      if (addrs) {
        hasContractAddresses = true;
        for (const a of addrs) contractAddresses.add(a);
      }
    }
  }

  if (!hasContracts) {
    // Not a Web3 project. Don't penalize, but record nothing.
  } else {
    if (!hasDeployScripts) {
      findings.push({
        id: 'web3-no-deploy-script',
        category: 'web3',
        severity: 'high',
        title: 'No deploy script found',
        description: 'Contracts are present but no deployment script (e.g. scripts/deploy.ts) was detected.',
        evidence: [{ file: 'scripts/', line: null, reason: 'no deploy entry' }],
        recommendedAction: 'Add a deploy script under scripts/ that supports at least one network.',
        acceptanceCriteria: ['scripts/deploy.{ts,js,sol} exists and is wired into the package manager scripts.'],
      });
    }
    if (!hasContractTests) {
      findings.push({
        id: 'web3-no-contract-tests',
        category: 'web3',
        severity: 'high',
        title: 'No contract tests detected',
        description: 'Contract code without a Foundry/Hardhat test suite cannot be considered launch-ready.',
        evidence: [{ file: 'test/', line: null, reason: 'no .sol/.t.sol test files' }],
        recommendedAction: 'Add at least one Foundry or Hardhat test per contract.',
        acceptanceCriteria: ['forge test (Foundry) or npx hardhat test (Hardhat) exits 0.'],
      });
    }
    if (chains.size === 0) {
      findings.push({
        id: 'web3-no-chain-config',
        category: 'web3',
        severity: 'medium',
        title: 'No chain configuration detected',
        description: 'Frontend / backend code mentions no specific chain. Auditors and judges cannot tell which network this targets.',
        evidence: [{ file: 'wagmi/viem/ethers config', line: null, reason: 'no chain keyword match' }],
        recommendedAction: 'Document the target chain in the README and pin it in the frontend chain config.',
        acceptanceCriteria: ['README names at least one chain.'],
      });
    }
    if (!hasAuditNote) {
      findings.push({
        id: 'web3-no-audit-note',
        category: 'web3',
        severity: 'low',
        title: 'No security audit document',
        description:
          'RepoPilot is NOT a security audit. If the project is production-bound, add a note about whether a third-party audit has been performed.',
        evidence: [{ file: 'AUDIT.md / SECURITY.md', line: null, reason: 'no audit-related file' }],
        recommendedAction: 'Add an AUDIT.md describing audit status (or "self-reviewed only — not audited").',
        acceptanceCriteria: ['AUDIT.md or SECURITY.md is present and current.'],
      });
    }
  }

  return {
    findings,
    hasContracts,
    hasDeployScripts,
    hasAbi,
    hasContractTests,
    hasAuditNote,
    hasContractAddresses,
    chains: [...chains],
    contractAddresses: [...contractAddresses],
  };
}
