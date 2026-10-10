"""QC Pro UI checks — runs the real app in Chromium against an in-memory stand-in for Supabase.
No request reaches the real database: every *.supabase.co call is answered locally.
Usage: python3 tests/ui_check.py [AXE_PATH]   (serve the repo root on http://127.0.0.1:8766 first)"""
import json, sys, base64, time, re, pathlib
from playwright.sync_api import sync_playwright

import os
URL = os.environ.get('QC_URL', 'http://127.0.0.1:8766/index.html')
AXE = pathlib.Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else None
REF = 'qlfhmrjweivlejnrycju'
results = []
def check(name, ok, ev=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{ev}]' if ev else ''))

ME = {'id': 'u1', 'email': 'admin@example.com', 'full_name': 'مدير تجريبي', 'role': 'admin', 'status': 'active', 'org_id': 1, 'created_at': '2026-01-01T00:00:00Z'}
NOW = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
DATA = {
    'profiles': [ME],
    'organizations': [{'id': 1, 'name': 'مختبر تجريبي', 'code': 'MAIN', 'active': True, 'valid_until': None, 'plan': 'trial', 'max_users': 5}],
    'departments': [{'id': 1, 'name': 'الكيمياء السريرية'}],
    'analyzers': [{'id': 1, 'name': 'جهاز 1', 'department_id': 1}],
    'tests': [{'id': 1, 'name': 'Glucose', 'unit': 'mmol/L', 'analyzer_id': 1, 'department_id': 1, 'tea': 6.9, 'decimals': 2, 'active': True, 'rules': None}],
    'qc_lots': [{'id': 1, 'test_id': 1, 'level': 'L1', 'lot_number': 'A1', 'target_mean': 5.2, 'target_sd': 0.12, 'active': True, 'expiry': '2027-01-01'},
                {'id': 2, 'test_id': 1, 'level': 'L2', 'lot_number': 'A2', 'target_mean': 15.8, 'target_sd': 0.35, 'active': True, 'expiry': '2027-01-01'}],
    'qc_results': [{'id': 1, 'lot_id': 1, 'test_id': 1, 'value': 5.24, 'z': 0.33, 'rules_violated': [], 'status': 'accept', 'run_at': NOW, 'entered_by': 'u1'}],
    'eqa_results': [], 'audit_log': [],
}
def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
JWT = b64({'alg': 'HS256', 'typ': 'JWT'}) + '.' + b64({'sub': 'u1', 'exp': 4102444800, 'role': 'authenticated', 'email': ME['email']}) + '.sig'
SESSION = {'access_token': JWT, 'refresh_token': 'r', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': 4102444800,
           'user': {'id': 'u1', 'email': ME['email'], 'aud': 'authenticated', 'role': 'authenticated'}}

def backend(route):
    u = route.request.url
    if '/rest/v1/rpc/' in u:
        fn = u.split('/rpc/')[1].split('?')[0]
        return route.fulfill(json={'has_users': True, 'check_org_code': True, 'org_stats': []}.get(fn, None))
    m = re.search(r'/rest/v1/([a-z_]+)', u)
    if m:
        return route.fulfill(json=DATA.get(m.group(1), []), headers={'content-range': '0-0/*'})
    if '/auth/v1/' in u:
        return route.fulfill(json={'user': SESSION['user']} if '/user' in u else {})
    route.fulfill(status=404, body='')

with sync_playwright() as p:
    b = p.chromium.launch()
    def page(signed, h='#/dashboard', vp=(1366, 860)):
        ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]})
        ext = []
        ctx.route(f'https://{REF}.supabase.co/**', backend)
        ctx.route('**/fonts.g*/**', lambda r: r.abort())
        # The sandbox cannot reach public CDNs. For the old (CDN-loading) version, serve the same library
        # files locally so both versions can be compared; Font Awesome CSS is skipped (icons only).
        VEND = pathlib.Path(__file__).resolve().parent.parent / 'vendor'
        ctx.route('**/cdnjs.cloudflare.com/**', lambda r: r.fulfill(path=str(VEND / 'chart-4.4.1.umd.js'), content_type='application/javascript') if 'Chart.js' in r.request.url else r.abort())
        ctx.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(path=str(VEND / 'supabase-js-2.117.3.js'), content_type='application/javascript'))
        if signed:
            ctx.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(SESSION))})")
        pg = ctx.new_page(); pg._errs = []
        pg.on('pageerror', lambda e: pg._errs.append(str(e)))
        pg.on('request', lambda r: ext.append(r.url) if 'jsdelivr' in r.url else None)
        pg.on('dialog', lambda d: d.accept())
        pg.goto(URL + h); pg.wait_for_timeout(1200); pg._ext = ext
        return pg

    def axe(pg, label):
        if not AXE: return
        pg.add_script_tag(content=AXE)
        v = pg.evaluate("""async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});
          return r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,t:v.nodes.slice(0,2).map(n=>n.target.join(' '))}))}""")
        serious = [x for x in v if x['impact'] in ('serious', 'critical')]
        check(f'axe WCAG A/AA serious+critical — {label}', not serious, json.dumps(serious, ensure_ascii=False)[:400] or 'none')
        if v and not serious: print('      (minor/moderate):', json.dumps(v, ensure_ascii=False)[:300])

    # ---------- signed out
    pg = page(False, '#/')
    check('libraries load from vendor/ with SRI (Chart, supabase defined)', pg.evaluate("typeof Chart==='function' && typeof supabase==='object'"))
    check('no request to unpinned jsdelivr CDN', not pg._ext, ', '.join(pg._ext))
    check('login screen renders', pg.locator('.auth-card').count() == 1)
    unl = pg.evaluate("[...document.querySelectorAll('label')].filter(l=>!l.control).map(l=>l.textContent.trim())")
    check('auth: every label is tied to a field', not unl, ', '.join(unl))
    check('auth: no JS errors', not pg._errs, '; '.join(pg._errs))
    axe(pg, 'login')
    pg.context.close()

    # ---------- signed in, desktop: every view
    pg = page(True)
    check('dashboard renders (shell + KPIs)', pg.locator('.app .kpi').count() >= 4)
    sep = pg.evaluate("(e=>e?getComputedStyle(e).color+'|'+getComputedStyle(e).opacity:'missing')(document.querySelector('.nav .sep'))")
    check('nav section labels: solid #a3abbd, no opacity', sep == 'rgb(163, 171, 189)|1', sep)
    nameless = pg.evaluate("[...document.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')).map(b=>b.outerHTML.slice(0,80))")
    check('dashboard: icon-only buttons have an accessible name', not nameless, ' | '.join(nameless))
    views = pg.evaluate("[...document.querySelectorAll('.nav a')].map(a=>a.dataset.v)")
    for v in views:
        pg._errs.clear()
        pg.goto(URL + '#/' + v); pg.wait_for_timeout(700)
        bad = pg.locator('#view > .alert.bad').count()
        unl = pg.evaluate("[...document.querySelectorAll('#view label')].filter(l=>!l.control && !l.querySelector('input,select,textarea')).map(l=>l.textContent.trim())")
        nb = pg.evaluate("[...document.querySelectorAll('#view button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')).length")
        check(f'view #{v}: renders without error, labels tied, icon buttons named', not bad and not pg._errs and not unl and not nb,
              f'errors={pg._errs[:1]} unlabeled={unl[:3]} nameless={nb}')
    pg.goto(URL + '#/entry?test=1'); pg.wait_for_timeout(900)
    lv = pg.locator('.level-card .lv')
    check('entry: two level inputs for Glucose', lv.count() == 2)
    if lv.count() == 2:
        lv.nth(0).fill('5.24'); lv.nth(1).fill('17.2'); pg.wait_for_timeout(200)
        txt = pg.locator('#levels').inner_text()
        check('entry: live Westgard evaluation still works (L2 z=4 → rejected)', 'مرفوض' in txt and 'Z = 4.00' in txt, txt[txt.find('Z ='):][:60].replace('\n', ' '))
    pg.goto(URL + '#/entry?test=1'); pg.wait_for_timeout(900)
    axe(pg, 'QC entry')
    pg.goto(URL + '#/dashboard'); pg.wait_for_timeout(900)
    axe(pg, 'dashboard')
    pg.context.close()

    # ---------- signed in, phone
    pg = page(True, '#/dashboard', (375, 812))
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('phone 375px: no horizontal page overflow', sw <= 375, f'scrollWidth={sw}')
    small = pg.evaluate("[...document.querySelectorAll('button,.nav a')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<40).map(e=>e.textContent.trim()||e.getAttribute('aria-label'))")
    check('phone: visible buttons/links at least 40px tall', not small, ', '.join(small[:6]))
    pg.context.close()
    b.close()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
