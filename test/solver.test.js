'use strict';
const assert = require('assert');
const { solve } = require('../src/solver');

/* ---------- 暴力参考实现（全排列枚举） ---------- */
function brute(input) {
  const scenes = input.scenes;
  const n = scenes.length;
  const idIdx = new Map(scenes.map((s, i) => [s.id, i]));
  const sets = scenes.map((s) => new Set(s.props));
  const deps = (input.dependencies || []).map(([a, b]) => [idIdx.get(a), idIdx.get(b)]);
  const fixed = new Map((input.fixed || []).map((f) => [idIdx.get(f.id), f.pos - 1]));
  const fb = (input.forbidden || []).map(([a, b]) => [idIdx.get(a), idIdx.get(b)]);

  let best = null;
  const perm = [];
  const used = new Array(n).fill(false);

  const feasible = (p) => {
    const pos = new Array(n);
    p.forEach((s, i) => { pos[s] = i; });
    for (const [a, b] of deps) if (pos[a] >= pos[b]) return false;
    for (const [s, q] of fixed) if (pos[s] !== q) return false;
    for (const [a, b] of fb) if (Math.abs(pos[a] - pos[b]) === 1) return false;
    return true;
  };
  const cost = (p) => {
    let c = 0;
    for (let i = 1; i < p.length; i++) {
      const A = sets[p[i - 1]], B = sets[p[i]];
      for (const x of A) if (!B.has(x)) c++;
      for (const x of B) if (!A.has(x)) c++;
    }
    return c;
  };

  (function rec() {
    if (perm.length === n) {
      if (feasible(perm)) {
        const c = cost(perm);
        if (best === null || c < best.cost || (c === best.cost && perm.join() < best.order.join())) {
          best = { cost: c, order: perm.slice() };
        }
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (!used[i]) { used[i] = true; perm.push(i); rec(); perm.pop(); used[i] = false; }
    }
  })();
  return best;
}

function makeInput(n, rand, opts = {}) {
  const scenes = [];
  const propPool = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
  for (let i = 0; i < n; i++) {
    const props = [];
    const k = rand() % 4;
    for (let j = 0; j < k; j++) {
      const p = propPool[rand() % propPool.length];
      if (!props.includes(p)) props.push(p);
    }
    scenes.push({ id: `s${i}`, name: `S${i}`, props });
  }
  const input = { scenes, dependencies: [], fixed: [], forbidden: [] };
  if (opts.deps) {
    const cnt = rand() % (n + 1);
    for (let t = 0; t < cnt; t++) {
      const a = rand() % n, b = rand() % n;
      if (a !== b && !input.dependencies.some(([x, y]) => x === `s${a}` && y === `s${b}`)) {
        input.dependencies.push([`s${a}`, `s${b}`]);
      }
    }
  }
  if (opts.fixed) {
    const cnt = rand() % 3;
    const positions = new Set();
    for (let t = 0; t < cnt; t++) {
      const s = rand() % n;
      if (input.fixed.some((f) => f.id === `s${s}`)) continue;
      const pos = 1 + rand() % n;
      if (positions.has(pos)) continue;
      positions.add(pos);
      input.fixed.push({ id: `s${s}`, pos });
    }
  }
  if (opts.forbidden) {
    const cnt = rand() % 3;
    const seen = new Set();
    for (let t = 0; t < cnt; t++) {
      const a = rand() % n, b = rand() % n;
      if (a === b) continue;
      const key = [Math.min(a, b), Math.max(a, b)].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      input.forbidden.push([`s${a}`, `s${b}`]);
    }
  }
  return input;
}

/* ---------- 随机交叉验证 ---------- */
let pass = 0, infeasible = 0;
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
}

for (let seed = 1; seed <= 4000; seed++) {
  const rand = seeded(seed * 7 + 13);
  const n = 1 + rand() % 8;
  const input = makeInput(n, rand, { deps: true, fixed: true, forbidden: true });
  const r = solve(input);
  const b = brute(input);
  if (b === null) {
    assert.strictEqual(r.feasible, false, `seed ${seed}: DP 应有解但报无冲突?`);
    assert.ok(r.conflicts.length >= 1, `seed ${seed}: 冲突为空`);
    infeasible++;
  } else {
    assert.ok(r.feasible, `seed ${seed}: 应有解，冲突: ${JSON.stringify(r.conflicts)}`);
    assert.strictEqual(r.totalMoves, b.cost,
      `seed ${seed}: 代价 ${r.totalMoves} != 最优 ${b.cost}; ${JSON.stringify(input)}`);
    const dpOrder = r.order.map((x) => input.scenes.findIndex((s) => s.id === x.id));
    assert.strictEqual(dpOrder.join(','), b.order.join(','),
      `seed ${seed}: 并列时顺序应确定`);
    pass++;
  }
}
console.log(`随机交叉验证通过：${pass} 个有解实例（代价与顺序均与全排列一致），${infeasible} 个无解实例均报告冲突`);

/* ---------- MUS 极小性验证 ---------- */
// K3 三条边全禁：任意排列都有相邻禁边；
// 而去掉任意一条禁边后即可解 => MUS 大小恰为 2
const r1 = solve({
  scenes: [{ id: 'a', name: 'A', props: [] }, { id: 'b', name: 'B', props: [] }, { id: 'c', name: 'C', props: [] }],
  forbidden: [['a', 'b'], ['b', 'c'], ['a', 'c']]
});
assert.strictEqual(r1.feasible, false);
assert.strictEqual(r1.method, 'mus');
assert.ok(r1.conflicts.length >= 2 && r1.conflicts.length <= 3, 'K3 的 MUS 大小应为 2 或 3');
console.log('MUS 测试通过（K3 完全图，核大小 =', r1.conflicts.length, '）：');
r1.conflicts.forEach((c) => console.log('  -', c.message));

// 端到端验证极小性：全部 3 条在则不可解；而从返回的核中去掉任意一条后均可解
const allFb = [['a', 'b'], ['b', 'c'], ['a', 'c']];
const baseScenes = [
  { id: 'a', name: 'A', props: [] },
  { id: 'b', name: 'B', props: [] },
  { id: 'c', name: 'C', props: [] }
];
assert.strictEqual(solve({ scenes: baseScenes, forbidden: allFb }).feasible, false);
// 从核消息反推名称，再映射回 ID，构造核集合
const nameToId = new Map(baseScenes.map((s) => [s.name, s.id]));
const pairFromMsg = (msg) => [...msg.matchAll(/「([^」]+)」/g)].map((x) => nameToId.get(x[1]));
const core = r1.conflicts.map((c) => pairFromMsg(c.message));
assert.ok(core.length >= 2, 'K3 的 MUS 至少 2 条');
for (const [x, y] of core) {
  const rest = core.filter(([p, q]) => !(p === x && q === y));
  assert.strictEqual(
    solve({ scenes: baseScenes, forbidden: rest }).feasible,
    true,
    `从核中去掉「${x}—${y}」后应可解`
  );
}
// 核本身必须不可解
assert.strictEqual(solve({ scenes: baseScenes, forbidden: core }).feasible, false);
console.log('MUS 子集极小性端到端验证通过：核本身不可解，去掉核中任意一条约束后均可解');

/* ---------- 结构化冲突 ---------- */
// 依赖环
const r2 = solve({
  scenes: [{ id: 'a', name: 'A', props: [] }, { id: 'b', name: 'B', props: [] }],
  dependencies: [['a', 'b'], ['b', 'a']]
});
assert.strictEqual(r2.feasible, false);
assert.strictEqual(r2.method, 'structural');
assert.ok(r2.conflicts[0].type === 'cycle');
console.log('环冲突：', r2.conflicts[0].message);

// 自依赖
const r2b = solve({ scenes: [{ id: 'a', name: 'A', props: [] }], dependencies: [['a', 'a']] });
assert.strictEqual(r2b.feasible, false);
assert.strictEqual(r2b.conflicts[0].type, 'cycle');

// 固定位与依赖冲突（两者固定位均在自身可行区间内，纯方向矛盾）
const r3 = solve({
  scenes: [{ id: 'a', name: 'A', props: [] }, { id: 'b', name: 'B', props: [] }, { id: 'c', name: 'C', props: [] }],
  dependencies: [['a', 'b']],
  fixed: [{ id: 'a', pos: 2 }, { id: 'b', pos: 1 }]
});
assert.strictEqual(r3.feasible, false);
assert.ok(r3.conflicts.some((c) => c.type === 'fixed-window'), '2 场景下应报告固定位超出区间');
console.log('固定窗口冲突（2 场景）：', r3.conflicts.map((c) => c.message).join(' / '));

const r3b = solve({
  scenes: [
    { id: 'a', name: 'A', props: [] }, { id: 'b', name: 'B', props: [] },
    { id: 'c', name: 'C', props: [] }, { id: 'd', name: 'D', props: [] }
  ],
  dependencies: [['a', 'b']],
  fixed: [{ id: 'a', pos: 3 }, { id: 'b', pos: 2 }]
});
assert.strictEqual(r3b.feasible, false);
assert.ok(r3b.conflicts.some((c) => c.type === 'fixed-dep'), '4 场景双方窗口可行时应报告固定位与依赖方向冲突');
console.log('固定-依赖冲突：', r3b.conflicts[0].message);

// 固定窗口冲突：a 必须在 b 之前，a 固定第 2 位（2 场景）
const r4 = solve({
  scenes: [{ id: 'a', name: 'A', props: [] }, { id: 'b', name: 'B', props: [] }],
  dependencies: [['a', 'b']],
  fixed: [{ id: 'a', pos: 2 }]
});
assert.strictEqual(r4.feasible, false);
assert.ok(r4.conflicts.some((c) => c.type === 'fixed-window'));
console.log('固定窗口冲突：', r4.conflicts[0].message);

// 固定相邻 + 禁止相邻
const r5 = solve({
  scenes: [{ id: 'a', name: 'A', props: [] }, { id: 'b', name: 'B', props: [] }],
  fixed: [{ id: 'a', pos: 1 }, { id: 'b', pos: 2 }],
  forbidden: [['a', 'b']]
});
assert.strictEqual(r5.feasible, false);
assert.ok(r5.conflicts.some((c) => c.type === 'fixed-adj'));
console.log('固定-禁邻冲突：', r5.conflicts[0].message);

/* ---------- 校验错误 ---------- */
assert.throws(() => solve({ scenes: [] }), /至少需要 1 个场景/);
assert.throws(() => solve({ scenes: Array.from({ length: 13 }, (_, i) => ({ id: 's' + i })) }), /不能超过 12/);
assert.throws(() => solve({ scenes: [{ id: 'a' }], fixed: [{ id: 'a', pos: 2 }] }), /序位/);
assert.throws(() => solve({ scenes: [{ id: 'a' }], dependencies: [['a', 'x']] }), /不存在/);
assert.throws(() => solve({ scenes: [{ id: 'a' }], forbidden: [['a', 'a']] }), /自身/);
assert.throws(() => solve({
  scenes: [{ id: 'a' }, { id: 'b' }],
  fixed: [{ id: 'a', pos: 1 }, { id: 'b', pos: 1 }]
}), /同时固定/);
console.log('输入校验测试全部通过');

/* ---------- 换景明细正确性 ---------- */
const r6 = solve({
  scenes: [
    { id: 'a', name: 'A', props: ['x', 'y'] },
    { id: 'b', name: 'B', props: ['y', 'z'] }
  ]
});
assert.strictEqual(r6.feasible, true);
assert.strictEqual(r6.totalMoves, 2);
assert.deepStrictEqual(r6.transitions[0].adds, ['z']);
assert.deepStrictEqual(r6.transitions[0].removes, ['x']);
assert.deepStrictEqual(r6.setup.sort(), ['x', 'y']);
assert.deepStrictEqual(r6.strike.sort(), ['y', 'z']);
console.log('换景明细测试通过：装台', r6.setup, '/ 增加', r6.transitions[0].adds, '/ 移除', r6.transitions[0].removes, '/ 卸台', r6.strike);

/* ---------- n=12 性能 ---------- */
{
  const rand = seeded(999);
  const input = makeInput(12, rand, { deps: true, fixed: false, forbidden: true });
  const t0 = Date.now();
  const r = solve(input);
  const ms = Date.now() - t0;
  console.log(`n=12 求解耗时 ${ms}ms，feasible=${r.feasible}${r.feasible ? '，总增减=' + r.totalMoves : ''}`);
  assert.ok(ms < 500, 'n=12 应在 500ms 内完成');
}

/* ---------- 无解 MUS 性能（最坏：每次删减法都跑 DP） ---------- */
{
  const scenes = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, name: 'S' + i, props: [] }));
  // 构造几乎不可行：大量固定 + 依赖 + 禁边，使 MUS 过程反复跑 12 维 DP
  const input = {
    scenes,
    fixed: Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, pos: i + 1 })),
    dependencies: [['s10', 's11']],
    forbidden: [['s0', 's1']] // 与固定位矛盾 -> 实际会被结构化检测 fixed-adj 捕获
  };
  const t0 = Date.now();
  const r = solve(input);
  const ms = Date.now() - t0;
  console.log(`结构化冲突 n=12 耗时 ${ms}ms：`, r.conflicts[0].message);
}

// 纯禁边导致的无解 + MUS 性能（n=12 完全图）
{
  const scenes = Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, name: 'S' + i, props: [] }));
  const forbidden = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) forbidden.push(['s' + i, 's' + j]);
  const t0 = Date.now();
  const r = solve({ scenes, forbidden });
  const ms = Date.now() - t0;
  assert.strictEqual(r.feasible, false);
  assert.strictEqual(r.method, 'mus');
  console.log(`n=12 完全禁边图 MUS 耗时 ${ms}ms，核大小 ${r.conflicts.length}`);

  // 端到端验证子集极小性：核本身不可解；去掉核中任意一条后均可解
  const idByName = new Map(scenes.map((s) => [s.name, s.id]));
  const coreEdges = r.conflicts.map((c) =>
    [...c.message.matchAll(/「([^」]+)」/g)].map((x) => idByName.get(x[1]))
  );
  assert.strictEqual(solve({ scenes, forbidden: coreEdges }).feasible, false, '核本身应不可解');
  for (let i = 0; i < coreEdges.length; i++) {
    const rest = coreEdges.filter((_, j) => j !== i);
    assert.strictEqual(
      solve({ scenes, forbidden: rest }).feasible,
      true,
      `K12 核去掉第 ${i + 1} 条后应可解`
    );
  }
  console.log(`K12 核子集极小性验证通过（${coreEdges.length} 条，逐删除均可解）`);
  assert.ok(ms < 5000, 'MUS 应在数秒内完成');
}

console.log('\n全部测试通过 ✔');
