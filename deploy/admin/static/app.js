'use strict';

const $ = (id) => document.getElementById(id);
let ACCOUNTS = [];
const SELECTED = new Set();

function cookie(name) {
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

async function api(path, options) {
  const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
  if (opts.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-CSRF'] = cookie('admin_csrf');
  }
  const res = await fetch('/admin' + path, opts);
  if (res.status === 401) {
    window.location.href = '/admin/';
    throw new Error('unauthenticated');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value.endsWith && value.endsWith('Z') ? value : value + 'Z');
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function showError(message) {
  const box = $('error');
  if (!message) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.textContent = message;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'offscreen';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }
}

function renderSummary(summary, generatedAt) {
  $('s-total').textContent = summary.total;
  $('s-active').textContent = summary.active;
  $('s-banned').textContent = summary.banned;
  $('s-ledger').textContent = summary.with_ledger;
  $('s-items').textContent = summary.items;
  $('s-records').textContent = summary.records;
  $('s-seven').textContent = summary.signed_in_7d;
  $('updated').textContent = '更新于 ' + fmtDate(new Date(generatedAt * 1000).toISOString());
}

function statusPill(account) {
  return account.banned_until ? el('span', 'pill banned', '已禁用') : el('span', 'pill ok', '正常');
}

function updateSelection() {
  const ids = Array.from(SELECTED);
  $('btn-sum').disabled = ids.length < 1;
  $('btn-diff').disabled = ids.length !== 2;
  if (!ids.length) {
    $('sel-info').textContent = '未选择账号 · 勾选后可汇总或相减，顺序即 A、B';
    return;
  }
  const names = ids.map((id) => {
    const found = ACCOUNTS.find((a) => a.id === id);
    return found ? (found.username || found.id.slice(0, 6)) : id.slice(0, 6);
  });
  $('sel-info').textContent = '已选 ' + ids.length + ' 个：' + names.join(' → ');
}

function renderRows() {
  const needle = $('search').value.trim().toLowerCase();
  const list = ACCOUNTS.filter((a) => !needle || (a.username || '').toLowerCase().includes(needle));
  const rows = $('rows');
  rows.textContent = '';
  if (!list.length) {
    rows.appendChild(el('p', 'empty muted', ACCOUNTS.length ? '没有匹配的账号' : '还没有账号'));
    return;
  }
  for (const account of list) {
    const row = el('div', 'row');

    const who = el('div', 'cell who');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'pick';
    box.checked = SELECTED.has(account.id);
    box.addEventListener('change', () => {
      if (box.checked) SELECTED.add(account.id); else SELECTED.delete(account.id);
      updateSelection();
    });
    who.appendChild(box);
    const nameBox = el('div', 'namebox');
    nameBox.appendChild(el('strong', null, account.username || '(无用户名)'));
    nameBox.appendChild(el('span', 'muted small', '注册 ' + fmtDate(account.created_at)));
    who.appendChild(nameBox);
    row.appendChild(who);

    row.appendChild(statusPill(account));

    const usage = el('div', 'cell usage');
    usage.appendChild(el('span', null, account.items + ' 物品 / ' + account.records + ' 记录'));
    usage.appendChild(el('span', 'muted small', account.revision === null ? '无账本' : 'rev ' + account.revision));
    row.appendChild(usage);

    row.appendChild(el('div', 'cell muted small', account.last_sign_in_at ? fmtDate(account.last_sign_in_at) : '从未登录'));

    const actions = el('div', 'cell actions');
    const detail = el('button', 'ghost small', '详情');
    detail.type = 'button';
    detail.addEventListener('click', () => openDetail(account));
    actions.appendChild(detail);

    const exp = el('button', 'ghost small', '导出');
    exp.type = 'button';
    exp.addEventListener('click', () => exportAccount(account, 'csv'));
    actions.appendChild(exp);

    const toggle = el('button', 'ghost small' + (account.banned_until ? '' : ' warn'), account.banned_until ? '启用' : '禁用');
    toggle.type = 'button';
    toggle.addEventListener('click', () => toggleBan(account, toggle));
    actions.appendChild(toggle);

    const reset = el('button', 'ghost small', '改密码');
    reset.type = 'button';
    reset.addEventListener('click', () => resetPassword(account, reset));
    actions.appendChild(reset);

    row.appendChild(actions);
    rows.appendChild(row);
  }
  updateSelection();
}

function exportAccount(account, format) {
  const url = '/admin/api/accounts/' + account.id + '/export?format=' + format;
  const link = document.createElement('a');
  link.href = url;
  link.className = 'offscreen';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyExport(account) {
  try {
    const res = await fetch('/admin/api/accounts/' + account.id + '/export?format=csv',
      { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const ok = await copyText(text);
    showError(ok ? '' : '复制失败，请改用「导出」下载');
    if (ok) flash('已复制 ' + (account.username || '该账号') + ' 的记录到剪贴板');
  } catch (err) {
    showError('复制失败：' + err.message);
  }
}

function flash(message) {
  const box = $('error');
  box.hidden = false;
  box.className = 'banner ok';
  box.textContent = message;
  setTimeout(() => { box.hidden = true; box.className = 'banner error'; }, 2500);
}

async function toggleBan(account, button) {
  const banned = !account.banned_until;
  const name = account.username || account.id.slice(0, 8);
  const prompt = banned
    ? '禁用「' + name + '」？该账号将无法登录，数据保留。'
    : '启用「' + name + '」？';
  if (!window.confirm(prompt)) return;
  button.disabled = true;
  try {
    await api('/api/accounts/' + account.id + '/ban', {
      method: 'POST', body: JSON.stringify({ banned: banned }),
    });
    await load();
  } catch (err) {
    showError('操作失败：' + err.message);
  } finally {
    button.disabled = false;
  }
}

async function resetPassword(account, button) {
  const name = account.username || account.id.slice(0, 8);
  const typed = window.prompt(
    '为「' + name + '」设置新密码。\n\n留空 = 随机生成 12 位；\n也可以直接输入你想设的密码（6–128 位）。',
    '');
  if (typed === null) return;
  const custom = typed.trim();
  if (custom && (custom.length < 6 || custom.length > 128)) {
    showError('密码长度需 6–128 位');
    return;
  }
  button.disabled = true;
  try {
    const data = await api('/api/accounts/' + account.id + '/password', {
      method: 'POST',
      body: JSON.stringify(custom ? { password: custom } : {}),
    });
    $('s-who').textContent = '账号：' + name + (custom ? '（你指定的密码）' : '（随机生成）');
    $('s-pass').textContent = data.password;
    $('secret').hidden = false;
  } catch (err) {
    showError('操作失败：' + err.message);
  } finally {
    button.disabled = false;
  }
}

function openDetail(account) {
  $('d-title').textContent = account.username || account.id.slice(0, 8);

  const actions = $('d-actions');
  actions.textContent = '';
  const exp = el('button', 'ghost small', '导出 CSV');
  exp.type = 'button';
  exp.addEventListener('click', () => exportAccount(account, 'csv'));
  const expJson = el('button', 'ghost small', '导出 JSON');
  expJson.type = 'button';
  expJson.addEventListener('click', () => exportAccount(account, 'json'));
  const cp = el('button', 'ghost small', '复制记录');
  cp.type = 'button';
  cp.addEventListener('click', () => copyExport(account));
  actions.appendChild(exp);
  actions.appendChild(expJson);
  actions.appendChild(cp);

  const body = $('d-body');
  body.textContent = '';

  const meta = el('dl', 'meta');
  const pairs = [
    ['状态', account.banned_until ? '已禁用（至 ' + fmtDate(account.banned_until) + '）' : '正常'],
    ['注册时间', fmtDate(account.created_at)],
    ['最近登录', account.last_sign_in_at ? fmtDate(account.last_sign_in_at) : '从未登录'],
    ['账本修订', account.revision === null ? '无' : String(account.revision)],
    ['最后保存', account.ledger_updated_at ? fmtDate(account.ledger_updated_at) : '—'],
    ['密码', '单向哈希存储，无法查看，只能重置'],
  ];
  for (const [k, v] of pairs) {
    meta.appendChild(el('dt', null, k));
    meta.appendChild(el('dd', null, v));
  }
  body.appendChild(meta);

  const books = account.books || {};
  for (const key of Object.keys(books)) {
    const book = books[key];
    const title = key === 'sales' ? '销售账本' : '库存账本';
    const section = el('section', 'book');
    section.appendChild(el('h3', null, title + ' · ' + book.items + ' 物品 / ' + book.records + ' 记录'));
    if (!book.lines.length) {
      section.appendChild(el('p', 'muted', '没有物品'));
    } else {
      const list = el('ul', 'lines');
      for (const line of book.lines) {
        const item = el('li');
        item.appendChild(el('span', null, line.name || '(未命名)'));
        item.appendChild(el('strong', null, String(line.total)));
        list.appendChild(item);
      }
      section.appendChild(list);
    }
    body.appendChild(section);
  }
  $('detail').hidden = false;
}

async function runAggregate(op) {
  const ids = Array.from(SELECTED);
  if (!ids.length) return;
  if (op === 'diff' && ids.length !== 2) {
    showError('相减需要正好选择 2 个账号（顺序即 A、B）');
    return;
  }
  showError('');
  try {
    const data = await api('/api/aggregate', {
      method: 'POST',
      body: JSON.stringify({ ids: ids, book: $('book').value, op: op }),
    });
    renderAggregate(data);
  } catch (err) {
    showError('汇总失败：' + err.message);
  }
}

function renderAggregate(data) {
  const bookLabel = data.book === 'sales' ? '销售账本' : '库存账本';
  $('a-title').textContent = (data.op === 'diff' ? '相减 ' : '相加汇总 · ') + bookLabel;

  const body = $('a-body');
  body.textContent = '';

  if (data.missing && data.missing.length) {
    body.appendChild(el('p', 'muted small', '有账号还没有账本，按 0 计算。'));
  }
  if (!data.rows.length) {
    body.appendChild(el('p', 'muted', '这些账号在所选账本里没有物品。'));
    $('agg').hidden = false;
    return;
  }

  const scroll = el('div', 'table-scroll');
  const table = el('table', 'agg');
  const head = el('tr');
  head.appendChild(el('th', null, '物品'));
  for (const user of data.users) {
    head.appendChild(el('th', null, user.username || user.id.slice(0, 6)));
  }
  head.appendChild(el('th', null, data.op === 'diff' ? '差值 A−B' : '合计'));
  table.appendChild(head);

  for (const row of data.rows) {
    const tr = el('tr');
    tr.appendChild(el('td', null, row.name));
    row.values.forEach((value) => tr.appendChild(el('td', 'num', String(value))));
    const total = data.op === 'diff' ? row.diff : row.sum;
    const cell = el('td', 'num total', String(total));
    tr.appendChild(cell);
    table.appendChild(tr);
  }
  scroll.appendChild(table);
  body.appendChild(scroll);

  const copy = el('button', 'ghost small', '复制表格');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    const lines = [['物品'].concat(data.users.map((u) => u.username || u.id.slice(0, 6)))
      .concat([data.op === 'diff' ? '差值 A-B' : '合计']).join('\t')];
    for (const row of data.rows) {
      lines.push([row.name].concat(row.values.map(String))
        .concat([String(data.op === 'diff' ? row.diff : row.sum)]).join('\t'));
    }
    const ok = await copyText(lines.join('\n'));
    flash(ok ? '已复制表格到剪贴板' : '复制失败');
  });
  body.appendChild(copy);
  $('agg').hidden = false;
}

async function loadAudit() {
  try {
    const data = await api('/api/audit');
    const box = $('audit');
    box.textContent = '';
    if (!data.entries.length) {
      box.appendChild(el('p', 'muted', '还没有操作记录'));
      return;
    }
    for (const entry of data.entries) {
      const line = el('div', 'audit-line');
      line.appendChild(el('span', 'muted small', fmtDate(new Date(entry.ts * 1000).toISOString())));
      line.appendChild(el('span', null, label(entry.action) + (entry.target_name ? ' · ' + entry.target_name : '')));
      line.appendChild(el('span', 'muted small', entry.result === 'ok' ? entry.ip : '失败 · ' + entry.ip));
      box.appendChild(line);
    }
  } catch (err) {
    /* audit is optional */
  }
}

function label(action) {
  return ({
    login: '登录', logout: '退出', ban: '禁用账号', unban: '启用账号',
    reset_password: '设置密码', export: '导出记录', aggregate: '汇总计算',
  })[action] || action;
}

async function load() {
  showError('');
  try {
    const data = await api('/api/accounts');
    ACCOUNTS = data.accounts;
    const alive = new Set(ACCOUNTS.map((a) => a.id));
    for (const id of Array.from(SELECTED)) if (!alive.has(id)) SELECTED.delete(id);
    renderSummary(data.summary, data.generated_at);
    renderRows();
  } catch (err) {
    showError('读取失败：' + err.message + '（后端可能暂时不可用）');
  }
  loadAudit();
}

$('search').addEventListener('input', renderRows);
$('reload').addEventListener('click', load);
$('btn-sum').addEventListener('click', () => runAggregate('sum'));
$('btn-diff').addEventListener('click', () => runAggregate('diff'));
$('sel-all').addEventListener('change', (event) => {
  const on = event.target.checked;
  SELECTED.clear();
  if (on) for (const a of ACCOUNTS) SELECTED.add(a.id);
  renderRows();
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ }
  window.location.href = '/admin/';
});
$('d-close').addEventListener('click', () => { $('detail').hidden = true; });
$('a-close').addEventListener('click', () => { $('agg').hidden = true; });
$('s-close').addEventListener('click', () => { $('secret').hidden = true; });
$('s-copy').addEventListener('click', async () => {
  const ok = await copyText($('s-pass').textContent);
  flash(ok ? '密码已复制' : '复制失败，请手动选中');
});
for (const id of ['detail', 'agg', 'secret']) {
  $(id).addEventListener('click', (event) => {
    if (event.target === $(id)) $(id).hidden = true;
  });
}

load();
