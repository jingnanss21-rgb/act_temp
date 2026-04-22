/**
 * best-practice.js - 三层交互：业态总览 → Top3详情抽屉 → 活动漏斗弹窗
 */

const CATEGORY_ORDER = ['茶饮咖啡', '中式快餐', '西式快餐', '正餐', '小吃', '甜品烘焙'];
const CATEGORY_EMOJI = { '茶饮咖啡': '🧋', '中式快餐': '🍚', '西式快餐': '🍔', '正餐': '🍽️', '小吃': '🍢', '甜品烘焙': '🍰' };
const CATEGORY_COLOR = { '茶饮咖啡': '#2563EB', '中式快餐': '#EA580C', '西式快餐': '#DC2626', '正餐': '#1E40AF', '小吃': '#CA8A04', '甜品烘焙': '#DB2777' };
const CATEGORY_BG = { '茶饮咖啡': '#EFF6FF', '中式快餐': '#FFF7ED', '西式快餐': '#FEF2F2', '正餐': '#EFF6FF', '小吃': '#FEFCE8', '甜品烘焙': '#FDF2F8' };
const CATEGORY_BAR = { '茶饮咖啡': '#93C5FD', '中式快餐': '#FDBA74', '西式快餐': '#FCA5A5', '正餐': '#93C5FD', '小吃': '#FDE68A', '甜品烘焙': '#F9A8D4' };

const RATE_CAPS = { exposure_claim: 0.40, claim_redeem: 0.80, exposure_redeem: 0.10, store_redeem: 1.00 };
const METRICS = [
  { key: 'exposure_claim',  label: '曝光领取率', calcField: 'exposure_claim_rate' },
  { key: 'claim_redeem',    label: '领取核销率', calcField: 'claim_redeem_rate' },
  { key: 'exposure_redeem', label: '曝光核销率', calcField: 'exposure_redeem_rate' },
  { key: 'store_redeem',    label: '到店核销率', calcField: 'store_redeem_rate' },
];

let bestPracticeData = {};
let allBrandDaily = [];
let allActivitiesForBP = [];
let trackedBrandIdsForDiag = new Set();
let latestByBrand = {};
let currentMetricIdx = 2; // 默认曝光核销率
let catMedians = {}; // 按类目的中位数

function isAnomalyActivity(item) {
  return item.exposure_claim_rate > RATE_CAPS.exposure_claim ||
    item.claim_redeem_rate > RATE_CAPS.claim_redeem ||
    item.exposure_redeem_rate > RATE_CAPS.exposure_redeem ||
    item.store_redeem_rate >= RATE_CAPS.store_redeem;
}

function isCategoryAllowed(catL4) {
  if (!catL4) return false;
  return CATEGORY_ORDER.some(kw => catL4.includes(kw));
}

function getCategoryKey(catL4) {
  if (!catL4) return null;
  return CATEGORY_ORDER.find(kw => catL4.includes(kw)) || null;
}

function parseRateValue(val) {
  if (val === null || val === undefined || val === '' || val === '<NA>') return NaN;
  const s = String(val).trim();
  if (s.endsWith('%')) return parseFloat(s) / 100;
  return parseFloat(s);
}

function fmtPct(v) {
  if (isNaN(v) || v === null || v === undefined) return '-';
  return (v * 100).toFixed(1) + '%';
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '' || v === '<NA>') return '-';
  const n = parseFloat(v);
  if (isNaN(n)) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function median(arr) {
  const sorted = arr.filter(v => !isNaN(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============================================================
// 数据加载
// ============================================================
async function loadBestPracticeData() {
  const container = document.getElementById('best-practice-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载数据中...</p></div>';

  try {
    const viewName = getViewName();
    const [actData, merchantResult] = await Promise.all([
      fetchAllFromView(viewName, '*'),
      supabaseClient.from('tem_merchant_contacts')
        .select('brand_id').limit(5000),
    ]);

    trackedBrandIdsForDiag = new Set();
    for (const m of (merchantResult.data || [])) {
      if (m.brand_id) trackedBrandIdsForDiag.add(String(m.brand_id));
    }

    // 构建 latestByBrand（从活动数据聚合）
    latestByBrand = {};
    for (const act of actData) {
      if (!act.brand_id) continue;
      if (!latestByBrand[act.brand_id]) {
        latestByBrand[act.brand_id] = {
          brand_id: act.brand_id,
          brand_name: act.brand_name,
          category_l4: act.category_name,
          w7_store_redeem_rate_uv: act.store_redeem_rate_uv,
          report_date: act.report_date || act.latest_date,
        };
      }
    }
    allBrandDaily = Object.values(latestByBrand);

    allActivitiesForBP = [];
    for (const act of actData) {
      const cat = act.category_name || '';
      if (!isCategoryAllowed(cat)) continue;

      const ePv = act.exposure_pv || 0;
      const cPv = act.claim_pv || 0;
      const rPv = act.redeem_pv || 0;
      const eUv = act.exposure_uv || 0;
      const cUv = act.claim_uv || 0;
      const rUv = act.redeem_uv || 0;
      if (ePv === 0 && eUv === 0) continue;

      // 到店相关始终UV口径
      const storeRate = parseRateValue(act.store_redeem_rate_uv);
      const claimToStoreRate = parseRateValue(act.claim_to_store_rate_uv);
      const storeVisitUv = (!isNaN(claimToStoreRate) && claimToStoreRate > 0 && cUv > 0)
        ? Math.round(cUv * claimToStoreRate) : null;

      const item = {
        brand_id: act.brand_id,
        brand_name: act.brand_name || '-',
        activity_name: act.activity_name || '',
        activity_id: act.activity_id,
        category_l4: cat,
        category_key: getCategoryKey(cat),
        // 原始数据双口径
        exposure_pv: ePv, claim_pv: cPv, redeem_pv: rPv,
        exposure_uv: eUv, claim_uv: cUv, redeem_uv: rUv,
        // 到店始终UV
        store_visit_uv: storeVisitUv,
        store_redeem_rate: storeRate,
        claim_to_store_rate: claimToStoreRate,
        brand_store_redeem_rate: storeRate,
        // 动态率（由 recomputeBestPractice 填充）
        exposure_claim_rate: 0, claim_redeem_rate: 0, exposure_redeem_rate: 0,
        is_anomaly: false,
        // V2 新字段
        batch_name: act.batch_name || '',
        price_power: act.price_power,
        total_stock: act.total_stock || 0,
        remain_stock: act.remain_stock || 0,
        start_date: act.start_date || '',
        end_date: act.end_date || '',
      };
      allActivitiesForBP.push(item);
    }

    recomputeBestPractice();
    renderLayer1();
    initBrandDiagnostics();
  } catch (err) {
    container.innerHTML = `<div class="loading"><p style="color:var(--danger);">数据加载失败: ${err.message}</p></div>`;
    console.error(err);
  }
}

// ============================================================
// 第一层：业态总览卡片
// ============================================================
function renderLayer1() {
  const metric = METRICS[currentMetricIdx];
  const container = document.getElementById('best-practice-container');

  // 指标 Tab
  let tabHtml = '<div class="bp-metric-tabs">';
  METRICS.forEach((m, idx) => {
    tabHtml += `<button class="bp-metric-tab ${idx === currentMetricIdx ? 'active' : ''}" onclick="switchBPMetric(${idx})">${m.label}</button>`;
  });
  tabHtml += '</div>';

  // 卡片矩阵
  let cardsHtml = '<div class="bp-card-grid">';
  for (const catKey of CATEGORY_ORDER) {
    const top3 = bestPracticeData[catKey]?.[metric.key] || [];
    const emoji = CATEGORY_EMOJI[catKey] || '';
    const color = CATEGORY_COLOR[catKey] || '#2563EB';
    const bg = CATEGORY_BG[catKey] || '#EFF6FF';
    const barColor = CATEGORY_BAR[catKey] || '#93C5FD';

    const top1 = top3[0];
    const top1Rate = top1 ? fmtPct(top1[metric.calcField]) : '-';
    const top1Brand = top1 ? top1.brand_name : '-';
    const top1Act = top1 ? top1.activity_name : '';

    // 最大值用于柱状图比例
    const maxRate = top3.length > 0 ? top3[0][metric.calcField] : 1;

    cardsHtml += `<div class="bp-card" style="border-top:3px solid ${color}" onclick="openLayer2('${catKey}')">
      <div class="bp-card-head">
        <span class="bp-card-emoji">${emoji}</span>
        <span class="bp-card-cat" style="color:${color}">${catKey}</span>
      </div>
      <div class="bp-card-top1">
        <div class="bp-card-top1-info">
          <div class="bp-top1-label">Top1：${top1Brand}</div>
          <div class="bp-top1-act" title="${top1Act}">${top1Act}</div>
        </div>
        <div class="bp-card-top1-rate">
          <div class="bp-rate-label">${metric.label}</div>
          <div class="bp-rate-value" style="color:${color}">${top1Rate}</div>
        </div>
      </div>
      <div class="bp-card-bars">`;

    for (let i = 0; i < 3; i++) {
      const item = top3[i];
      if (!item) {
        cardsHtml += `<div class="bp-bar-row"><span class="bp-bar-rank">Top${i+1}</span><span class="bp-bar-empty">-</span></div>`;
        continue;
      }
      const rate = item[metric.calcField];
      const pct = maxRate > 0 ? (rate / maxRate * 100) : 0;
      cardsHtml += `<div class="bp-bar-row">
        <span class="bp-bar-rank">${i === 0 ? 'Top1' : i === 1 ? 'Top2' : 'Top3'}</span>
        <div class="bp-bar-track"><div class="bp-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <span class="bp-bar-pct">${fmtPct(rate)}</span>
        <span class="bp-bar-name">${item.brand_name}</span>
      </div>`;
    }

    cardsHtml += `</div>
      <div class="bp-card-link" style="color:${color}">查看详情 →</div>
    </div>`;
  }
  cardsHtml += '</div>';

  container.innerHTML = tabHtml + cardsHtml;
}

function switchBPMetric(idx) {
  currentMetricIdx = idx;
  renderLayer1();
}

// ============================================================
// 根据当前UV/PV口径重算转化率、Top3、中位数
// ============================================================
function recomputeBestPractice() {
  const t = window.currentMetricType || 'uv';
  for (const item of allActivitiesForBP) {
    const e = t === 'uv' ? item.exposure_uv : item.exposure_pv;
    const c = t === 'uv' ? item.claim_uv : item.claim_pv;
    const r = t === 'uv' ? item.redeem_uv : item.redeem_pv;
    item.exposure_claim_rate = e > 0 ? c / e : 0;
    item.claim_redeem_rate = c > 0 ? r / c : 0;
    item.exposure_redeem_rate = e > 0 ? r / e : 0;
    // 到店始终UV口径不变
    item.is_anomaly = isAnomalyActivity(item);
  }

  bestPracticeData = {};
  catMedians = {};

  for (const catKey of CATEGORY_ORDER) {
    const catItems = allActivitiesForBP.filter(i => i.category_key === catKey);
    const normalItems = catItems.filter(i => !i.is_anomaly);

    bestPracticeData[catKey] = {};
    catMedians[catKey] = {};

    for (const mk of METRICS) {
      const vals = normalItems.map(i => i[mk.calcField]).filter(v => !isNaN(v) && v > 0);
      catMedians[catKey][mk.key] = median(vals);

      const sorted = [...normalItems]
        .filter(i => !isNaN(i[mk.calcField]) && i[mk.calcField] > 0)
        .sort((a, b) => b[mk.calcField] - a[mk.calcField]);
      bestPracticeData[catKey][mk.key] = sorted.slice(0, 3);
    }
    const ctsVals = normalItems.map(i => i.claim_to_store_rate).filter(v => !isNaN(v) && v > 0);
    catMedians[catKey].claim_to_store = median(ctsVals);
    const crVals = normalItems.map(i => i.claim_redeem_rate).filter(v => !isNaN(v) && v > 0);
    catMedians[catKey].claim_redeem = median(crVals);
  }
}

// ============================================================
// 第二层：右侧抽屉 - 单业态 Top3 详情
// ============================================================
function openLayer2(catKey) {
  // 移除已有抽屉
  closeLayer2();

  const metric = METRICS[currentMetricIdx];
  const emoji = CATEGORY_EMOJI[catKey] || '';
  const color = CATEGORY_COLOR[catKey] || '#2563EB';

  // 创建 overlay + drawer
  const overlay = document.createElement('div');
  overlay.id = 'bp-overlay';
  overlay.className = 'bp-overlay';
  overlay.onclick = closeLayer2;
  document.body.appendChild(overlay);

  const drawer = document.createElement('div');
  drawer.id = 'bp-drawer';
  drawer.className = 'bp-drawer';
  drawer.onclick = (e) => e.stopPropagation();

  function renderDrawerContent(metricIdx) {
    const mk = METRICS[metricIdx];
    const top3 = bestPracticeData[catKey]?.[mk.key] || [];

    let html = `<div class="drawer-header">
      <div class="drawer-title">${emoji} ${catKey} · ${mk.label} Top3</div>
      <button class="drawer-close" onclick="closeLayer2()">✕</button>
    </div>
    <div class="drawer-tabs">`;

    METRICS.forEach((m, idx) => {
      html += `<button class="drawer-tab ${idx === metricIdx ? 'active' : ''}" style="${idx === metricIdx ? `color:${color};border-color:${color}` : ''}" onclick="event.stopPropagation(); updateDrawer('${catKey}', ${idx})">${m.label}</button>`;
    });
    html += '</div><div class="drawer-body">';

    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < top3.length; i++) {
      const item = top3[i];
      const rateVal = item[mk.calcField];

      // 到店人数倒推
      const storeVisit = item.store_visit_uv;
      const storeVisitStr = storeVisit !== null ? fmtNum(storeVisit) : '-';

      html += `<div class="drawer-card" onclick="event.stopPropagation(); openLayer3('${catKey}', '${item.activity_id}', '${item.brand_id}')">
        <div class="drawer-card-head">
          <span class="drawer-medal">${medals[i]}</span>
          <div class="drawer-card-info">
            <div class="drawer-brand">${item.brand_name}</div>
            <div class="drawer-act">${item.activity_name}</div>
          </div>
        </div>
        <div class="drawer-metrics">`;

      // 4 个指标全量展示
      for (const mm of METRICS) {
        const v = item[mm.calcField];
        const isActive = mm.key === mk.key;
        html += `<div class="drawer-metric-item ${isActive ? 'active' : ''}">
          <span class="dm-label">${mm.label}</span>
          <span class="dm-value" ${isActive ? `style="color:${color};font-weight:700"` : ''}>${fmtPct(v)}</span>
        </div>`;
      }

      // 渐变漏斗（曝光→领取→到店→核销）
      const funnelSteps = [
        { label: '曝光', value: item.exposure_uv, est: false },
        { label: '领取', value: item.claim_uv, est: false },
        { label: '到店', value: storeVisit, est: true },
        { label: '核销', value: item.redeem_uv, est: false },
      ];
      const maxFunnel = Math.max(...funnelSteps.map(s => s.value || 0), 1);

      html += `</div>
        <div class="drawer-funnel-gradient" style="align-items:flex-start">`;
      for (let fi = 0; fi < funnelSteps.length; fi++) {
        const step = funnelSteps[fi];
        const opacity = 1 - fi * 0.15;
        const numStr = step.value ? fmtNum(step.value) : '-';
        const estLabel = step.est ? '*预估' : '&nbsp;';
        const estColor = step.est ? 'color:#FAAD14' : 'visibility:hidden';
        html += `<div class="fg-step" style="flex:1;text-align:center">
          <div class="fg-bar" style="background:${color};opacity:${opacity};min-height:50px">
            <span class="fg-label">${step.label}</span>
            <span class="fg-num">${numStr}</span>
          </div>
          <div style="font-size:9px;${estColor};margin-top:2px;line-height:1.2;cursor:${step.est?'help':'default'}" ${step.est?'title="到店人数 = 领取人数 × 领取到店率"':''}>${estLabel}</div>
        </div>`;
        if (fi < funnelSteps.length - 1) {
          html += `<div class="fg-arrow">▶</div>`;
        }
      }
      html += `</div>
      </div>`;
    }

    if (top3.length === 0) {
      html += '<div style="text-align:center;color:var(--text-muted);padding:40px">该业态暂无数据</div>';
    }

    html += '</div>';
    return html;
  }

  drawer.innerHTML = renderDrawerContent(currentMetricIdx);
  document.body.appendChild(drawer);

  // 触发动画
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    drawer.classList.add('show');
  });

  // 保存 updateDrawer 到全局
  window._currentDrawerCat = catKey;
  window.updateDrawer = function(cat, idx) {
    const d = document.getElementById('bp-drawer');
    if (d) d.innerHTML = renderDrawerContent(idx);
  };
}

function closeLayer2() {
  const overlay = document.getElementById('bp-overlay');
  const drawer = document.getElementById('bp-drawer');
  if (overlay) overlay.remove();
  if (drawer) drawer.remove();
  closeLayer3();
}

// ============================================================
// 第三层：弹窗 - 活动转化漏斗详情
// ============================================================
function openLayer3(catKey, activityId, brandId) {
  closeLayer3();

  const item = allActivitiesForBP.find(a => a.activity_id === activityId && String(a.brand_id) === String(brandId));
  if (!item) return;

  const emoji = CATEGORY_EMOJI[catKey] || '';
  const color = CATEGORY_COLOR[catKey] || '#2563EB';
  const meds = catMedians[catKey] || {};

  // 根据当前口径取值
  const t = window.currentMetricType || 'uv';
  const isPV = t === 'pv';
  const unitLabel = isPV ? '次' : '人';
  const exposureVal = isPV ? item.exposure_pv : item.exposure_uv;
  const claimVal = isPV ? item.claim_pv : item.claim_uv;
  const redeemVal = isPV ? item.redeem_pv : item.redeem_uv;
  // 到店始终UV
  const storeVisitUv = item.store_visit_uv;

  // 转化率（按当前口径重算）
  const expClm = item.exposure_claim_rate;
  const clmRdm = item.claim_redeem_rate;
  const storeRdm = item.store_redeem_rate;
  const expRdm = item.exposure_redeem_rate;
  // 领取到店率：直接用DB真实值
  const clmToStore = item.claim_to_store_rate;

  // 流失率
  function lossRate(conv) { return isNaN(conv) ? NaN : 1 - conv; }

  function comparisonRow(label, val, med) {
    const valStr = fmtPct(val);
    const medStr = fmtPct(med);
    const isBetter = !isNaN(val) && !isNaN(med) && val >= med;
    const diffClass = isBetter ? 'cmp-good' : 'cmp-bad';
    const diffIcon = isBetter ? '↑ 优于均值' : '↓ 低于均值';
    return `<tr>
      <td class="cmp-label">${label}</td>
      <td class="cmp-val ${diffClass}">${valStr}</td>
      <td class="cmp-med">${medStr}</td>
      <td class="cmp-diff ${diffClass}">${(!isNaN(val) && !isNaN(med)) ? diffIcon : '-'}</td>
    </tr>`;
  }

  const modal = document.createElement('div');
  modal.id = 'bp-modal';
  modal.className = 'bp-modal';
  modal.onclick = closeLayer3;

  modal.innerHTML = `<div class="bp-modal-content" onclick="event.stopPropagation()">
    <div class="modal-header">
      <div>
        <div class="modal-title">${emoji} ${item.brand_name} — ${item.activity_name}</div>
        <div class="modal-subtitle">${catKey} | 活动转化漏斗详情</div>
      </div>
      <button class="modal-close" onclick="closeLayer3()">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-left">
        <div class="funnel-full">
          <div class="funnel-level" style="width:100%;background:${color}">
            <span class="fl-text">曝光${unitLabel} = ${fmtNum(exposureVal)}${unitLabel}</span>
          </div>
          <div class="funnel-transition">
            <span class="ft-label">曝光领取率</span>
            <span class="ft-conv">${fmtPct(expClm)}</span>
            <span class="ft-loss">| 流失率 ${fmtPct(lossRate(expClm))}</span>
          </div>
          <div class="funnel-level" style="width:85%;background:${color}CC">
            <span class="fl-text">领取${unitLabel} = ${fmtNum(claimVal)}${unitLabel}</span>
          </div>
          <div class="funnel-transition">
            <span class="ft-label">领取到店率</span>
            <span class="ft-conv">${fmtPct(clmToStore)}</span>
            <span class="ft-loss">| 流失率 ${fmtPct(lossRate(clmToStore))}</span>
          </div>
          <div class="funnel-level" style="width:65%;background:${color}AA">
            <span class="fl-text">到店人数 *预估 = ${storeVisitUv !== null ? fmtNum(storeVisitUv) : '-'}人${isPV ? ' <span style="font-size:10px;opacity:0.7">(UV口径)</span>' : ''}</span>
          </div>
          <div class="funnel-transition">
            <span class="ft-label">到店核销率</span>
            <span class="ft-conv">${fmtPct(storeRdm)}</span>
            <span class="ft-loss">| 流失率 ${fmtPct(lossRate(storeRdm))}</span>
          </div>
          <div class="funnel-level" style="width:45%;background:${color}88">
            <span class="fl-text">核销${unitLabel} = ${fmtNum(redeemVal)}${unitLabel}</span>
          </div>
        </div>
      </div>
      <div class="modal-right">
        <div class="cmp-title">对比业态均值</div>
        <div style="font-size:11px;color:#8C8C8C;margin-bottom:6px">🔄 过程指标（漏斗转化链路）</div>
        <table class="cmp-table">
          <thead><tr><th></th><th>本活动</th><th>${catKey}均值</th><th></th></tr></thead>
          <tbody>
            ${comparisonRow('曝光领取率', expClm, meds.exposure_claim)}
            ${comparisonRow('领取核销率', clmRdm, meds.claim_redeem)}
            ${comparisonRow('领取到店率', clmToStore, meds.claim_to_store)}
            ${comparisonRow('到店核销率', storeRdm, meds.store_redeem)}
            ${comparisonRow('全链路转化率<br><span style="font-size:10px;color:#8C8C8C">(曝光核销率)</span>', expRdm, meds.exposure_redeem)}
          </tbody>
        </table>
        <div class="cmp-note">数据更新时间：${latestByBrand[item.brand_id]?.report_date || '-'}</div>
        <div class="cmp-note" style="margin-top:4px;font-size:10px;color:#94A3B8">口径说明：转化率均为活动维度UV口径；到店人数 = 领取人数 × 领取到店率（预估）</div>
      </div>
    </div>
  </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('show'));
}

function closeLayer3() {
  const modal = document.getElementById('bp-modal');
  if (modal) modal.remove();
}

// ============================================================
// 品牌诊断卡片（保留原有功能）
// ============================================================
let diagBrandList = [];

function initBrandDiagnostics() {
  diagBrandList = allBrandDaily
    .filter(b => b.brand_name && b.category_l4 && trackedBrandIdsForDiag.has(String(b.brand_id)))
    .sort((a, b) => (a.brand_name || '').localeCompare(b.brand_name || ''));

  const input = document.getElementById('brand-diag-input');
  if (!input) return;

  input.addEventListener('input', () => showDiagDropdown(input.value.trim().toLowerCase()));
  input.addEventListener('focus', () => showDiagDropdown(input.value.trim().toLowerCase()));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.diag-search-wrap')) {
      document.getElementById('brand-diag-dropdown')?.classList.remove('show');
    }
  });
}

function showDiagDropdown(keyword) {
  const dropdown = document.getElementById('brand-diag-dropdown');
  if (!dropdown) return;
  let filtered = diagBrandList;
  if (keyword) {
    filtered = diagBrandList.filter(b => (b.brand_name || '').toLowerCase().includes(keyword) || (b.brand_id || '').toLowerCase().includes(keyword));
  }
  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px">未找到匹配品牌</div>';
  } else {
    dropdown.innerHTML = filtered.slice(0, 30).map(b =>
      `<div class="diag-search-item" onclick="selectDiagBrand('${b.brand_id}')">
        <span class="brand-info">${b.brand_id} - ${b.brand_name}</span>
        <span class="cat-info">${b.category_l4 || ''}</span>
      </div>`
    ).join('');
  }
  dropdown.classList.add('show');
}

let selectedDiagBrandId = '';

function selectDiagBrand(brandId) {
  const brand = diagBrandList.find(b => b.brand_id === brandId);
  if (!brand) return;
  selectedDiagBrandId = brandId;
  document.getElementById('brand-diag-input').value = `${brand.brand_id} - ${brand.brand_name}`;
  document.getElementById('brand-diag-dropdown')?.classList.remove('show');
}

function generateDiagCard() {
  if (!selectedDiagBrandId) { alert('请先选择品牌'); return; }
  const brand = allBrandDaily.find(b => b.brand_id === selectedDiagBrandId);
  if (!brand) { alert('未找到品牌数据'); return; }

  const cat = brand.category_l4;
  const catKey = getCategoryKey(cat);
  const sameCatBrands = allBrandDaily.filter(b => getCategoryKey(b.category_l4) === catKey);
  const brandActivities = allActivitiesForBP.filter(a => String(a.brand_id) === String(selectedDiagBrandId));
  const sameCatActivities = allActivitiesForBP.filter(a => a.category_key === catKey && !a.is_anomaly);

  const totalExpPv = brandActivities.reduce((s, a) => s + a.exposure_pv, 0);
  const totalClmPv = brandActivities.reduce((s, a) => s + a.claim_pv, 0);
  const totalRdmPv = brandActivities.reduce((s, a) => s + a.redeem_pv, 0);

  const meds = catMedians[catKey] || {};
  const storeRate = parseRateValue(brand.w7_store_redeem_rate_uv);

  const container = document.getElementById('diag-card-container');

  let html = `<div class="diag-card" id="diag-card-export">
    <div class="diag-header">
      <div class="diag-brand-name">${CATEGORY_EMOJI[catKey] || ''} ${brand.brand_name}</div>
      <div class="diag-cat">${cat} | 数据日期：${brand.report_date || '-'}</div>
    </div>
    <h3 class="diag-subtitle">📊 品牌活动表现</h3>
    <table class="diag-table"><thead><tr>
      <th>活动名称</th><th>曝光PV</th><th>领取PV</th><th>核销PV</th>
      <th>曝光占比</th><th>领取占比</th><th>核销占比</th>
      <th>曝光领取率</th><th>中位</th><th>领取核销率</th><th>中位</th>
      <th>曝光核销率</th><th>中位</th><th>到店核销率</th><th>中位</th>
    </tr></thead><tbody>`;

  for (const act of brandActivities) {
    const expShare = totalExpPv > 0 ? act.exposure_pv / totalExpPv : 0;
    const clmShare = totalClmPv > 0 ? act.claim_pv / totalClmPv : 0;
    const rdmShare = totalRdmPv > 0 ? act.redeem_pv / totalRdmPv : 0;
    html += `<tr>
      <td title="${act.activity_name}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${act.activity_name}</td>
      <td>${fmtNum(act.exposure_pv)}</td><td>${fmtNum(act.claim_pv)}</td><td>${fmtNum(act.redeem_pv)}</td>
      <td>${fmtPct(expShare)}</td><td>${fmtPct(clmShare)}</td><td>${fmtPct(rdmShare)}</td>
      <td class="${act.pv_exposure_claim > (meds.exposure_claim||0) ? 'rate-above' : 'rate-below'}">${fmtPct(act.pv_exposure_claim || (act.exposure_pv > 0 ? act.claim_pv/act.exposure_pv : 0))}</td>
      <td style="color:var(--text-muted)">${fmtPct(meds.exposure_claim)}</td>
      <td class="${act.pv_claim_redeem > (meds.claim_redeem||0) ? 'rate-above' : 'rate-below'}">${fmtPct(act.claim_pv > 0 ? act.redeem_pv/act.claim_pv : 0)}</td>
      <td style="color:var(--text-muted)">${fmtPct(meds.claim_redeem)}</td>
      <td class="${act.pv_exposure_redeem > (meds.exposure_redeem||0) ? 'rate-above' : 'rate-below'}">${fmtPct(act.exposure_pv > 0 ? act.redeem_pv/act.exposure_pv : 0)}</td>
      <td style="color:var(--text-muted)">${fmtPct(meds.exposure_redeem)}</td>
      <td class="${storeRate > (meds.store_redeem||0) ? 'rate-above' : 'rate-below'}">${fmtPct(storeRate)}</td>
      <td style="color:var(--text-muted)">${fmtPct(meds.store_redeem)}</td>
    </tr>`;
  }
  if (brandActivities.length === 0) {
    html += '<tr><td colspan="15" style="text-align:center;color:var(--text-muted);padding:16px">暂无活动数据</td></tr>';
  }

  const storeRedeem1 = brand.w7_avg_store_redeem;
  html += `</tbody><tfoot><tr style="font-weight:600;background:#F0F5FF">
    <td>🔖 品牌汇总</td><td>${fmtNum(totalExpPv)}</td><td>${fmtNum(totalClmPv)}</td><td>${fmtNum(totalRdmPv)}</td>
    <td colspan="3"></td>
    <td>${fmtPct(totalExpPv > 0 ? totalClmPv/totalExpPv : 0)}</td><td></td>
    <td>${fmtPct(totalClmPv > 0 ? totalRdmPv/totalClmPv : 0)}</td><td></td>
    <td>${fmtPct(totalExpPv > 0 ? totalRdmPv/totalExpPv : 0)}</td><td></td>
    <td colspan="2">1店几核: ${storeRedeem1 && storeRedeem1 !== '<NA>' ? parseFloat(storeRedeem1).toFixed(2) : '-'}</td>
  </tr></tfoot></table>`;

  // 最佳实践
  const bestItems = {};
  for (const mk of METRICS) {
    const sorted = sameCatActivities.filter(i => !isNaN(i[mk.calcField]) && i[mk.calcField] > 0).sort((a, b) => b[mk.calcField] - a[mk.calcField]);
    bestItems[mk.key] = sorted[0] || null;
  }

  html += `<h3 class="diag-subtitle" style="margin-top:20px">🏆 行业最佳实践（${catKey}）</h3>
    <table class="diag-table"><thead><tr><th>指标</th><th>最佳值</th><th>最佳品牌</th><th>最佳活动</th></tr></thead><tbody>`;

  for (const mk of METRICS) {
    const best = bestItems[mk.key];
    if (best) {
      html += `<tr><td style="font-weight:500">${mk.label}</td><td style="color:var(--primary);font-weight:600">${fmtPct(best[mk.calcField])}</td><td>${best.brand_name}</td><td title="${best.activity_name}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${best.activity_name}</td></tr>`;
    }
  }

  html += `</tbody></table>
    <div class="diag-footer">类目品牌数：${sameCatBrands.length} | 类目活动数：${sameCatActivities.length}</div>
  </div>
  <button class="btn-primary" style="margin-top:12px" onclick="exportDiagCard()">📥 导出诊断卡片</button>`;

  container.innerHTML = html;
}

async function exportDiagCard() {
  const card = document.getElementById('diag-card-export');
  if (!card) return;
  try {
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: '#F8FAFC' });
    const link = document.createElement('a');
    link.download = `诊断卡片_${card.querySelector('.diag-brand-name')?.textContent || '品牌'}_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) { alert('导出失败: ' + err.message); }
}
