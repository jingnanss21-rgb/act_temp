#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 research/biweekly_report_v2.html 原生移植进活动看板，作为「货盘双周报」第 6 个 tab。

产出（写入 site/biweekly/）：
  - biweekly.css        作用域限定到 #biweekly-report-section 的样式（避免污染主看板）
  - biweekly-chart.js   原内联的 Chart.js（UMD）
  - biweekly-report.js  改编后的渲染逻辑，暴露 window.initBiweeklyReport()
  - bw_data_1..N.js     DATA 的 base64 分块（每块 < 3.5MB，绕过 OA Pages 5MB 上传限制）

⚠️ 解码约定（极其重要，曾踩坑）：
   浏览器端必须用 TextDecoder('utf-8') 还原 base64 二进制串，不能用裸 atob 后 JSON.parse
   —— atob 给出的是 Latin-1 二进制串，直接 JSON.parse 会把中文多字节打散成乱码。
   该解码逻辑写在 index.html 的 loadBiweekly() 里，本脚本只负责生成正确的 base64 数据块。

用法：
  python build_biweekly_tab.py
依赖：python3（无需第三方库）
"""
import re, json, base64, pathlib, sys

SRC = pathlib.Path('/Users/jingnanshe/WorkBuddy/2026-07-16-22-03-21/research/biweekly_report_v2.html')
OUT = pathlib.Path(__file__).resolve().parent / 'biweekly'
CHUNK_CHARS = 3_000_000   # base64 字符上限（每块 < 5MB 请求体）

def scope_sel(sel):
    res = []
    for p in sel.split(','):
        p = p.strip()
        if not p:
            continue
        # :root 与裸 body 特判 -> 作用域容器本身
        res.append('#biweekly-report-section' if (p == ':root' or p == 'body') else '#biweekly-report-section ' + p)
    return ', '.join(res)

def scope_css(css):
    out = []
    i, n = 0, len(css)
    while i < n:
        c = css[i]
        if c == '@':
            j = css.find('{', i)
            if j == -1:
                out.append(css[i:]); break
            name = css[i:j].strip(); depth = 0; k = j
            while k < n:
                if css[k] == '{': depth += 1
                elif css[k] == '}':
                    depth -= 1
                    if depth == 0: break
                k += 1
            body = css[j+1:k]
            if name.startswith(('@media', '@supports', '@container')):
                out.append(name + ' {\n' + scope_css(body) + '}\n')
            else:
                out.append(name + ' {\n' + body + '\n}\n')
            i = k + 1
        elif c == '/' and i+1 < n and css[i+1] == '*':
            e = css.find('*/', i+2)
            if e == -1: break
            out.append(css[i:e+2]); i = e+2
        elif c in '};' or c.isspace():
            i += 1
        else:
            j = css.find('{', i)
            if j == -1:
                i += 1; continue
            sel = css[i:j].strip(); depth = 0; k = j
            while k < n:
                if css[k] == '{': depth += 1
                elif css[k] == '}':
                    depth -= 1
                    if depth == 0: break
                k += 1
            out.append(scope_sel(sel) + ' {' + css[j+1:k] + '}\n')
            i = k + 1
    return ''.join(out)

def main():
    if not SRC.exists():
        print('SRC missing:', SRC); sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    html = SRC.read_text(encoding='utf-8')

    # ---- 1) CSS（head 内 + body 内两段 <style> 合并后作用域限定）----
    head_styles = re.findall(r'<style[^>]*>(.*?)</style>', html, re.S)
    bi = html.find('<body'); si = html.find('<script', bi)
    body_region = html[bi:si]
    body_styles = re.findall(r'<style[^>]*>(.*?)</style>', body_region, re.S)
    (OUT/'biweekly.css').write_text(scope_css('\n'.join(head_styles + body_styles)), encoding='utf-8')
    print('biweekly.css written')

    # ---- 2) 抽取脚本：script[0]=Chart.js, script[1]=逻辑+DATA ----
    scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
    chart = next((s for s in scripts if 'Chart' in s[:3000] and ('function Chart' in s or 'class Chart' in s or 'VERSION' in s)), None)
    # 兜底：长度最大的含 Chart 的块
    if chart is None:
        chart = max((s for s in scripts if 'Chart' in s), key=len)
    assert chart and 'Chart' in chart[:5000], 'Chart.js not found'
    (OUT/'biweekly-chart.js').write_text(chart, encoding='utf-8')

    app = max((s for s in scripts if 'const DATA' in s), key=len)

    # ---- 3) DATA 拆分为 { ... } 并 base64 分块 ----
    key = 'const DATA = '
    start = app.index(key) + len(key)
    assert app[start] == '{'
    depth = 0; end = None
    for j in range(start, len(app)):
        if app[j] == '{': depth += 1
        elif app[j] == '}':
            depth -= 1
            if depth == 0:
                end = j + 1; break
    data_obj = app[start:end]
    json.loads(data_obj)  # 合法性校验
    b64 = base64.b64encode(data_obj.encode('utf-8')).decode('ascii')
    n = max(1, (len(b64) + CHUNK_CHARS - 1) // CHUNK_CHARS)
    for i in range(n):
        part = b64[i*CHUNK_CHARS:(i+1)*CHUNK_CHARS]
        (OUT/f'bw_data_{i+1}.js').write_text(f'window.__bw_b64=(window.__bw_b64||"")+"{part}";', encoding='utf-8')
    print(f'DATA -> {n} base64 chunks ({len(b64)} chars total)')

    # ---- 4) 逻辑改编 ----
    logic = app[end:].lstrip()
    if logic.startswith(';'):
        logic = logic[1:].lstrip()
    # winNote IIFE -> 具名函数（供 init 调用）
    logic = logic.replace(
        '''(function(){try{var m=DATA.meta||{},p=m.prev_win,c=m.curr_win,el=document.getElementById("winNote");var mm=function(s){return s?s.slice(5).replace("-","")+"":"";};if(el&&p&&c)el.textContent="双周窗口 上期 "+mm(p[0])+"–"+mm(p[1])+" / 本期 "+mm(c[0])+"–"+mm(c[1]);}catch(e){}})();''',
        '''function setWinNote(){try{var m=DATA.meta||{},p=m.prev_win,c=m.curr_win,el=document.getElementById("winNote");var mm=function(s){return s?s.slice(5).replace("-","")+"":"";};if(el&&p&&c)el.textContent="双周窗口 上期 "+mm(p[0])+"–"+mm(p[1])+" / 本期 "+mm(c[0])+"–"+mm(c[1]);}catch(e){}}'''
    )
    # 选择器作用域前缀，避免与主看板 .tab/.panel 冲突
    logic = logic.replace('document.querySelectorAll(".tab")', 'document.querySelectorAll("#biweekly-report-section .tab")')
    logic = logic.replace('document.querySelectorAll(".panel")', 'document.querySelectorAll("#biweekly-report-section .panel")')
    logic = logic.replace('''document.querySelector('.tab[data-tab="brand"]')''', '''document.querySelector('#biweekly-report-section .tab[data-tab="brand"]')''')
    # 立即执行 -> 暴露为懒加载函数
    old_init = '''// init
renderSegment("overall", DATA.overall);
renderSegment("ka", DATA.ka);
renderSegment("waist", DATA.waist);
renderBrand();'''
    new_init = '''// init (由 act-temp 在「货盘双周报」tab 首次打开时懒加载调用)
window.initBiweeklyReport = function(){
  setWinNote();
  renderSegment("overall", DATA.overall);
  renderSegment("ka", DATA.ka);
  renderSegment("waist", DATA.waist);
  renderBrand();
};'''
    assert old_init in logic, 'init block not found'
    (OUT/'biweekly-report.js').write_text(logic.replace(old_init, new_init), encoding='utf-8')
    print('biweekly-report.js written')

    # ---- 5) tab section 标记（供 index.html 注入；已注入则忽略）----
    body = re.sub(r'<style[^>]*>.*?</style>', '', body_region, flags=re.S)
    body = body.replace('<!-- ===================== Chart.js（离线内联） ===================== -->', '')
    section = '<div id="biweekly-report-section" style="display:none;">\n' + body.strip() + '\n</div>'
    (OUT/'_section.html').write_text(section, encoding='utf-8')
    print('section markup -> biweekly/_section.html (manual injection once)')
    print('DONE')

if __name__ == '__main__':
    main()
