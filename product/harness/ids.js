'use strict';
// 条件ID・実行ID・識別子（D41、experiment_spec.md §5.2）
const fs = require('node:fs');

const TYPES = ['R', 'I', 'D', 'J', 'A'];
const KINDS = ['N', 'M'];
const POINTS = ['OA', 'OB', 'OX'];

function parseCondition(id) {
  const m = /^([RIDJA])-([NM])-(OA|OB|OX)$/.exec(id);
  if (!m) throw new Error(`条件IDの書式が不正: ${id}`);
  if (m[1] === 'R' && m[2] === 'M') throw new Error('R-M-* は作らない（D41）');
  return { id, type: m[1], kind: m[2], point: m[3] };
}

// 試行番号 = その条件の試行を始めた順の通し番号（無効試行も数える）
function nextTrialNumber(outRoot, conditionId) {
  const dir = `${outRoot}/${conditionId}`;
  if (!fs.existsSync(dir)) return 1;
  const nums = fs.readdirSync(dir)
    .map((n) => new RegExp(`^${conditionId}-(\\d{3})$`).exec(n))
    .filter(Boolean).map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 英大文字と数字だけの4桁。シードから再現できる
function identifier(runId, seed) {
  const rnd = mulberry32(seed);
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += cs[Math.floor(rnd() * cs.length)];
  return `ID-${runId}-${s}`;
}

module.exports = { TYPES, KINDS, POINTS, parseCondition, nextTrialNumber, identifier };
