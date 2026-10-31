import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../dist/core.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

test('recommendation is null without items and follows current counts', () => {
  assert.equal(C.eggRecommend(C.emptyEgg(), {}), null);
  const egg = freshEgg([['甲', 1], ['乙', 1]]);
  C.eggChange(egg, egg.items[0].id, 1);
  const pick = C.eggRecommend(egg, { random: () => 0.5 });
  assert.equal(pick.name, '乙');
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

test('a dominant ratio can repeat and still completes each round exactly', () => {
  const egg = freshEgg([['多', 9], ['少', 1]]);
  const picks = [];
  for (let k = 0; k < 30; k++) {
    const pick = C.eggRecommend(egg);
    picks.push(pick.id);
    C.eggChange(egg, pick.id, 1);
    if ((k + 1) % 10 === 0) {
      assert.deepEqual(Object.values(C.eggCounts(egg)), [9 * (k + 1) / 10, (k + 1) / 10]);
    }
  }
  assert.ok(picks.some((id, k) => k > 0 && id === picks[k - 1]));
});

test('ahead-of-round counts never cause a full item to be recommended', () => {
  const egg = freshEgg([['甲', 10], ['乙', 1], ['丙', 1]]);
  C.eggSetCount(egg, egg.items[1].id, 100);
  for (let k = 0; k < 22; k++) {
    const pick = C.eggRecommend(egg);
    const progress = C.eggProgress(egg).find(p => p.id === pick.id);
    assert.ok(progress.left > 0);
    assert.notEqual(pick.name, '乙');
    C.eggChange(egg, pick.id, 1);
  }
  assert.deepEqual(Object.values(C.eggCounts(egg)), [20, 100, 2]);
  assert.equal(C.eggRound(egg), 2);
});

test('manual changes, ratio edits and record deletion immediately change the recommendation', () => {
  const egg = freshEgg([['甲', 1], ['乙', 1]]);
  const [a, b] = egg.items;
  const pick = () => C.eggRecommend(egg, { random: () => 0.5 });
  assert.equal(pick().id, a.id);
  C.eggChange(egg, a.id, 1);
  assert.equal(pick().id, b.id);
  C.eggChange(egg, a.id, -1);
  assert.ok(C.eggProgress(egg).find(p => p.id === pick().id).left > 0);
  C.eggSetRatio(egg, b.id, 3);
  assert.equal(pick().id, b.id);
  C.eggSetCount(egg, b.id, 3);
  assert.equal(pick().id, a.id);
  C.eggDeleteRecords(egg, new Set([egg.records.at(-1).id]));
  assert.equal(pick().id, b.id);
});

test('seeded alternatives are reproducible, include all eligible items and never change records', () => {
  const egg = freshEgg([['甲', 100], ['乙', 1], ['丙', 1], ['丁', 1], ['戊', 1]]);
  C.eggSetCount(egg, egg.items[1].id, 1);
  const before = JSON.stringify(egg);
  const picks = C.eggRecommendationSet(egg, 200, seeded(42));
  assert.equal(picks.length, 4);
  assert.equal(picks[0].id, C.eggRecommend(egg, { random: seeded(42) }).id);
  assert.ok(!picks.some(p => p.name === '乙'));
  for (let k = 0; k < 20; k++) assert.deepEqual(C.eggRecommendationSet(egg, 200, seeded(42)), picks);
  assert.equal(JSON.stringify(egg), before);
});

test('sampled ratios and manual starting counts always fill each missing round exactly', () => {
  const random = seeded(92);
  for (let trial = 0; trial < 80; trial++) {
    const ratios = Array.from({ length: 2 + Math.floor(random() * 6) }, (_, k) => [String(k), 1 + Math.floor(random() * 12)]);
    const egg = freshEgg(ratios);
    for (const item of egg.items) C.eggSetCount(egg, item.id, Math.floor(random() * 50));
    const round = C.eggRound(egg), counts = C.eggCounts(egg);
    const missing = C.eggProgress(egg).reduce((n, p) => n + p.left, 0);
    for (let k = 0; k < missing; k++) {
      const pick = C.eggRecommend(egg);
      assert.ok(C.eggProgress(egg).find(p => p.id === pick.id).left > 0);
      C.eggChange(egg, pick.id, 1);
    }
    const after = C.eggCounts(egg);
    for (const item of egg.items) assert.equal(after[item.id], Math.max(counts[item.id], (round + 1) * item.ratio));
  }
});

// Exercise the actual page selection functions without signing in or touching live accounts.
function pagePicker(egg) {
  const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const random = seeded(222); let calculations = 0;
  const core = { ...C, eggRecommendationSet: (egg, count) => {
    calculations++; return C.eggRecommendationSet(egg, count, random);
  } };
  const context = vm.createContext({ C: core, state: { eggPick: null } });
  vm.runInContext(source.slice(source.indexOf('function eggPickKey('), source.indexOf('function eggView(')), context);
  return { pick: () => context.eggPickId(egg), change: () => context.eggReroll(egg),
    get calculations() { return calculations; }, get selection() { return context.state.eggPick; } };
}

test('page change button cycles alternatives and stays stable across redraws', () => {
  const egg = freshEgg([['甲', 100], ['乙', 1], ['丙', 1], ['丁', 1], ['戊', 1]]);
  const page = pagePicker(egg), before = JSON.stringify(egg), first = page.pick(), seen = new Set([first]);
  for (let k = 1; k < 5; k++) {
    const previous = page.pick();
    assert.equal(page.change(), true);
    const next = page.pick();
    assert.notEqual(next, previous);
    seen.add(next);
    for (let j = 0; j < 10; j++) assert.equal(page.pick(), next);
  }
  assert.equal(seen.size, 5);
  page.change();
  assert.equal(page.pick(), first);
  assert.equal(page.calculations, 1, 'redraws and alternative selection must not reroll');
  assert.equal(JSON.stringify(egg), before);
});

test('page discards an alternative when quantities or ratios change, including cloud refresh', () => {
  const egg = freshEgg([['甲', 1], ['乙', 1], ['丙', 1]]);
  const page = pagePicker(egg);
  page.change();
  const previous = page.pick();
  C.eggChange(egg, previous, 1);
  page.pick(); assert.equal(page.calculations, 2);
  assert.notEqual(page.pick(), previous);
  page.change();
  C.eggSetRatio(egg, egg.items[2].id, 10);
  page.pick(); assert.equal(page.calculations, 3);
  page.change();
  egg.records = [];
  page.pick(); assert.equal(page.calculations, 4);
});

test('page handles a single remaining candidate and an empty book', () => {
  const egg = freshEgg([['甲', 1], ['乙', 1]]);
  C.eggChange(egg, egg.items[0].id, 1);
  const page = pagePicker(egg);
  assert.equal(page.change(), false);
  assert.equal(page.pick(), egg.items[1].id);
  egg.items = []; egg.records = [];
  assert.equal(page.pick(), null);
  assert.equal(page.change(), false);
});

function simulate(ratios, seed, rounds) {
  const egg = freshEgg(ratios.map((ratio, k) => [String(k), ratio]));
  const random = seeded(seed), sequence = [], size = ratios.reduce((a, b) => a + b, 0);
  for (let k = 0; k < rounds * size; k++) {
    const pick = C.eggRecommend(egg, { random });
    assert.ok(C.eggProgress(egg).find(p => p.id === pick.id).left > 0);
    sequence.push(Number(pick.name));
    C.eggChange(egg, pick.id, 1);
    if ((k + 1) % size === 0) {
      assert.deepEqual(Object.values(C.eggCounts(egg)), ratios.map(r => r * (k + 1) / size));
    }
  }
  return sequence;
}

test('many random runs preserve exact quotas and avoid adjacency when balanced', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const ratios of [[4, 4, 4, 4], [2, 3], [9, 1], [6, 3, 1], [40, 35, 15, 8, 2]]) {
      const seq = simulate(ratios, seed, 3);
      if (ratios.length === 4) for (let k = 1; k < seq.length; k++) assert.notEqual(seq[k], seq[k - 1]);
    }
  }
});

test('same proportions produce diverse sequences instead of a fixed repeating round', () => {
  const size = 16, sequences = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const seq = simulate([4, 4, 4, 4], seed, 5);
    const rounds = Array.from({ length: 5 }, (_, k) => seq.slice(k * size, (k + 1) * size).join(''));
    assert.ok(new Set(rounds).size >= 3, 'rounds must not replay one fixed order');
    sequences.add(seq.join(''));
  }
  assert.ok(sequences.size >= 25, 'independent random runs must vary');
});

test('available third items break an A B A pattern instead of continuing A B A B', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const egg = freshEgg([['甲', 4], ['乙', 4], ['丙', 4]]);
    const [a, b, c] = egg.items;
    C.eggChange(egg, a.id, 1); C.eggChange(egg, b.id, 1); C.eggChange(egg, a.id, 1);
    assert.equal(C.eggRecommend(egg, { random: seeded(seed) }).id, c.id);
  }
});

test('rare prizes are spaced across rounds, not merely within each round', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const seq = simulate([40, 35, 15, 8, 2], seed, 4);
    const positions = seq.map((v, k) => v === 4 ? k : -1).filter(k => k >= 0);
    for (let k = 1; k < positions.length; k++) {
      assert.ok(positions[k] - positions[k - 1] >= 32, 'rare prize must retain its cooldown across a round boundary');
    }
  }
});

test('a rare prize manually taken at round end is not recommended again at next round start', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const egg = freshEgg([['普通', 6], ['中', 3], ['大奖', 1]]);
    C.eggSetCount(egg, egg.items[0].id, 6); C.eggSetCount(egg, egg.items[1].id, 3);
    C.eggChange(egg, egg.items[2].id, 1);
    assert.equal(C.eggRound(egg), 1);
    const random = seeded(seed);
    for (let k = 1; k <= 5; k++) {
      const pick = C.eggRecommend(egg, { random });
      assert.notEqual(pick.name, '大奖', 'recent prize history must survive the new round');
      C.eggChange(egg, pick.id, 1);
    }
  }
});

test('taking a non-recommended item recalculates from actual counts and actual recent history', () => {
  const egg = freshEgg([['甲', 3], ['乙', 3], ['丙', 3]]), page = pagePicker(egg);
  const recommended = page.pick(), other = egg.items.find(i => i.id !== recommended);
  const previous = page.selection;
  C.eggChange(egg, other.id, 1);
  const next = page.pick();
  assert.equal(page.calculations, 2);
  assert.notEqual(page.selection, previous);
  assert.notEqual(next, other.id, 'spacing must refer to what was actually taken');
  const beforeUndo = page.selection;
  C.eggChange(egg, other.id, -1);
  page.pick();
  assert.equal(page.calculations, 3);
  assert.notEqual(page.selection, beforeUndo);
});

test('dominant ratios do not collapse random rounds into a few fixed alternating patterns', () => {
  for (const [ratios, minimum] of [[[5, 3, 1], 20], [[6, 3, 1], 25]]) {
    const orders = new Set();
    for (let seed = 1; seed <= 80; seed++) orders.add(simulate(ratios, seed, 1).join(','));
    assert.ok(orders.size >= minimum, `${ratios}: only ${orders.size} distinct orders`);
  }
});

test('weighted sampling stays finite even at the random generator boundaries', () => {
  const egg = freshEgg([['甲', 5], ['乙', 3], ['丙', 1]]);
  for (const random of [() => 0, () => 1]) {
    const picks = C.eggRecommendationSet(egg, 3, random);
    assert.equal(picks.length, 3);
    assert.ok(picks.every(p => Number.isFinite(p.score)));
  }
});

test('production sampling obtains fresh Web Crypto randomness without Math.random', t => {
  const original=globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  let calls=0;
  t.mock.method(globalThis.crypto,'getRandomValues',array=>{calls++;return original(array);});
  t.mock.method(Math,'random',()=>{throw new Error('insecure random fallback');});
  const egg=freshEgg([['甲',5],['乙',3],['丙',1]]);
  assert.ok(C.eggRecommend(egg));
  const first=calls;
  assert.ok(first>=3);
  assert.ok(C.eggRecommend(egg));
  assert.ok(calls>first,'a new calculation must obtain new system randomness');
});
