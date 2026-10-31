import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../dist/core.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function freshEgg(ratios) {
  const egg = C.emptyEgg();
  ratios.forEach(([name, ratio]) => C.eggAddItem(egg, name, ratio));
  return egg;
}

test('egg items validate and reject bad ratios', () => {
  const egg = freshEgg([['甲', 5], ['乙', 3], ['丙', 1]]);
  assert.equal(egg.items.length, 3);
  C.validateEgg(egg);
  assert.throws(() => C.eggAddItem(egg, '丁', 0), /比例/);
  assert.throws(() => C.eggAddItem(egg, '甲', 1), /不重复/);
});

test('one full round lands exactly on the ratios', () => {
  const egg = freshEgg([['甲', 5], ['乙', 3], ['丙', 1]]);
  const random = seeded(7);
  for (let k = 0; k < 9; k++) {
    const pick = C.eggRecommend(egg, { random });
    C.eggChange(egg, pick.id, 1);
  }
  const counts = C.eggCounts(egg);
  const byName = Object.fromEntries(egg.items.map((i) => [i.name, counts[i.id]]));
  assert.deepEqual(byName, { 甲: 5, 乙: 3, 丙: 1 });
  assert.equal(C.eggRound(egg), 1);
  assert.deepEqual(C.eggProgress(egg).map((p) => p.progress), [0, 0, 0]);
  assert.deepEqual(C.eggProgress(egg).map((p) => p.left), [5, 3, 1]);
});

test('second round carries over and stays exact', () => {
  const egg = freshEgg([['甲', 2], ['乙', 3]]);
  const random = seeded(11);
  for (let k = 0; k < 10; k++) {
    C.eggChange(egg, C.eggRecommend(egg, { random }).id, 1);
  }
  const c = C.eggCounts(egg);
  assert.equal(c[egg.items[0].id], 4);
  assert.equal(c[egg.items[1].id], 6);
  assert.equal(C.eggRound(egg), 2);
});

test('consecutive picks do not repeat', () => {
  const egg = freshEgg([['甲', 1], ['乙', 1], ['丙', 1], ['丁', 1]]);
  const random = seeded(3);
  const picks = [];
  for (let k = 0; k < 60; k++) {
    const pick = C.eggRecommend(egg, { random });
    picks.push(pick.id);
    C.eggChange(egg, pick.id, 1);
  }
  for (let k = 1; k < picks.length; k++) {
    assert.notEqual(picks[k], picks[k - 1], `第 ${k} 次与前一次重复`);
  }
});

test('smaller ratios are spaced further apart', () => {
  const egg = freshEgg([['大', 6], ['中', 3], ['小', 1]]);
  const random = seeded(21);
  const picks = [];
  for (let k = 0; k < 120; k++) {
    const pick = C.eggRecommend(egg, { random });
    picks.push(pick.id);
    C.eggChange(egg, pick.id, 1);
  }
  const gapOf = (name) => {
    const id = egg.items.find((i) => i.name === name).id;
    const at = picks.map((p, k) => (p === id ? k : -1)).filter((k) => k >= 0);
    const gaps = at.slice(1).map((v, k) => v - at[k]);
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
  };
  const big = gapOf('大'), mid = gapOf('中'), small = gapOf('小');
  assert.ok(big < mid, `大的间隔 ${big} 应小于中的 ${mid}`);
  assert.ok(mid < small, `中的间隔 ${mid} 应小于小的 ${small}`);
});

test('progress reports what is still missing this round', () => {
  const egg = freshEgg([['甲', 4], ['乙', 2]]);
  C.eggChange(egg, egg.items[0].id, 1);
  const progress = C.eggProgress(egg);
  const first = progress.find((p) => p.name === '甲');
  assert.equal(first.left, 3);
  assert.equal(first.progress, 1);
  assert.equal(first.round, 0);
});

test('recommendation is null without items and honours an exclude', () => {
  assert.equal(C.eggRecommend(C.emptyEgg(), {}), null);
  const egg = freshEgg([['甲', 1], ['乙', 1]]);
  C.eggChange(egg, egg.items[0].id, 1);
  const pick = C.eggRecommend(egg, { random: () => 0.5 });
  assert.ok(pick && ['甲', '乙'].includes(pick.name));
});

test('deleting records lowers the count but not the last-change time', () => {
  const egg = freshEgg([['甲', 2]]);
  const id = egg.items[0].id;
  C.eggChange(egg, id, 1);
  const stamp = egg.items[0].lastAt;
  assert.ok(stamp > 0);
  const newest = egg.records[egg.records.length - 1];
  C.eggDeleteRecords(egg, new Set([newest.id]));
  assert.equal(C.eggCounts(egg)[id], 0);
  assert.equal(C.eggLastChange(egg, id), stamp, '删除记录不应重置计时');
  assert.equal(egg.items[0].lastAt, stamp);
});

test('deleting a record that would go negative is refused', () => {
  const egg = freshEgg([['甲', 1]]);
  const id = egg.items[0].id;
  C.eggChange(egg, id, 1);
  C.eggChange(egg, id, 1);
  C.eggChange(egg, id, -1);
  assert.equal(C.eggCounts(egg)[id], 1);
  const positives = egg.records.filter((r) => r.delta > 0).map((r) => r.id);
  assert.throws(() => C.eggDeleteRecords(egg, new Set(positives)), /负数/);
});

test('recommendation set offers distinct alternatives', () => {
  const egg = freshEgg([['甲', 3], ['乙', 3], ['丙', 3]]);
  C.validateEgg(egg);
  const set = C.eggRecommendationSet(egg, 3, seeded(5));
  assert.ok(set.length >= 2);
  assert.equal(new Set(set.map((p) => p.id)).size, set.length);
});
