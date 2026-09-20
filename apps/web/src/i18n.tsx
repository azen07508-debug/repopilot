/**
 * Minimal i18n layer for the web UI.
 *
 * Two locales: English and Simplified Chinese. No dependency, no
 * lazy loading, no pluralisation engine — this UI has ~50 strings.
 *
 * `zh-CN` is typed as the English dictionary so a missing key is a
 * compile error, not a runtime blank.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type UiLanguage = 'en' | 'zh-CN';

const en = {
  appName: 'RepoPilot',
  langToggle: '中文',
  langToggleTo: 'Switch to Chinese',

  heroTitle: 'One repo in. A launch-ready plan out.',
  heroSubtitle:
    'Paste a public GitHub URL. Get a launch-readiness report with documented evidence, prioritized blockers and acceptance criteria. Static analysis only. Your repository code is never executed.',

  formRepoUrl: 'GitHub repository URL',
  formRepoPlaceholder: 'https://github.com/owner/repo',
  formMode: 'Mode',
  modeQuick: 'Quick Scan',
  modeFull: 'Full Launch Audit',
  formTarget: 'Target',
  targetOpenSource: 'Open Source',
  targetHackathon: 'Hackathon',
  targetProduction: 'Production',
  formLanguage: 'Report language',
  langEn: 'English',
  langZh: 'Simplified Chinese',
  formIncludeLaunchCopy: 'Include launch copy',
  formTry: 'Try',
  actionRun: 'Run audit',
  actionRunQuick: 'Run Quick Scan',
  actionRunFull: 'Run Full Audit',
  actionRunning: 'Auditing',

  statusApiOk: 'API ok',
  statusDbOk: 'DB ok',
  statusPayment: 'payment',
  statusQuickScan: 'Quick Scan',
  statusFullAudit: 'Full Audit',
  statusMaxFiles: 'Max files',
  statusRate: 'Rate',
  statusMockPayment: 'Mock payment (dev only)',

  reportOverall: 'overall / 100',
  reportDownload: 'Download JSON',
  reportSummary: 'Summary',
  reportScores: 'Scores',
  scoreDocumentation: 'Documentation',
  scoreReproducibility: 'Reproducibility',
  scoreSecurity: 'Security hygiene',
  scoreDeployment: 'Deployment readiness',
  reportStack: 'Detected stack',
  reportStackEmpty: 'No specific stack detected.',
  reportBlockers: 'Blockers',
  reportBlockersEmpty: 'No critical or high-severity blockers detected.',
  reportDocGaps: 'Documentation gaps',
  reportDocGapsEmpty: 'All baseline documentation is present.',
  reportSecurity: 'Security findings',
  reportSecurityEmpty: 'No secrets or prompt-injection patterns detected.',
  reportChecklist: 'Launch checklist',
  reportLaunchCopy: 'Launch copy',
  copyOneSentence: 'One-sentence pitch',
  copyShort: 'Short description',
  copyXPost: 'X post',
  reportLimitations: 'Limitations',
  labelEvidence: 'Evidence',
  labelRecommended: 'Recommended',
  stateDone: 'Done',
  statePending: 'Pending',

  emptyTitle: 'No report yet',
  emptyBody: 'Submit a public GitHub URL above to generate the first audit.',
  loadingTitle: 'Reading the repository',
  loadingBody: 'Fetching the file tree, running analyzers and scoring the result.',
  errorTitle: 'Something went wrong',

  footerDisclaimer:
    'RepoPilot performs static analysis only. It does not execute code from audited repositories and does not perform a formal security audit. No investment advice.',
  footerPayments:
    'Payments in production run via the OKX Agent Payments Protocol (x402 / accepts[]). In dev, a mock adapter is used.',

  navReport: 'Report',
  navHistory: 'History',
  navDiff: 'Comparison',
  backToReport: 'Back to report',

  fixPlanTitle: 'Fix plan',
  fixPlanHint: 'Derived from this report. No repository scan, no extra cost.',
  fixPlanEmpty: 'No findings to plan for.',
  fixPlanTests: 'Tests to add',
  fixPlanAcceptance: 'Acceptance criteria',
  fixPlanRisks: 'Watch out',
  fixPlanInstructions: 'Agent instructions',
  copyInstructions: 'Copy instructions',
  copied: 'Copied',
  fixPlanFooter: '{n} plan(s) generated from this report.',

  diffTitle: 'Before / after',
  verdictImproved: 'Improved',
  verdictRegressed: 'Regressed',
  verdictUnchanged: 'Unchanged',
  diffDimensions: 'By dimension',
  diffRules: 'Why the score moved',
  diffRulesEmpty: 'No scoring rule changed between these two audits.',
  diffRule: 'Rule',
  diffBefore: 'Before',
  diffAfter: 'After',
  diffChange: 'Change',
  diffFindings: 'Findings',
  diffResolved: 'Resolved',
  diffNew: 'New',
  diffPersistent: 'Still open',

  historyTitle: 'Audit history',
  historyHint: 'newest first',
  historyEmpty: 'No audits recorded for this repository yet.',
  historyWhen: 'When',
  historyCommit: 'Commit',
  historyMode: 'Mode',
  historyScore: 'Score',
  historyFindings: 'Findings',
  historyCurrent: 'current',
  historyCompare: 'Compare',
};

export type Dict = typeof en;

const zhCN: Dict = {
  appName: 'RepoPilot',
  langToggle: 'English',
  langToggleTo: '切换为英文',

  heroTitle: '输入一个仓库，输出一份可上线的方案。',
  heroSubtitle:
    '粘贴一个公开 GitHub 仓库地址，得到一份带证据、按优先级排列阻塞项、并附验收标准的发布就绪度报告。仅做静态分析，绝不执行被审计仓库的代码。',

  formRepoUrl: 'GitHub 仓库地址',
  formRepoPlaceholder: 'https://github.com/owner/repo',
  formMode: '扫描模式',
  modeQuick: '快速扫描',
  modeFull: '完整发布审计',
  formTarget: '目标场景',
  targetOpenSource: '开源项目',
  targetHackathon: '黑客松',
  targetProduction: '生产环境',
  formLanguage: '报告语言',
  langEn: '英文',
  langZh: '简体中文',
  formIncludeLaunchCopy: '包含发布文案',
  formTry: '试试',
  actionRun: '开始审计',
  actionRunQuick: '运行快速扫描',
  actionRunFull: '运行完整审计',
  actionRunning: '审计中',

  statusApiOk: '接口正常',
  statusDbOk: '数据库正常',
  statusPayment: '支付方式',
  statusQuickScan: '快速扫描',
  statusFullAudit: '完整审计',
  statusMaxFiles: '文件上限',
  statusRate: '频率',
  statusMockPayment: '模拟支付（仅开发环境）',

  reportOverall: '总分 / 100',
  reportDownload: '下载 JSON',
  reportSummary: '摘要',
  reportScores: '评分',
  scoreDocumentation: '文档',
  scoreReproducibility: '可复现性',
  scoreSecurity: '安全卫生',
  scoreDeployment: '部署就绪度',
  reportStack: '识别到的技术栈',
  reportStackEmpty: '未识别到明确的技术栈。',
  reportBlockers: '阻塞项',
  reportBlockersEmpty: '未发现严重或高危阻塞项。',
  reportDocGaps: '文档缺口',
  reportDocGapsEmpty: '基础文档齐全。',
  reportSecurity: '安全发现',
  reportSecurityEmpty: '未发现密钥或提示词注入模式。',
  reportChecklist: '发布清单',
  reportLaunchCopy: '发布文案',
  copyOneSentence: '一句话简介',
  copyShort: '简短描述',
  copyXPost: 'X 推文',
  reportLimitations: '局限性',
  labelEvidence: '证据',
  labelRecommended: '建议',
  stateDone: '已完成',
  statePending: '待处理',

  emptyTitle: '还没有报告',
  emptyBody: '在上方提交一个公开 GitHub 仓库地址，即可生成第一份审计报告。',
  loadingTitle: '正在读取仓库',
  loadingBody: '正在获取文件树、运行分析器并计算结果评分。',
  errorTitle: '出错了',

  footerDisclaimer:
    'RepoPilot 仅执行静态分析，不会运行被审计仓库中的代码，也不构成正式的安全审计。不构成任何投资建议。',
  footerPayments:
    '生产环境的支付通过 OKX Agent Payments Protocol（x402 / accepts[]）完成，开发环境使用模拟适配器。',

  navReport: '报告',
  navHistory: '历史',
  navDiff: '对比',
  backToReport: '返回报告',

  fixPlanTitle: '修复计划',
  fixPlanHint: '由本份报告派生，不重新扫描仓库，不额外计费。',
  fixPlanEmpty: '没有需要制定计划的发现项。',
  fixPlanTests: '需新增测试',
  fixPlanAcceptance: '验收标准',
  fixPlanRisks: '注意事项',
  fixPlanInstructions: 'Agent 指令',
  copyInstructions: '复制指令',
  copied: '已复制',
  fixPlanFooter: '本份报告共生成了 {n} 条计划。',

  diffTitle: '改动前后',
  verdictImproved: '有改善',
  verdictRegressed: '有退步',
  verdictUnchanged: '无变化',
  diffDimensions: '分维度',
  diffRules: '分数变化的原因',
  diffRulesEmpty: '两次审计之间没有评分规则发生变化。',
  diffRule: '规则',
  diffBefore: '之前',
  diffAfter: '之后',
  diffChange: '变化',
  diffFindings: '发现项',
  diffResolved: '已解决',
  diffNew: '新增',
  diffPersistent: '仍未解决',

  historyTitle: '审计历史',
  historyHint: '按时间倒序',
  historyEmpty: '该仓库还没有审计记录。',
  historyWhen: '时间',
  historyCommit: '提交',
  historyMode: '模式',
  historyScore: '评分',
  historyFindings: '发现项',
  historyCurrent: '当前',
  historyCompare: '对比',
};

const DICTS: Record<UiLanguage, Dict> = { en, 'zh-CN': zhCN };

interface I18nValue {
  lang: UiLanguage;
  setLang: (l: UiLanguage) => void;
  t: Dict;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'repopilot.ui.lang';

function initialLang(): UiLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch {
    // localStorage can be unavailable (private mode, SSR). Fall through.
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLanguage>(initialLang);

  const setLang = useCallback((next: UiLanguage) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting the preference is best-effort only.
    }
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: DICTS[lang] }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
