'use strict';

const $ = (id) => document.getElementById(id);
let ACCOUNTS = [];
let LOADED_ONCE = false, LOADING = false, ACTIVE_DETAIL = null, ACTIVE_EGG_VIEW = null;
const ACCOUNT_CHANGES = new Map();
const SELECTED = new Set();
const PIN_STORAGE = 'tally-admin-pinned-accounts-v1';
let ADMIN_SLOT = null, assignmentVersion = 0;
function pinStorageKey(){return ADMIN_SLOT === 'secondary' ? PIN_STORAGE + '-secondary' : PIN_STORAGE;}
function readPinnedAccounts(){try{const ids=JSON.parse(localStorage.getItem(pinStorageKey())||'[]');return new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string'&&/^[0-9a-fA-F-]{36}$/.test(id)):[]);}catch{return new Set();}}
let PINNED = new Set();
function accountModifiedTime(account){const value=account.ledger_updated_at;if(!value)return 0;const raw=typeof value==='string'&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)?value+'Z':value;const time=new Date(raw).getTime();return Number.isFinite(time)?time:0;}
function compareAccounts(a,b){return Number(PINNED.has(b.id))-Number(PINNED.has(a.id))||accountModifiedTime(b)-accountModifiedTime(a)||(a.username||'').localeCompare(b.username||'','zh-CN')||a.id.localeCompare(b.id);}
function togglePinnedAccount(id){if(PINNED.has(id))PINNED.delete(id);else PINNED.add(id);let saved=true;try{localStorage.setItem(pinStorageKey(),JSON.stringify([...PINNED]));}catch{saved=false;}renderRows();if(!saved)flash('置顶已在本页生效，浏览器未能保存，关闭页面后可能失效。');}
const BOOK_LABELS = { sales: '销售账本', stock: '库存账本', egg: '放蛋账本' };

function cookie(name) {
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

async function api(path, options) {
  const opts = Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: {} }, options || {});
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
  const raw = typeof value === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value + 'Z' : value;
  const stamp = new Date(raw).getTime();if (!Number.isFinite(stamp)) return '—';
  const d = new Date(stamp + 8 * 3600000), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
function accountChange(before, after) {
  if (!before) return {kind:'data',text:'新账号'};
  const a = before.data_fingerprint || JSON.stringify(before.books || {}), b = after.data_fingerprint || JSON.stringify(after.books || {});
  if (a !== b) {
    const parts = [];
    for (const key of ['sales','stock','egg']) {
      const oldBook = (before.books || {})[key] || {}, newBook = (after.books || {})[key] || {}, label = key === 'egg' ? '放蛋' : key === 'sales' ? '销售' : '库存';
      if ((oldBook.records || 0) !== (newBook.records || 0)) parts.push(label + '记录 ' + (oldBook.records || 0) + '→' + (newBook.records || 0));
      if ((oldBook.items || 0) !== (newBook.items || 0)) parts.push(label + '物品 ' + (oldBook.items || 0) + '→' + (newBook.items || 0));
      if (key === 'egg' && (oldBook.total || 0) !== (newBook.total || 0)) parts.push('放蛋总数 ' + (oldBook.total || 0) + '→' + (newBook.total || 0));
    }
    return {kind:'data',text:parts.join('；') || '物品、比例或记录内容调整'};
  }
  if (before.revision !== after.revision || before.recommendation_synced_at !== after.recommendation_synced_at)
    return {kind:'sync',text:'推荐或保存状态更新，账本内容未变'};
  return null;
}
function recommendationLabel(account) {
  return account.recommendation_version === 2 ? '整轮推荐已同步' : account.recommendation_version === 1 ? '旧版推荐，需刷新用户端' : '尚未同步有效推荐';
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
  const updated = $('updated');
  if (updated) updated.textContent = '上次检查更新于 ' + fmtDate(new Date(generatedAt * 1000).toISOString()) + '（北京时间）';
}

function statusPill(account) {
  return account.banned_until ? el('span', 'pill banned', '已禁用') : el('span', 'pill ok', '正常');
}

function updateSelection() {
  const ids = Array.from(SELECTED);
  $('btn-sum').disabled = ids.length < 1;
  $('btn-diff').disabled = ids.length < 2;
  if (!ids.length) {
    $('sel-info').textContent = '未选择账号 · 勾选后可汇总或相减，首个账号减其余账号';
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
  const list = ACCOUNTS.filter((a) => !needle || (a.username || '').toLowerCase().includes(needle)).sort(compareAccounts);
  const rows = $('rows');
  rows.textContent = '';
  if (!list.length) {
    const message = ACCOUNTS.length ? '没有匹配的账号' : (ADMIN_SLOT === 'secondary' ? '管理员 1 尚未分配账号或群' : '还没有账号');
    rows.appendChild(el('p', 'empty muted', message));
    updateSelection();
    return;
  }
  for (const account of list) {
    const row = el('div', 'row' + (PINNED.has(account.id) ? ' account-pinned' : ''));

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
    if (PINNED.has(account.id)) nameBox.appendChild(el('span', 'pin-marker', '已置顶'));
    nameBox.appendChild(el('span', 'muted small', '注册 ' + fmtDate(account.created_at)));
    who.appendChild(nameBox);
    row.appendChild(who);

    row.appendChild(statusPill(account));

    const usage = el('div', 'cell usage');
    usage.appendChild(el('span', null, account.items + ' 物品 / ' + account.records + ' 记录'));
    const egg = (account.books || {}).egg;
    if (egg) usage.appendChild(el('span', 'muted small', '放蛋：' + egg.items + ' 物品 / ' + egg.records + ' 记录'));
    usage.appendChild(el('span', 'muted small', account.revision === null ? '无账本' : 'rev ' + account.revision));
    row.appendChild(usage);

    const activity = el('div', 'cell activity');
    activity.appendChild(el('span', null, '最后保存 ' + fmtDate(account.ledger_updated_at)));
    activity.appendChild(el('span', 'muted small', recommendationLabel(account)));
    activity.appendChild(el('span', 'muted small', '推荐同步 ' + fmtDate(account.recommendation_synced_at)));
    const change = ACCOUNT_CHANGES.get(account.id);
    if (change) {
      activity.appendChild(el('span', 'change-badge ' + change.kind, change.kind === 'data' ? '检测到账本变动' : '检测到同步更新'));
      activity.appendChild(el('span', 'small', change.text));
      activity.appendChild(el('span', 'muted small', '检测于 ' + fmtDate(change.at)));
    }
    row.appendChild(activity);

    const actions = el('div', 'cell actions');
    const pin = el('button', 'ghost small pin-action' + (PINNED.has(account.id) ? ' is-pinned' : ''), PINNED.has(account.id) ? '取消置顶' : '置顶');
    pin.type = 'button';pin.setAttribute('aria-pressed', String(PINNED.has(account.id)));
    pin.addEventListener('click', () => togglePinnedAccount(account.id));actions.appendChild(pin);
    const detail = el('button', 'ghost small', '详情');
    detail.type = 'button';
    detail.addEventListener('click', () => openDetail(account));
    actions.appendChild(detail);

    const exp = el('button', 'ghost small', '导出');
    exp.type = 'button';
    exp.addEventListener('click', () => exportAccount(account, 'csv'));
    actions.appendChild(exp);

    if (ADMIN_SLOT === 'primary') {
      const assign = el('button', 'ghost small', '分给管理员 2');
      assign.type = 'button';
      assign.addEventListener('click', () => changeAssignment(account, true, assign));
      actions.appendChild(assign);
    }
    if(account.entity_type!=='team'){
    const toggle = el('button', 'ghost small' + (account.banned_until ? '' : ' warn'), account.banned_until ? '启用' : '禁用');
    toggle.type = 'button';
    toggle.addEventListener('click', () => toggleBan(account, toggle));
    actions.appendChild(toggle);

    const reset = el('button', 'ghost small', '改密码');
    reset.type = 'button';
    reset.addEventListener('click', () => resetPassword(account, reset));
    actions.appendChild(reset);
    }

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
  const hadPlan = ACTIVE_EGG_VIEW && ACTIVE_EGG_VIEW.id === account.id && ACTIVE_EGG_VIEW.loaded;
  ACTIVE_DETAIL = account.id;ACTIVE_EGG_VIEW = null;
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
    ['类型',account.entity_type==='team'?'群账本 · '+account.members+'名成员':'个人账号'],
    ['状态', account.banned_until ? '已禁用（至 ' + fmtDate(account.banned_until) + '）' : '正常'],
    ['注册时间', fmtDate(account.created_at)],
    ['最近登录', account.last_sign_in_at ? fmtDate(account.last_sign_in_at) : '从未登录'],
    ['账本修订', account.revision === null ? '无' : String(account.revision)],
    ['最后保存', fmtDate(account.ledger_updated_at)],
    ['现有记录中最近一次', fmtDate(account.latest_record_at)],
    ['推荐状态', recommendationLabel(account)],
    ['推荐同步时间', fmtDate(account.recommendation_synced_at)],
    ['密码', '单向哈希存储，无法查看，只能重置'],
  ];
  for (const [k, v] of pairs) {
    meta.appendChild(el('dt', null, k));
    meta.appendChild(el('dd', null, v));
  }
  body.appendChild(meta);

  const books = account.books || {};
  for (const [key, title] of Object.entries(BOOK_LABELS)) {
    const book = books[key] || {items: 0, records: 0, lines: []};
    const isEgg = key === 'egg';
    const section = el('section', 'book');
    section.appendChild(el('h3', null, title + ' · ' + book.items + ' 物品 / ' + book.records + ' 记录'));
    if (isEgg && books.egg) {
      const preview = el('div', 'recommendation-preview');
      const view = el('button', 'ghost small', '查看当前推荐与本轮顺序');
      view.type = 'button';
      const content = el('div');
      view.addEventListener('click', () => {ACTIVE_EGG_VIEW.loaded = true;return loadAccountEggPlan(account, content, view);});
      ACTIVE_EGG_VIEW = {id:account.id,target:content,button:view,loaded:Boolean(hadPlan)};
      preview.appendChild(view);preview.appendChild(content);section.appendChild(preview);
    }
    if (!book.lines.length) {
      section.appendChild(el('p', 'muted', '没有物品'));
    } else {
      const list = el('ul', 'lines');
      for (const line of book.lines) {
        const item = el('li');
        item.appendChild(el('span', null, line.name || '(未命名)'));
        item.appendChild(el('strong', null, String(line.total) + (isEgg && line.ratio ? ' · 比例 ' + line.ratio : '')));
        list.appendChild(item);
      }
      section.appendChild(list);
    }
    const total = book.total ?? book.lines.reduce((sum, line) => sum + line.total, 0);
    const footer = el('footer', 'book-total');
    footer.appendChild(el('strong', null, '总数 ' + total.toLocaleString('zh-CN') + (isEgg ? ' 个' : ' 件')));
    if (isEgg) footer.appendChild(el('span', null, '当前第 ' + ((book.round ?? 0) + 1) + ' 轮'));
    section.appendChild(footer);
    body.appendChild(section);
  }
  $('detail').hidden = false;
  if (hadPlan && ACTIVE_EGG_VIEW) loadAccountEggPlan(account, ACTIVE_EGG_VIEW.target, ACTIVE_EGG_VIEW.button);
}

function loadRecommendationCore() { return import('/core.js'); }
async function loadAccountEggPlan(account, target, button) {
  button.disabled = true;
  target.textContent = '正在读取当前推荐…';
  try {
    const data = await api('/api/accounts/' + account.id + '/recommendation');
    const core = await loadRecommendationCore();
    const egg = data.egg, saved = egg && core.eggStoredPlan(egg);
    target.textContent = '';
    if (!saved) {
      target.appendChild(el('p', 'muted small', '该账号尚未同步有效的推荐顺序。请让工作人员刷新放蛋页，再点这里刷新。'));
      return;
    }
    renderAccountEggPlan(target, core, egg, saved);
  } catch (error) {
    target.textContent = '读取推荐失败：' + error.message;
  } finally {
    button.disabled = false;button.textContent = '刷新当前推荐与本轮顺序';
  }
}
function renderAccountEggPlan(target, core, egg, saved) {
  const iterator = core.eggSavedSequence(saved), ids = [];
  const names = Object.fromEntries(egg.items.map(i => [i.id, i.name]));
  function showMore() {
    const end = Math.min(saved.total, ids.length + 200);
    while (ids.length < end) { const next = iterator.next();if (next.done) break;ids.push(next.value); }
    target.textContent = '';
    target.appendChild(el('h3', 'recommendation-current', '当前推荐：' + (names[ids[0]] || '—')));
    target.appendChild(el('p', 'muted small', '第 ' + (saved.context.round + 1) + ' 轮 · 剩余 ' + saved.total + ' 个 · 同步于 ' + core.clock(saved.at, true)));
    const list = el('ol', 'recommendation-order');
    ids.forEach((id, index) => {
      const row = el('li');
      row.appendChild(el('span', 'muted', index ? '第 ' + (index + 1) + ' 个' : '下一个'));
      row.appendChild(el('strong', null, names[id] || '物品'));list.appendChild(row);
    });
    target.appendChild(list);
    if (ids.length < saved.total) {
      const more = el('button', 'ghost small', '继续显示（还有 ' + (saved.total - ids.length) + ' 个）');
      more.type = 'button';more.addEventListener('click', showMore);target.appendChild(more);
    } else target.appendChild(el('p', 'muted small', '本轮结束'));
  }
  showMore();
}

async function runAggregate(op) {
  const ids = Array.from(SELECTED);
  if (!ids.length) return;
  if(ids.length>40){showError('每次最多计算40个账号，请减少选择。');return;}
  if (op === 'diff' && ids.length < 2) {
    showError('相减至少选择 2 个账号，首个账号减去其余账号');
    return;
  }
  showError('');
  try {
    const data = await api('/api/aggregate', {
      method: 'POST',
      body: JSON.stringify({ ids: ids, book: $('book').value, op: op, all_books: true }),
    });
    if(data.books)renderAllAggregates(data);else renderAggregate(data);
  } catch (err) {
    showError('汇总失败：' + err.message);
  }
}

function aggregateValue(data,row){return data.op==='diff'?row.diff:row.sum;}
function aggregateText(data,mode='process'){
 const label=BOOK_LABELS[data.book]||data.book,op=data.op==='diff'?'相减':'相加',process=mode==='process';
 const lines=[label+' · '+op+'结果','计算时间：'+fmtDate(Date.now())];
 if(process)lines.push('计算：'+data.users.map(u=>u.username||u.id.slice(0,6)).join(data.op==='diff'?' − ':' + '));
 if(data.missing?.length)lines.push('注：没有账本的账号按0计算。');
 const resultLabel=data.op==='diff'?'差值（首个减其余）':'合计';
 lines.push(['物品',...(process?data.users.map(u=>u.username||u.id.slice(0,6)):[]),resultLabel].join('\t'));
 for(const row of data.rows)lines.push([row.name,...(process?row.values:[]),aggregateValue(data,row)].join('\t'));
 lines.push(['总计',...(process?data.users.map((_,k)=>data.rows.reduce((n,row)=>n+row.values[k],0)):[]),data.rows.reduce((n,row)=>n+aggregateValue(data,row),0)].join('\t'));
 return lines.join('\n');
}
async function copyAggregateResult(data,target,mode){
 const text=aggregateText(data,mode),ok=await copyText(text);
 if(!ok){const field=el('textarea');field.value=text;field.readOnly=true;field.setAttribute('aria-label','可手动复制的计算结果');field.style.width='100%';field.rows=10;target.appendChild(field);field.focus();field.select();}
 flash(ok?'已复制'+(mode==='result'?'结果':'过程和结果'):'请长按下方文本全选复制');
}
function aggregateSection(data){
 const section=el('section','aggregate-book');section.appendChild(el('h3',null,BOOK_LABELS[data.book]||data.book));
 section.appendChild(el('p','muted small','计算：'+data.users.map(u=>u.username||u.id.slice(0,6)).join(data.op==='diff'?' − ':' + ')));
 const actions=el('div','aggregate-copy-actions');
 for(const [mode,label] of [['result','复制结果'],['process','复制过程和结果']]){
  const button=el('button',mode==='result'?'primary-refresh':'ghost',label);button.type='button';button.addEventListener('click',()=>copyAggregateResult(data,section,mode));actions.appendChild(button);
 }section.appendChild(actions);
 if(data.missing?.length)section.appendChild(el('p','muted small','其中'+data.missing.length+'个账号尚未保存账本，按0计算。'));
 const scroll=el('div','table-scroll aggregate-table-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('role','region');scroll.setAttribute('aria-label',(BOOK_LABELS[data.book]||data.book)+'计算表格，可左右滑动');
 const table=el('table','agg aggregate-table'),thead=el('thead'),head=el('tr');
 head.appendChild(el('th',null,'物品'));for(const user of data.users)head.appendChild(el('th',null,user.username||user.id.slice(0,6)));
 head.appendChild(el('th',null,data.op==='diff'?(data.users.length===2?'结果（差值 A−B）':'结果（差值：首个减其余）'):'结果（合计）'));thead.appendChild(head);table.appendChild(thead);
 const tbody=el('tbody');
 for(const row of data.rows){const tr=el('tr');tr.appendChild(el('th',null,row.name));for(const value of row.values)tr.appendChild(el('td','num',String(value)));tr.appendChild(el('td','num total',String(aggregateValue(data,row))));tbody.appendChild(tr);}table.appendChild(tbody);
 const tfoot=el('tfoot'),foot=el('tr');foot.appendChild(el('th',null,'总计'));
 data.users.forEach((_,k)=>foot.appendChild(el('td','num',String(data.rows.reduce((n,row)=>n+row.values[k],0)))));
 foot.appendChild(el('td','num total',String(data.rows.reduce((n,row)=>n+aggregateValue(data,row),0))));tfoot.appendChild(foot);table.appendChild(tfoot);scroll.appendChild(table);section.appendChild(scroll);
 section.appendChild(el('p','muted small','账号较多时可左右滑动表格，最右侧为计算结果。'));
 if(!data.rows.length)section.appendChild(el('p','muted','当前所选账号在此账本没有物品。'));
 return section;
}
function renderAllAggregates(data){
 const body=$('a-body');body.textContent='';$('a-title').textContent='多账号'+(data.op==='diff'?'相减':'相加')+'结果';
 const first=$('book').value;
 for(const key of [first,...['egg','sales','stock'].filter(k=>k!==first)])if(data.books[key])body.appendChild(aggregateSection(data.books[key]));
 $('agg').hidden=false;
}
function renderAggregate(data){
 $('a-title').textContent=(data.op==='diff'?'相减 · ':'相加汇总 · ')+(BOOK_LABELS[data.book]||data.book);
 const body=$('a-body');body.textContent='';body.appendChild(aggregateSection(data));$('agg').hidden=false;
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
    assign_account: '分给管理员 2', reclaim_account: '收回管理',
  })[action] || action;
}

function clearAccountViews() {
  ACTIVE_DETAIL = null;
  ACTIVE_EGG_VIEW = null;
  for (const id of ['detail', 'agg', 'secret']) $(id).hidden = true;
  for (const id of ['d-body', 'd-actions', 'a-body', 's-pass', 's-who']) $(id).textContent = '';
}

function setAdminSlot(slot) {
  if (slot === ADMIN_SLOT) return;
  ADMIN_SLOT = slot;
  ACCOUNTS = [];
  LOADED_ONCE = false;
  ACCOUNT_CHANGES.clear();
  SELECTED.clear();
  PINNED = readPinnedAccounts();
  clearAccountViews();
  for (const id of ['assignments-panel', 'security-panel']) $(id).hidden = true;
  for (const id of ['assigned-list', 'security-body', 'audit']) $(id).textContent = '';
  $('admin-position').textContent = slot === 'secondary' ? '管理员 2' : '管理员 1';
  $('assignments-open').hidden = slot !== 'primary';
  $('security-open').hidden = slot !== 'primary';
}

async function loadAssignments() {
  const list = $('assigned-list');
  list.textContent = '正在读取…';
  try {
    const {accounts} = await api('/api/assignments');
    list.textContent = '';
    if (!accounts.length) list.appendChild(el('p', 'muted', '还没有分配账号或群。'));
    for (const account of accounts) {
      const row = el('div', 'security-row');
      row.appendChild(el('span', null, account.username));
      const reclaim = el('button', 'ghost small', '收回');
      reclaim.type = 'button';
      reclaim.addEventListener('click', () => changeAssignment(account, false, reclaim));
      row.appendChild(reclaim);
      list.appendChild(row);
    }
  } catch (error) {
    list.textContent = '读取分配失败：' + error.message;
  }
}

async function changeAssignment(account, assigned, button) {
  const action = assigned ? '分给管理员 2' : '收回到管理员 1';
  if (!window.confirm('将「' + account.username + '」' + action + '？')) return;
  button.disabled = true;
  try {
    await api('/api/assignments', {method: 'POST', body: JSON.stringify({id: account.id, assigned})});
    assignmentVersion++;
    if (assigned) {
      ACCOUNTS = ACCOUNTS.filter(item => item.id !== account.id);
      SELECTED.delete(account.id);
      ACCOUNT_CHANGES.delete(account.id);
      clearAccountViews();
      renderRows();
    }
    await load();
    if (!$('assignments-panel').hidden) await loadAssignments();
    flash(assigned ? '已分配给管理员 2' : '已收回到管理员 1');
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function load(options = {}) {
  if (LOADING) return false;
  LOADING = true;let received = false;
  const requestedVersion = assignmentVersion;
  for (const id of ['reload','reload-top','d-refresh']) $(id).disabled = true;
  showError('');
  try {
    const data = await api('/api/accounts');
    if (requestedVersion !== assignmentVersion) return false;
    received = true;
    setAdminSlot(data.admin_slot);
    const old = new Map(ACCOUNTS.map(a=>[a.id,a]));
    let changed = 0, synced = 0;
    if (LOADED_ONCE) for (const account of data.accounts) {
      const change = accountChange(old.get(account.id), account);
      if (change) {const previous=ACCOUNT_CHANGES.get(account.id);if(change.kind==='data'||previous?.kind!=='data')ACCOUNT_CHANGES.set(account.id,{...change,at:Date.now()});if(change.kind==='data')changed++;else synced++;}
    }
    const first = !LOADED_ONCE;ACCOUNTS = data.accounts;LOADED_ONCE = true;
    const alive = new Set(ACCOUNTS.map(a=>a.id));
    if ([...old.keys()].some(id => !alive.has(id))) clearAccountViews();
    for (const id of Array.from(SELECTED)) if (!alive.has(id)) SELECTED.delete(id);
    for (const id of ACCOUNT_CHANGES.keys()) if (!alive.has(id)) ACCOUNT_CHANGES.delete(id);
    renderSummary(data.summary, data.generated_at);renderRows();
    $('changes').textContent = first ? '已建立当前数据基准；后续刷新会标出账本变动和仅同步更新。' :
      '本次检查：' + changed + ' 个账号账本变动，' + synced + ' 个账号仅推荐或保存状态更新。';
    const current = ACCOUNTS.find(a=>a.id===ACTIVE_DETAIL);
    if (current && !$('detail').hidden && (options.forceDetail || JSON.stringify(current)!==JSON.stringify(old.get(current.id)))) {
      const body = $('d-body').parentElement, scroll = body ? body.scrollTop : 0;
      openDetail(current);if(body)body.scrollTop=scroll;
    }
    return true;
  } catch (err) {
    if (err.message !== 'unauthenticated') showError(received ? '管理页面显示异常：' + err.message + '，请刷新页面重试。' : '读取账号失败：' + err.message + '，已保留上次显示的数据，请稍后刷新重试。');
    return false;
  } finally {
    LOADING = false;for (const id of ['reload','reload-top','d-refresh']) $(id).disabled = false;
    if (requestedVersion !== assignmentVersion) load();
    else loadAudit();
  }
}

$('search').addEventListener('input', renderRows);
$('reload').addEventListener('click', load);
$('reload-top').addEventListener('click', load);
$('d-refresh').addEventListener('click', () => load({forceDetail:true}));
$('btn-sum').addEventListener('click', () => runAggregate('sum'));
$('btn-diff').addEventListener('click', () => runAggregate('diff'));
$('sel-all').addEventListener('change', (event) => {
  const on = event.target.checked;
  SELECTED.clear();
  if (on) for (const a of ACCOUNTS.slice().sort(compareAccounts)) SELECTED.add(a.id);
  renderRows();
});
async function loadSecurity(){
 try{const data=await api('/api/security'),body=$('security-body');body.textContent='';
 body.appendChild(el('p','muted small','资源缺失、访问拒绝和账本变更分别显示。异常记录不等于攻击成功；默认不自动封 IP。'));
 const agentStatus=data.agent.status.startsWith('运行正常')?'运行正常 · 已封禁 '+(data.agent.blocked??data.blocked.length)+' 个 IP':data.agent.status;
 body.appendChild(el('p',null,'安全服务：'+agentStatus+(data.agent.at?' · '+fmtDate(data.agent.at*1000):'')));
 for(const ip of data.blocked){const row=el('div','security-row');row.appendChild(el('span',null,'已封禁：'+ip));const btn=el('button','ghost','解除封禁');btn.addEventListener('click',()=>setIpBlock(ip,false));row.appendChild(btn);body.appendChild(row);}
 for(const event of data.entries){const row=el('div','security-row');const at=typeof event.at==='number'?event.at*1000:event.at;row.appendChild(el('span',null,fmtDate(at)+' · '+event.ip+(event.ip===data.current_ip?'（当前连接）':'')+' · '+event.kind+' · '+event.detail));if(event.ip!==data.current_ip&&event.can_block!==false){const btn=el('button','ghost small',data.blocked.includes(event.ip)?'解除封禁':'封禁此IP');btn.addEventListener('click',()=>setIpBlock(event.ip,!data.blocked.includes(event.ip)));row.appendChild(btn);}body.appendChild(row);}
 if(!data.entries.length)body.appendChild(el('p','muted','暂未记录到异常。'));
 }catch(err){showError('安全记录读取失败：'+err.message);}
}
async function setIpBlock(ip,blocked){if(!window.confirm((blocked?'封禁':'解除封禁')+' IP '+ip+'？'))return;try{await api('/api/security/block',{method:'POST',body:JSON.stringify({ip,blocked})});flash('已提交，几秒后刷新可查看生效状态。');await loadSecurity();}catch(err){showError(err.message);}}
$('security-open').addEventListener('click',async()=>{$('security-panel').hidden=!$('security-panel').hidden;if(!$('security-panel').hidden)await loadSecurity();});
$('assignments-open').addEventListener('click', () => {
  $('assignments-panel').hidden = false;
  loadAssignments();
});
$('assignments-close').addEventListener('click', () => { $('assignments-panel').hidden = true; });
$('security-refresh').addEventListener('click',loadSecurity);
$('security-close').addEventListener('click',()=>{$('security-panel').hidden=true;});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ }
  window.location.href = '/admin/';
});
$('d-close').addEventListener('click', () => { $('detail').hidden = true;ACTIVE_DETAIL=null;ACTIVE_EGG_VIEW=null; });
$('a-close').addEventListener('click', () => { $('agg').hidden = true; });
$('s-close').addEventListener('click', () => { $('secret').hidden = true; });
$('s-copy').addEventListener('click', async () => {
  const ok = await copyText($('s-pass').textContent);
  flash(ok ? '密码已复制' : '复制失败，请手动选中');
});
for (const id of ['detail', 'agg', 'secret']) {
  $(id).addEventListener('click', (event) => {
    if (event.target === $(id)) {$(id).hidden = true;if(id==='detail'){ACTIVE_DETAIL=null;ACTIVE_EGG_VIEW=null;}}
  });
}

setInterval(() => {if ($('auto-refresh').checked && document.visibilityState !== 'hidden') return load();},10000);
document.addEventListener('visibilitychange', () => {if (document.visibilityState === 'visible' && $('auto-refresh').checked) load();});
$('auto-refresh').addEventListener('change', () => {if ($('auto-refresh').checked) load();});
load();
