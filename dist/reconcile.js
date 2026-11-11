const keyFor = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

function bookBaseline(book, at) {
  const records = book?.records || [];
  const quantities = Object.create(null);
  for (const record of records) quantities[record.itemId] = (quantities[record.itemId] || 0) + record.delta;
  return {
    lastId: records.at(-1)?.id || null,
    excluded: records.filter(record => record.at >= at).map(record => record.id),
    quantities,
  };
}

export function startReconciliation(egg, sales, at = Date.now()) {
  return {version: 1, enabled: true, at, egg: bookBaseline(egg, at), sales: bookBaseline(sales, at)};
}

function sequence(book, baseline, at) {
  const records = book?.records || [];
  const last = baseline.lastId ? records.findIndex(record => record.id === baseline.lastId) : -1;
  const excluded = new Set(baseline.excluded || []);
  const rows = last >= 0 ? records.slice(last + 1) : records.filter(record => record.at >= at && !excluded.has(record.id));
  const items = new Map((book?.items || []).map(item => [item.id, item]));
  const runs = [];
  const stacks = new Map();
  let baselineReduction = 0;
  for (const record of rows) {
    const item = items.get(record.itemId);
    if (!item) continue;
    if (record.delta > 0) {
      const run = {key: keyFor(item.name), name: item.name, quantity: record.delta, recordId: record.id, at: record.at};
      runs.push(run);
      if (!stacks.has(item.id)) stacks.set(item.id, []);
      stacks.get(item.id).push(run);
    } else if (record.delta < 0) {
      const stack = stacks.get(item.id) || [];
      let remove = -record.delta;
      while (remove && stack.length) {
        const run = stack.at(-1);
        const taken = Math.min(remove, run.quantity);
        remove -= taken;
        run.quantity -= taken;
        if (!run.quantity) stack.pop();
      }
      baselineReduction += remove;
    }
  }
  return {runs: runs.filter(run => run.quantity), baselineReduction};
}

export function validReconciliation(baseline) {
  if (baseline?.version !== 1 || baseline.enabled !== true || !Number.isFinite(baseline.at)) return false;
  return ['egg','sales'].every(key => {
    const value=baseline[key];
    return value && (value.lastId===null || typeof value.lastId==='string') &&
      Array.isArray(value.excluded) && value.excluded.every(id=>typeof id==='string') &&
      value.quantities && typeof value.quantities==='object' && !Array.isArray(value.quantities) &&
      Object.values(value.quantities).every(quantity=>Number.isSafeInteger(quantity)&&quantity>=0);
  });
}

export function reconcile(egg, sales, baseline, windowSize = 20) {
  if (!validReconciliation(baseline)) return null;
  const placed = sequence(egg, baseline.egg, baseline.at);
  const sold = sequence(sales, baseline.sales, baseline.at);
  const rows = new Map();
  function row(run) {
    if (!rows.has(run.key)) rows.set(run.key, {name: run.name, eggs: 0, sales: 0, matched: 0, waiting: 0, overdue: 0, unmatched: 0});
    return rows.get(run.key);
  }
  for (const run of placed.runs) row(run).eggs += run.quantity;
  for (const run of sold.runs) row(run).sales += run.quantity;
  let head = 0;
  const issues = [];
  for (const sale of sold.runs) {
    let remaining = sale.quantity;
    while (remaining) {
      while (head < placed.runs.length && !placed.runs[head].quantity) head++;
      let available = 0, found = null;
      for (let i = head; i < placed.runs.length && available < windowSize; i++) {
        const run = placed.runs[i];
        if (run.quantity && run.key === sale.key) { found = run; break; }
        available += run.quantity;
      }
      if (!found) {
        row(sale).unmatched += remaining;
        if (issues.length < 100) issues.push({name: sale.name, quantity: remaining, at: sale.at, recordId: sale.recordId});
        break;
      }
      const count = Math.min(found.quantity, remaining);
      found.quantity -= count;
      remaining -= count;
      row(sale).matched += count;
    }
  }
  const pending = placed.runs.reduce((sum, run) => sum + run.quantity, 0);
  let overdue = Math.max(0, pending - windowSize);
  for (const run of placed.runs) {
    if (!run.quantity) continue;
    const late = Math.min(overdue, run.quantity);
    row(run).overdue += late;
    row(run).waiting += run.quantity - late;
    overdue -= late;
  }
  const lines = [...rows.values()];
  const total = field => lines.reduce((sum, line) => sum + line[field], 0);
  return {
    at: baseline.at, windowSize, rows: lines, issues,
    eggs: total('eggs'), sales: total('sales'), matched: total('matched'),
    waiting: total('waiting'), overdue: total('overdue'), unmatched: total('unmatched'),
    eggBaselineReduction: placed.baselineReduction, salesBaselineReduction: sold.baselineReduction,
    status: total('overdue') || total('unmatched') ? 'error' : pending ? 'pending' : 'ok',
  };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function reconciliationMarkup(result) {
  if (!result) return '<p>尚未开启对账。</p>';
  const rows = result.rows.map(row => `<tr><th>${escape(row.name)}</th><td>${row.eggs}</td><td>${row.sales}</td><td>${row.matched}</td><td>${row.waiting}</td><td>${row.overdue}</td><td>${row.unmatched}</td></tr>`).join('');
  return `<p class="reconcile-summary">已放 ${result.eggs} · 已售 ${result.sales} · 已匹配 ${result.matched}</p>
    <p>容错范围内待售 ${result.waiting} 个 · 超窗未售 ${result.overdue} 个 · 销售未匹配 ${result.unmatched} 个</p>
    <p class="hint">同名物品一一对应。每笔销售在接下来 20 个尚未匹配的放蛋中查找；余下放蛋最多保留 20 个待售。</p>
    <div class="reconcile-scroll"><table class="reconcile-table"><thead><tr><th>物品</th><th>放蛋</th><th>销售</th><th>匹配</th><th>待售</th><th>超窗未售</th><th>销售未匹配</th></tr></thead><tbody>${rows || '<tr><td colspan="7">启用后还没有新记录</td></tr>'}</tbody></table></div>
    ${result.eggBaselineReduction || result.salesBaselineReduction ? `<p>起点数量被减回：放蛋 ${result.eggBaselineReduction} 个，销售 ${result.salesBaselineReduction} 个。请核对历史起点，必要时重新开始对账。</p>` : ''}
    ${result.issues.length ? '<h3>未匹配的销售</h3>' + result.issues.slice(0,30).map(issue => `<p>${escape(issue.name)} × ${issue.quantity} · ${escape(new Date(issue.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}</p>`).join('') : ''}`;
}