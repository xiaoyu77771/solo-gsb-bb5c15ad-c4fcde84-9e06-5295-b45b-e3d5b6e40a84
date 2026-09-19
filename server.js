'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { solve, normalize } = require('./src/solver');
const storage = require('./src/storage');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- 求解 ----
app.post('/api/solve', (req, res) => {
  try {
    const result = solve(req.body);
    if (!result.feasible) {
      return res.status(422).json(result);
    }
    res.json(result);
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 方案保存 / 读取 ----
app.get('/api/plans', (req, res) => {
  res.json({ plans: storage.listPlans() });
});

app.get('/api/plans/:id', (req, res) => {
  const plan = storage.getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: '方案不存在' });
  res.json(plan);
});

app.post('/api/plans', async (req, res) => {
  try {
    const { id, name, data, lastResult } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '方案名称不能为空' });
    }
    normalize(data);
    if (id && storage.getPlan(id)) {
      const plan = await storage.updatePlan(id, { name: name.trim(), data, lastResult });
      return res.json(plan);
    }
    const plan = await storage.createPlan({
      id: id || crypto.randomUUID(),
      name: name.trim(),
      data,
      lastResult
    });
    res.status(201).json(plan);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.delete('/api/plans/:id', async (req, res) => {
  const ok = await storage.deletePlan(req.params.id);
  if (!ok) return res.status(404).json({ error: '方案不存在' });
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`舞台换景顺序优化器已启动： http://localhost:${PORT}`);
});
