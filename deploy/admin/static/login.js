'use strict';

const form = document.getElementById('form');
const input = document.getElementById('pw');
const positionCode = document.getElementById('position-code');
const msg = document.getElementById('msg');
const go = document.getElementById('go');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  msg.textContent = '';
  go.disabled = true;
  try {
    const credentials = { password: input.value };
    if (!positionCode.disabled) credentials.position_code = positionCode.value;
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (res.ok) {
      window.location.href = '/admin/';
      return;
    }
    if (res.status === 429) {
      msg.textContent = '尝试次数过多，请 15 分钟后再试。';
    } else if (res.status === 403) {
      msg.textContent = '来源不被允许。';
    } else {
      msg.textContent = positionCode.disabled ? '口令不正确。' : '管理口令或位置口令不正确。';
    }
  } catch (err) {
    msg.textContent = '网络异常，请重试。';
  } finally {
    go.disabled = false;
    input.value = '';
    positionCode.value = '';
  }
});
