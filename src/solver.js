'use strict';

/**
 * 舞台换景顺序优化核心算法
 *
 * 问题：给定 n (<=12) 个场景，每个场景需要一组道具；
 *       在满足以下全部约束的前提下，求一个场景排列，使相邻场景间
 *       道具“增加/移除”的总次数最少（即相邻道具集合对称差之和最小）：
 *         1. dependencies  依赖：a 必须在 b 之前演出
 *         2. fixed         固定序位：场景 s 必须在第 p 个位置（1 起始）
 *         3. forbidden     禁止相邻：a 与 b 在顺序中不能相邻
 *
 * 算法：子集 DP。dp[mask] = 已排布集合为 mask 时的最小代价。
 *       n<=12 => 4096 个状态，O(n^2 * 2^n)，n=12 约 59 万次转移。
 *       并列时始终取编号较小的场景，保证结果唯一可复现。
 *
 * 无解：先做结构化冲突检测（环、固定位矛盾、禁止相邻与固定位矛盾），
 *       其余情况用逐条删减法求“极小不可满足约束核”(MUS)：
 *       核中任意删除一条约束后即可解。
 */

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

/** 将道具文本拆为去重后的道具名数组（支持中英文逗号/顿号/分号/空白/换行） */
function splitProps(text) {
  if (text === null || text === undefined) return [];
  const parts = String(text).split(/[,，、;；\t\r\n]+/);
  const seen = new Set();
  const out = [];
  for (const raw of parts) {
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * 校验并归一化输入。
 * 返回 { scenes:[{id,name,props}], deps:[[a,b]], fixed:[{id,pos}], forbidden:[[a,b]] }
 * 输入不合法时抛 ValidationError（HTTP 400）。
 */
function normalize(input) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('请求体必须为 JSON 对象');
  }
  const rawScenes = input.scenes;
  if (!Array.isArray(rawScenes)) {
    throw new ValidationError('scenes 必须为数组');
  }
  if (rawScenes.length === 0) {
    throw new ValidationError('至少需要 1 个场景');
  }
  if (rawScenes.length > 12) {
    throw new ValidationError('场景数量不能超过 12 个');
  }

  const scenes = [];
  const ids = new Set();
  rawScenes.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new ValidationError(`第 ${i + 1} 个场景格式不合法`);
    }
    const id = s.id === undefined || s.id === null || s.id === '' ? `scene-${i + 1}` : String(s.id);
    if (ids.has(id)) {
      throw new ValidationError(`场景 ID 重复：${id}`);
    }
    ids.add(id);
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : `场景${i + 1}`;
    const props = Array.isArray(s.props)
      ? Array.from(new Set(s.props.map((p) => String(p).trim()).filter(Boolean)))
      : splitProps(s.propsText);
    scenes.push({ id, name, props });
  });

  const indexById = new Map(scenes.map((s, i) => [s.id, i]));
  const ref = (v, label) => {
    const id = String(v);
    if (!indexById.has(id)) {
      throw new ValidationError(`${label}引用了不存在的场景：${id}`);
    }
    return indexById.get(id);
  };

  // 依赖是有向关系：键按 (a,b) 精确匹配；[a,b] 与 [b,a] 视为两条不同约束（构成环）
  const normPairs = (arr, label) => {
    if (arr === undefined || arr === null) return [];
    if (!Array.isArray(arr)) throw new ValidationError(`${label}必须为数组`);
    const out = [];
    const seen = new Set();
    for (const item of arr) {
      if (!Array.isArray(item) || item.length !== 2) {
        throw new ValidationError(`${label}的每一项必须是包含两个场景 ID 的数组`);
      }
      const a = ref(item[0], label);
      const b = ref(item[1], label);
      const key = `${a}|${b}`;
      if (seen.has(key)) {
        throw new ValidationError(`${label}中存在重复关系：${scenes[a].name} — ${scenes[b].name}`);
      }
      seen.add(key);
      out.push([a, b]);
    }
    return out;
  };

  const deps = normPairs(input.dependencies, '前后依赖');

  // 禁止相邻：自相矛盾直接 400（某场景不可能与自己不相邻）
  const forbidden = [];
  {
    const raw = input.forbidden;
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw)) throw new ValidationError('forbidden 必须为数组');
      const seen = new Set();
      for (const item of raw) {
        if (!Array.isArray(item) || item.length !== 2) {
          throw new ValidationError('禁止相邻的每一项必须是包含两个场景 ID 的数组');
        }
        const a = ref(item[0], '禁止相邻');
        const b = ref(item[1], '禁止相邻');
        if (a === b) {
          throw new ValidationError(`场景「${scenes[a].name}」不能与自身设置禁止相邻`);
        }
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) {
          throw new ValidationError(`禁止相邻中存在重复关系：${scenes[a].name} — ${scenes[b].name}`);
        }
        seen.add(key);
        forbidden.push([a, b]);
      }
    }
  }

  // 固定序位
  const fixed = [];
  {
    const raw = input.fixed;
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw)) throw new ValidationError('fixed 必须为数组');
      const posOwners = new Map();
      for (const item of raw) {
        if (!item || typeof item !== 'object') {
          throw new ValidationError('固定序位的每一项必须为 {id, pos}');
        }
        const s = ref(item.id, '固定序位');
        const pos = Number(item.pos);
        if (!Number.isInteger(pos) || pos < 1 || pos > scenes.length) {
          throw new ValidationError(
            `场景「${scenes[s].name}」的固定序位必须是 1~${scenes.length} 之间的整数`
          );
        }
        if (posOwners.has(pos)) {
          throw new ValidationError(
            `第 ${pos} 位被「${scenes[posOwners.get(pos)].name}」和「${scenes[s].name}」同时固定，一个位置只能固定一个场景`
          );
        }
        posOwners.set(pos, s);
        fixed.push({ s, pos });
      }
    }
  }

  // 同一场景固定多个序位
  {
    const byScene = new Map();
    for (const f of fixed) {
      if (byScene.has(f.s)) {
        throw new ValidationError(`场景「${scenes[f.s].name}」被固定了多个序位`);
      }
      byScene.set(f.s, f.pos);
    }
  }

  return { scenes, deps, fixed, forbidden };
}

/** 建内部计算模型（位掩码、道具位、禁止相邻表） */
function buildModel(normed) {
  const { scenes, deps, fixed, forbidden } = normed;
  const n = scenes.length;

  // 道具统一编号
  const propNames = [];
  const propIndex = new Map();
  for (const s of scenes) {
    for (const p of s.props) {
      if (!propIndex.has(p)) {
        propIndex.set(p, propNames.length);
        propNames.push(p);
      }
    }
  }
  const propMask = scenes.map((s) => {
    let m = 0;
    for (const p of s.props) m |= 1 << propIndex.get(p);
    return m;
  });

  // 前驱集合：predMask[b] 含 a 表示 a 必须排在 b 之前（自依赖 a==b 保留，会形成环）
  const predMask = new Int32Array(n);
  for (const [a, b] of deps) predMask[b] |= 1 << a;

  // 固定序位（0 基位置）
  const fixedPos = new Int32Array(n).fill(-1);
  for (const f of fixed) fixedPos[f.s] = f.pos - 1;

  // 禁止相邻表
  const adjMask = new Int32Array(n);
  for (const [a, b] of forbidden) {
    adjMask[a] |= 1 << b;
    adjMask[b] |= 1 << a;
  }

  return { n, propNames, propMask, predMask, fixedPos, adjMask };
}

/** 两个道具掩码的对称差元素数 = 增加数 + 移除数 */
function diffCount(a, b) {
  return popcount32(a ^ b);
}

function popcount32(x) {
  x = x | 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * 子集 DP（后缀代价）+ 前向贪心。
 * f[mask*n + last]：已摆放集合为 mask、最后一场为 last 时，
 *                   摆完剩余场景所需的最小追加代价；不可行为 Infinity。
 * 边界 f[full*n + last] = 0。
 * 求出 f 后从空台开始，每一步取“仍保持全局最优”的编号最小场景，
 * 从而在所有最优顺序中唯一确定字典序最小者，结果可复现。
 *
 * @param {object} m 模型
 * @param {object} [override] 可覆盖 predMask/fixedPos/adjMask（MUS 可行性判定用）
 * @returns {{order:number[], cost:number}|null} 最优排列（场景下标）及总代价；不可行返回 null
 */
function solveDP(m, override) {
  const n = m.n;
  const predMask = override && override.predMask ? override.predMask : m.predMask;
  const fixedPos = override && override.fixedPos ? override.fixedPos : m.fixedPos;
  const adjMask = override && override.adjMask ? override.adjMask : m.adjMask;

  const size = 1 << n;
  const full = size - 1;
  const f = new Float64Array(size * n).fill(Infinity);
  for (let last = 0; last < n; last++) f[full * n + last] = 0;

  // 某位置被固定的场景（无则 -1）
  const ownerAt = new Int32Array(n).fill(-1);
  for (let s = 0; s < n; s++) if (fixedPos[s] !== -1) ownerAt[fixedPos[s]] = s;

  // mask 只增，故按数值从大到小计算，子状态 f[nmask*n+s] 必然已就绪
  for (let mask = full - 1; mask >= 0; mask--) {
    const placed = popcount32(mask); // 下一个场景将处在的位置（0 基）
    let lastBits = mask;
    while (lastBits) {
      const lb = lastBits & -lastBits;
      const last = 31 - Math.clz32(lb);
      lastBits ^= lb;

      let best = Infinity;
      let avail = full ^ mask;
      while (avail) {
        const bit = avail & -avail;
        const s = 31 - Math.clz32(bit);
        avail ^= bit;

        if (!canPlace(s, placed, mask, last, fixedPos, ownerAt, predMask, adjMask)) continue;

        const v = diffCount(m.propMask[last], m.propMask[s]) + f[(mask | bit) * n + s];
        if (v < best) best = v;
      }
      f[mask * n + last] = best;
    }
  }

  // 空台起步（第 0 位，边代价 0）
  let totalCost = Infinity;
  for (let s = 0; s < n; s++) {
    if (!canPlace(s, 0, 0, -1, fixedPos, ownerAt, predMask, adjMask)) continue;
    const v = f[(1 << s) * n + s];
    if (v < totalCost) totalCost = v;
  }
  if (totalCost === Infinity) return null;

  // 前向贪心重建：每一步选编号最小且能保持全局最优的场景
  const order = [];
  let mask = 0;
  let last = -1;
  let remaining = totalCost;
  for (let pos = 0; pos < n; pos++) {
    let pick = -1;
    for (let s = 0; s < n; s++) {
      if ((mask >> s) & 1) continue;
      if (!canPlace(s, pos, mask, last, fixedPos, ownerAt, predMask, adjMask)) continue;
      const edge = last === -1 ? 0 : diffCount(m.propMask[last], m.propMask[s]);
      const v = edge + f[(mask | (1 << s)) * n + s];
      if (Math.abs(v - remaining) < 1e-9) { pick = s; break; }
    }
    if (pick === -1) return null; // 理论不可达
    const edge = last === -1 ? 0 : diffCount(m.propMask[last], m.propMask[pick]);
    order.push(pick);
    mask |= 1 << pick;
    last = pick;
    remaining -= edge;
  }
  return { order, cost: totalCost };
}

/** 判断场景 s 能否放在位置 placed（0 基），已摆放集合为 mask、上一场为 last（-1 表示空台） */
function canPlace(s, placed, mask, last, fixedPos, ownerAt, predMask, adjMask) {
  // 当前场景被固定到别处
  if (fixedPos[s] !== -1 && fixedPos[s] !== placed) return false;
  // 本位置属于另一个固定场景
  if (ownerAt[placed] !== -1 && ownerAt[placed] !== s) return false;
  // 依赖前驱必须已摆放
  if (predMask[s] & ~mask) return false;
  // 与上一场禁止相邻
  if (last !== -1 && ((adjMask[s] >> last) & 1)) return false;
  return true;
}

/** 依赖图中的环检测，返回 {cycle:[场景下标...]} 或 null */
function findDependencyCycle(m) {
  const n = m.n;
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Uint8Array(n);
  const stack = [];

  const dfs = (u) => {
    color[u] = GRAY;
    stack.push(u);
    let bits = m.predMask[u]; // u 的前驱 v：边 v -> u
    while (bits) {
      const bit = bits & -bits;
      const v = 31 - Math.clz32(bit);
      bits ^= bit;
      if (color[v] === GRAY) {
        const idx = stack.indexOf(v);
        return stack.slice(idx).concat(v);
      }
      if (color[v] === WHITE) {
        const cyc = dfs(v);
        if (cyc) return cyc;
      }
    }
    stack.pop();
    color[u] = BLACK;
    return null;
  };

  for (let i = 0; i < n; i++) {
    if (color[i] === WHITE) {
      const cyc = dfs(i);
      if (cyc) return { cycle: cyc };
    }
  }
  return null;
}

/**
 * 结构化冲突检测（可解释的典型矛盾）。
 * 返回冲突数组；空数组表示未发现结构化冲突。
 */
function structuralConflicts(scenes, m) {
  const n = m.n;
  const out = [];
  const nm = (i) => scenes[i].name;

  // 1) 依赖成环（含自依赖）
  const cyc = findDependencyCycle(m);
  if (cyc) {
    const names = cyc.cycle.map(nm);
    out.push({
      type: 'cycle',
      message: `前后依赖形成环路：${names.join(' → ')}，这些场景不可能同时满足先后关系`,
      refs: [...new Set(cyc.cycle)]
    });
    // 环存在时后面的界计算无意义
    return out;
  }

  // 依赖 DAG 上每个场景“最早可排位置”= 前驱闭包大小 + 1
  // “最晚可排位置”= n - 后继闭包大小
  const head = new Int32Array(n);
  const tail = new Int32Array(n);
  {
    // 前驱（祖先）传递闭包
    const ancestor = m.predMask.slice();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        let merged = ancestor[i];
        let bits = ancestor[i];
        while (bits) {
          const bit = bits & -bits;
          const j = 31 - Math.clz32(bit);
          bits ^= bit;
          merged |= ancestor[j];
        }
        if (merged !== ancestor[i]) { ancestor[i] = merged; changed = true; }
      }
    }
    for (let i = 0; i < n; i++) {
      head[i] = popcount32(ancestor[i]) + 1; // 含自身：最早位置（1 基）
      let desc = 0;
      for (let j = 0; j < n; j++) {
        if ((ancestor[j] >> i) & 1) desc |= 1 << j;
      }
      tail[i] = popcount32(desc) + 1;       // 含自身：必须排在其后的规模
    }
  }

  // 2) 固定位超出依赖允许的区间
  for (let s = 0; s < n; s++) {
    if (m.fixedPos[s] === -1) continue;
    const p = m.fixedPos[s] + 1; // 1 基
    const earliest = head[s];
    const latest = n - tail[s] + 1;
    if (p < earliest) {
      out.push({
        type: 'fixed-window',
        message: `场景「${nm(s)}」被固定在第 ${p} 位，但它必须在 ${earliest - 1} 个场景之后演出（最早第 ${earliest} 位）`,
        refs: [s]
      });
    } else if (p > latest) {
      out.push({
        type: 'fixed-window',
        message: `场景「${nm(s)}」被固定在第 ${p} 位，但有 ${tail[s] - 1} 个场景必须在它之后演出（最晚第 ${latest} 位）`,
        refs: [s]
      });
    }
  }

  // 3) 固定序位与依赖方向冲突：a 固定位 >= b 固定位，而 a 必须在 b 之前。
  //    若某一方的固定位已超出自身可行区间，第 2 条已说明，此处不再重复。
  for (let b = 0; b < n; b++) {
    if (m.fixedPos[b] === -1) continue;
    let bits = m.predMask[b];
    while (bits) {
      const bit = bits & -bits;
      const a = 31 - Math.clz32(bit);
      bits ^= bit;
      if (m.fixedPos[a] === -1 || m.fixedPos[a] < m.fixedPos[b]) continue;
      const aInWindow = m.fixedPos[a] + 1 >= head[a] && m.fixedPos[a] + 1 <= n - tail[a] + 1;
      const bInWindow = m.fixedPos[b] + 1 >= head[b] && m.fixedPos[b] + 1 <= n - tail[b] + 1;
      if (aInWindow && bInWindow) {
        out.push({
          type: 'fixed-dep',
          message: `依赖要求「${nm(a)}」在「${nm(b)}」之前，但固定序位把「${nm(a)}」放在第 ${m.fixedPos[a] + 1} 位、「${nm(b)}」放在第 ${m.fixedPos[b] + 1} 位`,
          refs: [a, b]
        });
      }
    }
  }

  // 4) 两个固定场景相邻但被禁止相邻
  for (let a = 0; a < n; a++) {
    if (m.fixedPos[a] === -1) continue;
    for (let b = a + 1; b < n; b++) {
      if (m.fixedPos[b] === -1) continue;
      if (Math.abs(m.fixedPos[a] - m.fixedPos[b]) === 1 && (m.adjMask[a] >> b) & 1) {
        out.push({
          type: 'fixed-adj',
          message: `「${nm(a)}」固定在第 ${m.fixedPos[a] + 1} 位、「${nm(b)}」固定在第 ${m.fixedPos[b] + 1} 位，二者必然相邻，但它们被设置为禁止相邻`,
          refs: [a, b]
        });
      }
    }
  }

  return out;
}

/**
 * 极小不可满足约束核（MUS）：把全部约束拍平为列表，逐条尝试移除；
 * 移除后可解则约束保留，不可解则移除。最终留下的集合删除任一条都会可解，
 * 即一个子集极小的冲突约束集合，可稳定复现。
 */
function findMus(scenes, m) {
  const n = m.n;
  const nm = (i) => scenes[i].name;
  const items = [];

  for (let b = 0; b < n; b++) {
    let bits = m.predMask[b];
    while (bits) {
      const bit = bits & -bits;
      const a = 31 - Math.clz32(bit);
      bits ^= bit;
      items.push({
        kind: 'dep', a, b,
        message: `「${nm(a)}」必须在「${nm(b)}」之前演出`,
        refs: [a, b]
      });
    }
  }
  for (let s = 0; s < n; s++) {
    if (m.fixedPos[s] !== -1) {
      const pos = m.fixedPos[s] + 1;
      items.push({
        kind: 'fixed', s, pos,
        message: `「${nm(s)}」固定在第 ${pos} 位`,
        refs: [s]
      });
    }
  }
  const seenPair = new Set();
  for (let a = 0; a < n; a++) {
    let bits = m.adjMask[a];
    while (bits) {
      const bit = bits & -bits;
      const b = 31 - Math.clz32(bit);
      bits ^= bit;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      if (b > a) {
        items.push({
          kind: 'forbidden', a, b,
          message: `「${nm(a)}」与「${nm(b)}」禁止相邻`,
          refs: [a, b]
        });
      }
    }
  }

  const feasibleWith = (active) => {
    const predMask = new Int32Array(n);
    const fixedPos = new Int32Array(n).fill(-1);
    const adjMask = new Int32Array(n);
    for (const it of active) {
      if (it.kind === 'dep') predMask[it.b] |= 1 << it.a;
      else if (it.kind === 'fixed') fixedPos[it.s] = it.pos - 1;
      else {
        adjMask[it.a] |= 1 << it.b;
        adjMask[it.b] |= 1 << it.a;
      }
    }
    return solveDP(m, { predMask, fixedPos, adjMask }) !== null;
  };

  let active = items.slice();
  for (let i = 0; i < active.length; i++) {
    const candidate = active.filter((_, j) => j !== i);
    if (!feasibleWith(candidate)) {
      active = candidate;
      i -= 1;
    }
  }

  return active.map((it) => ({
    type: it.kind === 'dep' ? 'mus-dep' : it.kind === 'fixed' ? 'mus-fixed' : 'mus-forbidden',
    message: it.message,
    refs: it.refs
  }));
}

/** 生成换景明细 */
function buildTransitions(scenes, propNames, propMask, order) {
  const transition = [];
  let totalMoves = 0;

  // 装台（空台 -> 第 1 个场景），仅展示，不计入优化目标
  const setupAdd = bitsToNames(propMask[order[0]], propNames);

  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1];
    const b = order[i];
    const removeBits = propMask[a] & ~propMask[b];
    const addBits = propMask[b] & ~propMask[a];
    const removes = bitsToNames(removeBits, propNames);
    const adds = bitsToNames(addBits, propNames);
    const moves = removes.length + adds.length;
    totalMoves += moves;
    transition.push({
      step: i,
      from: sceneRef(scenes[a]),
      to: sceneRef(scenes[b]),
      removes,
      adds,
      moves
    });
  }

  // 卸台（最后一个场景 -> 空台），仅展示
  const strikeRemove = bitsToNames(propMask[order[order.length - 1]], propNames);

  return { transition, totalMoves, setupAdd, strikeRemove };
}

function bitsToNames(bits, propNames) {
  const out = [];
  let b = bits;
  while (b) {
    const bit = b & -b;
    out.push(propNames[31 - Math.clz32(bit)]);
    b ^= bit;
  }
  return out;
}

function sceneRef(s) {
  return { id: s.id, name: s.name, props: s.props };
}

/**
 * 主入口。
 * @returns {{feasible:true, ...}|{feasible:false, conflicts:[...]}}
 */
function solve(input) {
  const normed = normalize(input);
  const { scenes } = normed;
  const m = buildModel(normed);

  const result = solveDP(m);
  if (result) {
    const { transition, totalMoves, setupAdd, strikeRemove } =
      buildTransitions(scenes, m.propNames, m.propMask, result.order);
    return {
      feasible: true,
      sceneCount: scenes.length,
      order: result.order.map((i) => sceneRef(scenes[i])),
      totalMoves,                 // 优化目标：换景（相邻场景之间）道具增减总次数
      setupCount: setupAdd.length,   // 装台道具数，参考
      strikeCount: strikeRemove.length, // 卸台移除数，参考
      setup: setupAdd,
      strike: strikeRemove,
      transitions: transition
    };
  }

  // 不可行：先给结构化冲突，否则用 MUS
  let conflicts = structuralConflicts(scenes, m);
  let method = 'structural';
  if (conflicts.length === 0) {
    conflicts = findMus(scenes, m);
    method = 'mus';
  }
  return {
    feasible: false,
    method,
    conflicts,
    hint: method === 'mus'
      ? '下面这组约束构成一组极小冲突：删除其中任意一条后，剩余约束即可满足。'
      : '请根据以下冲突调整场景或约束。'
  };
}

module.exports = { solve, splitProps, normalize };
