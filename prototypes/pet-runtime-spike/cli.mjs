import console from 'node:console';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import readline from 'node:readline';

import {
  buildPetRuntimeBenchmarkComparison,
} from '../../src/shared/pet-runtime-benchmark.ts';
import {
  PET_RUNTIME_GATE_IDS,
  PET_RUNTIME_REVIEW_MARGIN,
  PET_RUNTIME_SCORE_WEIGHTS,
  createEmptyPetRuntimeCandidate,
  evaluatePetRuntimeCandidate,
  rankPetRuntimeCandidates,
} from '../../src/shared/pet-runtime-evaluation.ts';

const bold = '\u001b[1m';
const dim = '\u001b[2m';
const reset = '\u001b[0m';

const candidateSeeds = [
  ['rive-canvas-lite', 'Rive · Canvas Lite'],
  ['rive-webgl2', 'Rive · WebGL2'],
  ['dotlottie-software', 'dotLottie v2 · Software'],
  ['dotlottie-webgl2', 'dotLottie v2 · WebGL2'],
  ['webm-alpha', '透明 WebM · Chromium'],
  ['frame-sequence-canvas2d', '高密度序列帧 · Canvas 2D'],
];

const gateLabels = {
  packagedArm64: 'packaged arm64 真机',
  offline: '完全离线 / 零远程请求',
  preloadDeepValidation: '加载前深层声明式校验',
  isolatedPlayer: '专用无权限 Player 隔离',
  semanticReplay: '语义动作可确定重放',
  lifecycleStability: '隐藏/恢复/100 次切换稳定',
  reducedMotion: 'reduced-motion 正确',
  distributionLicense: '分发与用户导入许可清晰',
  authoringDocumented: '制作流程、软件与费用已记录',
  creatorInputContract: '用户只需参考图与自然语言要求',
  headlessSkillGeneration: 'Skill 无头生成且无需专有编辑器',
  zeroExtraCredentials: '用户无需配置 DeepSeek 之外的任何第三方 Key',
};

const scoreLabels = {
  naturalMotion: '动作自然度',
  frameTiming: 'frame-time / 丢帧',
  resourceStability: 'CPU/GPU/内存稳定',
  bundleEfficiency: '包体效率',
  authoringEfficiency: '制作效率',
  toolingCost: '工具成本',
  skillAutomation: '未来 Skill 自动化程度',
};

const benchmarkFlagIndex = process.argv.indexOf('--benchmark');
if (benchmarkFlagIndex >= 0) {
  process.exitCode = await compareBenchmarkFiles(process.argv.slice(benchmarkFlagIndex + 1));
} else {
let candidates = candidateSeeds.map(([id, name]) => createEmptyPetRuntimeCandidate(id, name));
let selectedIndex = 0;
let message = '请选择候选并录入真实测量；unknown 不会被当作 pass。';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function render() {
  if (process.stdout.isTTY) console.clear();
  const candidate = candidates[selectedIndex];
  const result = evaluatePetRuntimeCandidate(candidate);
  const ranking = rankPetRuntimeCandidates(candidates);

  console.log(`${bold}Pet Runtime Spike · 固定口径${reset}`);
  console.log(`${dim}一票否决优先；评分权重已冻结；领先差 < ${PET_RUNTIME_REVIEW_MARGIN} 分必须人工复核。${reset}\n`);
  console.log(`${bold}候选${reset}`);
  candidates.forEach((item, index) => {
    const marker = index === selectedIndex ? '›' : ' ';
    const itemResult = evaluatePetRuntimeCandidate(item);
    const summary = itemResult.status === 'eligible' ? `${itemResult.weightedScore.toFixed(2)} 分` : itemResult.status;
    console.log(`${marker} ${index + 1}. ${item.name} ${dim}${summary}${reset}`);
  });

  console.log(`\n${bold}硬门禁 · ${candidate.name}${reset}`);
  PET_RUNTIME_GATE_IDS.forEach((gate, index) => {
    console.log(`${index + 1}. ${gateLabels[gate]}: ${candidate.gates[gate]}`);
  });

  console.log(`\n${bold}加权评分（0–100）${reset}`);
  Object.entries(PET_RUNTIME_SCORE_WEIGHTS).forEach(([score, weight], index) => {
    console.log(`${index + 1}. ${scoreLabels[score]} [${weight}%]: ${candidate.scores[score] ?? '未测'}`);
  });

  console.log(`\n${bold}当前判定${reset}: ${formatResult(result)}`);
  console.log(`${bold}总体决策${reset}: ${formatDecision(ranking.decision)}`);
  console.log(`${dim}${message}${reset}\n`);
  console.log(`${bold}命令${reset}`);
  console.log('use <候选序号> | gate <门禁序号> <pass|fail|unknown>');
  console.log('score <评分序号> <0-100|clear> | all-gates <pass|unknown> | reset | q');
  rl.setPrompt('> ');
  rl.prompt();
}

function formatResult(result) {
  if (result.status === 'eligible') return `可入选，${result.weightedScore.toFixed(2)} 分`;
  if (result.status === 'disqualified') return `淘汰：${result.failedGates.join(', ')}`;
  return `未完成：${result.missingGates.length} 项门禁、${result.missingScores.length} 项评分待测`;
}

function formatDecision(decision) {
  if (decision.status === 'no-eligible-candidate') return '尚无完整合格候选';
  if (decision.status === 'leader') {
    return `${decision.candidateId} 当前领先${decision.scoreDelta === null ? '' : ` ${decision.scoreDelta.toFixed(2)} 分`}`;
  }
  return `${decision.candidateIds.join(' / ')} 差 ${decision.scoreDelta.toFixed(2)} 分，必须人工复核`;
}

function replaceSelected(update) {
  candidates = candidates.map((candidate, index) => index === selectedIndex ? update(candidate) : candidate);
}

function handle(line) {
  const [command, first, second] = line.trim().split(/\s+/u);
  if (command === 'q' || command === 'quit') {
    rl.close();
    return;
  }
  if (command === 'use') {
    const index = Number(first) - 1;
    if (!Number.isInteger(index) || candidates[index] === undefined) return setMessage('候选序号无效。');
    selectedIndex = index;
    return setMessage(`已选择 ${candidates[index].name}。`);
  }
  if (command === 'gate') {
    const gate = PET_RUNTIME_GATE_IDS[Number(first) - 1];
    if (gate === undefined || !['pass', 'fail', 'unknown'].includes(second)) return setMessage('门禁命令无效。');
    replaceSelected((candidate) => ({ ...candidate, gates: { ...candidate.gates, [gate]: second } }));
    return setMessage(`${gateLabels[gate]} → ${second}`);
  }
  if (command === 'all-gates') {
    if (!['pass', 'unknown'].includes(first)) return setMessage('all-gates 只接受 pass 或 unknown。');
    replaceSelected((candidate) => ({
      ...candidate,
      gates: Object.fromEntries(PET_RUNTIME_GATE_IDS.map((gate) => [gate, first])),
    }));
    return setMessage(`当前候选全部门禁 → ${first}`);
  }
  if (command === 'score') {
    const score = Object.keys(PET_RUNTIME_SCORE_WEIGHTS)[Number(first) - 1];
    const value = second === 'clear' ? null : Number(second);
    if (score === undefined || (value !== null && (!Number.isFinite(value) || value < 0 || value > 100))) {
      return setMessage('评分命令无效；请输入 0–100 或 clear。');
    }
    replaceSelected((candidate) => ({ ...candidate, scores: { ...candidate.scores, [score]: value } }));
    return setMessage(`${scoreLabels[score]} → ${value ?? '未测'}`);
  }
  if (command === 'reset') {
    const [id, name] = candidateSeeds[selectedIndex];
    candidates = candidates.map((candidate, index) => index === selectedIndex
      ? createEmptyPetRuntimeCandidate(id, name)
      : candidate);
    return setMessage('当前候选已重置；其他候选未改变。');
  }
  setMessage('未知命令。');
}

function setMessage(next) {
  message = next;
}

rl.on('line', (line) => {
  handle(line);
  if (!rl.closed) render();
});

rl.on('close', () => {
  console.log('\n已退出；本次输入未写入磁盘。');
});

render();
}

async function compareBenchmarkFiles(paths) {
  if (paths.length === 0) {
    console.error('用法: pnpm pet:spike -- --benchmark <record.json> [record.json ...]');
    return 1;
  }
  const records = [];
  for (const path of paths) {
    try {
      records.push(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      console.error(`无法读取 benchmark 记录 ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  const comparison = buildPetRuntimeBenchmarkComparison(records);
  if (comparison.status === 'incomparable') {
    console.error('Benchmark 记录不可比较：');
    comparison.issues.forEach((issue) => console.error(`- ${issue}`));
    return 1;
  }
  console.log(`${bold}Pet Runtime Benchmark · 客观证据${reset}`);
  console.log(`${dim}主观自然度与制作效率不在此处自动生成，仍需盲评和人工复核。${reset}\n`);
  console.table(comparison.rows.map((row) => ({
    candidate: row.candidateId,
    trials: row.trialCount,
    frameP95: row.frameP95Ms,
    frameP99: row.frameP99Ms,
    missedRatio: row.overDoublePeriodRatio,
    activeCpu: row.activeCpuPercentMean,
    hiddenCpu: row.hiddenCpuPercentMean,
    peakMemoryMiB: Math.round((row.peakResidentMemoryBytes / 1_048_576) * 10) / 10,
    offline: row.objectiveGates.offline,
    lifecycle: row.objectiveGates.lifecycleStability,
    importReady: row.scorecardImportReady,
  })));
  const blocked = comparison.rows.filter((row) => !row.scorecardImportReady);
  if (blocked.length > 0) {
    console.error(`\n${blocked.map((row) => row.candidateId).join(', ')} 存在客观硬门禁失败，未导入评分卡。`);
    return 2;
  }
  console.log('\n所有记录的可自动验证门禁均通过；仍需完成其余安全门与人工评分。');
  return 0;
}
