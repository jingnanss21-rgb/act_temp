const C={blue:"#2f6bff",green:"#14b86e",red:"#f5455c",amber:"#ff9f1a",purple:"#7c5cff",grey:"#9aa0a6"};
function setWinNote(){try{var m=DATA.meta||{},p=m.prev_win,c=m.curr_win,el=document.getElementById("winNote");var mm=function(s){return s?s.slice(5).replace("-","")+"":"";};if(el&&p&&c)el.textContent="双周窗口 上期 "+mm(p[0])+"–"+mm(p[1])+" / 本期 "+mm(c[0])+"–"+mm(c[1]);}catch(e){}}
const PIE=["#2f6bff","#14b86e","#f5455c","#ff9f1a","#7c5cff","#22c1c3","#e06fd0","#8a6d3b","#5b8c5a","#b56576","#9aa0a6"];
const fmt=n=>{ if(n==null) return "—"; if(Math.abs(n)>=1e8) return (n/1e8).toFixed(2)+"亿"; if(Math.abs(n)>=1e4) return (n/1e4).toFixed(1)+"万"; return Math.round(n).toLocaleString(); };
const pct=n=> n==null?"—":n.toFixed(2)+"%";
const safePct=n=> n==null?"—":(n>50?"—":n.toFixed(2)+"%");
const chg=(v,unit)=> (v==null)?"新增":(v>=0?`<span class="up">▲ ${v>0?"+":""}${v}${unit}</span>`:`<span class="down">▼ ${v}${unit}</span>`);

function bars(id, labels, vals, opt){
  opt=opt||{};
  const el=document.getElementById(id);
  if(!el || typeof el.getContext!=='function') return;
  const ctx=el.getContext('2d');
  if(!ctx){ requestAnimationFrame(()=>bars(id,labels,vals,opt)); return; }
  try{ const old=Chart.getChart(el); if(old) old.destroy(); new Chart(el,{type:"bar",
    data:{labels, datasets:[{label:opt.label||"", data:vals, backgroundColor:opt.color||C.blue, borderRadius:5}]},
    options:{responsive:true, plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>opt.fmt?opt.fmt(c.parsed.y):c.parsed.y+(opt.unit||"")}}},
      scales:{x:{ticks:{font:{size:10},maxRotation:0,minRotation:0,autoSkip:true,autoSkipPadding:14,maxTicksLimit:10,
        callback:v=>{const lab=labels[v];if(typeof lab==='string' && /^\d{4}-\d{2}-\d{2}$/.test(lab)) return lab.slice(5);return lab;}}},
              y:{beginAtZero:true, title:{display:true, text:opt.ytitle||""},
        ticks:{callback:v=>opt.tickFmt?opt.tickFmt(v):v}}}}});
  }catch(e){}
}
function dual(id, labels, L, R, opt){
  opt=opt||{};
  const el=document.getElementById(id);
  if(!el || typeof el.getContext!=='function') return;
  const ctx=el.getContext('2d');
  if(!ctx){ requestAnimationFrame(()=>dual(id,labels,L,R,opt)); return; }
  try{
  const old=Chart.getChart(el); if(old) old.destroy();
  const oneAxis=!!opt.oneAxis;
  const ds=[{label:L.label, data:L.data, borderColor:C.blue, backgroundColor:"rgba(47,107,255,.08)", yAxisID:"y", tension:.3, fill:true}];
  if(R) ds.push({label:R.label, data:R.data, borderColor:C.red, backgroundColor:"rgba(245,69,92,.06)", yAxisID:oneAxis?"y":"y1", tension:.3, fill:!oneAxis});
  const scales={x:{ticks:{font:{size:10},maxRotation:0,minRotation:0,autoSkip:true,autoSkipPadding:14,maxTicksLimit:10,
    callback:v=>{const lab=labels[v];if(typeof lab==='string' && /^\d{4}-\d{2}-\d{2}$/.test(lab)) return lab.slice(5);return lab;}}},
                y:{position:"left", title:{display:true,text:(R&&oneAxis)?"":L.label}, beginAtZero:true}};
  if(R && !oneAxis) scales.y1={position:"right", title:{display:true,text:R.label}, beginAtZero:true, grid:{drawOnChartArea:false}};
  new Chart(el,{type:"line",
    data:{labels, datasets:ds},
    options:{responsive:true, maintainAspectRatio: opt.mAR!==false, layout:{padding:{bottom:16}},
      interaction:{mode:"index",intersect:false},
      plugins:{legend:{display:!!R}, tooltip:{callbacks:{label:c=>c.dataset.label+": "+(c.parsed.y==null?"—":c.parsed.y)}}},
      scales}});
  }catch(e){}
}
function pie(id, labels, vals, opt){
  opt=opt||{};
  const el=document.getElementById(id);
  if(!el || typeof el.getContext!=='function') return;
  const ctx=el.getContext('2d');
  if(!ctx){ requestAnimationFrame(()=>pie(id,labels,vals,opt)); return; }
  const colors=opt.colors||PIE;
  try{
    const old=Chart.getChart(el); if(old) old.destroy();
    new Chart(el,{type:"pie",
      data:{labels, datasets:[{data:vals, backgroundColor:labels.map((_,i)=>colors[i%colors.length]), borderColor:"#fff", borderWidth:1}]},
      options:{responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:true, position:"bottom", labels:{font:{size:10}, boxWidth:10, padding:5}},
                 tooltip:{callbacks:{label:c=>` ${c.label}: ${c.parsed.toFixed(1)}%`}}}}});
  }catch(e){}
}

// 品牌核销变化表：单行渲染（全局，供初始渲染与点击排序复用）
function brandRowHtml(r){
  const cls=v=>v>=0?"val-up":"val-down";
  return `<tr class="bt-row" data-bid="${r.bid}" title="点击查看品牌明细">
    <td><b>${r.brand}</b></td>
    <td>${fmt(r.curr_rdm_d)}</td>
    <td>${fmt(r.prev_rdm_d)}</td>
    <td class="${cls(r.change_d)}">${r.change_d>=0?'+':''}${fmt(r.change_d)}</td>
    <td class="${cls(r.dRdm)}">${r.dRdm==null?'—':chg(r.dRdm,'%')}</td>
    <td>${fmt(r.curr_exp_d)}</td>
    <td>${fmt(r.prev_exp_d)}</td>
    <td class="${cls(r.dExp)}">${r.dExp==null?'—':chg(r.dExp,'%')}</td>
    <td>${pct(r.rate)}</td>
    <td class="${cls(r.dRate)}">${r.dRate==null?'—':(r.dRate>=0?'+':'')+r.dRate+'pp'}</td>
  </tr>`;
}

function renderKPI(seg){
  const k=seg.kpi;
  const chg=(v,unit)=> (v>=0?`<span class="up">▲ ${v>0?"+":""}${v}${unit}</span>`:`<span class="down">▼ ${v}${unit}</span>`);
  return `<div class="kpis">
    <div class="kpi"><div class="lab">曝光 · 双周日均</div><div class="val">${fmt(k.exposure)}</div><div class="chg">${chg(k.dExposure,"%")} 环比</div></div>
    <div class="kpi"><div class="lab">核销 · 双周日均</div><div class="val">${fmt(k.redemption)}</div><div class="chg">${chg(k.dRedemption,"%")} 环比</div></div>
    <div class="kpi"><div class="lab">曝光核销率 · 双周汇总</div><div class="val">${pct(k.rate)}</div><div class="chg">${chg(k.dRate,"pp")} 环比</div></div>
    <div class="kpi"><div class="lab">核销占比 · 双周汇总</div><div class="val">${pct(k.share)}</div><div class="chg">${chg(k.dShare,"pp")} 环比</div></div>
  </div>`;
}

function renderCoupon(seg){
  const cp=seg.coupon;
  return `<div class="grid2">
    <div><h3>券类型占比（按核销占比）</h3><div style="position:relative;height:260px"><canvas id="cp-pie-__S__" style="width:100%;height:100%"></canvas></div></div>
    <div><h3>券类型明细（按核销降序，含双周环比）</h3>
      <table><thead><tr><th>券类型</th><th>核销占比</th><th>日均核销pv</th><th>曝光核销率</th></tr></thead><tbody>
      ${cp.map(c=>`<tr>
        <td>${c.type}</td>
        <td>${c.pct}%<br><span class="muted">${c.dPct==null?"新增":chg(c.dPct,"pp")}</span></td>
        <td>${fmt(c.rdm_avg)}<br><span class="muted">${c.dRdmAvg==null?"新增":chg(c.dRdmAvg,"%")}</span></td>
        <td>${pct(c.rate)}<br><span class="muted">${c.dRate==null?"新增":chg(c.dRate,"pp")}</span></td>
      </tr>`).join("")}
      </tbody></table>
    </div></div>`;
}

function renderIndustry(seg){
  const ind=seg.industry;
  return `<table><thead><tr><th>细分行业</th><th>主导券类型</th><th>主导券型核销占比</th><th>占比环比</th><th>行业曝光核销率</th><th>行业率环比</th><th>主导券型曝光核销率</th><th>主导券型率环比</th></tr></thead><tbody>
    ${ind.map(d=>`<tr><td>${d.industry}</td><td><span class="pill ka">${d.lead_coupon}</span></td><td>${d.lead_coupon_pct}%</td><td>${chg(d.dLeadPct,"pp")}</td><td>${pct(d.industry_rate)}</td><td>${chg(d.dIndRate,"pp")}</td><td>${pct(d.lead_coupon_rate)}</td><td>${chg(d.dLeadRate,"pp")}</td></tr>`).join("")}
    </tbody></table>
    <p class="muted" style="margin-top:8px">主导券类型 = 该行业「核销」最高的券类型；主导券型核销占比 = 该券型核销 / 行业总核销（核销占比口径）。各环比按 pp 变化；上期无该行业记为「新增」。</p>`;
}

function renderFactors(seg){
  const f=seg.factors;
  const tRows=f.threshold.map(r=>`<tr><td>${r.name}</td><td>${r.count}</td><td>${pct(r.rate)}</td><td>${chg(r.dRate,"pp")}</td><td>${fmt(r.rdm_avg)}</td><td>${chg(r.dRdmAvg,"%")}</td><td>${r.share}%</td></tr>`).join("");
  const mRows=f.mode.map(r=>`<tr><td>${r.label||r.name}</td><td>${r.count}</td><td>${pct(r.rate)}</td><td>${chg(r.dRate,"pp")}</td><td>${fmt(r.rdm_avg)}</td><td>${chg(r.dRdmAvg,"%")}</td><td>${r.share}%</td></tr>`).join("");
  const freq=f.freqTags.map(t=>`<tr><td>${t.tag}</td><td>${t.count}</td><td>${t.cover}%</td><td>${pct(t.rate)}</td><td>${chg(t.dRate,"pp")}</td><td>${fmt(t.rdm_avg)}</td><td>${chg(t.dRdmAvg,"%")}</td></tr>`).join("");
  // 价格力/限领/门店覆盖度（已展开，无折叠）
  const ppAll=f.othersFolded[0].buckets;
  const ppUntagged=ppAll.find(b=>b.name==='未打标');
  const ppUntaggedCount=ppUntagged?ppUntagged.count:0;
  const ppRows=ppAll.filter(b=>b.name!=='未打标').map(b=>`<tr><td>${b.name}</td><td>${b.count}</td><td>${pct(b.rate)}</td><td>${chg(b.dRate,"pp")}</td><td>${fmt(b.rdm_avg)}</td><td>${chg(b.dRdmAvg,"%")}</td><td>${b.share}%</td></tr>`).join("");
  const limRows=f.othersFolded[1].buckets.map(b=>`<tr><td>${b.name}</td><td>${b.count}</td><td>${pct(b.rate)}</td><td>${chg(b.dRate,"pp")}</td><td>${fmt(b.rdm_avg)}</td><td>${chg(b.dRdmAvg,"%")}</td><td>${b.share}%</td></tr>`).join("");
  const covRows=f.othersFolded[2].buckets.map(b=>`<tr><td>${b.name}</td><td>${b.count}</td><td>${pct(b.rate)}</td><td>${chg(b.dRate,"pp")}</td><td>${fmt(b.rdm_avg)}</td><td>${chg(b.dRdmAvg,"%")}</td><td>${b.share}%</td></tr>`).join("");
  return `<div class="factor-block">
    <h3>优惠门槛</h3>
    <p class="muted">无门槛与1-10元核销率最高（1.46%/1.70%），>30元显著下降至&lt;0.66%。</p>
    <div class="factor-row"><div class="factor-chart"><canvas id="th-pie-__S__" style="width:100%;height:100%"></canvas></div><div class="factor-tbl"><table class="sldr"><thead><tr><th>区间(¥)</th><th>活动数</th><th>曝光核销率</th><th>率环比</th><th>日均核销pv</th><th>日均环比</th><th>占比</th></tr></thead><tbody>${tRows}</tbody></table></div></div></div>
  <div class="factor-block">
    <h3>投放模式</h3>
    <p class="muted">定向（${pct(f.mode[0].rate)}）高于通投（${pct(f.mode[1].rate)}），效率高约${f.mode[1].rate?(((f.mode[0].rate-f.mode[1].rate)/f.mode[1].rate)*100).toFixed(0):0}%。</p>
    <div class="factor-row"><div class="factor-chart"><canvas id="tm-pie-__S__" style="width:100%;height:100%"></canvas></div><div class="factor-tbl"><table class="sldr"><thead><tr><th>模式</th><th>活动数</th><th>曝光核销率</th><th>率环比</th><th>日均核销pv</th><th>日均环比</th><th>占比</th></tr></thead><tbody>${mRows}</tbody></table></div></div></div>
  <div class="factor-block">
    <h3>定向频次</h3>
    <p class="muted">高频最高（${pct(f.freqTags[0].rate)}）→低频（${pct(f.freqTags[1].rate)}）→沉默（${pct(f.freqTags[2].rate)}）→流失（${pct(f.freqTags[3].rate)}）递减，高频比低频高${(f.freqTags[0].rate-f.freqTags[1].rate).toFixed(2)}pp。</p>
    <div class="factor-row"><div class="factor-chart"><canvas id="freq-pie-__S__" style="width:100%;height:100%"></canvas></div><div class="factor-tbl"><table class="sldr"><thead><tr><th>标签</th><th>活动数</th><th>占定向比</th><th>核销率</th><th>率环比</th><th>日均核销pv</th><th>日均环比</th></tr></thead><tbody>${freq}</tbody></table></div></div></div>
  <div class="factor-block">
    <h3>价格力</h3>
    <p class="muted">6-8%档最高（${pct(f.othersFolded[0].buckets.find(b=>b.name==='6–8%')?.rate)}），打标活动整体优于未打标。另有 ${fmt(ppUntaggedCount)} 个活动未打标（已剔除）。</p>
    <div class="factor-row"><div class="factor-chart"><canvas id="of0-pie-__S__" style="width:100%;height:100%"></canvas></div><div class="factor-tbl"><table class="sldr"><thead><tr><th>区间</th><th>活动数</th><th>曝光核销率</th><th>率环比</th><th>日均核销pv</th><th>日均环比</th><th>占比</th></tr></thead><tbody>${ppRows}</tbody></table></div></div></div>
  <div class="factor-block">
    <h3>限领张数</h3>
    <p class="muted">不限（1.42%）与≥4张（1.54%）接近，限领对转化影响不明显。</p>
    <div class="factor-row"><div class="factor-chart"><canvas id="of1-pie-__S__" style="width:100%;height:100%"></canvas></div><div class="factor-tbl"><table class="sldr"><thead><tr><th>档位</th><th>活动数</th><th>曝光核销率</th><th>率环比</th><th>日均核销pv</th><th>日均环比</th><th>占比</th></tr></thead><tbody>${limRows}</tbody></table></div></div></div>
  <div class="factor-block">
    <h3>门店覆盖度（活动可用门店/上传门店）</h3>
    <p class="muted">80-100%覆盖度核销率（${pct(f.othersFolded[2].buckets.find(b=>b.name==='80–100%')?.rate)}）最高，<50%覆盖度活动数少但核销率（${pct(f.othersFolded[2].buckets.find(b=>b.name==='<50%')?.rate)}）不低；各区间无单调相关关系。</p>
    <div class="factor-row"><div class="factor-chart"><canvas id="of2-pie-__S__" style="width:100%;height:100%"></canvas></div><div class="factor-tbl"><table class="sldr"><thead><tr><th>覆盖度</th><th>活动数</th><th>曝光核销率</th><th>率环比</th><th>日均核销pv</th><th>日均环比</th><th>占比</th></tr></thead><tbody>${covRows}</tbody></table></div></div>
    <p class="muted" style="margin-top:6px;font-size:12px">注：覆盖度为「未知」（缺可用门店/上传门店字段）的 ${f.cov_unknown_n ?? 0} 个活动视为异常数据，已剔除统计，不参与占比与率计算。</p>
  </div>`;
}

function renderLifecycle(seg){
  const w=seg.lifecycle.wave;
  const CD=w.days||14;
  const cls=v=>v>=0?"val-up":"val-down";
  const fnum=v=> (v>=0?"+":"")+fmt(v);
  const rt=x=> x==null?"—":x.toFixed(2)+"%";
  // —— #1 整体转化小结（数据源：顶部卡片 brand_v2 货盘品牌 全量）——
  const k=seg.kpi;
  const dDaily_w = (k.redemption - k.redemption/(1+k.dRedemption/100))/1e4;
  const exposureComp = Math.abs(k.dExposure)>Math.abs(k.dRedemption) ? '跌幅 > 核销环比' : '跌幅 < 核销环比';
  const convSummary = `核销量环比 ${chg(k.dRedemption,"%")}（日均${fnum(dDaily_w)}万/天）；曝光环比 ${chg(k.dExposure,"%")}，${exposureComp}；${Math.abs(k.dRate)<=0.1?'曝光核销率基本稳定':'曝光核销率'+((k.dRate>0)?'小幅提升':'小幅下降')}（${chg(k.dRate,"pp")}）。`;

  // —— 2.1 三桶（日均口径 + 绝对变化）——
  const dPv=(a,b)=>(a-b)/CD; // 日均绝对变化
  const bkRow=b=>`<tr>
    <td><b>${b.label}</b></td>
    <td>${fmt(b.prev_rdm/CD)}</td><td>${fmt(b.curr_rdm/CD)}</td>
      <td class="${cls(b.curr_rdm-b.prev_rdm)}">${fnum(dPv(b.curr_rdm,b.prev_rdm))}</td>
    <td>${fmt(b.prev_exp/CD)}</td><td>${fmt(b.curr_exp/CD)}</td>
      <td class="${cls(b.curr_exp-b.prev_exp)}">${fnum(dPv(b.curr_exp,b.prev_exp))}</td>
    <td>${rt(b.prev_rate)}</td><td>${rt(b.curr_rate)}</td>
  </tr>`;
  const t=w.total;
  const totRow=`<tr class="tot">
    <td><b>分类合计</b>（= 活动明细表全量）</td>
    <td>${fmt(t.prev_rdm/CD)}</td><td>${fmt(t.curr_rdm/CD)}</td>
      <td class="${cls(t.curr_rdm-t.prev_rdm)}">${fnum(dPv(t.curr_rdm,t.prev_rdm))}</td>
    <td>${fmt(t.prev_exp/CD)}</td><td>${fmt(t.curr_exp/CD)}</td>
      <td class="${cls(t.curr_exp-t.prev_exp)}">${fnum(dPv(t.curr_exp,t.prev_exp))}</td>
    <td>${rt(t.prev_rate)}</td><td>${rt(t.curr_rate)}</td>
  </tr>`;

  // —— 2.2 品牌核销变化表（每品牌整体；支持点击表头按各指标排序；点击行下钻）——
  const btRows=w.brand_table.map(brandRowHtml).join("");

  return `
  <div class="conv-banner">${convSummary}</div>

  <section class="bk-chart-block" style="margin:14px 0">
    <h3>2.1 · 活动分类（持续在线 / 新 / 下线）</h3>
    <div class="tbl-wrap"><table><thead><tr>
      <th>活动类型</th><th>上期日均核销PV</th><th>本期日均核销PV</th><th>核销Δ(绝对)</th>
      <th>上期日均曝光</th><th>本期日均曝光</th><th>曝光Δ(绝对)</th>
      <th>上期核销率</th><th>本期核销率</th>
    </tr></thead><tbody>
      ${w.buckets.map(bkRow).join("")}
      ${totRow}
    </tbody></table></div>
  </section>

  <section class="bk-chart-block" style="margin:14px 0">
    <h3>2.2 · 品牌核销变化表 <span class="muted" style="font-size:12px;font-weight:400">（点击列标题可排序；点击品牌行 → 下钻到品牌逐日趋势线 + 活动明细）</span></h3>
    <div class="tbl-wrap bt-scroll"><table><thead><tr>
      <th class="sortable" data-key="brand">品牌</th>
      <th class="sortable" data-key="curr_rdm_d">本期日均核销</th>
      <th class="sortable" data-key="prev_rdm_d">上期日均核销</th>
      <th class="sortable sorted-asc" data-key="change_d" data-dir="asc">核销变化量(日均)</th>
      <th class="sortable" data-key="dRdm">核销环比</th>
      <th class="sortable" data-key="curr_exp_d">本期日均曝光</th>
      <th class="sortable" data-key="prev_exp_d">上期日均曝光</th>
      <th class="sortable" data-key="dExp">曝光环比</th>
      <th class="sortable" data-key="rate">曝光核销率</th>
      <th class="sortable" data-key="dRate">率环比</th>
    </tr></thead><tbody id="bt-tbody-__S__">
      ${btRows||`<tr><td colspan="10" class="muted">无品牌数据</td></tr>`}
    </tbody></table></div>
  </section>`;
}

let _chartSegs = {};
function renderSegment(key, seg){
  const el=document.getElementById("panel-"+key);
  let html=`
    <section><h2>1 · 整体转化（双周环比）</h2>${renderKPI(seg)}</section>
    <section><h2>2 · 活动变化对核销影响</h2>${renderLifecycle(seg)}</section>
    <section><h2>3 · 货盘结构</h2>
      <div class="conv-banner" style="margin-bottom:10px">次卡+全场券（全场折扣券+全场满减券+全场无门槛立减券）核销占比 <b>${seg.combine_coupon_pct==null?'—':seg.combine_coupon_pct+'%'}（${seg.combine_coupon_dPct==null?'新增':chg(seg.combine_coupon_dPct,'pp')}）</b></div>
      ${renderCoupon(seg)}${renderIndustry(seg)}
    </section>
    <section><h2>4 · 影响因素</h2>${renderFactors(seg)}</section>`;
  html=html.replace(/__S__/g, key);
  el.innerHTML=html;
  // 品牌表下钻联动：点击品牌行跳转到品牌明细（不依赖 Chart.js）
  el.querySelectorAll(".bt-row").forEach(r=>{
    r.onclick=()=>gotoBrand(parseInt(r.dataset.bid,10));
  });
  // 品牌核销变化表：点击表头按各指标排序
  const btBody=el.querySelector("#bt-tbody-"+key);
  if(btBody){
    const brandTable=seg.lifecycle.wave.brand_table;
    el.querySelectorAll("th.sortable").forEach(th=>{
      th.onclick=()=>{
        const skey=th.dataset.key;
        const dir = th.dataset.dir==="asc" ? "desc" : "asc";
        el.querySelectorAll("th.sortable").forEach(x=>{x.classList.remove("sorted-asc","sorted-desc");x.dataset.dir="";});
        th.classList.add(dir==="asc"?"sorted-asc":"sorted-desc");
        th.dataset.dir=dir;
        const rows=[...brandTable];
        rows.sort((a,b)=>{
          if(skey==="brand") return dir==="asc"?String(a.brand).localeCompare(String(b.brand),"zh"):String(b.brand).localeCompare(String(a.brand),"zh");
          const va=a[skey]==null?-Infinity:a[skey], vb=b[skey]==null?-Infinity:b[skey];
          return dir==="asc"?va-vb:vb-va;
        });
        btBody.innerHTML=rows.map(brandRowHtml).join("");
        btBody.querySelectorAll(".bt-row").forEach(r=>{ r.onclick=()=>gotoBrand(parseInt(r.dataset.bid,10)); });
      };
    });
  }
  // 延迟图表创建：存数据，仅对当前可见 tab 立即创建
  _chartSegs[key] = {seg,key};
  if(el.classList.contains("active")){
    requestAnimationFrame(()=>renderSegmentCharts(key));
  }
}
function renderSegmentCharts(key){
  const d = _chartSegs?.[key];
  if(!d || d._rendered) return;
  d._rendered = true;
  const seg=d.seg, cp=seg.coupon, f=seg.factors;
  pie("cp-pie-"+key, cp.map(c=>c.type), cp.map(c=>c.pct), {});
  pie("th-pie-"+key, f.threshold.map(r=>r.name), f.threshold.map(r=>r.share), {});
  pie("tm-pie-"+key, f.mode.map(r=>r.label||r.name), f.mode.map(r=>r.share), {});
  pie("freq-pie-"+key, f.freqTags.map(t=>t.tag), f.freqTags.map(t=>t.share), {});
  f.othersFolded.forEach((o,i)=>{
    if(o) pie("of"+i+"-pie-"+key, o.buckets.map(b=>b.name), o.buckets.map(b=>b.share), {});
  });
}

function renderBrand(){
  const B=DATA.brand;
  let cur=null;

  // ---- KPI 卡片渲染（四指标：主值=当期值，副值=环比）----
  function renderKPIs(b){
    const k=b.kpi||{};
    const dir=v=> v==null? "" : (v>=0?"up":"down");
    const chg=v=> v==null?"—": (v>=0?"+":"")+v;
    const kpis=[
      {name:"曝光PV · 双周日均",     curr:fmt(k.exposure),   chg:chg(k.dExposure)+"%",  dir:dir(k.dExposure)},
      {name:"核销PV · 双周日均",     curr:fmt(k.redemption), chg:chg(k.dRedemption)+"%", dir:dir(k.dRedemption)},
      {name:"曝光核销率 · 双周汇总", curr:pct(k.rate),       chg:chg(k.dRate)+"pp",     dir:dir(k.dRate)},
      {name:"核销占比 · 双周汇总",   curr:pct(k.share),      chg:chg(k.dShare)+"pp",    dir:dir(k.dShare)}
    ];
    return `<div class="bk-kpi-row">${kpis.map(k=>
      `<div class="bk-kpi-card">
         <div class="bk-metric-name">${k.name}</div>
         <div class="bk-val-main">${k.curr}</div>
         <div class="bk-val-chg val-${k.dir}">环比 ${k.chg}</div>
       </div>`
    ).join("")}</div>`;
  }

  // ---- 趋势线区域（左右并列，避免变形）----
  function renderTrends(b){
    return `<section class="bk-chart-block">
      <h3>品牌趋势（核销PV / 曝光 + 交易笔数 / 率）</h3>
      <div class="bk-trend-row">
        <div class="bk-trend-cell"><div class="bk-trend-cap">核销PV</div><canvas id="b-rdm"></canvas></div>
        <div class="bk-trend-cell"><div class="bk-trend-cap">曝光PV & 日均交易笔数</div><canvas id="b-exp-txn"></canvas></div>
        <div class="bk-trend-cell"><div class="bk-trend-cap">曝光核销率 & 核销占比</div><canvas id="b-rate-share"></canvas></div>
      </div>
      <p class="muted" style="margin-top:8px;font-size:12px">数值单位：核销PV、曝光PV 以「万」计；日均交易笔数 以「万笔」计；曝光核销率、核销占比 为百分比（%）。</p>
    </section>`;
  }

  // ---- 活动明细表（按所选品牌过滤，完整列）----
  function renderActivities(b){
    const cls=v=>v>=0?"val-up":"val-down";
    const acts=B.activities.filter(a=>a.brand===b.name).slice()
      .filter(a=>{
        const D=a.days||14;
        const pe=(a.prev_exp||0)/D, ce=(a.curr_exp||0)/D;       // 曝光/天
        const pr=(a.prev_rdm||0)/D, cr=(a.curr_rdm||0)/D;        // 日均核销
        // 仅过滤「曝光=0 且 核销=0」的活动；次卡等零曝光但有核销的活动一并展示
        return (pe>=100 || ce>=100) || (pr>=100 || cr>=100);
      });
    const total=acts.reduce((s,a)=>s+(a.curr_rdm||0),0)||1;
    const pillMap={on:["on","持续在线"],off:["off","已下线"],new:["new","新上线"]};
    // 计算每活动日均值，按核销变化量升序（下降最多排最前）
    acts.forEach(a=>{
      const days=a.days||14;
      a._prevD=(a.prev_rdm||0)/days; a._currD=(a.curr_rdm||0)/days; a._chgD=a._currD-a._prevD;
      a._prevExpD=(a.prev_exp||0)/days; a._currExpD=(a.curr_exp||0)/days;
      a._dExp = a._prevExpD?((a._currExpD-a._prevExpD)/a._prevExpD*100).toFixed(2):null;
      a._dRdm = a._prevD?((a._currD-a._prevD)/a._prevD*100).toFixed(2):null;
    });
    acts.sort((x,y)=>x._chgD-y._chgD);
    const rows=acts.map(a=>{
      const p=pillMap[a.status];
      const share=((a.curr_rdm||0)/total*100);
      const dRate = (a.rate!=null && a.prev_rate!=null && a.rate<=50 && a.prev_rate<=50) ? (a.rate-a.prev_rate).toFixed(2) : null;
      return `<tr>
        <td><span class="pill ${p[0]}">${p[1]}</span></td>
        <td>${a.aid}</td>
        <td>${a.name}</td>
        <td class="${cls(a._chgD)}">${a._chgD>=0?'+':''}${fmt(a._chgD)}</td>
        <td class="${cls(parseFloat(a._dRdm)||0)}">${a._dRdm==null?'—':(a._dRdm>=0?'+':'')+a._dRdm+'%'}</td>
        <td>${fmt(a._currD)}</td>
        <td>${fmt(a._prevD)}</td>
        <td class="${cls(parseFloat(a._dExp)||0)}">${a._dExp==null?'—':(a._dExp>=0?'+':'')+a._dExp+'%'}</td>
        <td>${fmt(a._currExpD)}</td>
        <td>${fmt(a._prevExpD)}</td>
        <td class="${cls(parseFloat(dRate)||0)}">${dRate==null?'—':(dRate>=0?'+':'')+dRate+'pp'}</td>
        <td>${safePct(a.rate)}</td>
        <td>${safePct(a.prev_rate)}</td>
        <td>${share.toFixed(1)}%</td>
        <td>${a.coupon}</td>
        <td>${a.discount_amt}</td>
        <td>${a.threshold}</td>
        <td>${a.price_power}</td>
        <td>${a.store_cov}</td>
        <td>${a.mode}</td>
        <td>${a.target_tag}</td>
        <td>${a.has_city_pack}</td>
        <td>${a.has_crowd_pack}</td>
        <td>${a.online_time}</td>
        <td>${a.offline_time}</td>
        <td>${a.daily_limit}</td>
        <td>${a.user_daily_limit}</td>
        <td>${a.total_stock}</td>
      </tr>`}).join("");
    return `<div class="tbl-wrap act-full">
      <table id="brand-activity" class="act-full">
        <thead><tr>
          <th>状态</th><th>活动ID</th><th>活动名称</th>
          <th>日均核销变化(绝对)</th><th>核销环比</th><th>本期日均核销</th><th>上期日均核销</th>
          <th>曝光环比</th><th>本期日均曝光</th><th>上期日均曝光</th>
          <th>率环比</th><th>本期曝光核销率</th><th>上期曝光核销率</th><th>核销占比</th>
          <th>券类型(最细)</th><th>优惠面额</th><th>门槛(¥)</th><th>价格力(%)</th>
          <th>门店覆盖度</th><th>投放模式</th><th>定向标签</th>
          <th>城市包</th><th>人群包</th><th>上线</th><th>结束(下线)</th>
          <th>单日限领</th><th>单用户限领</th><th>库存</th>
        </tr></thead>
        <tbody>${rows||`<tr><td colspan="28" class="muted">该品牌暂无活动明细</td></tr>`}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:8px">说明：日均 = 窗口内汇总 ÷ 14 天；「核销变化量」= 本期日均 − 上期日均；活动按核销变化量升序（下降最多排最前）。展示门槛：曝光 ≥100/天 或 日均核销 ≥100，仅过滤「曝光=0 且 核销=0」的活动（次卡等零曝光有核销的活动一并列出，故本表合计与品牌行口径一致）。点击活动行查看逐日趋势。</p>
    <div id="act-trend-panel" style="margin-top:10px;display:none">
      <div class="bk-trend-row">
        <div class="bk-trend-cell"><h4 style="margin:0 0 4px;font-size:13px">核销PV（逐日·万）</h4><canvas id="act-rdm" height="200"></canvas></div>
        <div class="bk-trend-cell"><h4 style="margin:0 0 4px;font-size:13px">曝光PV（逐日·万）</h4><canvas id="act-exp" height="200"></canvas></div>
        <div class="bk-trend-cell"><h4 style="margin:0 0 4px;font-size:13px">曝光核销率（%）</h4><canvas id="act-rate" height="200"></canvas></div>
      </div>
    </div>`;
  }

  // ---- 活动替换对比（以「下降活动」为中心，找同名同类替代，逐字段比对）----
  function renderReplace(b){
    const D=b.days||14;
    const cls=v=>v>=0?"val-up":"val-down";
    const tmpl=a=> (b.name && a.name && a.name.startsWith(b.name)) ? a.name.slice(b.name.length) : a.name;
    const acts=B.activities.filter(a=>a.brand===b.name).slice();
    acts.forEach(a=>{ a._d=((a.curr_rdm||0)-(a.prev_rdm||0))/D; a._pr=(a.prev_rdm||0)/D; a._cr=(a.curr_rdm||0)/D;
      a._pe=(a.prev_exp||0)/D; a._ce=(a.curr_exp||0)/D; });
    const kept=acts.filter(a=> (a._pe>=100||a._ce>=100)||(a._pr>=100||a._cr>=100));
    const centers=kept.filter(a=>a.status==="off" && a._d<0).sort((x,y)=>x._d-y._d);
    const repPool=kept.filter(a=>a.status==="new"||a.status==="on");
    const repAll=repPool.reduce((s,a)=>s+a._d,0);
    const offAll=kept.filter(a=>a.status==="off");
    const totOff=offAll.reduce((s,a)=>s+a._d,0);
    const numOf=s=>{ if(s==null) return null; const m=String(s).match(/-?\d+(\.\d+)?/); return m?parseFloat(m[0]):null; };
    const FIELDS=[["优惠金额","discount_amt","amt"],["门槛","threshold","thr"],["价格力","price_power","pp"],
      ["投放天数","deliver_days","days"],["投放区间","_period","period"],
      ["频次标签","target_tag","txt"],["定向城市","has_city_pack","txt"],["定向人群包","has_crowd_pack","txt"],["门店覆盖度","store_cov","txt"]];
    const rawOf=(a,key)=> a==null?null : (key==="_period" ? ((a.online_time||"—")+" ~ "+(a.offline_time||"—")) : a[key]);
    const dispOf=(a,key,kind)=>{ const v=rawOf(a,key); if(v==null||v==="") return "—"; return kind==="days" ? v+"天" : v; };
    const fieldRows=(base,rep)=>FIELDS.map(([lab,key,kind])=>{
      const bv=rawOf(base,key), rv=rawOf(rep,key);
      const self = rep || base;             // 基准卡片展示活动自身字段；替代卡片展示替代活动字段
      const show = dispOf(self,key,kind);
      const diff = rep && String(bv??"—")!==String(rv??"—");
      let arrow="";
      if(diff && kind!=="txt" && kind!=="amt" && kind!=="period"){ const bn=numOf(bv),rn=numOf(rv); if(bn!=null&&rn!=null) arrow = rn>bn?" ↑":(rn<bn?" ↓":""); }
      return `<div class="rc-f ${diff?'rc-diff':''}"><span class="rc-fl">${lab}</span><span class="rc-fv">${show}${arrow}</span></div>`;
    }).join("");
    const card=a=>`<div class="rc-card">
        <div class="rc-top"><span class="pill ${a.status}">${a.status==="off"?"已下线":a.status==="new"?"新上线":"持续在线"}</span>
          <span class="rc-name">${a.name}</span><span class="rc-aid">#${a.aid}</span></div>
        <div class="rc-d ${cls(a._d)}">${a._d>=0?'+':''}${fmt(a._d)} <span class="rc-u">/天</span></div>
        <div class="rc-fields">${fieldRows(a,null)}</div>
      </div>`;
    const repCard=(base,rep)=>`<div class="rc-card rep">
        <div class="rc-top"><span class="pill ${rep.status}">${rep.status==="off"?"已下线":rep.status==="new"?"新上线":"持续在线"}</span>
          <span class="rc-name">${rep.name}</span><span class="rc-aid">#${rep.aid}</span></div>
        <div class="rc-d ${cls(rep._d)}">${rep._d>=0?'+':''}${fmt(rep._d)} <span class="rc-u">/天</span></div>
        <div class="rc-fields">${fieldRows(base,rep)}</div>
      </div>`;
    let body="";
    for(const c of centers){
      const reps=repPool.filter(r=> tmpl(r)===tmpl(c) && r.coupon===c.coupon);
      body += `<div class="rc-pair">
        <div class="rc-ph"><span class="pill off">已下线</span>
          <span class="rc-tmpl">${tmpl(c)}</span><span class="rc-aid">#${c.aid}</span>
          <span class="rc-d val-down">${fmt(c._d)} <span class="rc-u">/天</span></span>
          <span class="rc-note">原活动：${c.name}</span>
          <span class="rc-repcnt">同名同类替代 ${reps.length} 个</span></div>
        <div class="rc-cols">
          <div class="rc-base"><div class="rc-colh">下降活动（基准）</div>${card(c)}</div>
          <div class="rc-reps ${reps.length?'':'no'}"><div class="rc-colh">同名同类替代</div>${
            reps.length ? reps.map(r=>repCard(c,r)).join("") 
                        : `<div class="rc-norep">无同名同类替代 · 缺口 ${fmt(c._d)}/天</div>`
          }</div>
        </div>
      </div>`;
    }
    const totGap=totOff+repAll;
    return `<div class="repl-wrap">
      <div class="repl-sum">下降活动合计 <b class="val-down">${fmt(totOff)}</b>/天 ｜ 新上/在线合计 <b class="val-up">+${fmt(repAll)}</b>/天 ｜ 净 <b class="${totGap>=0?'val-up':'val-down'}">${totGap>=0?'+':''}${fmt(totGap)}</b>/天</div>
      <p class="muted" style="margin:6px 0 8px;font-size:12px">对比逻辑：以「已下线且核销下降」的活动为中心，按「同名（去品牌前缀）+ 同券类型」匹配「新上线/持续在线」活动作替代；逐字段比对 优惠金额 / 门槛 / 价格力 / 投放天数 / 投放区间 / 频次标签 / 定向城市 / 定向人群包 / 门店覆盖度，差异字段高亮（橙色）。投放天数：下线活动=结束日期−开始日期；在线活动=本期最后一天−开始日期。仅含曝光≥100/天 或 日均核销≥100 的活动。数字为日均核销PV变化（万/天）。</p>
      ${body||'<p class="muted">该品牌无「已下线且核销下降」的活动，暂无可对比项。</p>'}
    </div>`;
  }

  // ---- 主绘制函数 ----
  function draw(b){
    cur=b;
    const auop=(b.auop!=null)?b.auop:30;
    document.getElementById("brand-count").textContent=`当前品牌：${b.name}（ID ${b.bid}，${b.ind}）`;

    const container=document.getElementById("brand-content");
    container.innerHTML=`
      <!-- 品牌标题 -->
      <div class="bk-header">
        <h2>${b.name}<small style="font-size:12px;color:var(--sub);font-weight:400;margin-left:8px">(ID:${b.bid}) 下钻分析</small></h2>
      </div>
      ${renderKPIs(b)}
      <!-- 子 tab -->
      <div class="bk-subtabs">
        <div class="bk-subtab active" data-btab="trend">趋势线</div>
        <div class="bk-subtab" data-btab="act">活动明细</div>
        <div class="bk-subtab" data-btab="repl">活动替换对比</div>
      </div>
      <p class="muted" style="margin:6px 0 4px;font-size:12px">💡 提示：在「活动明细」中点击任意活动行，可下钻查看该活动的逐日趋势线（核销PV / 曝光PV / 曝光核销率）。</p>
      <div class="bk-section active" data-bsc="trend">${renderTrends(b)}</div>
      <div class="bk-section" data-bsc="act">${renderActivities(b)}</div>
      <div class="bk-section" data-bsc="repl">${renderReplace(b)}</div>`;

    // 子 tab 切换
    container.querySelectorAll(".bk-subtab").forEach(t=>t.onclick=()=>{
      container.querySelectorAll(".bk-subtab").forEach(x=>x.classList.remove("active"));
      container.querySelectorAll(".bk-section").forEach(x=>x.classList.remove("active"));
      t.classList.add("active");
      container.querySelector(`.bk-section[data-bsc="${t.dataset.btab}"]`).classList.add("active");
    });

    // 活动替换对比：renderReplace 已为静态配对视图，无需动态绑定
    if (typeof __expose==="function") __expose({DATA, draw, renderReplace, B});

    // 渲染 3 组图（延迟到布局完成）
    requestAnimationFrame(()=>{
      dual("b-rdm", b.dates,
        {label:"核销PV",data:b.rdm}, null, {mAR:false});
      dual("b-exp-txn", b.dates,
        {label:"曝光PV",data:b.exp}, {label:"日均交易笔数",data:b.txn}, {mAR:false, oneAxis:true});
      dual("b-rate-share", b.dates,
        {label:"曝光核销率",data:b.rate.map(v=>v==null||v>50?null:v)}, {label:"核销占比",data:b.share}, {mAR:false, oneAxis:true});
    });
    // 活动明细行点击：下钻到活动逐日趋势
    container.querySelectorAll("#brand-activity tbody tr").forEach(tr=>{
      tr.style.cursor="pointer";
      tr.onclick=()=>{
        const cells=tr.querySelectorAll("td");
        const aid=cells[1]?.textContent?.trim();
        const panel=document.getElementById("act-trend-panel");
        panel.style.display="block";
        panel.scrollIntoView({behavior:"smooth",block:"nearest"});
        // 从活动数据中找到对应活动
        const a=B.activities.find(x=>String(x.aid)===aid);
        if(!a||!a.act_dates) return;
        // 计算逐日曝光核销率（safe: >50%→null）
        const rate=a.act_exp.map((e,i)=> e?((a.act_rdm[i]||0)/e*100):null).map(v=> v!=null&&v<=50?v:null);
        requestAnimationFrame(()=>{
          const w=1e4;
          dual("act-rdm", a.act_dates, {label:"核销PV(万)",data:a.act_rdm.map(v=>v/w)}, null, {mAR:false});
          dual("act-exp", a.act_dates, {label:"曝光PV(万)",data:a.act_exp.map(v=>v/w)}, null, {mAR:false});
          dual("act-rate", a.act_dates, {label:"曝光核销率(%)",data:rate}, null, {mAR:false});
        });
      };
    });
  }

  function applyFilter(){
    const bid=document.getElementById("f-bid").value.trim(), bname=document.getElementById("f-bname").value.trim();
    let list=B.brands.filter(b=>(!bid||String(b.bid)===bid)&&(!bname||b.name.includes(bname)));
    if(!list.length){ document.getElementById("brand-count").textContent="无匹配品牌"; return; }
    draw(list[0]);
  }
  document.getElementById("f-go").onclick=applyFilter;
  document.getElementById("f-reset").onclick=()=>{ document.getElementById("f-bid").value=""; document.getElementById("f-bname").value=""; draw(B.brands[0]); };
  draw(B.brands[0]);
}

// 从生命周期下钻到品牌明细（点击品牌行触发）
function gotoBrand(bid){
  const tb=document.querySelector('#biweekly-report-section .tab[data-tab="brand"]');
  if(tb) tb.click();
  document.getElementById("f-bid").value=bid;
  document.getElementById("f-bname").value="";
  const go=document.getElementById("f-go"); if(go) go.click();
  const p=document.getElementById("panel-brand"); if(p) p.scrollIntoView({behavior:"smooth"});
}

// tabs
document.querySelectorAll("#biweekly-report-section .tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll("#biweekly-report-section .tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll("#biweekly-report-section .panel").forEach(x=>x.classList.remove("active"));
  t.classList.add("active");
  const p=document.getElementById("panel-"+t.dataset.tab);
  p.classList.add("active");
  // 切换到该 tab 时延迟创建图表（避免 display:none 导致 Chart.js 失败）
  setTimeout(()=>renderSegmentCharts(t.dataset.tab), 50);
});

// init (由 act-temp 在「货盘双周报」tab 首次打开时懒加载调用)
window.initBiweeklyReport = function(){
  setWinNote();
  renderSegment("overall", DATA.overall);
  renderSegment("ka", DATA.ka);
  renderSegment("waist", DATA.waist);
  renderBrand();
};
