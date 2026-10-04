// =====================================================================
//  QC Pro — التطبيق الرئيسي (SPA)
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY, LAB_NAME, APP_NAME } from './config.js';
import * as S from './stats.js';

const root = document.getElementById('root');
const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');
const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  session: null, profile: null,
  depts: [], analyzers: [], tests: [], lots: [], profiles: [],
  charts: [],
};

// ---------------------------------------------------------------- utils
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => state.profile?.role === 'admin' && state.profile?.status === 'active';
const pad = n => String(n).padStart(2, '0');
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const fdt = s => s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fd = s => s ? new Date(s).toLocaleDateString('en-GB') : '—';
const testById = id => state.tests.find(t => t.id === id);
const lotById = id => state.lots.find(l => l.id === id);
const deptName = id => state.depts.find(d => d.id === id)?.name || '—';
const analyzerName = id => state.analyzers.find(a => a.id === id)?.name || '—';
const userName = id => { const p = state.profiles.find(p => p.id === id); return p ? (p.full_name || p.email) : '—'; };
const lotLabel = l => l ? `${l.level} · ${l.lot_number}` : '—';
const dec = t => t?.decimals ?? 2;

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function statusBadge(st) {
  return st === 'reject' ? '<span class="badge bad"><i class="fa-solid fa-xmark"></i> مرفوض</span>'
    : st === 'warning' ? '<span class="badge warn"><i class="fa-solid fa-triangle-exclamation"></i> تحذير</span>'
    : '<span class="badge ok"><i class="fa-solid fa-check"></i> مقبول</span>';
}
const rulesHtml = arr => (arr || []).map(r => `<span class="rule ${S.RULES[r]?.type === 'warning' ? 'w' : ''}">${esc(S.RULES[r]?.label || r)}</span>`).join('') || '<span class="muted">—</span>';

function opts(list, val, labelFn = x => x.name, empty = '') {
  return (empty ? `<option value="">${empty}</option>` : '') +
    list.map(x => `<option value="${x.id}" ${String(x.id) === String(val) ? 'selected' : ''}>${esc(labelFn(x))}</option>`).join('');
}
function testOptions(val, empty = 'اختر الفحص') {
  const active = state.tests.filter(t => t.active);
  const groups = {};
  active.forEach(t => (groups[deptName(t.department_id)] ??= []).push(t));
  return `<option value="">${empty}</option>` + Object.entries(groups).map(([g, ts]) =>
    `<optgroup label="${esc(g)}">${ts.map(t => `<option value="${t.id}" ${String(t.id) === String(val) ? 'selected' : ''}>${esc(t.name)}${t.unit ? ` (${esc(t.unit)})` : ''}</option>`).join('')}</optgroup>`).join('');
}

function destroyCharts() { state.charts.forEach(c => c.destroy()); state.charts = []; }

function modal(html, onMount) {
  const mr = $('#modal-root');
  mr.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  const bg = $('.modal-bg', mr);
  bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
  $$('[data-close]', mr).forEach(b => b.onclick = closeModal);
  onMount?.($('.modal', mr));
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// نموذج عام للإضافة/التعديل
function formModal({ title, fields, data = {}, onSave }) {
  const fh = fields.map(f => {
    const v = data[f.k] ?? f.default ?? '';
    let input;
    if (f.type === 'select') input = `<select name="${f.k}" ${f.required ? 'required' : ''}>${f.options(v)}</select>`;
    else if (f.type === 'textarea') input = `<textarea name="${f.k}">${esc(v)}</textarea>`;
    else if (f.type === 'checkbox') input = `<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    else if (f.type === 'rules') input = `<div class="checks">${Object.entries(S.RULES).map(([k, r]) =>
      `<label title="${esc(r.desc)}"><input type="checkbox" name="rules" value="${k}" ${(v || S.DEFAULT_RULES).includes(k) ? 'checked' : ''}> <span class="ltr">${r.label}</span></label>`).join('')}</div>`;
    else input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.required ? 'required' : ''} ${f.type === 'number' ? 'dir="ltr"' : ''}>`;
    return `<div class="field" style="${f.full ? 'grid-column:1/-1' : ''}">${f.type === 'checkbox' ? '' : `<label>${esc(f.label)}${f.required ? ' *' : ''}</label>`}${input}${f.hint ? `<div class="muted" style="font-size:12px;margin-top:4px">${f.hint}</div>` : ''}</div>`;
  }).join('');
  modal(`<h3>${title}</h3><form id="fm"><div class="grid g2" style="gap:0 14px">${fh}</div>
    <div class="actions"><button class="btn primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> حفظ</button><button class="btn" type="button" data-close>إلغاء</button></div></form>`,
    m => {
      $('#fm', m).onsubmit = async e => {
        e.preventDefault();
        const fdata = new FormData(e.target), out = {};
        fields.forEach(f => {
          if (f.type === 'checkbox') out[f.k] = !!e.target.elements[f.k].checked;
          else if (f.type === 'rules') out[f.k] = fdata.getAll('rules');
          else {
            let v = fdata.get(f.k);
            if (v === '') v = null;
            else if (f.type === 'number' || f.num) v = Number(v);
            out[f.k] = v;
          }
        });
        const btn = $('button[type=submit]', m); btn.disabled = true;
        try { await onSave(out); closeModal(); } catch (err) { toast(err.message || String(err), 'bad'); btn.disabled = false; }
      };
    });
}

function downloadCSV(name, rows) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click();
}

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- data
async function loadRefs() {
  const [depts, analyzers, tests, lots, profiles] = await Promise.all([
    q(sb.from('departments').select('*').order('name')),
    q(sb.from('analyzers').select('*').order('name')),
    q(sb.from('tests').select('*').order('name')),
    q(sb.from('qc_lots').select('*').order('level')),
    q(sb.from('profiles').select('*').order('created_at')),
  ]);
  Object.assign(state, { depts, analyzers, tests, lots, profiles });
}

async function fetchResults({ testId, lotId, from, to, status, limit = 5000 } = {}) {
  let qq = sb.from('qc_results').select('*').order('run_at', { ascending: true }).limit(limit);
  if (testId) qq = qq.eq('test_id', testId);
  if (lotId) qq = qq.eq('lot_id', lotId);
  if (from) qq = qq.gte('run_at', new Date(from + 'T00:00:00').toISOString());
  if (to) qq = qq.lte('run_at', new Date(to + 'T23:59:59').toISOString());
  if (status) qq = qq.eq('status', status);
  return q(qq);
}

// ---------------------------------------------------------------- auth
function renderSetupNeeded() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="max-width:560px">
    <div class="brand"><div class="logo"><i class="fa-solid fa-vial-circle-check"></i></div><div><h1>${APP_NAME}</h1><small>إعداد أولي مطلوب</small></div></div>
    <div class="alert warn" style="margin-top:16px"><i class="fa-solid fa-gear"></i><div>لم يتم ربط التطبيق بقاعدة البيانات بعد.<br>
    افتح الملف <b class="ltr">js/config.js</b> وضع <b class="ltr">SUPABASE_URL</b> و <b class="ltr">SUPABASE_ANON_KEY</b> من مشروعك على Supabase، ثم شغّل <b class="ltr">supabase/schema.sql</b>. التفاصيل في ملف README.</div></div>
  </div></div>`;
}

function renderAuth(mode = 'login') {
  destroyCharts();
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="brand"><div class="logo"><i class="fa-solid fa-vial-circle-check"></i></div>
      <div><h1>${APP_NAME}</h1><small>${esc(LAB_NAME)} — نظام ضبط الجودة</small></div></div>
    ${mode === 'reset' ? '' : `<div class="tabs">
      <button data-m="login" class="${mode === 'login' ? 'active' : ''}">تسجيل الدخول</button>
      <button data-m="signup" class="${mode === 'signup' ? 'active' : ''}">حساب جديد</button></div>`}
    <form id="af">
      ${mode === 'signup' ? `<div class="field"><label>الاسم الكامل</label><input name="name" required></div>` : ''}
      ${mode !== 'reset' ? `<div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" dir="ltr" required autocomplete="email"></div>` : ''}
      ${mode !== 'forgot' ? `<div class="field"><label>${mode === 'reset' ? 'كلمة المرور الجديدة' : 'كلمة المرور'}</label><input name="password" type="password" dir="ltr" minlength="8" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>` : ''}
      ${mode === 'signup' ? `<div class="field"><label>تأكيد كلمة المرور</label><input name="password2" type="password" dir="ltr" minlength="8" required></div>` : ''}
      <button class="btn primary block" type="submit">${{ login: 'دخول', signup: 'إنشاء الحساب', forgot: 'إرسال رابط الاستعادة', reset: 'حفظ كلمة المرور' }[mode]}</button>
    </form>
    <div style="margin-top:14px;text-align:center;font-size:13px">
      ${mode === 'login' ? '<a href="#" data-m="forgot">نسيت كلمة المرور؟</a>' : ''}
      ${mode === 'forgot' ? '<a href="#" data-m="login">العودة لتسجيل الدخول</a>' : ''}
    </div>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:18px">أول حساب يُنشأ يصبح مدير النظام تلقائياً، والحسابات الأخرى تتطلب موافقة المدير.</p>
  </div></div>`;

  $$('[data-m]').forEach(b => b.onclick = e => { e.preventDefault(); renderAuth(b.dataset.m); });
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (f.password !== f.password2) throw new Error('كلمتا المرور غير متطابقتين');
        const { data, error } = await sb.auth.signUp({
          email: f.email.trim(), password: f.password,
          options: { data: { full_name: f.name.trim() }, emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        if (!data.session) { toast('تم إنشاء الحساب — تحقق من بريدك لتأكيده ثم سجّل الدخول', 'ok'); renderAuth('login'); }
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        toast('تم إرسال رابط الاستعادة إلى بريدك', 'ok');
      } else if (mode === 'reset') {
        const { error } = await sb.auth.updateUser({ password: f.password });
        if (error) throw error;
        toast('تم تغيير كلمة المرور', 'ok');
        history.replaceState(null, '', location.pathname);
        boot();
      }
    } catch (err) {
      const m = err.message || String(err);
      toast(m.includes('Invalid login') ? 'البريد أو كلمة المرور غير صحيحة' : m.includes('Email not confirmed') ? 'لم يتم تأكيد البريد بعد' : m, 'bad');
    } finally { btn.disabled = false; }
  };
}

function renderPending() {
  const p = state.profile;
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="text-align:center">
    <div class="brand" style="justify-content:center"><div class="logo"><i class="fa-solid fa-hourglass-half"></i></div></div>
    <h2>${p?.status === 'disabled' ? 'الحساب موقوف' : 'بانتظار موافقة المدير'}</h2>
    <p class="muted">${p?.status === 'disabled' ? 'تم إيقاف هذا الحساب. تواصل مع مدير النظام.' : 'تم إنشاء حسابك بنجاح. سيتمكن مدير الجودة من تفعيله وتحديد قسمك.'}</p>
    <p class="ltr muted">${esc(p?.email || '')}</p>
    <div class="row" style="justify-content:center"><button class="btn" id="rl"><i class="fa-solid fa-rotate"></i> تحديث</button>
    <button class="btn danger" id="lo"><i class="fa-solid fa-right-from-bracket"></i> خروج</button></div></div></div>`;
  $('#rl').onclick = boot;
  $('#lo').onclick = () => sb.auth.signOut();
}

// ---------------------------------------------------------------- shell + router
const NAV = [
  { id: 'dashboard', icon: 'gauge-high', label: 'لوحة التحكم' },
  { id: 'entry', icon: 'pen-to-square', label: 'إدخال نتائج QC' },
  { id: 'lj', icon: 'chart-line', label: 'مخطط Levey-Jennings' },
  { id: 'results', icon: 'list-check', label: 'سجل النتائج والمراجعة' },
  { sep: 'التحليل الإحصائي' },
  { id: 'sigma', icon: 'bullseye', label: 'Six Sigma والتوصيات' },
  { id: 'eqa', icon: 'globe', label: 'التقييم الخارجي EQA' },
  { id: 'mu', icon: 'ruler-combined', label: 'عدم اليقين MU' },
  { id: 'compare', icon: 'code-compare', label: 'مقارنة اللوتات' },
  { id: 'reports', icon: 'file-lines', label: 'التقارير الشهرية' },
  { id: 'guide', icon: 'book-medical', label: 'دليل القواعد' },
  { sep: 'الإدارة', admin: true },
  { id: 'users', icon: 'users', label: 'المستخدمون', admin: true },
  { id: 'setup', icon: 'sliders', label: 'الإعدادات (فحوص/لوتات)', admin: true },
  { id: 'audit', icon: 'shield-halved', label: 'سجل التدقيق', admin: true },
];

function renderShell() {
  const p = state.profile;
  root.innerHTML = `<div class="app">
    <aside class="side" id="side">
      <div class="brand"><div class="logo"><i class="fa-solid fa-vial-circle-check"></i></div><div><h1>${APP_NAME}</h1><small>${esc(LAB_NAME)}</small></div></div>
      <nav class="nav">${NAV.filter(n => !n.admin || isAdmin()).map(n => n.sep ? `<div class="sep">${n.sep}</div>` :
        `<a href="#/${n.id}" data-v="${n.id}"><i class="fa-solid fa-${n.icon}"></i>${n.label}</a>`).join('')}</nav>
    </aside>
    <main class="main">
      <div class="topbar">
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn sm menu-btn" id="mb"><i class="fa-solid fa-bars"></i></button>
          <div><h2 id="vt"></h2><div class="sub" id="vs"></div></div>
        </div>
        <div class="userchip"><div class="avatar">${esc((p.full_name || p.email || '?').trim()[0])}</div>
          <div class="uname"><div style="font-size:14px">${esc(p.full_name || p.email)}</div><div class="muted" style="font-size:11px">${isAdmin() ? 'مدير النظام' : 'مستخدم'}</div></div>
          <button class="btn sm" id="lo" title="خروج"><i class="fa-solid fa-right-from-bracket"></i></button></div>
      </div>
      <div id="view"></div>
    </main></div>`;
  $('#lo').onclick = () => sb.auth.signOut();
  $('#mb').onclick = () => $('#side').classList.toggle('open');
  route();
}

const VIEWS = {};
async function route() {
  if (!state.profile) return;
  const id = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const nav = NAV.find(n => n.id === id && (!n.admin || isAdmin())) || NAV[0];
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.v === nav.id));
  $('#side')?.classList.remove('open');
  $('#vt').textContent = nav.label; $('#vs').textContent = '';
  destroyCharts();
  const view = $('#view');
  view.innerHTML = '<div class="loader"></div>';
  try { await VIEWS[nav.id](view); }
  catch (err) { console.error(err); view.innerHTML = `<div class="alert bad"><i class="fa-solid fa-circle-exclamation"></i>${esc(err.message || err)}</div>`; }
}
window.addEventListener('hashchange', route);

// ================================================================ VIEWS
// ---------------- Dashboard
VIEWS.dashboard = async view => {
  $('#vs').textContent = new Date().toLocaleDateString('ar-JO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const res = await fetchResults({ from: isoDate(daysAgo(29)) });
  const today = isoDate(new Date());
  const tRes = res.filter(r => isoDate(new Date(r.run_at)) === today);
  const unreviewed = res.filter(r => r.status === 'reject' && !r.reviewed_by);
  const soon = daysAgo(-30);
  const expiring = state.lots.filter(l => l.active && l.expiry && new Date(l.expiry) <= soon);
  const accRate = res.length ? (res.filter(r => r.status !== 'reject').length / res.length * 100) : NaN;

  // tests with no QC today
  const activeTestIds = [...new Set(state.lots.filter(l => l.active).map(l => l.test_id))].filter(id => testById(id)?.active);
  const doneToday = new Set(tRes.map(r => r.test_id));
  const missing = activeTestIds.filter(id => !doneToday.has(id));

  view.innerHTML = `
  <div class="grid g4">
    <div class="kpi info"><i class="fa-solid fa-flask"></i><div class="l">نتائج اليوم</div><div class="v num">${tRes.length}</div></div>
    <div class="kpi bad"><i class="fa-solid fa-ban"></i><div class="l">مرفوضة اليوم</div><div class="v num">${tRes.filter(r => r.status === 'reject').length}</div></div>
    <div class="kpi warn"><i class="fa-solid fa-clipboard-question"></i><div class="l">رفض بانتظار المراجعة</div><div class="v num">${unreviewed.length}</div></div>
    <div class="kpi ok"><i class="fa-solid fa-circle-check"></i><div class="l">نسبة القبول (30 يوم)</div><div class="v num">${S.fmt(accRate, 1)}%</div></div>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><h3><i class="fa-solid fa-chart-column"></i> اتجاه نتائج QC — آخر 30 يوماً</h3><div class="chart-box sm"><canvas id="c1"></canvas></div></div>
    <div class="card"><h3><i class="fa-solid fa-bell"></i> تنبيهات</h3>
      ${expiring.map(l => `<div class="alert warn"><i class="fa-solid fa-calendar-xmark"></i><div>لوت <b class="ltr">${esc(l.lot_number)}</b> (${esc(testById(l.test_id)?.name)} — ${esc(l.level)}) ${new Date(l.expiry) < new Date() ? 'منتهي الصلاحية' : 'تنتهي صلاحيته'} في <span class="num">${fd(l.expiry)}</span></div></div>`).join('')}
      ${missing.length ? `<div class="alert info"><i class="fa-solid fa-hourglass-start"></i><div>لم يُسجَّل QC اليوم لـ <b>${missing.length}</b> فحص: ${missing.slice(0, 12).map(id => esc(testById(id)?.name)).join('، ')}${missing.length > 12 ? '…' : ''}</div></div>` : '<div class="alert ok"><i class="fa-solid fa-check"></i>تم تسجيل QC اليوم لجميع الفحوص الفعّالة.</div>'}
      ${!state.tests.length ? `<div class="alert info"><i class="fa-solid fa-circle-info"></i><div>ابدأ بإضافة الأقسام والأجهزة والفحوص واللوتات من ${isAdmin() ? '<a href="#/setup">الإعدادات</a>' : 'الإعدادات (المدير)'}.</div></div>` : ''}
    </div>
  </div>
  <div class="card"><h3><i class="fa-solid fa-triangle-exclamation"></i> آخر المخالفات</h3>
    ${tableResults(res.filter(r => r.status !== 'accept').slice(-15).reverse())}</div>`;

  // daily stacked chart
  const days = [...Array(30)].map((_, i) => isoDate(daysAgo(29 - i)));
  const by = st => days.map(d => res.filter(r => r.status === st && isoDate(new Date(r.run_at)) === d).length);
  state.charts.push(new Chart($('#c1'), {
    type: 'bar',
    data: { labels: days.map(d => d.slice(5)), datasets: [
      { label: 'مقبول', data: by('accept'), backgroundColor: '#3ecf8e' },
      { label: 'تحذير', data: by('warning'), backgroundColor: '#f2b632' },
      { label: 'مرفوض', data: by('reject'), backgroundColor: '#ff5d5d' }] },
    options: chartBase({ stacked: true }),
  }));
  bindResultRows(view);
};

function chartBase({ stacked = false } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    plugins: { legend: { labels: { color: '#8d97ab', font: { family: 'Tajawal' } } } },
    scales: {
      x: { stacked, ticks: { color: '#8d97ab' }, grid: { color: 'rgba(255,255,255,.04)' } },
      y: { stacked, ticks: { color: '#8d97ab' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: stacked },
    },
  };
}

function tableResults(rows, { review = false } = {}) {
  if (!rows.length) return '<div class="empty"><i class="fa-solid fa-inbox"></i>لا توجد نتائج</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>الفحص</th><th>المستوى/اللوت</th><th>القيمة</th><th>Z</th><th>القواعد</th><th>الحالة</th><th>أدخلها</th><th>المراجعة</th></tr></thead><tbody>
  ${rows.map(r => { const t = testById(r.test_id), l = lotById(r.lot_id); return `<tr data-rid="${r.id}" style="cursor:pointer">
    <td class="num">${fdt(r.run_at)}</td><td>${esc(t?.name)}</td><td>${esc(lotLabel(l))}</td>
    <td class="num">${S.fmt(r.value, dec(t))} <span class="muted">${esc(t?.unit || '')}</span></td>
    <td class="num">${S.fmt(r.z, 2)}</td><td>${rulesHtml(r.rules_violated)}</td><td>${statusBadge(r.status)}</td>
    <td>${esc(userName(r.entered_by))}</td>
    <td>${r.reviewed_by ? `<span class="badge ok"><i class="fa-solid fa-user-check"></i> ${esc(userName(r.reviewed_by))}</span>` : r.status === 'accept' ? '' : '<span class="badge muted">بانتظار</span>'}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function bindResultRows(view, onChange) {
  $$('tr[data-rid]', view).forEach(tr => tr.onclick = async () => {
    const r = (await q(sb.from('qc_results').select('*').eq('id', tr.dataset.rid)))[0];
    const t = testById(r.test_id), l = lotById(r.lot_id);
    modal(`<h3><i class="fa-solid fa-file-medical"></i> تفاصيل النتيجة</h3>
      <div class="grid g2" style="gap:8px 16px">
        <div><span class="muted">الفحص:</span> ${esc(t?.name)}</div><div><span class="muted">المستوى:</span> ${esc(lotLabel(l))}</div>
        <div><span class="muted">القيمة:</span> <b class="num">${S.fmt(r.value, dec(t))}</b> ${esc(t?.unit || '')}</div>
        <div><span class="muted">المستهدف:</span> <span class="num">${S.fmt(l?.target_mean, dec(t))} ± ${S.fmt(l?.target_sd, dec(t))}</span></div>
        <div><span class="muted">Z-score:</span> <span class="num">${S.fmt(r.z, 2)}</span></div><div>${statusBadge(r.status)}</div>
        <div><span class="muted">التشغيل:</span> <span class="num">${fdt(r.run_at)}</span></div><div><span class="muted">أدخلها:</span> ${esc(userName(r.entered_by))}</div>
      </div>
      <div style="margin:10px 0">${(r.rules_violated || []).map(x => `<div class="alert ${S.RULES[x]?.type === 'reject' ? 'bad' : 'warn'}" style="margin-bottom:6px"><span class="rule">${S.RULES[x]?.label}</span>${esc(S.RULES[x]?.desc)}</div>`).join('')}</div>
      <div class="field"><label>ملاحظة</label><div>${esc(r.comment) || '<span class="muted">—</span>'}</div></div>
      ${isAdmin() ? `<div class="field"><label>الإجراء التصحيحي</label><textarea id="ca">${esc(r.corrective_action)}</textarea></div>
        <div class="field"><label>الحالة</label><select id="st">${['accept', 'warning', 'reject'].map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${{ accept: 'مقبول', warning: 'تحذير', reject: 'مرفوض' }[s]}</option>`).join('')}</select></div>`
        : `<div class="field"><label>الإجراء التصحيحي</label><div>${esc(r.corrective_action) || '<span class="muted">—</span>'}</div></div>`}
      ${r.reviewed_by ? `<p class="muted">روجعت بواسطة ${esc(userName(r.reviewed_by))} في <span class="num">${fdt(r.reviewed_at)}</span></p>` : ''}
      <div class="actions">${isAdmin() ? `<button class="btn primary" id="rv"><i class="fa-solid fa-user-check"></i> حفظ واعتماد المراجعة</button><button class="btn danger" id="del"><i class="fa-solid fa-trash"></i> حذف</button>` : ''}<button class="btn" data-close>إغلاق</button></div>`,
      m => {
        if (!isAdmin()) return;
        $('#rv', m).onclick = async () => {
          try {
            await q(sb.from('qc_results').update({ corrective_action: $('#ca', m).value || null, status: $('#st', m).value, reviewed_by: state.profile.id, reviewed_at: new Date().toISOString() }).eq('id', r.id));
            toast('تم اعتماد المراجعة', 'ok'); closeModal(); onChange ? onChange() : route();
          } catch (e) { toast(e.message, 'bad'); }
        };
        $('#del', m).onclick = async () => {
          if (!confirm('حذف هذه النتيجة نهائياً؟ (سيُحفظ في سجل التدقيق)')) return;
          try { await q(sb.from('qc_results').delete().eq('id', r.id)); toast('تم الحذف', 'ok'); closeModal(); onChange ? onChange() : route(); } catch (e) { toast(e.message, 'bad'); }
        };
      });
  });
}

// ---------------- QC Entry
VIEWS.entry = async view => {
  $('#vs').textContent = 'تقييم فوري بقواعد Westgard متعددة القواعد';
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  view.innerHTML = `<div class="card">
    <div class="row">
      <div><label>الفحص</label><select id="tsel">${testOptions(qs.get('test'))}</select></div>
      <div><label>تاريخ ووقت التشغيل</label><input id="rat" type="datetime-local" dir="ltr" value="${toLocalInput(new Date())}"></div>
    </div></div><div id="levels"></div>`;
  const tsel = $('#tsel');
  tsel.onchange = () => loadLevels(+tsel.value);
  if (tsel.value) loadLevels(+tsel.value);

  async function loadLevels(testId) {
    const box = $('#levels');
    if (!testId) { box.innerHTML = ''; return; }
    const t = testById(testId);
    const lots = state.lots.filter(l => l.test_id === testId && l.active);
    if (!lots.length) { box.innerHTML = `<div class="alert warn"><i class="fa-solid fa-circle-info"></i>لا توجد لوتات فعّالة لهذا الفحص. ${isAdmin() ? '<a href="#/setup">أضف لوت QC</a>' : 'اطلب من المدير إضافة لوت.'}</div>`; return; }
    box.innerHTML = '<div class="loader"></div>';
    // آخر 12 نتيجة لكل لوت للتقييم التراكمي
    const hist = {};
    await Promise.all(lots.map(async l => {
      const rows = await q(sb.from('qc_results').select('value,run_at').eq('lot_id', l.id).order('run_at', { ascending: false }).limit(12));
      hist[l.id] = rows.reverse().map(r => S.zScore(r.value, l.target_mean, l.target_sd));
    }));
    const d = dec(t);
    box.innerHTML = `<div class="card"><h3><i class="fa-solid fa-vials"></i> ${esc(t.name)} <span class="muted" style="font-size:13px">${esc(analyzerName(t.analyzer_id))} · TEa ${S.fmt(t.tea, 1)}%</span></h3>
      <div class="grid ${lots.length >= 3 ? 'g3' : 'g2'}">${lots.map(l => {
        const exp = l.expiry && new Date(l.expiry) < new Date();
        return `<div class="level-card" data-lot="${l.id}">
          <div style="display:flex;justify-content:space-between"><b>${esc(l.level)}</b><span class="muted ltr" style="font-size:12px">Lot ${esc(l.lot_number)}</span></div>
          ${exp ? '<div class="badge bad" style="margin-top:6px">منتهي الصلاحية</div>' : ''}
          <div class="field" style="margin:10px 0 0"><input type="number" step="any" dir="ltr" placeholder="النتيجة ${esc(t.unit || '')}" class="lv"></div>
          <div class="ranges num">x̄ ${S.fmt(l.target_mean, d)} · SD ${S.fmt(l.target_sd, d)} · ±2SD [${S.fmt(l.target_mean - 2 * l.target_sd, d)} – ${S.fmt(l.target_mean + 2 * l.target_sd, d)}]</div>
          <div class="eval"></div></div>`; }).join('')}</div>
      <div class="grid g2" style="margin-top:14px">
        <div class="field"><label>ملاحظة (اختياري)</label><textarea id="cm" placeholder="رقم الكواشف، المعايرة، ..."></textarea></div>
        <div class="field" id="cawrap"><label>الإجراء التصحيحي <span class="muted">(إلزامي عند الرفض)</span></label><textarea id="ca" placeholder="مثال: إعادة المعايرة، تغيير الكاشف، إعادة الفحص بمادة جديدة، إيقاف إصدار النتائج..."></textarea></div>
      </div>
      <div id="sum"></div>
      <button class="btn primary" id="save"><i class="fa-solid fa-floppy-disk"></i> حفظ التشغيل</button></div>`;

    const evaluateAll = () => {
      const cards = $$('.level-card', box);
      const zs = cards.map(c => { const l = lotById(+c.dataset.lot), v = parseFloat($('.lv', c).value); return isFinite(v) ? S.zScore(v, l.target_mean, l.target_sd) : null; });
      const results = cards.map((c, i) => {
        if (zs[i] == null) { $('.eval', c).innerHTML = ''; return null; }
        const l = lotById(+c.dataset.lot);
        const peers = zs.filter((z, j) => j !== i && z != null);
        const ev = S.evaluateWestgard([...hist[l.id], zs[i]], t.rules || S.DEFAULT_RULES, peers);
        $('.eval', c).innerHTML = `<div class="num" style="margin-bottom:4px">Z = ${S.fmt(zs[i], 2)}</div>${statusBadge(ev.status)} ${rulesHtml(ev.violated)}`;
        c.style.borderColor = ev.status === 'reject' ? 'var(--bad)' : ev.status === 'warning' ? 'var(--warn)' : 'var(--ok)';
        return { lot: l, value: parseFloat($('.lv', c).value), z: zs[i], ...ev };
      });
      const anyReject = results.some(r => r?.status === 'reject');
      $('#sum').innerHTML = anyReject
        ? `<div class="alert bad"><i class="fa-solid fa-hand"></i><div><b>التشغيل مرفوض</b> — أوقف إصدار نتائج المرضى لهذا الفحص، ابحث عن السبب (${[...new Set(results.flatMap(r => r?.violated || []))].filter(x => S.RULES[x]?.type === 'reject').map(x => S.RULES[x].desc).join('؛ ')})، صحّح، ثم أعد تشغيل QC. راجع عينات المرضى منذ آخر QC مقبول.</div></div>`
        : results.some(r => r?.status === 'warning') ? '<div class="alert warn"><i class="fa-solid fa-triangle-exclamation"></i>تحذير 1₂ₛ — افحص بقية القواعد؛ التشغيل مقبول إن لم تُخرق قاعدة رفض.</div>' : '';
      return results;
    };
    $$('.lv', box).forEach(i => i.oninput = evaluateAll);

    $('#save').onclick = async () => {
      const results = evaluateAll().filter(Boolean);
      if (!results.length) return toast('أدخل نتيجة واحدة على الأقل', 'bad');
      const ca = $('#ca').value.trim();
      if (results.some(r => r.status === 'reject') && !ca) { $('#ca').focus(); return toast('الإجراء التصحيحي إلزامي عند رفض التشغيل', 'bad'); }
      const runAt = new Date($('#rat').value).toISOString();
      const rows = results.map(r => ({ lot_id: r.lot.id, test_id: testId, value: r.value, z: +r.z.toFixed(4), rules_violated: r.violated, status: r.status, run_at: runAt, comment: $('#cm').value.trim() || null, corrective_action: ca || null, entered_by: state.profile.id }));
      const btn = $('#save'); btn.disabled = true;
      try {
        await q(sb.from('qc_results').insert(rows));
        toast(`تم حفظ ${rows.length} نتيجة`, 'ok');
        loadLevels(testId);
      } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    };
  }
};

// ---------------- Levey-Jennings
VIEWS.lj = async view => {
  $('#vs').textContent = 'مخططات ضبط الجودة مع الإحصاء الوصفي';
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  view.innerHTML = `<div class="card no-print"><div class="row">
      <div><label>الفحص</label><select id="tsel">${testOptions(qs.get('test'))}</select></div>
      <div><label>العرض</label><select id="mode"><option value="lot">لوت واحد (قيم فعلية)</option><option value="z">كل المستويات (Z-score)</option></select></div>
      <div id="lotw"><label>المستوى / اللوت</label><select id="lsel"></select></div>
      <div><label>من</label><input type="date" id="from" dir="ltr" value="${isoDate(daysAgo(30))}"></div>
      <div><label>إلى</label><input type="date" id="to" dir="ltr" value="${isoDate(new Date())}"></div>
      <button class="btn primary" id="go"><i class="fa-solid fa-chart-line"></i> عرض</button>
    </div></div><div id="out"></div>`;
  const fillLots = () => {
    const lots = state.lots.filter(l => l.test_id === +$('#tsel').value);
    $('#lsel').innerHTML = opts(lots, null, l => `${l.level} · ${l.lot_number}${l.active ? '' : ' (غير فعّال)'}`);
  };
  $('#tsel').onchange = () => { fillLots(); draw(); };
  $('#mode').onchange = () => { $('#lotw').classList.toggle('hidden', $('#mode').value === 'z'); draw(); };
  $('#lsel').onchange = draw; $('#go').onclick = draw;
  fillLots();
  if ($('#tsel').value) draw();

  async function draw() {
    destroyCharts();
    const out = $('#out'), testId = +$('#tsel').value;
    if (!testId) { out.innerHTML = '<div class="empty"><i class="fa-solid fa-chart-line"></i>اختر فحصاً</div>'; return; }
    const t = testById(testId), d = dec(t);
    out.innerHTML = '<div class="loader"></div>';
    const from = $('#from').value, to = $('#to').value;

    if ($('#mode').value === 'z') {
      const lots = state.lots.filter(l => l.test_id === testId);
      const res = await fetchResults({ testId, from, to });
      const colors = ['#5aa9ff', '#f2b632', '#c084fc', '#3ecf8e', '#ff8a65'];
      const labels = [...new Set(res.map(r => fdt(r.run_at)))];
      out.innerHTML = `<div class="card"><h3><i class="fa-solid fa-chart-line"></i> ${esc(t.name)} — مخطط Z-score لكل المستويات</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>`;
      const sdLines = [3, 2, 1, 0, -1, -2, -3].map(k => ({ label: k ? `${k > 0 ? '+' : ''}${k}SD` : 'Mean', data: labels.map(() => k), borderColor: Math.abs(k) === 3 ? '#ff5d5d' : Math.abs(k) === 2 ? '#f2b632' : k === 0 ? '#3ecf8e' : '#4b556a', borderDash: k ? [5, 5] : [], borderWidth: 1, pointRadius: 0, fill: false }));
      state.charts.push(new Chart($('#c1'), {
        type: 'line',
        data: { labels, datasets: [...lots.map((l, i) => ({ label: lotLabel(l), data: labels.map(lb => { const r = res.find(r => r.lot_id === l.id && fdt(r.run_at) === lb); return r ? S.zScore(r.value, l.target_mean, l.target_sd) : null; }), borderColor: colors[i % 5], backgroundColor: colors[i % 5], spanGaps: true, tension: 0, pointRadius: 4 })), ...sdLines] },
        options: { ...chartBase(), scales: { ...chartBase().scales, y: { ...chartBase().scales.y, min: -4, max: 4 } }, plugins: { legend: { labels: { color: '#8d97ab', filter: it => !/SD|Mean/.test(it.text) } } } },
      }));
      return;
    }

    const lot = lotById(+$('#lsel').value);
    if (!lot) { out.innerHTML = '<div class="empty">لا توجد لوتات</div>'; return; }
    const res = await fetchResults({ lotId: lot.id, from, to });
    const vals = res.map(r => +r.value), accepted = res.filter(r => r.status !== 'reject').map(r => +r.value);
    const st = S.describe(accepted, lot.target_mean, lot.target_sd);
    const sig = S.sigmaMetric(t.tea, st.bias, st.cv), cat = S.sigmaCategory(sig);
    const g = S.grubbs(accepted);
    const cum = await fetchResults({ lotId: lot.id }); // تراكمي كامل اللوت
    const cumAcc = cum.filter(r => r.status !== 'reject').map(r => +r.value);
    const cst = S.describe(cumAcc, lot.target_mean, lot.target_sd);

    out.innerHTML = `
    <div class="print-only"><h2>${esc(LAB_NAME)} — Levey-Jennings</h2></div>
    <div class="card"><h3><i class="fa-solid fa-chart-line"></i> ${esc(t.name)} — ${esc(lot.level)} <span class="muted ltr" style="font-size:13px">Lot ${esc(lot.lot_number)} · Exp ${fd(lot.expiry)}</span>
      <span style="margin-inline-start:auto" class="no-print"><button class="btn sm" id="png"><i class="fa-solid fa-image"></i> PNG</button> <button class="btn sm" onclick="print()"><i class="fa-solid fa-print"></i></button></span></h3>
      ${res.length ? '<div class="chart-box"><canvas id="c1"></canvas></div>' : '<div class="empty"><i class="fa-solid fa-chart-line"></i>لا توجد نتائج في هذه الفترة</div>'}
    </div>
    <div class="grid g2">
      <div class="card"><h3><i class="fa-solid fa-calculator"></i> الإحصاء (النتائج المقبولة)</h3>
        <div class="tbl-wrap"><table><thead><tr><th>المعامل</th><th>المستهدف</th><th>الفترة</th><th>تراكمي اللوت</th></tr></thead><tbody>
          <tr><td>N</td><td>—</td><td class="num">${st.n}</td><td class="num">${cst.n}</td></tr>
          <tr><td>المتوسط Mean</td><td class="num">${S.fmt(lot.target_mean, d)}</td><td class="num">${S.fmt(st.mean, d)}</td><td class="num">${S.fmt(cst.mean, d)}</td></tr>
          <tr><td>الانحراف المعياري SD</td><td class="num">${S.fmt(lot.target_sd, d)}</td><td class="num">${S.fmt(st.sd, d)}</td><td class="num">${S.fmt(cst.sd, d)}</td></tr>
          <tr><td>CV%</td><td class="num">${S.fmt(lot.target_sd / lot.target_mean * 100, 2)}</td><td class="num">${S.fmt(st.cv, 2)}</td><td class="num">${S.fmt(cst.cv, 2)}</td></tr>
          <tr><td>Bias%</td><td>—</td><td class="num">${S.fmt(st.bias, 2)}</td><td class="num">${S.fmt(cst.bias, 2)}</td></tr>
          <tr><td>SD الفعلي ÷ المستهدف</td><td>—</td><td class="num">${S.fmt(st.sdRatio, 2)}</td><td class="num">${S.fmt(cst.sdRatio, 2)}</td></tr>
          <tr><td>Min – Max</td><td>—</td><td class="num">${S.fmt(st.min, d)} – ${S.fmt(st.max, d)}</td><td class="num">${S.fmt(cst.min, d)} – ${S.fmt(cst.max, d)}</td></tr>
        </tbody></table></div>
        ${isAdmin() && cst.n >= 20 ? `<button class="btn sm no-print" id="setlab" style="margin-top:10px"><i class="fa-solid fa-arrows-rotate"></i> اعتماد المتوسط و SD التراكمي كقيم مستهدفة للمختبر (n=${cst.n})</button>` : ''}
        ${cst.n < 20 ? `<p class="muted" style="font-size:12px">يُوصى بـ 20 نقطة على الأقل لتأسيس متوسط و SD خاص بالمختبر (CLSI C24).</p>` : ''}
      </div>
      <div class="card"><h3><i class="fa-solid fa-bullseye"></i> تقييم الأداء</h3>
        <div class="grid g2" style="gap:10px">
          <div class="kpi"><div class="l">Sigma (الفترة)</div><div class="v num">${S.fmt(sig, 2)}</div><span class="badge ${cat.cls}">${cat.label}</span></div>
          <div class="kpi"><div class="l">النتائج المرفوضة</div><div class="v num">${res.filter(r => r.status === 'reject').length} / ${res.length}</div></div>
        </div>
        <p class="muted" style="font-size:13px;margin-top:12px">TEa = ${S.fmt(t.tea, 1)}% ${t.tea_source ? `(${esc(t.tea_source)})` : ''} · Sigma = (TEa − |Bias|) ÷ CV</p>
        ${g ? `<div class="alert ${g.outlier ? 'warn' : 'ok'}" style="margin-top:8px"><i class="fa-solid fa-magnifying-glass-chart"></i><div>اختبار Grubbs للقيم الشاذة: G = <span class="num">${S.fmt(g.G, 3)}</span> (الحرجة <span class="num">${S.fmt(g.crit, 3)}</span>) — ${g.outlier ? `القيمة <b class="num">${S.fmt(g.value, d)}</b> شاذة إحصائياً` : 'لا توجد قيم شاذة'}</div></div>` : ''}
        ${st.sdRatio > 1.5 ? '<div class="alert warn"><i class="fa-solid fa-circle-exclamation"></i>SD الفعلي أعلى بكثير من المستهدف — راجع التكرارية أو أعد تقدير SD.</div>' : ''}
        ${st.sdRatio < 0.5 && st.n >= 10 ? '<div class="alert info"><i class="fa-solid fa-circle-info"></i>SD المستهدف واسع جداً مقارنة بالأداء الفعلي — هذا يقلل حساسية كشف الأخطاء؛ يُنصح باعتماد SD المختبر.</div>' : ''}
      </div>
    </div>
    <div class="card"><h3><i class="fa-solid fa-table"></i> النتائج</h3>${tableResults([...res].reverse())}</div>`;
    bindResultRows(out, draw);

    if (res.length) {
      const labels = res.map(r => fdt(r.run_at));
      const line = (k, color, dash) => ({ label: k, data: labels.map(() => lot.target_mean + ({ '+3SD': 3, '+2SD': 2, '+1SD': 1, 'Mean': 0, '-1SD': -1, '-2SD': -2, '-3SD': -3 }[k]) * lot.target_sd), borderColor: color, borderDash: dash, borderWidth: 1, pointRadius: 0, fill: false });
      const pc = res.map(r => r.status === 'reject' ? '#ff5d5d' : r.status === 'warning' ? '#f2b632' : '#5aa9ff');
      state.charts.push(new Chart($('#c1'), {
        type: 'line',
        data: { labels, datasets: [
          { label: 'النتيجة', data: vals, borderColor: '#5aa9ff', pointBackgroundColor: pc, pointBorderColor: pc, pointRadius: 5, pointHoverRadius: 7, tension: 0 },
          line('+3SD', '#ff5d5d', [6, 4]), line('+2SD', '#f2b632', [6, 4]), line('+1SD', '#4b556a', [3, 3]),
          line('Mean', '#3ecf8e', []), line('-1SD', '#4b556a', [3, 3]), line('-2SD', '#f2b632', [6, 4]), line('-3SD', '#ff5d5d', [6, 4])] },
        options: { ...chartBase(), plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: c => c.datasetIndex === 0 ? `Z = ${S.fmt(S.zScore(vals[c.dataIndex], lot.target_mean, lot.target_sd), 2)}  ${(res[c.dataIndex].rules_violated || []).join(' ')}` : '' } } },
          scales: { ...chartBase().scales, y: { ...chartBase().scales.y, suggestedMin: lot.target_mean - 4 * lot.target_sd, suggestedMax: lot.target_mean + 4 * lot.target_sd } } },
      }));
      $('#png').onclick = () => { const a = document.createElement('a'); a.href = $('#c1').toDataURL('image/png'); a.download = `LJ_${t.name}_${lot.level}.png`; a.click(); };
    }
    $('#setlab')?.addEventListener('click', async () => {
      if (!confirm(`اعتماد Mean = ${S.fmt(cst.mean, d)} و SD = ${S.fmt(cst.sd, d)} كقيم مستهدفة لهذا اللوت؟`)) return;
      try {
        await q(sb.from('qc_lots').update({ target_mean: +cst.mean.toFixed(6), target_sd: +cst.sd.toFixed(6), mean_source: 'lab' }).eq('id', lot.id));
        await loadRefs(); toast('تم تحديث القيم المستهدفة', 'ok'); draw();
      } catch (e) { toast(e.message, 'bad'); }
    });
  }
};

// ---------------- Results log
VIEWS.results = async view => {
  view.innerHTML = `<div class="card no-print"><div class="row">
    <div><label>الفحص</label><select id="tsel">${testOptions('', 'كل الفحوص')}</select></div>
    <div><label>الحالة</label><select id="st"><option value="">الكل</option><option value="reject">مرفوض</option><option value="warning">تحذير</option><option value="accept">مقبول</option></select></div>
    <div><label>من</label><input type="date" id="from" dir="ltr" value="${isoDate(daysAgo(7))}"></div>
    <div><label>إلى</label><input type="date" id="to" dir="ltr" value="${isoDate(new Date())}"></div>
    <div><label>المراجعة</label><select id="rv"><option value="">الكل</option><option value="no">غير مُراجع</option></select></div>
    <button class="btn primary" id="go"><i class="fa-solid fa-filter"></i> تصفية</button>
    <button class="btn" id="csv"><i class="fa-solid fa-file-csv"></i> CSV</button></div></div><div id="out"></div>`;
  let rows = [];
  const load = async () => {
    $('#out').innerHTML = '<div class="loader"></div>';
    rows = await fetchResults({ testId: +$('#tsel').value || null, status: $('#st').value || null, from: $('#from').value, to: $('#to').value });
    if ($('#rv').value === 'no') rows = rows.filter(r => r.status !== 'accept' && !r.reviewed_by);
    rows.reverse();
    $('#out').innerHTML = `<div class="card"><h3><i class="fa-solid fa-list"></i> ${rows.length} نتيجة <span class="muted" style="font-size:13px">— اضغط على أي صف للتفاصيل${isAdmin() ? ' والمراجعة' : ''}</span></h3>${tableResults(rows)}</div>`;
    bindResultRows($('#out'), load);
  };
  $('#go').onclick = load;
  $('#csv').onclick = () => downloadCSV('qc_results.csv', [['Date', 'Test', 'Unit', 'Level', 'Lot', 'Value', 'Target Mean', 'Target SD', 'Z', 'Rules', 'Status', 'Comment', 'Corrective action', 'Entered by', 'Reviewed by'],
    ...rows.map(r => { const t = testById(r.test_id), l = lotById(r.lot_id); return [fdt(r.run_at), t?.name, t?.unit, l?.level, l?.lot_number, r.value, l?.target_mean, l?.target_sd, S.fmt(r.z, 3), (r.rules_violated || []).join(' '), r.status, r.comment, r.corrective_action, userName(r.entered_by), r.reviewed_by ? userName(r.reviewed_by) : '']; })]);
  load();
};

// ---------------- Six Sigma
function computeTestPerformance(res, eqa, biasSource) {
  // يرجع صفاً لكل لوت فعّال لديه بيانات
  return state.lots.filter(l => testById(l.test_id)?.active).map(l => {
    const t = testById(l.test_id);
    const vals = res.filter(r => r.lot_id === l.id && r.status !== 'reject').map(r => +r.value);
    if (vals.length < 2) return null;
    const st = S.describe(vals, l.target_mean, l.target_sd);
    let bias = st.bias;
    if (biasSource === 'eqa') {
      const devs = eqa.filter(e => e.test_id === t.id).map(e => +e.deviation_pct).filter(isFinite);
      bias = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : NaN;
    }
    const sigma = S.sigmaMetric(t.tea, bias, st.cv);
    return { t, l, st, bias, sigma, qgi: S.qgi(bias, st.cv), cat: S.sigmaCategory(sigma), rec: S.sigmaQcRecommendation(sigma, state.lots.filter(x => x.test_id === t.id && x.active).length) };
  }).filter(Boolean);
}

VIEWS.sigma = async view => {
  $('#vs').textContent = 'Sigma = (TEa − |Bias|) ÷ CV  ·  Westgard Sigma Rules™';
  view.innerHTML = `<div class="card no-print"><div class="row">
    <div><label>من</label><input type="date" id="from" dir="ltr" value="${isoDate(daysAgo(90))}"></div>
    <div><label>إلى</label><input type="date" id="to" dir="ltr" value="${isoDate(new Date())}"></div>
    <div><label>مصدر الانحياز Bias</label><select id="bs"><option value="iqc">IQC (مقابل المتوسط المستهدف)</option><option value="eqa">EQA (متوسط الانحراف عن هدف المقارنة)</option></select></div>
    <button class="btn primary" id="go"><i class="fa-solid fa-calculator"></i> احسب</button>
    <button class="btn" onclick="print()"><i class="fa-solid fa-print"></i></button></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">ملاحظة: تحديد Bias من EQA أو مادة مرجعية أدق من IQC عندما يكون المتوسط المستهدف مأخوذاً من بيانات المختبر نفسه.</p></div><div id="out"></div>`;
  const run = async () => {
    destroyCharts();
    $('#out').innerHTML = '<div class="loader"></div>';
    const from = $('#from').value, to = $('#to').value;
    const [res, eqa] = await Promise.all([fetchResults({ from, to }), q(sb.from('eqa_results').select('*').gte('event_date', from).lte('event_date', to))]);
    const rows = computeTestPerformance(res, eqa, $('#bs').value);
    if (!rows.length) { $('#out').innerHTML = '<div class="empty"><i class="fa-solid fa-bullseye"></i>لا توجد بيانات كافية في هذه الفترة</div>'; return; }
    const count = c => rows.filter(r => r.cat.cls === c).length;
    $('#out').innerHTML = `
      <div class="grid g4"><div class="kpi ok"><div class="l">≥ 5σ</div><div class="v num">${rows.filter(r => r.sigma >= 5).length}</div></div>
      <div class="kpi info"><div class="l">4 – 5σ</div><div class="v num">${rows.filter(r => r.sigma >= 4 && r.sigma < 5).length}</div></div>
      <div class="kpi warn"><div class="l">3 – 4σ</div><div class="v num">${rows.filter(r => r.sigma >= 3 && r.sigma < 4).length}</div></div>
      <div class="kpi bad"><div class="l">&lt; 3σ</div><div class="v num">${rows.filter(r => !(r.sigma >= 3)).length}</div></div></div>
      <div class="card" style="margin-top:18px"><h3><i class="fa-solid fa-chart-area"></i> مخطط قرار الطريقة المُعيَّر (Normalized Method Decision Chart)</h3>
        <div class="chart-box"><canvas id="c1"></canvas></div>
        <p class="muted" style="font-size:12px">المحور الأفقي: CV كنسبة من TEa · العمودي: |Bias| كنسبة من TEa. كل خط يمثل مستوى سيغما؛ النقاط أسفل خط 6σ ممتازة.</p></div>
      <div class="card"><h3><i class="fa-solid fa-table"></i> أداء الفحوص والتوصيات</h3><div class="tbl-wrap"><table><thead><tr>
        <th>الفحص</th><th>المستوى</th><th>N</th><th>CV%</th><th>Bias%</th><th>TEa%</th><th>Sigma</th><th>التصنيف</th><th>QGI / المشكلة</th><th>قواعد QC الموصى بها</th><th>N / التكرار</th></tr></thead><tbody>
        ${rows.sort((a, b) => (a.sigma || 0) - (b.sigma || 0)).map(r => `<tr><td>${esc(r.t.name)}</td><td>${esc(r.l.level)}</td><td class="num">${r.st.n}</td><td class="num">${S.fmt(r.st.cv, 2)}</td><td class="num">${S.fmt(r.bias, 2)}</td><td class="num">${S.fmt(r.t.tea, 1)}</td>
          <td class="num"><b>${S.fmt(r.sigma, 2)}</b></td><td><span class="badge ${r.cat.cls}">${r.cat.label}</span></td>
          <td class="wrap">${r.sigma < 6 ? `<span class="num">${S.fmt(r.qgi.value, 2)}</span> — ${r.qgi.problem}` : '—'}</td>
          <td>${r.rec ? r.rec.rules.map(x => `<span class="rule w">${S.RULES[x].label}</span>`).join('') : '—'}</td>
          <td class="wrap">${r.rec ? `N=${r.rec.n} · ${r.rec.freq}` : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="alert info" style="margin-top:12px"><i class="fa-solid fa-lightbulb"></i><div>QGI &lt; 0.8 → المشكلة في الدقة (Imprecision) · QGI &gt; 1.2 → المشكلة في الصحة (Bias) · بينهما → الاثنان. الفحوص تحت 4σ تحتاج خطة تحسين موثقة ضمن نظام إدارة الجودة (ISO 15189:2022 §7.3.7 و §8.7).</div></div>
      </div>`;
    // decision chart
    const xs = rows.map(r => ({ x: r.st.cv / r.t.tea * 100, y: Math.abs(r.bias) / r.t.tea * 100, label: `${r.t.name} ${r.l.level}` })).filter(p => isFinite(p.x) && isFinite(p.y));
    const sigLine = (s, color) => ({ type: 'line', label: `${s}σ`, data: [{ x: 0, y: 100 }, { x: 100 / s, y: 0 }], borderColor: color, borderWidth: 1.5, pointRadius: 0, fill: false });
    state.charts.push(new Chart($('#c1'), {
      type: 'scatter',
      data: { datasets: [{ label: 'الفحوص', data: xs, backgroundColor: '#f2b632', pointRadius: 6 }, sigLine(6, '#3ecf8e'), sigLine(5, '#5aa9ff'), sigLine(4, '#c084fc'), sigLine(3, '#f2b632'), sigLine(2, '#ff5d5d')] },
      options: { ...chartBase(), plugins: { legend: { labels: { color: '#8d97ab' } }, tooltip: { callbacks: { label: c => c.raw.label ? `${c.raw.label}: CV ${S.fmt(c.raw.x, 0)}% · Bias ${S.fmt(c.raw.y, 0)}% من TEa` : '' } } },
        scales: { x: { min: 0, max: 50, title: { display: true, text: 'CV / TEa (%)', color: '#8d97ab' }, ticks: { color: '#8d97ab' }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { min: 0, max: 100, title: { display: true, text: '|Bias| / TEa (%)', color: '#8d97ab' }, ticks: { color: '#8d97ab' }, grid: { color: 'rgba(255,255,255,.05)' } } } },
    }));
  };
  $('#go').onclick = run; run();
};

// ---------------- EQA
VIEWS.eqa = async view => {
  $('#vs').textContent = 'برامج المقارنة بين المختبرات / اختبارات الكفاءة (PT)';
  view.innerHTML = `<div class="card no-print"><div class="row">
    <div><label>الفحص</label><select id="tsel">${testOptions('', 'كل الفحوص')}</select></div>
    <div><label>من</label><input type="date" id="from" dir="ltr" value="${isoDate(daysAgo(365))}"></div>
    <div><label>إلى</label><input type="date" id="to" dir="ltr" value="${isoDate(new Date())}"></div>
    <button class="btn" id="go"><i class="fa-solid fa-filter"></i> عرض</button>
    <button class="btn primary" id="add"><i class="fa-solid fa-plus"></i> إدخال نتيجة EQA</button>
    <button class="btn" id="csv"><i class="fa-solid fa-file-csv"></i></button></div></div><div id="out"></div>`;
  let rows = [];
  const load = async () => {
    destroyCharts();
    let qq = sb.from('eqa_results').select('*').gte('event_date', $('#from').value).lte('event_date', $('#to').value).order('event_date');
    if (+$('#tsel').value) qq = qq.eq('test_id', +$('#tsel').value);
    rows = await q(qq);
    const acc = rows.filter(r => r.acceptable === true).length, judged = rows.filter(r => r.acceptable != null).length;
    $('#out').innerHTML = `<div class="grid g3">
      <div class="kpi info"><div class="l">عدد العينات</div><div class="v num">${rows.length}</div></div>
      <div class="kpi ok"><div class="l">نسبة المقبول</div><div class="v num">${judged ? S.fmt(acc / judged * 100, 1) : '—'}%</div></div>
      <div class="kpi bad"><div class="l">غير مقبول</div><div class="v num">${judged - acc}</div></div></div>
      ${rows.some(r => r.sdi != null) ? '<div class="card" style="margin-top:18px"><h3><i class="fa-solid fa-chart-column"></i> مؤشر الانحراف المعياري SDI</h3><div class="chart-box sm"><canvas id="c1"></canvas></div></div>' : ''}
      <div class="card" style="margin-top:18px"><h3><i class="fa-solid fa-table"></i> النتائج</h3>${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>الفحص</th><th>المزود/الدورة</th><th>العينة</th><th>نتيجتنا</th><th>الهدف</th><th>SD المجموعة</th><th>الانحراف%</th><th>SDI</th><th>التقييم</th><th></th></tr></thead><tbody>
      ${[...rows].reverse().map(r => { const t = testById(r.test_id); const sdiCls = r.sdi == null ? 'muted' : Math.abs(r.sdi) <= 1 ? 'ok' : Math.abs(r.sdi) <= 2 ? 'info' : Math.abs(r.sdi) <= 3 ? 'warn' : 'bad'; return `<tr>
        <td class="num">${fd(r.event_date)}</td><td>${esc(t?.name)}</td><td>${esc(r.provider || '')} ${esc(r.cycle || '')}</td><td class="ltr">${esc(r.sample_id || '')}</td>
        <td class="num">${S.fmt(r.lab_value, dec(t))}</td><td class="num">${S.fmt(r.target_value, dec(t))}</td><td class="num">${S.fmt(r.peer_sd, dec(t))}</td>
        <td class="num">${S.fmt(r.deviation_pct, 2)}</td><td><span class="badge ${sdiCls} num">${S.fmt(r.sdi, 2)}</span></td>
        <td>${r.acceptable == null ? '—' : r.acceptable ? '<span class="badge ok">مقبول</span>' : '<span class="badge bad">غير مقبول</span>'}</td>
        <td>${isAdmin() ? `<button class="btn sm danger" data-del="${r.id}"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty"><i class="fa-solid fa-globe"></i>لا توجد نتائج EQA</div>'}
      <p class="muted" style="font-size:12px;margin-top:10px">التقييم: |الانحراف| ≤ TEa، أو |SDI| ≤ 2 عند عدم تحديد TEa. ‎|SDI| ≤1 ممتاز · ≤2 مقبول · 2–3 تحذير/مراجعة · &gt;3 غير مقبول ويتطلب تحقيقاً وإجراءً تصحيحياً.</p></div>`;
    $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('حذف؟')) return; await q(sb.from('eqa_results').delete().eq('id', b.dataset.del)); load(); });
    if ($('#c1')) {
      const pts = rows.filter(r => r.sdi != null);
      state.charts.push(new Chart($('#c1'), { type: 'bar',
        data: { labels: pts.map(r => `${testById(r.test_id)?.name} ${fd(r.event_date)}`), datasets: [{ label: 'SDI', data: pts.map(r => r.sdi), backgroundColor: pts.map(r => Math.abs(r.sdi) > 3 ? '#ff5d5d' : Math.abs(r.sdi) > 2 ? '#f2b632' : '#3ecf8e') }] },
        options: { ...chartBase(), plugins: { legend: { display: false } }, scales: { ...chartBase().scales, y: { ...chartBase().scales.y, suggestedMin: -3, suggestedMax: 3 } } } }));
    }
  };
  $('#go').onclick = load;
  $('#csv').onclick = () => downloadCSV('eqa_results.csv', [['Date', 'Test', 'Provider', 'Cycle', 'Sample', 'Lab', 'Target', 'Peer SD', 'Deviation %', 'SDI', 'Acceptable'],
    ...rows.map(r => [r.event_date, testById(r.test_id)?.name, r.provider, r.cycle, r.sample_id, r.lab_value, r.target_value, r.peer_sd, S.fmt(r.deviation_pct, 2), S.fmt(r.sdi, 2), r.acceptable])]);
  $('#add').onclick = () => formModal({
    title: 'إدخال نتيجة EQA',
    fields: [
      { k: 'test_id', label: 'الفحص', type: 'select', required: true, options: v => testOptions(v), num: true },
      { k: 'event_date', label: 'التاريخ', type: 'date', required: true, default: isoDate(new Date()) },
      { k: 'provider', label: 'مزود البرنامج', hint: 'CAP / RIQAS / Bio-Rad EQAS / UK NEQAS ...' },
      { k: 'cycle', label: 'الدورة/الحدث' },
      { k: 'sample_id', label: 'رقم العينة' },
      { k: 'lab_value', label: 'نتيجة المختبر', type: 'number', step: 'any', required: true },
      { k: 'target_value', label: 'القيمة المستهدفة (متوسط المجموعة)', type: 'number', step: 'any', required: true },
      { k: 'peer_sd', label: 'SD المجموعة', type: 'number', step: 'any' },
      { k: 'comment', label: 'ملاحظة / إجراء', type: 'textarea', full: true },
    ],
    onSave: async d => {
      const t = testById(d.test_id);
      const ev = S.eqaEval({ labValue: d.lab_value, targetValue: d.target_value, peerSd: d.peer_sd, tea: t?.tea });
      await q(sb.from('eqa_results').insert({ ...d, deviation_pct: +ev.deviation.toFixed(4), sdi: ev.sdi == null ? null : +ev.sdi.toFixed(4), acceptable: ev.acceptable, entered_by: state.profile.id }));
      toast(`تم الحفظ — الانحراف ${S.fmt(ev.deviation, 2)}%${ev.sdi != null ? ` · SDI ${S.fmt(ev.sdi, 2)}` : ''}`, ev.acceptable === false ? 'bad' : 'ok');
      load();
    },
  });
  load();
};

// ---------------- Measurement Uncertainty
VIEWS.mu = async view => {
  $('#vs').textContent = 'ISO 15189:2022 §7.3.4 — منهجية Top-down (ISO/TS 20914)';
  view.innerHTML = `<div class="card no-print"><div class="row">
    <div><label>من</label><input type="date" id="from" dir="ltr" value="${isoDate(daysAgo(180))}"></div>
    <div><label>إلى</label><input type="date" id="to" dir="ltr" value="${isoDate(new Date())}"></div>
    <div><label>u(Cref) — عدم يقين قيمة المعايِر %</label><input type="number" step="any" id="ucal" dir="ltr" value="0"></div>
    <div><label>معامل التغطية k</label><select id="k"><option value="2">2 (≈95%)</option><option value="1.96">1.96</option><option value="3">3 (≈99%)</option></select></div>
    <button class="btn primary" id="go"><i class="fa-solid fa-calculator"></i> احسب</button><button class="btn" onclick="print()"><i class="fa-solid fa-print"></i></button></div></div><div id="out"></div>`;
  const run = async () => {
    const from = $('#from').value, to = $('#to').value, ucal = +$('#ucal').value || 0, k = +$('#k').value;
    $('#out').innerHTML = '<div class="loader"></div>';
    const [res, eqa] = await Promise.all([fetchResults({ from, to }), q(sb.from('eqa_results').select('*').gte('event_date', from).lte('event_date', to))]);
    const rows = state.lots.filter(l => testById(l.test_id)?.active).map(l => {
      const t = testById(l.test_id);
      const vals = res.filter(r => r.lot_id === l.id && r.status !== 'reject').map(r => +r.value);
      if (vals.length < 2) return null;
      const cvI = S.cv(vals);
      const devs = eqa.filter(e => e.test_id === t.id).map(e => +e.deviation_pct).filter(isFinite);
      const ub = devs.length ? S.biasUncertaintyFromEqa(devs) : 0;
      const mu = S.measurementUncertainty({ cvIqc: cvI, uBias: ub, uCal: ucal, k });
      const mean = S.mean(vals);
      return { t, l, n: vals.length, mean, cvI, ub, nE: devs.length, ...mu, abs: mean * mu.U / 100 };
    }).filter(Boolean);
    $('#out').innerHTML = rows.length ? `<div class="card"><h3><i class="fa-solid fa-ruler-combined"></i> تقدير عدم اليقين الموسّع</h3><div class="tbl-wrap"><table><thead><tr>
      <th>الفحص</th><th>المستوى</th><th>N</th><th>المتوسط</th><th>u(Rw) = CV%</th><th>u(bias)% (EQA)</th><th>uc%</th><th>U% (k=${k})</th><th>U مطلق</th><th>U مقابل TEa</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.t.name)}</td><td>${esc(r.l.level)}</td><td class="num">${r.n}</td><td class="num">${S.fmt(r.mean, dec(r.t))}</td><td class="num">${S.fmt(r.cvI, 2)}</td>
        <td class="num">${r.nE ? S.fmt(r.ub, 2) + ` <span class="muted">(n=${r.nE})</span>` : '<span class="muted">—</span>'}</td><td class="num">${S.fmt(r.uc, 2)}</td><td class="num"><b>${S.fmt(r.U, 2)}</b></td>
        <td class="num">± ${S.fmt(r.abs, dec(r.t))} ${esc(r.t.unit || '')}</td>
        <td>${r.t.tea ? (r.U <= r.t.tea ? '<span class="badge ok">ضمن TEa</span>' : '<span class="badge bad">يتجاوز TEa</span>') : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="alert info" style="margin-top:12px"><i class="fa-solid fa-square-root-variable"></i><div>u<sub>c</sub> = √( u(Rw)² + u(bias)² + u(Cref)² ) ، U = k × u<sub>c</sub> · u(Rw) من CV التراكمي لـ IQC (ستة أشهر على الأقل يُفضَّل)، و u(bias) = √(RMS<sub>bias</sub>²) من نتائج EQA. يجب مراجعة MU دورياً ومقارنته بمواصفات الأداء ومشاركته مع الأطباء عند الطلب.</div></div></div>`
      : '<div class="empty"><i class="fa-solid fa-ruler-combined"></i>لا توجد بيانات IQC كافية</div>';
  };
  $('#go').onclick = run; run();
};

// ---------------- Lot comparison (new lot verification / crossover)
VIEWS.compare = async view => {
  $('#vs').textContent = 'التحقق من لوت جديد مقابل اللوت الحالي (Crossover)';
  view.innerHTML = `<div class="card"><div class="row">
    <div><label>الفحص</label><select id="tsel">${testOptions()}</select></div>
    <div><label>اللوت (أ) — الحالي</label><select id="a"></select></div>
    <div><label>اللوت (ب) — الجديد</label><select id="b"></select></div>
    <button class="btn primary" id="go"><i class="fa-solid fa-code-compare"></i> قارن</button></div></div><div id="out"></div>`;
  const fill = () => { const lots = state.lots.filter(l => l.test_id === +$('#tsel').value); $('#a').innerHTML = $('#b').innerHTML = opts(lots, null, l => `${l.level} · ${l.lot_number}`); };
  $('#tsel').onchange = fill; fill();
  $('#go').onclick = async () => {
    const la = lotById(+$('#a').value), lb = lotById(+$('#b').value), t = testById(+$('#tsel').value);
    if (!la || !lb || la.id === lb.id) return toast('اختر لوتين مختلفين', 'bad');
    const [ra, rb] = await Promise.all([fetchResults({ lotId: la.id }), fetchResults({ lotId: lb.id })]);
    const a = ra.filter(r => r.status !== 'reject').map(r => +r.value), b = rb.filter(r => r.status !== 'reject').map(r => +r.value);
    if (a.length < 2 || b.length < 2) { $('#out').innerHTML = '<div class="alert warn">يلزم نتيجتان على الأقل لكل لوت (يُوصى بـ 10–20).</div>'; return; }
    const c = S.compareLots(a, b), d = dec(t);
    const ok = Math.abs(c.diffPct) <= (t.tea ? t.tea / 3 : 5);
    $('#out').innerHTML = `<div class="card"><div class="tbl-wrap"><table><thead><tr><th></th><th>اللوت (أ) ${esc(la.lot_number)}</th><th>اللوت (ب) ${esc(lb.lot_number)}</th></tr></thead><tbody>
      <tr><td>N</td><td class="num">${a.length}</td><td class="num">${b.length}</td></tr>
      <tr><td>Mean</td><td class="num">${S.fmt(c.meanA, d)}</td><td class="num">${S.fmt(c.meanB, d)}</td></tr>
      <tr><td>SD</td><td class="num">${S.fmt(c.sdA, d)}</td><td class="num">${S.fmt(c.sdB, d)}</td></tr>
      <tr><td>CV%</td><td class="num">${S.fmt(c.sdA / c.meanA * 100, 2)}</td><td class="num">${S.fmt(c.sdB / c.meanB * 100, 2)}</td></tr>
      <tr><td>المستهدف</td><td class="num">${S.fmt(la.target_mean, d)} ± ${S.fmt(la.target_sd, d)}</td><td class="num">${S.fmt(lb.target_mean, d)} ± ${S.fmt(lb.target_sd, d)}</td></tr></tbody></table></div>
      <div class="grid g3" style="margin-top:14px"><div class="kpi"><div class="l">فرق المتوسط %</div><div class="v num">${S.fmt(c.diffPct, 2)}</div></div>
      <div class="kpi"><div class="l">t (Welch)</div><div class="v num">${S.fmt(c.t, 2)}</div></div><div class="kpi"><div class="l">F (نسبة التباين)</div><div class="v num">${S.fmt(c.F, 2)}</div></div></div>
      <div class="alert ${ok ? 'ok' : 'warn'}" style="margin-top:12px"><i class="fa-solid fa-scale-balanced"></i><div>${ok ? 'الفرق ضمن الحد المقترح (⅓ TEa) — يمكن اعتماد اللوت الجديد.' : 'الفرق يتجاوز ⅓ TEa — تحقق من القيم المستهدفة للوت الجديد قبل اعتماده.'} ‎|t| &gt; 2 يشير لفرق جوهري إحصائياً في المتوسط تقريباً.</div></div></div>`;
  };
};

// ---------------- Monthly report
VIEWS.reports = async view => {
  const now = new Date();
  view.innerHTML = `<div class="card no-print"><div class="row">
    <div><label>الشهر</label><input type="month" id="m" dir="ltr" value="${now.getFullYear()}-${pad(now.getMonth() + 1)}"></div>
    <div><label>القسم</label><select id="dp">${opts(state.depts, '', x => x.name, 'كل الأقسام')}</select></div>
    <button class="btn primary" id="go"><i class="fa-solid fa-file-lines"></i> إنشاء</button>
    <button class="btn" onclick="print()"><i class="fa-solid fa-print"></i> طباعة / PDF</button>
    <button class="btn" id="csv"><i class="fa-solid fa-file-csv"></i> CSV</button></div></div><div id="out"></div>`;
  let data = [];
  const run = async () => {
    const [y, mo] = $('#m').value.split('-').map(Number);
    const from = `${y}-${pad(mo)}-01`, to = isoDate(new Date(y, mo, 0));
    const res = await fetchResults({ from, to });
    const dp = +$('#dp').value;
    data = state.lots.filter(l => { const t = testById(l.test_id); return t && (!dp || t.department_id === dp); }).map(l => {
      const t = testById(l.test_id), all = res.filter(r => r.lot_id === l.id);
      if (!all.length) return null;
      const acc = all.filter(r => r.status !== 'reject').map(r => +r.value);
      const st = S.describe(acc, l.target_mean, l.target_sd);
      const sig = S.sigmaMetric(t.tea, st.bias, st.cv);
      return { t, l, n: all.length, st, warn: all.filter(r => r.status === 'warning').length, rej: all.filter(r => r.status === 'reject').length, sig };
    }).filter(Boolean);
    const total = data.reduce((s, r) => s + r.n, 0), rej = data.reduce((s, r) => s + r.rej, 0);
    $('#out').innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div><h3 style="margin:0">${esc(LAB_NAME)} — تقرير ضبط الجودة الداخلي الشهري</h3><div class="muted num">${$('#m').value} ${dp ? '· ' + esc(deptName(dp)) : ''}</div></div>
        <div class="muted" style="font-size:13px">إجمالي النتائج: <b class="num">${total}</b> · المرفوض: <b class="num">${rej}</b> (${S.fmt(total ? rej / total * 100 : NaN, 1)}%)</div></div>
      ${data.length ? `<div class="tbl-wrap"><table><thead><tr><th>القسم</th><th>الفحص</th><th>المستوى</th><th>اللوت</th><th>N</th><th>Mean المستهدف</th><th>Mean</th><th>SD</th><th>CV%</th><th>Bias%</th><th>تحذير</th><th>رفض</th><th>Sigma</th></tr></thead><tbody>
      ${data.map(r => `<tr><td>${esc(deptName(r.t.department_id))}</td><td>${esc(r.t.name)}</td><td>${esc(r.l.level)}</td><td class="ltr">${esc(r.l.lot_number)}</td><td class="num">${r.n}</td>
        <td class="num">${S.fmt(r.l.target_mean, dec(r.t))}</td><td class="num">${S.fmt(r.st.mean, dec(r.t))}</td><td class="num">${S.fmt(r.st.sd, dec(r.t))}</td><td class="num">${S.fmt(r.st.cv, 2)}</td><td class="num">${S.fmt(r.st.bias, 2)}</td>
        <td class="num">${r.warn}</td><td class="num" style="${r.rej ? 'color:var(--bad)' : ''}">${r.rej}</td><td><span class="badge ${S.sigmaCategory(r.sig).cls} num">${S.fmt(r.sig, 1)}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا توجد بيانات لهذا الشهر</div>'}
      <div class="print-only" style="margin-top:40px;display:flex;justify-content:space-between"><span>أعدّه: ${esc(state.profile.full_name || '')}</span><span>مراجعة مدير الجودة: ______________</span><span>التاريخ: ${fd(new Date())}</span></div></div>`;
  };
  $('#go').onclick = run;
  $('#csv').onclick = () => downloadCSV(`qc_report_${$('#m').value}.csv`, [['Department', 'Test', 'Level', 'Lot', 'N', 'Target mean', 'Mean', 'SD', 'CV%', 'Bias%', 'Warnings', 'Rejects', 'Sigma'],
    ...data.map(r => [deptName(r.t.department_id), r.t.name, r.l.level, r.l.lot_number, r.n, r.l.target_mean, S.fmt(r.st.mean, 4), S.fmt(r.st.sd, 4), S.fmt(r.st.cv, 2), S.fmt(r.st.bias, 2), r.warn, r.rej, S.fmt(r.sig, 2)])]);
  run();
};

// ---------------- Guide
VIEWS.guide = async view => {
  view.innerHTML = `<div class="card"><h3><i class="fa-solid fa-book-medical"></i> قواعد Westgard</h3><div class="tbl-wrap"><table><thead><tr><th>القاعدة</th><th>النوع</th><th>الوصف</th></tr></thead><tbody>
    ${Object.entries(S.RULES).map(([k, r]) => `<tr><td><span class="rule ${r.type === 'warning' ? 'w' : ''}">${r.label}</span></td><td>${r.type === 'reject' ? '<span class="badge bad">رفض</span>' : '<span class="badge warn">تحذير</span>'}</td><td class="wrap">${r.desc}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="grid g2">
    <div class="card"><h3><i class="fa-solid fa-route"></i> عند رفض التشغيل</h3><ol style="line-height:2;margin:0;padding-inline-start:20px">
      <li>أوقف إصدار نتائج المرضى للفحص المتأثر.</li><li>حدّد نوع الخطأ: عشوائي (1₃ₛ، R₄ₛ) أم منهجي (2₂ₛ، 4₁ₛ، 10ₓ).</li>
      <li>افحص: الكواشف، المعايرة، مادة QC (تحضير/صلاحية/تخزين)، الجهاز والصيانة، الماء والحرارة.</li>
      <li>صحّح السبب ووثّق الإجراء التصحيحي.</li><li>أعد تشغيل QC وتأكد من القبول.</li>
      <li>قيّم أثر الخطأ على عينات المرضى منذ آخر QC مقبول، وأعد فحصها عند الحاجة (ISO 15189:2022 §7.3.7.2 و §7.5).</li></ol>
      <div class="alert warn" style="margin-top:12px"><i class="fa-solid fa-ban"></i>لا تكرر QC عشوائياً حتى "ينجح" — هذه ممارسة غير مقبولة.</div></div>
    <div class="card"><h3><i class="fa-solid fa-square-root-variable"></i> المعادلات</h3><div style="line-height:2.1" class="ltr">
      z = (x − x̄) / SD<br>CV% = SD / x̄ × 100<br>Bias% = (x̄<sub>lab</sub> − x̄<sub>target</sub>) / x̄<sub>target</sub> × 100<br>
      σ = (TEa% − |Bias%|) / CV%<br>QGI = |Bias%| / (1.5 × CV%)<br>SDI = (x<sub>lab</sub> − x̄<sub>peer</sub>) / SD<sub>peer</sub><br>
      u<sub>c</sub> = √(u(Rw)² + u(bias)² + u(Cref)²) , U = k·u<sub>c</sub><br>TE = |Bias| + 1.65·CV</div></div>
  </div>
  <div class="card"><h3><i class="fa-solid fa-scroll"></i> المراجع</h3><ul style="line-height:2;margin:0">
    <li>ISO 15189:2022 — §7.3.7 ضمان صحة نتائج الفحص (IQC & EQA)، §7.3.4 عدم اليقين.</li>
    <li>CLSI C24 — Statistical Quality Control for Quantitative Measurement Procedures.</li>
    <li>Westgard JO — Basic QC Practices; Westgard Sigma Rules™.</li>
    <li>CLIA 2024 Proficiency Testing acceptance limits · Ricos/EFLM Biological Variation Database (لتحديد TEa).</li>
    <li>ISO/TS 20914:2019 — Measurement uncertainty for medical laboratories.</li></ul></div>`;
};

// ---------------- Admin: users
VIEWS.users = async view => {
  await loadRefs();
  const pending = state.profiles.filter(p => p.status === 'pending').length;
  $('#vs').textContent = pending ? `${pending} حساب بانتظار الموافقة` : '';
  view.innerHTML = `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>القسم</th><th>تاريخ التسجيل</th><th></th></tr></thead><tbody>
    ${state.profiles.map(p => `<tr data-id="${p.id}">
      <td><input class="fn" value="${esc(p.full_name || '')}" style="min-width:150px"></td><td class="ltr">${esc(p.email)}</td>
      <td><select class="role" ${p.id === state.profile.id ? 'disabled' : ''}><option value="user" ${p.role === 'user' ? 'selected' : ''}>مستخدم</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>مدير</option></select></td>
      <td><select class="status" ${p.id === state.profile.id ? 'disabled' : ''}>${['pending', 'active', 'disabled'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${{ pending: '⏳ بانتظار', active: '✅ فعّال', disabled: '⛔ موقوف' }[s]}</option>`).join('')}</select></td>
      <td><select class="dept">${opts(state.depts, p.department_id, x => x.name, '—')}</select></td>
      <td class="num">${fd(p.created_at)}</td>
      <td><button class="btn sm primary sv"><i class="fa-solid fa-floppy-disk"></i></button>
        ${p.status === 'pending' ? '<button class="btn sm ap"><i class="fa-solid fa-check"></i> تفعيل</button>' : ''}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="muted" style="font-size:12px;margin-top:10px">لحذف حساب نهائياً: Supabase → Authentication → Users. الإيقاف (⛔) يمنع الوصول فوراً مع الحفاظ على سجل النتائج.</p></div>`;
  $$('tr[data-id]', view).forEach(tr => {
    const save = async (extra = {}) => {
      try {
        await q(sb.from('profiles').update({ full_name: $('.fn', tr).value, role: $('.role', tr).value, status: $('.status', tr).value, department_id: +$('.dept', tr).value || null, ...extra }).eq('id', tr.dataset.id));
        toast('تم الحفظ', 'ok'); route();
      } catch (e) { toast(e.message, 'bad'); }
    };
    $('.sv', tr).onclick = () => save();
    $('.ap', tr)?.addEventListener('click', () => save({ status: 'active' }));
  });
};

// ---------------- Admin: setup
VIEWS.setup = async view => {
  const tab = (new URLSearchParams(location.hash.split('?')[1] || '').get('tab')) || 'tests';
  const tabs = { tests: 'الفحوص', lots: 'لوتات QC', analyzers: 'الأجهزة', depts: 'الأقسام' };
  view.innerHTML = `<div class="tabs no-print" style="max-width:560px;margin-top:0">${Object.entries(tabs).map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div><div id="out"></div>`;
  $$('[data-t]', view).forEach(b => b.onclick = () => location.hash = `#/setup?tab=${b.dataset.t}`);
  const out = $('#out');
  const reload = async () => { await loadRefs(); route(); };
  const del = async (table, id) => { if (!confirm('حذف هذا العنصر؟ سيتم حذف البيانات المرتبطة به.')) return; try { await q(sb.from(table).delete().eq('id', id)); toast('تم الحذف', 'ok'); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const save = (table, id) => async d => { if (id) await q(sb.from(table).update(d).eq('id', id)); else await q(sb.from(table).insert(d)); toast('تم الحفظ', 'ok'); reload(); };
  const card = (title, addLabel, body) => `<div class="card"><h3>${title}<button class="btn sm primary" id="add" style="margin-inline-start:auto"><i class="fa-solid fa-plus"></i> ${addLabel}</button></h3>${body}</div>`;
  const actions = (id) => `<button class="btn sm" data-ed="${id}"><i class="fa-solid fa-pen"></i></button> <button class="btn sm danger" data-dl="${id}"><i class="fa-solid fa-trash"></i></button>`;

  if (tab === 'depts') {
    const F = [{ k: 'name', label: 'اسم القسم', required: true, full: true }];
    out.innerHTML = card('<i class="fa-solid fa-building"></i> الأقسام', 'قسم', `<div class="tbl-wrap"><table><thead><tr><th>القسم</th><th>الفحوص</th><th></th></tr></thead><tbody>
      ${state.depts.map(d => `<tr><td>${esc(d.name)}</td><td class="num">${state.tests.filter(t => t.department_id === d.id).length}</td><td>${actions(d.id)}</td></tr>`).join('')}</tbody></table></div>
      ${!state.depts.length ? '<p class="muted">اقتراح: الكيمياء السريرية، أمراض الدم، المناعة والهرمونات، التخثر، الغازات، الأحياء الدقيقة.</p>' : ''}`);
    $('#add').onclick = () => formModal({ title: 'قسم جديد', fields: F, onSave: save('departments') });
    $$('[data-ed]').forEach(b => b.onclick = () => formModal({ title: 'تعديل القسم', fields: F, data: state.depts.find(x => x.id == b.dataset.ed), onSave: save('departments', b.dataset.ed) }));
    $$('[data-dl]').forEach(b => b.onclick = () => del('departments', b.dataset.dl));
  }

  if (tab === 'analyzers') {
    const F = [{ k: 'name', label: 'اسم الجهاز', required: true }, { k: 'model', label: 'الموديل' }, { k: 'serial_no', label: 'الرقم التسلسلي' },
      { k: 'department_id', label: 'القسم', type: 'select', num: true, options: v => opts(state.depts, v, x => x.name, '—') }, { k: 'active', label: 'فعّال', type: 'checkbox', default: true }];
    out.innerHTML = card('<i class="fa-solid fa-microscope"></i> الأجهزة', 'جهاز', `<div class="tbl-wrap"><table><thead><tr><th>الجهاز</th><th>الموديل</th><th>الرقم التسلسلي</th><th>القسم</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${state.analyzers.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.model || '')}</td><td class="ltr">${esc(a.serial_no || '')}</td><td>${esc(deptName(a.department_id))}</td><td>${a.active ? '<span class="badge ok">فعّال</span>' : '<span class="badge muted">متوقف</span>'}</td><td>${actions(a.id)}</td></tr>`).join('')}</tbody></table></div>`);
    $('#add').onclick = () => formModal({ title: 'جهاز جديد', fields: F, onSave: save('analyzers') });
    $$('[data-ed]').forEach(b => b.onclick = () => formModal({ title: 'تعديل الجهاز', fields: F, data: state.analyzers.find(x => x.id == b.dataset.ed), onSave: save('analyzers', b.dataset.ed) }));
    $$('[data-dl]').forEach(b => b.onclick = () => del('analyzers', b.dataset.dl));
  }

  if (tab === 'tests') {
    const F = [{ k: 'name', label: 'اسم الفحص', required: true }, { k: 'code', label: 'الرمز' }, { k: 'unit', label: 'الوحدة' },
      { k: 'decimals', label: 'المنازل العشرية', type: 'number', default: 2 },
      { k: 'department_id', label: 'القسم', type: 'select', num: true, options: v => opts(state.depts, v, x => x.name, '—') },
      { k: 'analyzer_id', label: 'الجهاز', type: 'select', num: true, options: v => opts(state.analyzers, v, x => x.name, '—') },
      { k: 'tea', label: 'TEa — الخطأ الكلي المسموح %', type: 'number', step: 'any', hint: 'مثال CLIA 2024: Glucose ±8%، Creatinine ±10%، Cholesterol ±10%، Hb ±4%' },
      { k: 'tea_source', label: 'مصدر TEa', hint: 'CLIA 2024 / RiliBÄK / Biological Variation (EFLM)' },
      { k: 'rules', label: 'قواعد Westgard المفعّلة', type: 'rules', full: true }, { k: 'active', label: 'فعّال', type: 'checkbox', default: true }];
    out.innerHTML = card('<i class="fa-solid fa-flask-vial"></i> الفحوص', 'فحص', `<div class="tbl-wrap"><table><thead><tr><th>الفحص</th><th>الوحدة</th><th>القسم</th><th>الجهاز</th><th>TEa%</th><th>القواعد</th><th>اللوتات</th><th></th></tr></thead><tbody>
      ${state.tests.map(t => `<tr style="${t.active ? '' : 'opacity:.5'}"><td>${esc(t.name)} <span class="muted ltr">${esc(t.code || '')}</span></td><td>${esc(t.unit || '')}</td><td>${esc(deptName(t.department_id))}</td><td>${esc(analyzerName(t.analyzer_id))}</td>
        <td class="num">${S.fmt(t.tea, 1)}</td><td>${(t.rules || []).map(r => `<span class="rule w">${S.RULES[r]?.label || r}</span>`).join('')}</td>
        <td class="num">${state.lots.filter(l => l.test_id === t.id && l.active).length}</td><td>${actions(t.id)}</td></tr>`).join('')}</tbody></table></div>`);
    $('#add').onclick = () => formModal({ title: 'فحص جديد', fields: F, onSave: save('tests') });
    $$('[data-ed]').forEach(b => b.onclick = () => formModal({ title: 'تعديل الفحص', fields: F, data: state.tests.find(x => x.id == b.dataset.ed), onSave: save('tests', b.dataset.ed) }));
    $$('[data-dl]').forEach(b => b.onclick = () => del('tests', b.dataset.dl));
  }

  if (tab === 'lots') {
    const F = [{ k: 'test_id', label: 'الفحص', type: 'select', required: true, num: true, options: v => testOptions(v) },
      { k: 'level', label: 'المستوى', required: true, hint: 'Level 1 / Normal / Abnormal / Low / High' }, { k: 'material_name', label: 'اسم مادة الضبط', hint: 'Bio-Rad Lyphochek, Randox Acusera...' },
      { k: 'lot_number', label: 'رقم اللوت', required: true }, { k: 'expiry', label: 'تاريخ الانتهاء', type: 'date' },
      { k: 'target_mean', label: 'المتوسط المستهدف', type: 'number', step: 'any', required: true }, { k: 'target_sd', label: 'SD المستهدف', type: 'number', step: 'any', required: true },
      { k: 'mean_source', label: 'مصدر القيم', type: 'select', options: v => [['manufacturer', 'الشركة المصنعة'], ['lab', 'المختبر (≥20 نقطة)'], ['peer', 'مجموعة المقارنة']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('') },
      { k: 'active', label: 'فعّال', type: 'checkbox', default: true }];
    out.innerHTML = card('<i class="fa-solid fa-vials"></i> لوتات مواد الضبط', 'لوت', `<div class="tbl-wrap"><table><thead><tr><th>الفحص</th><th>المستوى</th><th>المادة</th><th>اللوت</th><th>الانتهاء</th><th>Mean</th><th>SD</th><th>CV%</th><th>المصدر</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${state.lots.map(l => { const t = testById(l.test_id), exp = l.expiry && new Date(l.expiry) < new Date(); return `<tr style="${l.active ? '' : 'opacity:.5'}"><td>${esc(t?.name)}</td><td>${esc(l.level)}</td><td>${esc(l.material_name || '')}</td><td class="ltr">${esc(l.lot_number)}</td>
        <td class="num" style="${exp ? 'color:var(--bad)' : ''}">${fd(l.expiry)}</td><td class="num">${S.fmt(l.target_mean, dec(t))}</td><td class="num">${S.fmt(l.target_sd, dec(t))}</td><td class="num">${S.fmt(l.target_sd / l.target_mean * 100, 2)}</td>
        <td>${{ manufacturer: 'المصنّع', lab: 'المختبر', peer: 'المقارنة' }[l.mean_source] || ''}</td><td>${l.active ? '<span class="badge ok">فعّال</span>' : '<span class="badge muted">مؤرشف</span>'}</td><td>${actions(l.id)}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin-top:10px">عند استبدال لوت: أضف اللوت الجديد وشغّله بالتوازي مع القديم (Crossover) 10–20 مرة، ثم قارن من صفحة "مقارنة اللوتات"، وأرشف اللوت القديم بإلغاء "فعّال".</p>`);
    $('#add').onclick = () => formModal({ title: 'لوت جديد', fields: F, onSave: save('qc_lots') });
    $$('[data-ed]').forEach(b => b.onclick = () => formModal({ title: 'تعديل اللوت', fields: F, data: state.lots.find(x => x.id == b.dataset.ed), onSave: save('qc_lots', b.dataset.ed) }));
    $$('[data-dl]').forEach(b => b.onclick = () => del('qc_lots', b.dataset.dl));
  }
};

// ---------------- Admin: audit
VIEWS.audit = async view => {
  $('#vs').textContent = 'سجل غير قابل للتعديل لكل عمليات الإضافة والتعديل والحذف';
  const rows = await q(sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300));
  const tn = { qc_results: 'نتائج QC', qc_lots: 'اللوتات', tests: 'الفحوص', analyzers: 'الأجهزة', departments: 'الأقسام', profiles: 'المستخدمون', eqa_results: 'EQA' };
  const an = { INSERT: ['إضافة', 'ok'], UPDATE: ['تعديل', 'warn'], DELETE: ['حذف', 'bad'] };
  view.innerHTML = `<div class="card"><div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>المستخدم</th><th>الجدول</th><th>العملية</th><th>السجل</th><th>التغييرات</th></tr></thead><tbody>
    ${rows.map(r => {
      let ch = '';
      if (r.action === 'UPDATE' && r.old_data && r.new_data) ch = Object.keys(r.new_data).filter(k => JSON.stringify(r.old_data[k]) !== JSON.stringify(r.new_data[k])).map(k => `<b>${esc(k)}</b>: ${esc(JSON.stringify(r.old_data[k]))} → ${esc(JSON.stringify(r.new_data[k]))}`).join('<br>');
      else if (r.action === 'DELETE') ch = `<span class="muted">${esc(JSON.stringify(r.old_data)).slice(0, 160)}…</span>`;
      return `<tr><td class="num">${fdt(r.at)}</td><td>${r.user_id ? esc(userName(r.user_id)) : '<span class="muted">النظام</span>'}</td><td>${tn[r.table_name] || esc(r.table_name)}</td><td><span class="badge ${an[r.action]?.[1]}">${an[r.action]?.[0] || r.action}</span></td><td class="num">${esc(r.record_id).slice(0, 8)}</td><td class="wrap ltr" style="font-size:12px;text-align:left">${ch}</td></tr>`; }).join('')}
  </tbody></table></div></div>`;
};

// ================================================================ boot
async function boot() {
  if (!configured) return renderSetupNeeded();
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  if (!session) return renderAuth('login');
  if (/type=recovery/.test(location.hash)) return renderAuth('reset');
  try {
    const prof = await q(sb.from('profiles').select('*').eq('id', session.user.id));
    state.profile = prof[0] || null;
    if (!state.profile || state.profile.status !== 'active') return renderPending();
    await loadRefs();
    renderShell();
  } catch (e) {
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="alert bad">${esc(e.message)}</div><p class="muted">تأكد من تشغيل ملف schema.sql في Supabase.</p><button class="btn" onclick="location.reload()">إعادة المحاولة</button></div></div>`;
  }
}

if (sb) {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') return renderAuth('reset');
    if (event === 'SIGNED_IN' && state.session?.user?.id === session?.user?.id && state.profile) return;
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { state.profile = null; boot(); }
  });
}
boot();
