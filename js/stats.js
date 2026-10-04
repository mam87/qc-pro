// =====================================================================
//  QC Pro — محرك الإحصاء الحيوي وقواعد Westgard
//  Pure functions (no DOM / no DB) — usable in browser & Node for testing
// =====================================================================

export const RULES = {
  '1-2s':   { label: '1₂ₛ',   type: 'warning', desc: 'نتيجة واحدة خارج ±2SD (تحذير)' },
  '1-3s':   { label: '1₃ₛ',   type: 'reject',  desc: 'نتيجة واحدة خارج ±3SD — خطأ عشوائي' },
  '2-2s':   { label: '2₂ₛ',   type: 'reject',  desc: 'نتيجتان متتاليتان (أو مستويان في نفس التشغيل) خارج 2SD بنفس الاتجاه — خطأ منهجي' },
  'R-4s':   { label: 'R₄ₛ',   type: 'reject',  desc: 'الفرق بين نتيجتين في نفس التشغيل > 4SD — خطأ عشوائي' },
  '2of3-2s':{ label: '2/3₂ₛ', type: 'reject',  desc: 'نتيجتان من آخر 3 خارج 2SD بنفس الاتجاه — خطأ منهجي' },
  '3-1s':   { label: '3₁ₛ',   type: 'reject',  desc: '3 نتائج متتالية خارج 1SD بنفس الاتجاه — خطأ منهجي' },
  '4-1s':   { label: '4₁ₛ',   type: 'reject',  desc: '4 نتائج متتالية خارج 1SD بنفس الاتجاه — خطأ منهجي' },
  '6x':     { label: '6ₓ',    type: 'reject',  desc: '6 نتائج متتالية بنفس جانب المتوسط — انحياز' },
  '8x':     { label: '8ₓ',    type: 'reject',  desc: '8 نتائج متتالية بنفس جانب المتوسط — انحياز' },
  '9x':     { label: '9ₓ',    type: 'reject',  desc: '9 نتائج متتالية بنفس جانب المتوسط — انحياز' },
  '10x':    { label: '10ₓ',   type: 'reject',  desc: '10 نتائج متتالية بنفس جانب المتوسط — انحياز' },
  '12x':    { label: '12ₓ',   type: 'reject',  desc: '12 نتيجة متتالية بنفس جانب المتوسط — انحياز' },
  '7T':     { label: '7T',    type: 'warning', desc: '7 نتائج متتالية في اتجاه صاعد أو هابط (Trend)' },
};

export const DEFAULT_RULES = ['1-2s', '1-3s', '2-2s', 'R-4s', '4-1s', '10x'];

// ---------- إحصاء وصفي ----------
export function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }

export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export function cv(a) { const m = mean(a); return (sd(a) / m) * 100; }

export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

export function zScore(v, m, s) { return (v - m) / s; }

export function describe(values, targetMean, targetSd) {
  const n = values.length;
  const m = mean(values), s = sd(values);
  const out = {
    n, mean: m, sd: s, cv: (s / m) * 100,
    min: n ? Math.min(...values) : NaN, max: n ? Math.max(...values) : NaN,
    median: median(values),
  };
  if (targetMean != null) {
    out.bias = ((m - targetMean) / targetMean) * 100;   // %
    out.biasAbs = m - targetMean;
  }
  if (targetSd) out.sdRatio = s / targetSd;            // SD الفعلي ÷ SD المستهدف
  return out;
}

// ---------- Grubbs' test للقيم الشاذة (α=0.05, two-sided) ----------
const GRUBBS_CRIT = { 3:1.155,4:1.481,5:1.715,6:1.887,7:2.020,8:2.126,9:2.215,10:2.290,
  11:2.355,12:2.412,13:2.462,14:2.507,15:2.549,16:2.585,17:2.620,18:2.651,19:2.681,20:2.709,
  25:2.822,30:2.908,35:2.979,40:3.036,50:3.128,60:3.199,70:3.257,80:3.305,90:3.347,100:3.383 };

export function grubbsCritical(n) {
  if (n < 3) return NaN;
  const keys = Object.keys(GRUBBS_CRIT).map(Number);
  let k = keys.filter(x => x <= n).pop();
  return GRUBBS_CRIT[k];
}

export function grubbs(values) {
  if (values.length < 3) return null;
  const m = mean(values), s = sd(values);
  let idx = 0, G = 0;
  values.forEach((v, i) => { const g = Math.abs(v - m) / s; if (g > G) { G = g; idx = i; } });
  const crit = grubbsCritical(values.length);
  return { G, crit, outlier: G > crit, index: idx, value: values[idx] };
}

// ---------- Westgard multirule ----------
// history: مصفوفة z-scores مرتبة زمنياً (الأقدم أولاً) لنفس المستوى/اللوت، تنتهي بالنتيجة الحالية
// runPeers: z-scores لمستويات أخرى من نفس الفحص في نفس التشغيل (cross-level)
export function evaluateWestgard(history, enabledRules = DEFAULT_RULES, runPeers = []) {
  const z = history;
  const cur = z[z.length - 1];
  const last = k => z.slice(-k);
  const on = r => enabledRules.includes(r);
  const v = new Set();

  const sameSide = (arr, lim) =>
    arr.every(x => x > lim) || arr.every(x => x < -lim);

  if (on('1-2s') && Math.abs(cur) > 2) v.add('1-2s');
  if (on('1-3s') && Math.abs(cur) > 3) v.add('1-3s');

  // 2-2s: within-material (across runs) أو across-material (within run)
  if (on('2-2s')) {
    if (z.length >= 2 && sameSide(last(2), 2)) v.add('2-2s');
    if (runPeers.some(p => (cur > 2 && p > 2) || (cur < -2 && p < -2))) v.add('2-2s');
  }
  // R-4s: within run across levels (التعريف الأصلي)
  if (on('R-4s')) {
    if (runPeers.some(p => (cur > 2 && p < -2) || (cur < -2 && p > 2))) v.add('R-4s');
  }
  if (on('2of3-2s') && z.length >= 3) {
    const l3 = last(3);
    if (Math.abs(cur) > 2 && (l3.filter(x => x > 2).length >= 2 || l3.filter(x => x < -2).length >= 2)) v.add('2of3-2s');
  }
  if (on('3-1s') && z.length >= 3 && sameSide(last(3), 1)) v.add('3-1s');
  if (on('4-1s') && z.length >= 4 && sameSide(last(4), 1)) v.add('4-1s');
  for (const n of [6, 8, 9, 10, 12]) {
    if (on(`${n}x`) && z.length >= n && sameSide(last(n), 0)) v.add(`${n}x`);
  }
  if (on('7T') && z.length >= 7) {
    const l = last(7);
    let up = true, down = true;
    for (let i = 1; i < l.length; i++) { if (!(l[i] > l[i - 1])) up = false; if (!(l[i] < l[i - 1])) down = false; }
    if (up || down) v.add('7T');
  }

  const violated = [...v];
  let status = 'accept';
  if (violated.some(r => RULES[r]?.type === 'reject')) status = 'reject';
  else if (violated.length) status = 'warning';
  return { status, violated };
}

// ---------- Six Sigma ----------
export function sigmaMetric(tea, biasPct, cvPct) {
  if (!tea || !cvPct) return NaN;
  return (tea - Math.abs(biasPct || 0)) / cvPct;
}

export function sigmaCategory(s) {
  if (!isFinite(s)) return { label: '—', cls: 'muted' };
  if (s >= 6) return { label: 'عالمي (World class)', cls: 'ok' };
  if (s >= 5) return { label: 'ممتاز (Excellent)', cls: 'ok' };
  if (s >= 4) return { label: 'جيد (Good)', cls: 'info' };
  if (s >= 3) return { label: 'هامشي (Marginal)', cls: 'warn' };
  if (s >= 2) return { label: 'ضعيف (Poor)', cls: 'bad' };
  return { label: 'غير مقبول (Unacceptable)', cls: 'bad' };
}

// Westgard Sigma Rules™ — توصية قواعد الضبط وعدد المواد N حسب السيغما
export function sigmaQcRecommendation(s, levels = 2) {
  if (!isFinite(s)) return null;
  if (s >= 6) return { rules: ['1-3s'], n: 2, runs: 1, freq: 'مرة واحدة يومياً (أو حسب حجم العمل الكبير)', note: 'أداء ممتاز — قاعدة واحدة واسعة تكفي وتقلل الرفض الكاذب.' };
  if (s >= 5) return { rules: ['1-3s', '2-2s', 'R-4s'], n: 2, runs: 1, freq: 'مرتين يومياً', note: 'أداء جيد جداً — multirule مختصر.' };
  if (s >= 4) return { rules: ['1-3s', '2-2s', 'R-4s', '4-1s'], n: levels >= 3 ? 3 : 4, runs: levels >= 3 ? 1 : 2, freq: 'كل 4–8 ساعات', note: 'أداء مقبول — multirule كامل مع 4 نتائج.' };
  return { rules: ['1-3s', '2-2s', 'R-4s', '4-1s', '8x'], n: levels >= 3 ? 6 : 8, runs: levels >= 3 ? 2 : 4, freq: 'كل تشغيل/دفعة + مراجعة الطريقة', note: 'أداء أقل من 4σ — ضبط مكثف ومطلوب تحسين الطريقة (المعايرة، الكواشف، الصيانة) ودراسة السبب الجذري.' };
}

// Quality Goal Index: QGI = bias / (1.5 × CV)
export function qgi(biasPct, cvPct) {
  if (!cvPct) return { value: NaN, problem: '—' };
  const v = Math.abs(biasPct) / (1.5 * cvPct);
  let problem = 'الدقة والصحة معاً (Imprecision & Inaccuracy)';
  if (v < 0.8) problem = 'عدم الدقة (Imprecision) — حسّن التكرارية';
  else if (v > 1.2) problem = 'عدم الصحة (Inaccuracy/Bias) — راجع المعايرة';
  return { value: v, problem };
}

// ---------- عدم اليقين في القياس (ISO 15189:2022 §7.3.4 — top-down) ----------
// uRw = CV التراكمي للـ IQC ، u(bias) من EQA أو شهادة المعايِر
export function measurementUncertainty({ cvIqc, uBias = 0, uCal = 0, k = 2 }) {
  const uc = Math.sqrt(cvIqc ** 2 + uBias ** 2 + uCal ** 2);
  return { uc, U: k * uc, k };
}

// u(bias) من نتائج EQA: RMS(bias) و u(Cref)
export function biasUncertaintyFromEqa(deviationsPct, uCrefPct = 0) {
  if (!deviationsPct.length) return NaN;
  const rms = Math.sqrt(deviationsPct.reduce((s, d) => s + d * d, 0) / deviationsPct.length);
  return Math.sqrt(rms ** 2 + uCrefPct ** 2);
}

// ---------- EQA ----------
export function eqaEval({ labValue, targetValue, peerSd, tea }) {
  const deviation = ((labValue - targetValue) / targetValue) * 100;
  const sdi = peerSd ? (labValue - targetValue) / peerSd : null;
  let acceptable;
  if (tea) acceptable = Math.abs(deviation) <= tea;
  else if (sdi != null) acceptable = Math.abs(sdi) <= 2;
  else acceptable = null;
  let grade = '—';
  if (sdi != null) grade = Math.abs(sdi) <= 1 ? 'ممتاز' : Math.abs(sdi) <= 2 ? 'مقبول' : Math.abs(sdi) <= 3 ? 'تحذير' : 'غير مقبول';
  return { deviation, sdi, acceptable, grade };
}

// ---------- مقارنة فترات (F-test للتباين، t-test للمتوسط) ----------
export function compareLots(a, b) {
  const ma = mean(a), mb = mean(b), sa = sd(a), sb = sd(b);
  const F = Math.max(sa, sb) ** 2 / Math.min(sa, sb) ** 2;
  const se = Math.sqrt(sa ** 2 / a.length + sb ** 2 / b.length);
  const t = (ma - mb) / se;
  return { meanA: ma, meanB: mb, sdA: sa, sdB: sb, F, t, diffPct: ((mb - ma) / ma) * 100 };
}

// ---------- تنسيق ----------
export function fmt(x, d = 2) {
  if (x == null || !isFinite(x)) return '—';
  return Number(x).toFixed(d);
}
