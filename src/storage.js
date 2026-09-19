'use strict';

/**
 * 方案的文件型持久化（JSON 文件 + 写入互斥）。
 * 数据结构：{ plans: [ {id, name, createdAt, updatedAt, data, lastResult} ] }
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'plans.json');

let cache = null;
let writeChain = Promise.resolve();

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed.plans) ? parsed : { plans: [] };
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = { plans: [] };
    } else {
      throw err;
    }
  }
  return cache;
}

function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
          if (err) return reject(err);
          const tmp = `${DATA_FILE}.${process.pid}.tmp`;
          fs.writeFile(tmp, snapshot, (err2) => {
            if (err2) return reject(err2);
            fs.rename(tmp, DATA_FILE, (err3) => (err3 ? reject(err3) : resolve()));
          });
        });
      })
  );
  return writeChain;
}

function listPlans() {
  return load().plans.map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    sceneCount: Array.isArray(p.data && p.data.scenes) ? p.data.scenes.length : 0,
    feasible: p.lastResult ? p.lastResult.feasible : null
  }));
}

function getPlan(id) {
  return load().plans.find((p) => p.id === id) || null;
}

function createPlan({ id, name, data, lastResult }) {
  const db = load();
  const now = new Date().toISOString();
  const plan = { id, name, data, lastResult: lastResult || null, createdAt: now, updatedAt: now };
  db.plans.push(plan);
  return persist().then(() => plan);
}

function updatePlan(id, { name, data, lastResult }) {
  const db = load();
  const plan = db.plans.find((p) => p.id === id);
  if (!plan) return null;
  if (name !== undefined) plan.name = name;
  if (data !== undefined) plan.data = data;
  if (lastResult !== undefined) plan.lastResult = lastResult;
  plan.updatedAt = new Date().toISOString();
  return persist().then(() => plan);
}

function deletePlan(id) {
  const db = load();
  const idx = db.plans.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  db.plans.splice(idx, 1);
  return persist().then(() => true);
}

module.exports = { listPlans, getPlan, createPlan, updatePlan, deletePlan };
