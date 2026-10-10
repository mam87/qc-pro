// =====================================================================
//  QC Pro — تحسينات الوصول (قارئ الشاشة) تُطبَّق تلقائياً على كل شاشة
//  1) ربط كل <label> بالحقل التابع له (for/id)
//  2) اسم مقروء لأزرار الأيقونات فقط (aria-label)
// =====================================================================
(function () {
  'use strict';
  const ICON_LABELS = {
    'fa-bars': 'القائمة', 'fa-right-from-bracket': 'تسجيل الخروج', 'fa-print': 'طباعة',
    'fa-trash': 'حذف', 'fa-floppy-disk': 'حفظ', 'fa-pen': 'تعديل', 'fa-xmark': 'إغلاق',
    'fa-envelope': 'رسالة دعوة', 'fa-right-to-bracket': 'الدخول لهذا المختبر',
    'fa-check': 'اعتماد', 'fa-eye': 'عرض', 'fa-download': 'تنزيل', 'fa-plus': 'إضافة',
    'fa-file-csv': 'تصدير CSV', 'fa-image': 'تصدير صورة', 'fa-rotate': 'تحديث',
  };
  const CONTROL = 'input:not([type=hidden]),select,textarea';
  let seq = 0;

  function linkLabel(label) {
    if (label.htmlFor || label.querySelector(CONTROL)) return;
    let ctl = label.nextElementSibling;
    if (!ctl || !ctl.matches(CONTROL)) ctl = label.parentElement && label.parentElement.querySelector(CONTROL);
    if (!ctl || ctl.labels && ctl.labels.length) return;
    if (!ctl.id) ctl.id = 'a11y-f' + (++seq);
    label.htmlFor = ctl.id;
  }

  function nameButton(btn) {
    if (btn.hasAttribute('aria-label') || btn.textContent.trim()) return;
    if (btn.title) { btn.setAttribute('aria-label', btn.title); return; }
    const icon = btn.querySelector('i[class*="fa-"]');
    if (!icon) return;
    const cls = [...icon.classList].find(c => ICON_LABELS[c]);
    if (cls) btn.setAttribute('aria-label', ICON_LABELS[cls]);
  }

  function apply(root) {
    if (!(root instanceof Element)) return;
    root.querySelectorAll('label').forEach(linkLabel);
    root.querySelectorAll('button').forEach(nameButton);
    if (root.matches('label')) linkLabel(root);
    if (root.matches('button')) nameButton(root);
  }

  let pending = false;
  const run = () => { pending = false; apply(document.body); };
  new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true });
  run();
})();
