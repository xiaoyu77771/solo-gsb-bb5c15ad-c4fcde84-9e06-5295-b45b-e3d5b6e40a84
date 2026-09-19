'use strict';

/* ---------------- 状态 ---------------- */
const MAX_SCENES = 12;

const uid = () =>
  (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function newScene(index) {
  return { id: uid(), name: `场景${index + 1}`, propsText: '' };
}

const state = {
  scenes: [newScene(0), newScene(1)],
  deps: [],          // [[aId, bId]]
  fixed: [],         // [{id, pos}]
  forbidden: [],     // [[aId, bId]]
  planId: null,      // 已保存方案 ID（保存过则覆盖更新）
  result: null       // 最近一次求解结果
};

/* ---------------- 工具 ---------------- */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function sceneName(id) {
  const s = state.scenes.find((x) => x.id === id);
  return s ? s.name : '(已删除)';
}
function sceneIndex(id) {
  return state.scenes.findIndex((x) => x.id === id);
}
function splitProps(text) {
  const seen = new Set();
  const out = [];
  String(text || '').split(/[,，、;；\t\r\n]+/).forEach((raw) => {
    const v = raw.trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  });
  return out;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtList(items) {
  return items && items.length ? items.map(escapeHtml).join('、') : '<span class="none">无</span>';
}

function buildPayload() {
  return {
    scenes: state.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      props: splitProps(s.propsText)
    })),
    dependencies: state.deps.map(([a, b]) => [a, b]),
    fixed: state.fixed.map((f) => ({ id: f.id, pos: f.pos })),
    forbidden: state.forbidden.map(([a, b]) => [a, b])
  };
}

/* ---------------- 渲染：场景 ---------------- */
function renderScenes() {
  $('#scene-count').textContent = `${state.scenes.length}/${MAX_SCENES}`;
  const list = $('#scene-list');
  list.innerHTML = '';

  state.scenes.forEach((s, i) => {
    const card = el('div', 'scene-card');

    const row = el('div', 'scene-row');
    const idx = el('span', 'scene-index', String(i + 1));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = s.name;
    nameInput.placeholder = '场景名称';
    nameInput.addEventListener('input', () => {
      s.name = nameInput.value;
      syncSelectLabels();
    });
    const del = el('button', 'btn-del', '删除');
    del.disabled = state.scenes.length <= 1;
    del.addEventListener('click', () => removeScene(s.id));
    row.append(idx, nameInput, del);

    const propsBox = el('div', 'props');
    const label = el('label', null, '道具（用逗号、顿号或空格分隔）');
    const propsInput = el('input');
    propsInput.type = 'text';
    propsInput.value = s.propsText;
    propsInput.placeholder = '例如：王座, 立柱, 金色布景';
    const preview = el('p', 'props-preview');
    const updatePreview = () => {
      const c = splitProps(propsInput.value).length;
      preview.textContent = c ? `已识别 ${c} 件道具` : '';
    };
    propsInput.addEventListener('input', () => {
      s.propsText = propsInput.value;
      updatePreview();
    });
    updatePreview();
    propsBox.append(label, propsInput, preview);

    card.append(row, propsBox);
    list.appendChild(card);
  });

  $('#btn-add-scene').disabled = state.scenes.length >= MAX_SCENES;
  $('#fix-pos').max = state.scenes.length;
  const posInput = $('#fix-pos');
  const p = parseInt(posInput.value, 10);
  if (Number.isInteger(p) && p > state.scenes.length) posInput.value = state.scenes.length;
}
function removeScene(id) {
  if (state.scenes.length <= 1) return;
  state.scenes = state.scenes.filter((s) => s.id !== id);
  state.deps = state.deps.filter(([a, b]) => a !== id && b !== id);
  state.fixed = state.fixed.filter((f) => f.id !== id);
  state.forbidden = state.forbidden.filter(([a, b]) => a !== id && b !== id);
  renderAll();
}

/* ---------------- 渲染：约束下拉 / 列表 ---------------- */
function fillSelect(sel, allowSame) {
  const keep = sel.value;
  sel.innerHTML = '';
  state.scenes.forEach((s) => {
    const opt = el('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  if (!allowSame && state.scenes.length > 1) {
    const other = state.scenes.find((s) => s.id !== keep);
    if (other) sel.value = other.id;
  }
  if (keep && sceneIndex(keep) !== -1) sel.value = keep;
}

function syncSelects() {
  ['#dep-a', '#dep-b', '#fb-a', '#fb-b'].forEach((id) => fillSelect($(id), false));
  fillSelect($('#fix-s'), true);
}

function syncSelectLabels() {
  // 名称改动时仅更新下拉文字与已添加约束的展示
  syncSelects();
  renderChips();
}

function renderChips() {
  const depUl = $('#dep-list');
  depUl.innerHTML = '';
  if (!state.deps.length) {
    depUl.appendChild(el('li', 'empty', '尚未添加依赖关系'));
  } else {
    state.deps.forEach(([a, b], i) => {
      const li = el('li');
      li.appendChild(el('span', null, `「${sceneName(a)}」必须在「${sceneName(b)}」之前`));
      const x = el('button', 'x', '×');
      x.title = '删除';
      x.addEventListener('click', () => { state.deps.splice(i, 1); renderChips(); });
      li.appendChild(x);
      depUl.appendChild(li);
    });
  }

  const fixUl = $('#fix-list');
  fixUl.innerHTML = '';
  if (!state.fixed.length) {
    fixUl.appendChild(el('li', 'empty', '尚未设置固定序位'));
  } else {
    state.fixed.forEach((f, i) => {
      const li = el('li');
      li.appendChild(el('span', null, `「${sceneName(f.id)}」固定在第 ${f.pos} 位`));
      const x = el('button', 'x', '×');
      x.addEventListener('click', () => { state.fixed.splice(i, 1); renderChips(); });
      li.appendChild(x);
      fixUl.appendChild(li);
    });
  }

  const fbUl = $('#fb-list');
  fbUl.innerHTML = '';
  if (!state.forbidden.length) {
    fbUl.appendChild(el('li', 'empty', '尚未设置禁止相邻'));
  } else {
    state.forbidden.forEach(([a, b], i) => {
      const li = el('li');
      li.appendChild(el('span', null, `「${sceneName(a)}」与「${sceneName(b)}」禁止相邻`));
      const x = el('button', 'x', '×');
      x.addEventListener('click', () => { state.forbidden.splice(i, 1); renderChips(); });
      li.appendChild(x);
      fbUl.appendChild(li);
    });
  }
}

/* ---------------- 约束增删 ---------------- */
function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function bindConstraintInputs() {
  $('#btn-add-dep').addEventListener('click', () => {
    const a = $('#dep-a').value;
    const b = $('#dep-b').value;
    if (a === b) return toast('前后依赖需要选择两个不同的场景', true);
    if (state.deps.some(([x, y]) => x === a && y === b)) return toast('该依赖已存在', true);
    state.deps.push([a, b]);
    renderChips();
  });

  $('#btn-add-fix').addEventListener('click', () => {
    const id = $('#fix-s').value;
    const pos = parseInt($('#fix-pos').value, 10);
    if (!Number.isInteger(pos) || pos < 1 || pos > state.scenes.length) {
      return toast(`序位必须在 1~${state.scenes.length} 之间`, true);
    }
    const existScene = state.fixed.find((f) => f.id === id);
    if (existScene) { existScene.pos = pos; }
    else {
      const occupant = state.fixed.find((f) => f.pos === pos);
      if (occupant) return toast(`第 ${pos} 位已固定给「${sceneName(occupant.id)}」`, true);
      state.fixed.push({ id, pos });
    }
    renderChips();
  });

  $('#btn-add-fb').addEventListener('click', () => {
    const a = $('#fb-a').value;
    const b = $('#fb-b').value;
    if (a === b) return toast('禁止相邻需要选择两个不同的场景', true);
    if (state.forbidden.some(([x, y]) => pairKey(x, y) === pairKey(a, b))) {
      return toast('该禁止相邻关系已存在', true);
    }
    state.forbidden.push([a, b]);
    renderChips();
  });
}

/* ---------------- 求解与结果渲染 ---------------- */
async function solve() {
  const body = buildPayload();
  $('#btn-solve').disabled = true;
  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.status === 400) {
      state.result = { clientError: data.error };
    } else {
      state.result = data;
    }
    renderResult();
    if (res.ok) toast('已求得最优顺序');
  } catch (err) {
    toast('求解请求失败：' + err.message, true);
  } finally {
    $('#btn-solve').disabled = false;
  }
}

function renderResult() {
  const box = $('#result-body');
  box.innerHTML = '';
  const r = state.result;

  if (!r) {
    box.appendChild(el('p', 'placeholder', '设置好场景与约束后，点击「计算最优顺序」。'));
    return;
  }
  if (r.clientError) {
    const e = el('div', 'error-box');
    e.textContent = '输入有误：' + r.clientError;
    box.appendChild(e);
    return;
  }
  if (!r.feasible) {
    box.appendChild(renderConflicts(r));
    return;
  }

  // 统计
  const stats = el('div', 'stats');
  const main = el('div', 'stat main');
  main.appendChild(el('div', 'num', String(r.totalMoves)));
  main.appendChild(el('div', 'lbl', '换景道具增减总次数'));
  const setup = el('div', 'stat');
  setup.appendChild(el('div', 'num', String(r.setupCount)));
  setup.appendChild(el('div', 'lbl', '装台增加（参考）'));
  const strike = el('div', 'stat');
  strike.appendChild(el('div', 'num', String(r.strikeCount)));
  strike.appendChild(el('div', 'lbl', '卸台移除（参考）'));
  stats.append(main, setup, strike);
  box.appendChild(stats);

  // 顺序流
  box.appendChild(el('h4', 'sec', '最优演出顺序'));
  const flow = el('div', 'order-flow');
  r.order.forEach((s, i) => {
    const node = el('span', 'order-node');
    node.innerHTML = `<span class="pos">${i + 1}</span>${escapeHtml(s.name)}`;
    flow.appendChild(node);
    if (i < r.order.length - 1) flow.appendChild(el('span', 'order-arrow', '→'));
  });
  box.appendChild(flow);

  // 装台
  box.appendChild(el('h4', 'sec', '① 装台（空台 → 第 1 场，参考不计入优化目标）'));
  const setupBox = el('div', 'setup-box');
  setupBox.innerHTML = `<span class="tag-add">上场：</span>${fmtList(r.setup)}`;
  box.appendChild(setupBox);

  // 每次换景
  box.appendChild(el('h4', 'sec', '② 换景明细'));
  r.transitions.forEach((t) => {
    const card = el('div', 'transition');
    const head = el('div', 't-head');
    head.appendChild(el('span', 't-name', `第${t.step}次：${t.from.name} → ${t.to.name}`));
    head.appendChild(el('span', 't-cost', `增减 ${t.moves} 件`));
    const diff = el('div', 't-diff');
    const addLine = el('div');
    addLine.innerHTML = `<span class="tag-add">＋ 增加：</span>${fmtList(t.adds)}`;
    const rmLine = el('div');
    rmLine.innerHTML = `<span class="tag-rm">－ 移除：</span>${fmtList(t.removes)}`;
    diff.append(addLine, rmLine);
    card.append(head, diff);
    box.appendChild(card);
  });
  if (!r.transitions.length) {
    box.appendChild(el('p', 'placeholder', '只有一个场景，无需换景。'));
  }

  // 卸台
  box.appendChild(el('h4', 'sec', '③ 卸台（末场 → 空台，参考不计入优化目标）'));
  const strikeBox = el('div', 'strike-box');
  strikeBox.innerHTML = `<span class="tag-rm">撤场：</span>${fmtList(r.strike)}`;
  box.appendChild(strikeBox);
}

function renderConflicts(r) {
  const box = el('div', 'conflict-box');
  box.appendChild(el('h3', null, '不存在满足全部约束的演出顺序'));
  if (r.hint) box.appendChild(el('p', 'hint', r.hint));
  r.conflicts.forEach((c, i) => {
    const item = el('div', 'conflict-item');
    item.appendChild(el('span', 'idx', String(i + 1)));
    item.appendChild(el('span', null, c.message));
    box.appendChild(item);
  });
  return box;
}

/* ---------------- 保存 / 读取 ---------------- */
async function savePlan() {
  let name = $('#plan-name').value.trim();
  if (!name) name = `方案 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  const payload = {
    id: state.planId || undefined,
    name,
    data: buildPayload(),
    lastResult: state.result && !state.result.clientError ? state.result : null
  };
  try {
    const res = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '保存失败', true);
    state.planId = data.id;
    $('#plan-name').value = data.name;
    toast('方案已保存');
    loadPlanList();
  } catch (err) {
    toast('保存失败：' + err.message, true);
  }
}

async function loadPlanList() {
  const box = $('#plan-list');
  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    box.innerHTML = '';
    if (!data.plans.length) {
      box.appendChild(el('div', 'plan-empty', '还没有保存过方案。'));
      return;
    }
    data.plans.forEach((p) => {
      const item = el('div', 'plan-item');
      const left = el('div');
      const title = el('div', null, p.name + (p.id === state.planId ? '（当前编辑中）' : ''));
      const dot = p.feasible === true ? '<span class="dot ok"></span>'
        : p.feasible === false ? '<span class="dot no"></span>'
        : '<span class="dot none"></span>';
      const status = p.feasible === true ? '有解' : p.feasible === false ? '无可行顺序' : '未计算';
      const meta = el('div', 'meta');
      meta.innerHTML = `${dot}${p.sceneCount} 个场景 · ${status} · 更新于 ${new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })}`;
      left.append(title, meta);

      const actions = el('div', 'p-actions');
      const btnLoad = el('button', 'btn small', '载入并编辑');
      btnLoad.addEventListener('click', () => loadPlan(p.id));
      const btnDel = el('button', 'btn-del', '删除');
      btnDel.addEventListener('click', () => deletePlan(p.id));
      actions.append(btnLoad, btnDel);

      item.append(left, actions);
      box.appendChild(item);
    });
  } catch (err) {
    box.textContent = '方案列表加载失败';
  }
}

async function loadPlan(id) {
  try {
    const res = await fetch(`/api/plans/${id}`);
    if (!res.ok) return toast('载入失败', true);
    const plan = await res.json();
    const d = plan.data;
    state.scenes = (d.scenes || []).map((s, i) => ({
      id: String(s.id),
      name: s.name || `场景${i + 1}`,
      propsText: Array.isArray(s.props) ? s.props.join('，') : (s.propsText || '')
    }));
    state.deps = (d.dependencies || []).map(([a, b]) => [String(a), String(b)]);
    state.fixed = (d.fixed || []).map((f) => ({ id: String(f.id), pos: f.pos }));
    state.forbidden = (d.forbidden || []).map(([a, b]) => [String(a), String(b)]);
    state.planId = plan.id;
    state.result = plan.lastResult || null;
    $('#plan-name').value = plan.name;
    renderAll();
    if (!state.result) await solve();
    else renderResult();
    toast(`已载入方案「${plan.name}」，可继续编辑`);
  } catch (err) {
    toast('载入失败：' + err.message, true);
  }
}

async function deletePlan(id) {
  if (!confirm('确定删除该方案？此操作不可恢复。')) return;
  const res = await fetch(`/api/plans/${id}`, { method: 'DELETE' });
  if (res.status === 204) {
    if (state.planId === id) state.planId = null;
    toast('方案已删除');
    loadPlanList();
  } else {
    toast('删除失败', true);
  }
}

/* ---------------- 示例 / 清空 ---------------- */
function loadSample() {
  const s1 = uid(), s2 = uid(), s3 = uid(), s4 = uid(), s5 = uid(), s6 = uid();
  state.scenes = [
    { id: s1, name: '序幕', propsText: '幕布, 基础灯光' },
    { id: s2, name: '王宫大殿', propsText: '王座, 立柱, 金色布景, 基础灯光' },
    { id: s3, name: '森林', propsText: '树木, 藤蔓, 绿色灯光, 基础灯光' },
    { id: s4, name: '王宫花园', propsText: '喷泉, 花丛, 金色布景, 基础灯光' },
    { id: s5, name: '夜空决斗', propsText: '假山, 冷色灯光, 雾气' },
    { id: s6, name: '尾声', propsText: '幕布, 基础灯光' }
  ];
  state.deps = [[s2, s4], [s1, s5]];
  state.fixed = [{ id: s1, pos: 1 }, { id: s6, pos: 6 }];
  state.forbidden = [[s3, s5]];
  state.planId = null;
  $('#plan-name').value = '';
  renderAll();
  toast('已载入示例，点击「计算最优顺序」查看');
}

function clearAll() {
  if (!confirm('确定清空当前编辑内容？')) return;
  state.scenes = [newScene(0), newScene(1)];
  state.deps = [];
  state.fixed = [];
  state.forbidden = [];
  state.planId = null;
  state.result = null;
  $('#plan-name').value = '';
  renderAll();
}

/* ---------------- 初始化 ---------------- */
function renderAll() {
  renderScenes();
  syncSelects();
  renderChips();
  renderResult();
  loadPlanList();
}

$('#btn-add-scene').addEventListener('click', () => {
  if (state.scenes.length >= MAX_SCENES) return;
  state.scenes.push(newScene(state.scenes.length));
  renderAll();
});
$('#btn-solve').addEventListener('click', solve);
$('#btn-save').addEventListener('click', savePlan);
$('#btn-sample').addEventListener('click', loadSample);
$('#btn-clear').addEventListener('click', clearAll);
$('#btn-refresh-plans').addEventListener('click', loadPlanList);

bindConstraintInputs();
renderAll();
