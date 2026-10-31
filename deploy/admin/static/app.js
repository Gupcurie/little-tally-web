'use strict';

const $ = (id) => document.getElementById(id);
let ACCOUNTS = [];

function cookie(name) {
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

async function api(path, options) {
  const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
  if (opts.body) {
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
    err.data = data;
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
    who.appendChild(el('strong', null, account.username || '(无用户名)'));
    who.appendChild(el('span', 'muted small', '注册 ' + fmtDate(account.created_at)));
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

    const toggle = el('button', 'ghost small' + (account.banned_until ? '' : ' warn'), account.banned_until ? '启用' : '禁用');
    toggle.type = 'button';
    toggle.addEventListener('click', () => toggleBan(account, toggle));
    actions.appendChild(toggle);

    const reset = el('button', 'ghost small', '重置密码');
    reset.type = 'button';
    reset.addEventListener('click', () => resetPassword(account, reset));
    actions.appendChild(reset);

    row.appendChild(actions);
    rows.appendChild(row);
  }
}

async function toggleBan(account, button) {
  const banned = !account.banned_until;
  const prompt = banned
    ? '禁用「' + (account.username || account.id.slice(0, 8)) + '」？该账号将无法登录，数据保留。'
    : '启用「' + (account.username || account.id.slice(0, 8)) + '」？';
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
  if (!window.confirm('为「' + name + '」生成新密码？\n\n旧密码会立即失效，请把新密码交给本人。')) return;
  button.disabled = true;
  try {
    const data = await api('/api/accounts/' + account.id + '/password', {
      method: 'POST', body: JSON.stringify({}),
    });
    $('s-who').textContent = '账号：' + name;
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
  const body = $('d-body');
  body.textContent = '';

  const meta = el('dl', 'meta');
  const pairs = [
    ['状态', account.banned_until ? '已禁用（至 ' + fmtDate(account.banned_until) + '）' : '正常'],
    ['注册时间', fmtDate(account.created_at)],
    ['最近登录', account.last_sign_in_at ? fmtDate(account.last_sign_in_at) : '从未登录'],
    ['账本修订', account.revision === null ? '无' : String(account.revision)],
    ['最后保存', account.ledger_updated_at ? fmtDate(account.ledger_updated_at) : '—'],
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
    login: '登录', logout: '退出', ban: '禁用账号', unban: '启用账号', reset_password: '重置密码',
  })[action] || action;
}

async function load() {
  showError('');
  try {
    const data = await api('/api/accounts');
    ACCOUNTS = data.accounts;
    renderSummary(data.summary, data.generated_at);
    renderRows();
  } catch (err) {
    showError('读取失败：' + err.message + '（后端可能暂时不可用）');
  }
  loadAudit();
}

$('search').addEventListener('input', renderRows);
$('reload').addEventListener('click', load);
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ }
  window.location.href = '/admin/';
});
$('d-close').addEventListener('click', () => { $('detail').hidden = true; });
$('s-close').addEventListener('click', () => { $('secret').hidden = true; });
for (const id of ['detail', 'secret']) {
  $(id).addEventListener('click', (event) => {
    if (event.target === $(id)) $(id).hidden = true;
  });
}

load();
