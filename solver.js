'use strict';

/**
 * 求解器：在全部约束下，求道具增减次数最少的场景演出顺序。
 *
 * 约束类型：
 *  - dependencies:        [{ before, after }]   before 必须排在 after 之前
 *  - fixedPositions:      [{ sceneId, position }] 场景固定在第 position 位（1 起）
 *  - forbiddenAdjacencies:[{ a, b }]            a 与 b 不得相邻
 *
 * 目标函数：开场布置道具数 + 每次换景的（撤下数 + 上台数）之和。
 *
 * 算法：n <= 12，使用子集 DP（Held-Karp 风格），状态 (已排集合, 末尾场景)，
 * 复杂度 O(2^n * n^2)，最坏约 70 万状态，毫秒级完成。
 */

const MAX_SCENES = 12;

function normalizeProps(props) {
  const out = [];
  const seen = new Set();
  for (const p of props || []) {
    const s = String(p).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function popcount(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** 把输入编译成位掩码/矩阵模型，供 DP 使用。 */
function buildModel(scenes, constraints) {
  const n = scenes.length;
  const index = new Map();
  scenes.forEach((s, i) => index.set(s.id, i));
  const propSets = scenes.map(s => new Set(normalizeProps(s.props)));

  // prereq[i]: 必须排在 i 之前的场景位掩码
  const prereq = new Array(n).fill(0);
  for (const d of (constraints && constraints.dependencies) || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    prereq[b] |= (1 << a);
  }

  // 固定序位（position 为 1 起，内部转 0 起）
  const fixedPosOfScene = new Array(n).fill(-1);
  const sceneAtPos = new Array(n).fill(-1);
  for (const f of (constraints && constraints.fixedPositions) || []) {
    const i = index.get(f.sceneId);
    if (i === undefined) continue;
    const p = Number(f.position) - 1;
    if (p < 0 || p >= n) continue;
    fixedPosOfScene[i] = p;
    sceneAtPos[p] = i; // 若两个场景固定同一序位，DP 必然无解，由冲突分析给出核心
  }

  // 禁止相邻矩阵（对称）
  const bad = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const f of (constraints && constraints.forbiddenAdjacencies) || []) {
    const a = index.get(f.a);
    const b = index.get(f.b);
    if (a === undefined || b === undefined || a === b) continue;
    bad[a][b] = bad[b][a] = true;
  }

  // 换景代价：对称差大小
  const cost = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let c = 0;
      for (const p of propSets[i]) if (!propSets[j].has(p)) c++;
      for (const p of propSets[j]) if (!propSets[i].has(p)) c++;
      cost[i][j] = c;
    }
  }
  const setupCost = propSets.map(s => s.size);

  return { n, propSets, prereq, fixedPosOfScene, sceneAtPos, bad, cost, setupCost };
}

/** 子集 DP。返回 { cost, orderIdx } 或 null（无解）。 */
function runDP(model) {
  const { n, prereq, fixedPosOfScene, sceneAtPos, bad, cost, setupCost } = model;
  const fullMask = (1 << n) - 1;
  const size = 1 << n;
  const dp = new Array(size);
  const parent = new Array(size);

  const allowedAt = (j, pos) =>
    (fixedPosOfScene[j] === -1 || fixedPosOfScene[j] === pos) &&
    (sceneAtPos[pos] === -1 || sceneAtPos[pos] === j);

  const ensure = (m) => {
    if (!dp[m]) {
      dp[m] = new Array(n).fill(Infinity);
      parent[m] = new Array(n).fill(-1);
    }
  };

  for (let j = 0; j < n; j++) {
    if (prereq[j] !== 0) continue;      // 有前置依赖的场景不能排首位
    if (!allowedAt(j, 0)) continue;
    const m = 1 << j;
    ensure(m);
    dp[m][j] = setupCost[j];
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    const row = dp[mask];
    if (!row) continue;
    const pos = popcount(mask); // 下一位的序位（0 起）
    if (pos >= n) continue;
    for (let last = 0; last < n; last++) {
      const cur = row[last];
      if (cur === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const bit = 1 << j;
        if (mask & bit) continue;
        if ((prereq[j] & ~mask) !== 0) continue; // 前置依赖必须已全部排入
        if (!allowedAt(j, pos)) continue;
        if (bad[last][j]) continue;
        const nm = mask | bit;
        const nc = cur + cost[last][j];
        ensure(nm);
        if (nc < dp[nm][j]) { // 严格小于：保证结果确定性（按下标字典序取先到达者）
          dp[nm][j] = nc;
          parent[nm][j] = last;
        }
      }
    }
  }

  const fullRow = dp[fullMask];
  if (!fullRow) return null;
  let best = Infinity;
  let bestLast = -1;
  for (let last = 0; last < n; last++) {
    if (fullRow[last] < best) {
      best = fullRow[last];
      bestLast = last;
    }
  }
  if (bestLast === -1) return null;

  const orderIdx = [];
  let mask = fullMask;
  let last = bestLast;
  while (true) {
    orderIdx.push(last);
    const p = parent[mask][last];
    if (p === -1) break;
    mask ^= (1 << last);
    last = p;
  }
  orderIdx.reverse();
  return { cost: best, orderIdx };
}

/** 检测依赖环，返回构成环的依赖约束数组，无环返回 null。 */
function findDepCycle(scenes, deps) {
  const index = new Map(scenes.map((s, i) => [s.id, i]));
  const adj = scenes.map(() => []);
  for (const d of deps || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    adj[a].push({ to: b, dep: d });
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Array(scenes.length).fill(WHITE);
  const stack = [];
  let result = null;

  function dfs(u) {
    color[u] = GRAY;
    stack.push(u);
    for (const e of adj[u]) {
      if (result) return;
      if (color[e.to] === GRAY) {
        const start = stack.indexOf(e.to);
        const nodes = stack.slice(start).concat([e.to]);
        const cyc = [];
        for (let k = 0; k < nodes.length - 1; k++) {
          const edge = adj[nodes[k]].find(x => x.to === nodes[k + 1]);
          cyc.push(edge.dep);
        }
        result = cyc;
        return;
      }
      if (color[e.to] === WHITE) dfs(e.to);
    }
    stack.pop();
    color[u] = BLACK;
  }

  for (let i = 0; i < scenes.length && !result; i++) {
    if (color[i] === WHITE) dfs(i);
  }
  return result;
}

function describeConstraint(scenes, kind, data) {
  const name = (id) => {
    const s = scenes.find(x => x.id === id);
    return s ? s.name : String(id);
  };
  if (kind === 'dependency') {
    return { kind, data, text: `「${name(data.before)}」必须排在「${name(data.after)}」之前` };
  }
  if (kind === 'fixedPosition') {
    return { kind, data, text: `「${name(data.sceneId)}」固定在第 ${data.position} 位` };
  }
  return { kind, data, text: `「${name(data.a)}」与「${name(data.b)}」禁止相邻` };
}

/**
 * 无解时给出一组可复现的冲突约束：
 * 1. 若依赖存在环，直接返回环上的依赖（本身即最小冲突）；
 * 2. 否则做贪心极小化：逐条尝试移除约束，若仍无解则永久移除，
 *    剩余集合即为"去掉任意一条即可有解"的极小冲突核心。
 */
function analyzeConflict(scenes, constraints) {
  const cycle = findDepCycle(scenes, (constraints && constraints.dependencies) || []);
  if (cycle) {
    return {
      type: 'dependency-cycle',
      message: '场景依赖关系存在循环，无法排出满足全部先后约束的顺序：',
      constraints: cycle.map(d => describeConstraint(scenes, 'dependency', d)),
    };
  }

  const all = [];
  for (const d of (constraints && constraints.dependencies) || []) all.push({ kind: 'dependency', data: d });
  for (const f of (constraints && constraints.fixedPositions) || []) all.push({ kind: 'fixedPosition', data: f });
  for (const f of (constraints && constraints.forbiddenAdjacencies) || []) all.push({ kind: 'forbiddenAdjacency', data: f });

  const satisfiable = (items) => {
    const c = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
    for (const it of items) {
      if (it.kind === 'dependency') c.dependencies.push(it.data);
      else if (it.kind === 'fixedPosition') c.fixedPositions.push(it.data);
      else c.forbiddenAdjacencies.push(it.data);
    }
    return runDP(buildModel(scenes, c)) !== null;
  };

  let core = all.slice();
  for (const item of all) {
    if (core.length <= 1) break;
    const trial = core.filter(x => x !== item);
    if (!satisfiable(trial)) core = trial;
  }

  return {
    type: 'constraint-set',
    message: '以下约束组合相互冲突（移除其中任意一条即可恢复有解）：',
    constraints: core.map(it => describeConstraint(scenes, it.kind, it.data)),
  };
}

/**
 * 求解入口。
 * @returns 有解：{ ok:true, order, totalCost, steps }；无解：{ ok:false, conflict }
 */
function solve(scenes, constraints) {
  const model = buildModel(scenes, constraints);
  const res = runDP(model);
  if (!res) {
    return { ok: false, conflict: analyzeConflict(scenes, constraints || {}) };
  }

  const steps = [];
  const first = res.orderIdx[0];
  const firstProps = [...model.propSets[first]];
  steps.push({
    type: 'setup',
    scene: scenes[first].id,
    added: firstProps,
    removed: [],
    count: firstProps.length,
  });
  for (let k = 1; k < res.orderIdx.length; k++) {
    const a = res.orderIdx[k - 1];
    const b = res.orderIdx[k];
    const removed = [...model.propSets[a]].filter(p => !model.propSets[b].has(p));
    const added = [...model.propSets[b]].filter(p => !model.propSets[a].has(p));
    steps.push({
      type: 'transition',
      from: scenes[a].id,
      to: scenes[b].id,
      removed,
      added,
      count: removed.length + added.length,
    });
  }

  return {
    ok: true,
    order: res.orderIdx.map(i => scenes[i].id),
    totalCost: res.cost,
    steps,
  };
}

module.exports = { solve, MAX_SCENES, normalizeProps };
