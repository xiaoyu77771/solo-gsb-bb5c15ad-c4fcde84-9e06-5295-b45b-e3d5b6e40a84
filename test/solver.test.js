'use strict';

const assert = require('assert');
const { solve } = require('../solver');

const S = (id, props) => ({ id, name: id, props });
const empty = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
const C = (over) => ({ ...empty, ...over });

/* 1. 无约束时选择道具变化最少的顺序 */
{
  const scenes = [
    S('A', ['桌', '椅']),
    S('B', ['桌', '椅', '灯']),
    S('C', ['树']),
  ];
  const r = solve(scenes, C());
  assert.strictEqual(r.ok, true);
  // 最优为 C->A->B：开场 1（树）+ C→A 3（撤树上桌椅）+ A→B 1（上灯）= 5
  assert.strictEqual(r.totalCost, 5);
  assert.deepStrictEqual(r.order, ['C', 'A', 'B']);
  assert.strictEqual(r.steps.length, 3);
  assert.strictEqual(r.steps[0].type, 'setup');
}

/* 2. 依赖约束 */
{
  const scenes = [S('A', ['x']), S('B', ['y']), S('C', ['z'])];
  const r = solve(scenes, C({ dependencies: [{ before: 'C', after: 'A' }] }));
  assert.strictEqual(r.ok, true);
  assert.ok(r.order.indexOf('C') < r.order.indexOf('A'));
}

/* 3. 固定序位 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 1 }] }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order[0], 'B');
}

/* 4. 禁止相邻 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }));
  assert.strictEqual(r.ok, true);
  for (let i = 0; i + 1 < r.order.length; i++) {
    const pair = [r.order[i], r.order[i + 1]].sort().join(',');
    assert.notStrictEqual(pair, 'A,B');
  }
}

/* 5. 依赖环 → 无解并指出环 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({
    dependencies: [
      { before: 'A', after: 'B' },
      { before: 'B', after: 'C' },
      { before: 'C', after: 'A' },
    ],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'dependency-cycle');
  assert.strictEqual(r.conflict.constraints.length, 3);
}

/* 6. 固定序位冲突（两个场景同一位）→ 极小冲突核心 */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({
    fixedPositions: [
      { sceneId: 'A', position: 1 },
      { sceneId: 'B', position: 1 },
    ],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'constraint-set');
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 7. 依赖与固定序位冲突 */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({
    dependencies: [{ before: 'A', after: 'B' }],
    fixedPositions: [{ sceneId: 'B', position: 1 }],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 8. 禁止相邻导致的无解（2 个场景互不相邻） */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.constraints.length, 1);
}

/* 9. 12 个场景性能冒烟测试（应远小于 1 秒） */
{
  const scenes = [];
  for (let i = 0; i < 12; i++) scenes.push(S(`S${i}`, [`p${i}`, `p${i + 1}`]));
  const t0 = Date.now();
  const r = solve(scenes, C({
    dependencies: [{ before: 'S0', after: 'S11' }],
    fixedPositions: [{ sceneId: 'S5', position: 6 }],
    forbiddenAdjacencies: [{ a: 'S1', b: 'S2' }],
  }));
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order.length, 12);
  assert.ok(elapsed < 1000, `求解耗时 ${elapsed}ms，超过预期`);
}

/* 10. 换景明细账目核对：总次数 = 各步之和 */
{
  const scenes = [
    S('A', ['桌', '椅', '灯']),
    S('B', ['椅', '灯', '幕']),
    S('C', ['幕', '鼓']),
  ];
  const r = solve(scenes, C());
  assert.strictEqual(r.ok, true);
  const sum = r.steps.reduce((acc, s) => acc + s.count, 0);
  assert.strictEqual(sum, r.totalCost);
  // 最优顺序为 C->B->A：开场 2（幕鼓）+ C→B 3（撤鼓上椅灯）+ B→A 2（撤幕上桌）= 7
  assert.strictEqual(r.totalCost, 7);
  assert.deepStrictEqual(r.order, ['C', 'B', 'A']);
}

console.log('全部测试通过 ✔');
