// ============================================================
// 品牌诊断 Tab — 独立页面
// 区域 A: 品牌概览 + 健康评分
// 区域 B: 雷达图 + 指标对比表
// 区域 C: 行业标杆参考（刻度尺 + Top3）
// 区域 D: 活动明细（卡片式 2×2 网格）
// ============================================================

// 全局数据
let diagActivities = [];
let diagBrandDaily = {};
let diagMerchants = {};
let diagCatMedians = {};
let diagCatBest = {};     // category -> { metric -> max value } // FIX: Bug #2 - 改为取真正的 max
let diagCatP25 = {};
let diagCatP85 = {};      // 85th percentile（前15%水平线）
let diagCatTop3 = {};
let diagAllBrands = [];
let diagCurrentBrand = null;
let diagSelectedMetric = 'exposure_claim';
let diagViewMode = 'card';
let diagMode = 'full'; // 'full' | 'external'

const DIAG_METRICS = [
  { key: 'exposure_claim', label: '曝光领取率', desc: '券吸引力' },
  { key: 'claim_redeem', label: '领取核销率', desc: '券转化力' },
  { key: 'exposure_redeem', label: '曝光核销率', desc: '全链路效率' },
  { key: 'store_redeem', label: '到店核销率', desc: '到店转化力' },
];

const DIAG_METRICS_EXT = [
  { key: 'claim_redeem', label: '领取核销率', desc: '券转化力' },
  { key: 'store_redeem', label: '到店核销率', desc: '到店转化力' },
];

const DIAG_CATEGORIES = ['茶饮咖啡', '中式快餐', '西式快餐', '正餐', '小吃', '甜品烘焙'];

// ============================================================
// 初始化
// ============================================================
async function initDiagnosis() {
  const container = document.getElementById('diagnosis-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载品牌诊断数据...</p></div>';

  try {
    // 分页拉取全量活动数据（Supabase 默认只返回1000行）
    async function fetchAllRows(table, select) {
      let all = [], offset = 0, limit = 1000;
      while (true) {
        const { data, error } = await supabaseClient.from(table).select(select).range(offset, offset + limit - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < limit) break;
        offset += limit;
      }
      return all;
    }

    const [actData, mcRes, brandCatRes] = await Promise.all([
      fetchAllFromView(getViewName(), '*'),
      supabaseClient.from('tem_merchant_contacts').select('brand_id,brand_name,operating_sp,contact_assistant'),
      supabaseClient.from('tem_brand_daily')
        .select('brand_id, category_l4')
        .order('report_date', { ascending: false }).limit(5000),
    ]);

    // 品牌→类目映射（品牌日报四级类目）
    const brandCatMap = {};
    for (const r of (brandCatRes.data || [])) {
      if (r.brand_id && r.category_l4 && !brandCatMap[r.brand_id]) {
        brandCatMap[r.brand_id] = r.category_l4;
      }
    }

    // 统一写入类目
    for (const a of actData) {
      a._category = brandCatMap[a.brand_id] || a.category_name || '';
    }

    diagActivities = actData.filter(a => a.exposure_uv > 0 && a.exposure_pv > 0);

    for (const mc of (mcRes.data || [])) {
      diagMerchants[mc.brand_id] = mc;
    }

    // FIX: Bug #1 - 活动去重（按 activity_id 去重，避免重复 report_date 导致同活动出现多次）
    const seenActs = new Set();
    const uniqueActivities = [];
    for (const a of diagActivities) {
      const key = `${a.brand_id}_${a.activity_id}`;
      if (!seenActs.has(key)) {
        seenActs.add(key);
        uniqueActivities.push(a);
      }
    }
    diagActivities = uniqueActivities;

    const brandSet = new Set();
    diagAllBrands = [];
    for (const a of diagActivities) {
      if (!brandSet.has(a.brand_id) && diagMerchants[a.brand_id]) {
        brandSet.add(a.brand_id);
        diagAllBrands.push({ brand_id: a.brand_id, brand_name: a.brand_name });
      }
    }
    diagAllBrands.sort((a, b) => a.brand_name.localeCompare(b.brand_name, 'zh'));

    computeCategoryStats();
    renderDiagSearch(container);
  } catch (err) {
    container.innerHTML = `<div style="padding:32px;color:#DC2626">加载失败: ${err.message}</div>`;
  }
}

// ============================================================
// 计算类目统计
// ============================================================
function computeCategoryStats() {
  const catActivities = {};
  for (const a of diagActivities) {
    // 类目统一从品牌日报取
    const cat = a._category;
    if (!cat || !DIAG_CATEGORIES.includes(cat)) continue;

    // V2: 到店核销率直接用活动级 store_redeem_rate_uv
    const storeRateRaw = a.store_redeem_rate_uv;

    // 到店人数预估
    const storeRedeem = parseStoreRate(storeRateRaw);
    const dbClaimToStoreRate = parseStoreRate(a.claim_to_store_rate_uv);
    const rUv = a.redeem_uv || 0;
    const cUv = a.claim_uv || 0;
    // 次卡场景：用 领取UV × 领取到店率 正向估算
    const isMultiUse = a.coupon_type && a.coupon_type.indexOf('次卡') >= 0;
    let storeVisitUv = null;
    if (isMultiUse) {
      storeVisitUv = (!isNaN(dbClaimToStoreRate) && dbClaimToStoreRate > 0 && cUv > 0)
        ? Math.round(cUv * dbClaimToStoreRate) : null;
    } else {
      storeVisitUv = (!isNaN(storeRedeem) && storeRedeem > 0 && rUv > 0)
        ? Math.round(rUv / storeRedeem) : null;
    }
    // 领取到店率：次卡用DB真实值，其他由预估到店反推
    const claimToStoreRate = isMultiUse
      ? (isNaN(dbClaimToStoreRate) ? NaN : dbClaimToStoreRate)
      : ((storeVisitUv !== null && cUv > 0) ? storeVisitUv / cUv : dbClaimToStoreRate);

    // 根据当前UV/PV口径取值
    const t = window.currentMetricType || 'uv';
    const eVal = t === 'uv' ? (a.exposure_uv || 0) : (a.exposure_pv || 0);
    const cVal = t === 'uv' ? (a.claim_uv || 0) : (a.claim_pv || 0);
    const rVal = t === 'uv' ? (a.redeem_uv || 0) : (a.redeem_pv || 0);

    const item = {
      ...a,
      category: cat,
      exposure_claim: eVal > 0 ? cVal / eVal : 0,
      claim_redeem: cVal > 0 ? rVal / cVal : 0,
      exposure_redeem: eVal > 0 ? rVal / eVal : 0,
      store_redeem: storeRedeem,
      claim_to_store_rate: claimToStoreRate,
      store_visit_uv: storeVisitUv,
    };

    if (item.exposure_claim > (RATE_CAPS.exposure_claim || 1)) continue;
    if (item.claim_redeem > (RATE_CAPS.claim_redeem || 1)) continue;
    if (item.exposure_redeem > (RATE_CAPS.exposure_redeem || 1)) continue;
    if (item.store_redeem >= 1.0) continue;

    if (!catActivities[cat]) catActivities[cat] = [];
    catActivities[cat].push(item);
  }

  for (const cat of DIAG_CATEGORIES) {
    const items = catActivities[cat] || [];
    diagCatMedians[cat] = {};
    diagCatBest[cat] = {};
    diagCatP25[cat] = {};
    diagCatP85[cat] = {};
    diagCatTop3[cat] = {};

    for (const mk of DIAG_METRICS) {
      const vals = items.map(i => i[mk.key]).filter(v => !isNaN(v) && v > 0).sort((a, b) => a - b);
      diagCatMedians[cat][mk.key] = vals.length > 0 ? vals[Math.floor(vals.length / 2)] : 0;

      // P25（75th percentile）
      if (vals.length > 0) {
        const p25Idx = Math.floor(vals.length * 0.75);
        diagCatP25[cat][mk.key] = vals[p25Idx] || vals[vals.length - 1];
      } else {
        diagCatP25[cat][mk.key] = 0;
      }

      // P85（85th percentile，前15%水平线）
      if (vals.length > 0) {
        const p85Idx = Math.floor(vals.length * 0.85);
        diagCatP85[cat][mk.key] = vals[p85Idx] || vals[vals.length - 1];
      } else {
        diagCatP85[cat][mk.key] = 0;
      }

      // Top3
      const sorted = [...items].filter(i => !isNaN(i[mk.key]) && i[mk.key] > 0)
        .sort((a, b) => b[mk.key] - a[mk.key]);
      diagCatTop3[cat][mk.key] = sorted.slice(0, 3);

      // FIX: Bug #2 - 最佳值取真正的 max（而非 Top3 平均），确保 >= 所有品牌值
      diagCatBest[cat][mk.key] = sorted.length > 0 ? sorted[0][mk.key] : 0;
    }

    // 价格力中位数（原值，如316=3.16%）
    const ppVals = items.map(i => i.price_power).filter(v => v && v > 0).sort((a, b) => a - b);
    diagCatMedians[cat].price_power = ppVals.length > 0 ? ppVals[Math.floor(ppVals.length / 2)] : 0;
  }
}

function parseStoreRate(val) {
  if (!val) return NaN;
  const s = String(val).trim();
  if (s.includes('%')) return parseFloat(s) / 100;
  const n = parseFloat(s);
  return n > 1 ? n / 100 : n;
}

// ============================================================
// 渲染搜索UI
// ============================================================
function renderDiagSearch(container) {
  container.innerHTML = `
    <div class="diag-page">
      <div class="diag-search-area" id="diag-search-area">
        <div class="diag-search-box">
          <input type="text" id="diag-input" class="diag-input" placeholder="输入品牌ID或品牌名称搜索..." autocomplete="off"
            oninput="onDiagInput(this.value)" onfocus="onDiagInput(this.value)">
          <div class="diag-dropdown" id="diag-dropdown"></div>
          <button class="btn-primary" onclick="runDiagnosis()">生成诊断</button>
          <button class="btn-export" style="display:none" id="diag-export-btn" onclick="exportDiagnosis()">导出PDF</button>
        </div>
        <div class="diag-mode-tabs" id="diag-mode-tabs">
          <span class="diag-mode-tab active" data-mode="full" onclick="switchDiagMode('full')">完整版</span>
          <span class="diag-mode-tab" data-mode="external" onclick="switchDiagMode('external')">对外版</span>
        </div>
      </div>
      <div id="diag-result"></div>
    </div>
  `;

  document.addEventListener('click', (e) => {
    const dd = document.getElementById('diag-dropdown');
    if (dd && !e.target.closest('.diag-search-box')) {
      dd.style.display = 'none';
    }
  });
}

function onDiagInput(val) {
  const dd = document.getElementById('diag-dropdown');
  if (!val.trim()) { dd.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const matches = diagAllBrands.filter(b =>
    b.brand_id.toLowerCase().includes(q) || b.brand_name.toLowerCase().includes(q)
  ).slice(0, 15);
  if (matches.length === 0) { dd.style.display = 'none'; return; }
  dd.innerHTML = matches.map(b =>
    `<div class="dd-item" onclick="selectDiagBrand('${b.brand_id}','${b.brand_name.replace(/'/g, "\\'")}')">${b.brand_id} — ${b.brand_name}</div>`
  ).join('');
  dd.style.display = 'block';
}

function selectDiagBrand(bid, name) {
  document.getElementById('diag-input').value = `${bid} — ${name}`;
  document.getElementById('diag-dropdown').style.display = 'none';
}

function switchDiagMode(mode) {
  diagMode = mode;
  document.querySelectorAll('.diag-mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  // 对外版默认指标改为领取核销率
  if (mode === 'external' && (diagSelectedMetric === 'exposure_claim' || diagSelectedMetric === 'exposure_redeem')) {
    diagSelectedMetric = 'claim_redeem';
  }
  if (diagCurrentBrand) renderDiagResult();
}

// ============================================================
// 运行诊断
// ============================================================
function runDiagnosis() {
  const input = document.getElementById('diag-input').value.trim();
  if (!input) return;

  let brandId = input;
  const m = input.match(/^(\d+)/);
  if (m) brandId = m[1];

  // FIX: Bug #1 - 活动去重（按 activity_id）
  const rawActivities = diagActivities.filter(a => String(a.brand_id) === brandId);
  const seenIds = new Set();
  const brandActivities = [];
  for (const a of rawActivities) {
    if (!seenIds.has(a.activity_id)) {
      seenIds.add(a.activity_id);
      brandActivities.push(a);
    }
  }

  if (brandActivities.length === 0) {
    document.getElementById('diag-result').innerHTML =
      '<div style="padding:24px;color:#DC2626;font-size:16px">未找到该品牌的活动数据</div>';
    return;
  }

  // category 统一从品牌日报取
  const actCategory = brandActivities[0]._category || brandActivities[0].category_name || '';

  diagCurrentBrand = {
    brand_id: brandId,
    brand_name: brandActivities[0].brand_name,
    brand_daily: { report_date: brandActivities[0].report_date || brandActivities[0].latest_date || '-' },
    activities: brandActivities,
    category: actCategory || '未知',
  };

  diagSelectedMetric = diagMode === 'external' ? 'claim_redeem' : 'exposure_claim';

  const t = window.currentMetricType || 'uv';
  const totalExposure = brandActivities.reduce((s, a) => s + (t === 'uv' ? (a.exposure_uv||0) : (a.exposure_pv||0)), 0);
  const totalClaim = brandActivities.reduce((s, a) => s + (t === 'uv' ? (a.claim_uv||0) : (a.claim_pv||0)), 0);
  const totalRedeem = brandActivities.reduce((s, a) => s + (t === 'uv' ? (a.redeem_uv||0) : (a.redeem_pv||0)), 0);
  // UV 始终需要（到店相关）
  const totalClaimUv = brandActivities.reduce((s, a) => s + (a.claim_uv || 0), 0);
  const totalRedeemUv = brandActivities.reduce((s, a) => s + (a.redeem_uv || 0), 0);

  // V2.1: 到店核销率直接用DB真实值（品牌级加权平均）
  // 按核销UV加权: sum(redeem_uv_i * store_rate_i) / sum(redeem_uv_i)
  let weightedStoreSum = 0, weightedStoreDenom = 0;
  for (const a of brandActivities) {
    const sr = parseStoreRate(a.store_redeem_rate_uv);
    const ru = a.redeem_uv || 0;
    if (!isNaN(sr) && sr > 0 && ru > 0) {
      weightedStoreSum += sr * ru;
      weightedStoreDenom += ru;
    }
  }
  let storeRate = weightedStoreDenom > 0 ? weightedStoreSum / weightedStoreDenom : NaN;

  diagCurrentBrand.metrics = {
    exposure_claim: totalExposure > 0 ? totalClaim / totalExposure : 0,
    claim_redeem: totalClaim > 0 ? totalRedeem / totalClaim : 0,
    exposure_redeem: totalExposure > 0 ? totalRedeem / totalExposure : 0,
    store_redeem: storeRate || 0,
  };

  diagCurrentBrand.totals = {
    exposure: totalExposure,
    claim: totalClaim,
    redeem: totalRedeem,
  };

  // 短板检测——自动选中最弱指标
  const cat = diagCurrentBrand.category;
  const meds = diagCatMedians[cat] || {};
  const runMetrics = diagMode === 'external' ? DIAG_METRICS_EXT : DIAG_METRICS;
  const weakMetrics = runMetrics.filter(mk => diagCurrentBrand.metrics[mk.key] < (meds[mk.key] || 0));
  const worstMetric = weakMetrics.length > 0
    ? weakMetrics.reduce((a, c) => ((meds[c.key] || 0) - diagCurrentBrand.metrics[c.key]) > ((meds[a.key] || 0) - diagCurrentBrand.metrics[a.key]) ? c : a)
    : null;
  if (worstMetric) diagSelectedMetric = worstMetric.key;

  renderDiagResult();
}

// ============================================================
// 渲染完整诊断结果
// ============================================================
function renderDiagResult() {
  const b = diagCurrentBrand;
  const cat = b.category;
  const meds = diagCatMedians[cat] || {};
  const p25 = diagCatP25[cat] || {};
  const p85 = diagCatP85[cat] || {};
  const best = diagCatBest[cat] || {};
  const isExt = diagMode === 'external';
  const metrics = isExt ? DIAG_METRICS_EXT : DIAG_METRICS;

  // 健康评分（基准=P85，即前15%水平线）
  // 评分维度：价格力 + 曝光领取率 + 领取核销率 + 到店核销率
  let totalScore = 0;
  const SCORE_METRICS = [
    { key: 'exposure_claim', label: '曝光领取率' },
    { key: 'claim_redeem', label: '领取核销率' },
    { key: 'store_redeem', label: '到店核销率' },
  ];
  // 价格力评分（单独计算，P85为基准）
  let brandPricePower = 0, ppCount = 0;
  for (const a of b.activities) {
    if (a.price_power && a.price_power > 0) { brandPricePower += a.price_power; ppCount++; }
  }
  brandPricePower = ppCount > 0 ? brandPricePower / ppCount : 0;
  // 类目价格力P85
  const catPPVals = (function() {
    const acts = diagActivities.filter(a => {
      return a._category === cat && a.price_power && a.price_power > 0;
    });
    return acts.map(a => a.price_power).sort((a, b2) => a - b2);
  })();
  const ppP85 = catPPVals.length > 0 ? catPPVals[Math.floor(catPPVals.length * 0.85)] : 1;

  const scoreItems = 4; // 价格力 + 3 metrics
  const scorePerItem = 100 / scoreItems;
  // 价格力得分
  totalScore += Math.min(brandPricePower / (ppP85 || 1), 1.0) * scorePerItem;
  // 其他3项
  const activeScoreMetrics = isExt
    ? SCORE_METRICS.filter(m => m.key !== 'exposure_claim')
    : SCORE_METRICS;
  const remainPer = (scoreItems - 1) * scorePerItem / activeScoreMetrics.length;
  for (const mk of activeScoreMetrics) {
    const base = p85[mk.key] || 0.01;
    totalScore += Math.min(b.metrics[mk.key] / base, 1.0) * remainPer;
  }
  totalScore = Math.round(totalScore);

  const scoreColor = totalScore >= 80 ? '#16A34A' : totalScore >= 60 ? '#F59E0B' : '#DC2626';
  const scoreLabel = totalScore >= 80 ? '优秀' : totalScore >= 60 ? '待优化' : '需关注';

  const weakMetrics = metrics.filter(mk => b.metrics[mk.key] < (meds[mk.key] || 0));
  const worstMetric = weakMetrics.length > 0
    ? weakMetrics.reduce((a, c) => ((meds[c.key] || 0) - b.metrics[c.key]) > ((meds[a.key] || 0) - b.metrics[a.key]) ? c : a)
    : null;

  const resultDiv = document.getElementById('diag-result');
  resultDiv.innerHTML = `
    <!-- 区域 A: 品牌概览 -->
    <div class="diag-card diag-area-a" style="animation:fadeInUp 0.3s ease">
      <div class="diag-a-left">
        <div class="diag-brand-name">${b.brand_name} <span class="diag-cat-tag" style="background:${getCatColor(cat)}20;color:${getCatColor(cat)}">${cat}</span></div>
        <div class="diag-date">数据日期：${b.brand_daily.report_date}</div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">活动数</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${b.activities.length}</div>
          </div>
          <div style="flex:1;background:#FDF4FF;border:1px solid #F0ABFC;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">价格力</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${(() => {
              let wSum = 0, wDen = 0;
              for (const a of b.activities) {
                const pp = a.price_power;
                const ep = a.exposure_pv || 0;
                if (pp && pp > 0 && ep > 0) { wSum += pp * ep; wDen += ep; }
              }
              return wDen > 0 ? (wSum / wDen / 100).toFixed(2) + '%' : '-';
            })()}</div>
          </div>
          ${!isExt ? `<div style="flex:1;background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">曝光</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${fmtNum(b.totals.exposure)}</div>
          </div>` : ''}
          <div style="flex:1;background:#F0FDF4;border:1px solid #DCFCE7;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">领取</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${fmtNum(b.totals.claim)}</div>
          </div>
          <div style="flex:1;background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">核销</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${fmtNum(b.totals.redeem)}</div>
          </div>
        </div>
        ${weakMetrics.length > 0 ? `<div class="diag-alert" style="background:${scoreColor}10;border-left:3px solid ${scoreColor};color:${scoreColor}">
          ⚠️ ${weakMetrics.length} 项指标低于行业中位数，建议重点关注${worstMetric.label}
        </div>` : '<div class="diag-alert" style="background:#16A34A10;border-left:3px solid #16A34A;color:#16A34A">✅ 所有指标均优于行业中位数</div>'}
      </div>
      <div class="diag-a-right">
        <div class="diag-score-ring" id="diag-score-ring"></div>
      </div>
    </div>

    <!-- 区域 B: 品牌转化漏斗 + 对比表（上下结构） -->
    <div class="diag-card diag-area-b" style="animation:fadeInUp 0.5s ease">
      <h3 class="diag-section-title">📊 品牌转化漏斗 · 对比业态均值</h3>

      <!-- 上：水平漏斗 -->
      ${(() => {
        const isPV = (window.currentMetricType || 'uv') === 'pv';
        const unitWord = isPV ? '次数' : '人数';
        const unitShort = isPV ? '次' : '人';
        const exposureVal = b.totals.exposure;
        const claimVal = b.totals.claim;
        const redeemVal = b.totals.redeem;
        const storeRdmRate = b.metrics.store_redeem;
        // 到店人数估算：分次卡/非次卡分别计算后加总
        // 非次卡: 核销UV / 到店核销率
        // 次卡:   领取UV × 领取到店率
        let storeVisit = 0, storeVisitValid = false;
        for (const a of b.activities) {
          const isMU = a.coupon_type && a.coupon_type.indexOf('次卡') >= 0;
          const sr = parseStoreRate(a.store_redeem_rate_uv);
          const cts = parseStoreRate(a.claim_to_store_rate_uv);
          const ru = a.redeem_uv || 0;
          const cu = a.claim_uv || 0;
          if (isMU) {
            if (!isNaN(cts) && cts > 0 && cu > 0) { storeVisit += cu * cts; storeVisitValid = true; }
          } else {
            if (!isNaN(sr) && sr > 0 && ru > 0) { storeVisit += ru / sr; storeVisitValid = true; }
          }
        }
        storeVisit = storeVisitValid ? Math.round(storeVisit) : null;
        // 领取到店率 = 预估到店 / 领取
        const totalClaimUvFunnel = b.activities.reduce((s, a) => s + (a.claim_uv || 0), 0);
        const clmToStore = (storeVisit !== null && totalClaimUvFunnel > 0) ? storeVisit / totalClaimUvFunnel : NaN;
        const expClm = claimVal / Math.max(exposureVal, 1);
        const storeRdm = storeRdmRate;
        const lossRate = (r) => isNaN(r) ? NaN : 1 - r;
        const fp = (v) => isNaN(v) ? '-' : (v * 100).toFixed(1) + '%';

        // PV模式：到店次数 = 核销次数 / 到店核销率
        const storeVisitDisplay = isPV
          ? ((storeRdmRate > 0 && redeemVal > 0) ? Math.round(redeemVal / storeRdmRate) : null)
          : storeVisit;
        const storeUnitWord = isPV ? '次数' : '人数';
        const storeUnitShort = isPV ? '次' : '人';

        const allNodes = [
          { label: '曝光' + unitWord, value: fmtNum(exposureVal), unit: unitShort, opacity: '', ext: false },
          { label: '领取' + unitWord, value: fmtNum(claimVal), unit: unitShort, opacity: isExt ? '' : 'CC', ext: true },
          { label: '到店' + storeUnitWord, value: storeVisitDisplay !== null ? fmtNum(storeVisitDisplay) : '-', unit: storeUnitShort + '*预估', opacity: isExt ? 'CC' : 'AA', ext: true },
          { label: '核销' + unitWord, value: fmtNum(redeemVal), unit: unitShort, opacity: isExt ? '88' : '88', ext: true },
        ];
        const allArrows = [
          { rateLabel: '曝光领取率', rate: fp(expClm), loss: fp(lossRate(expClm)), ext: false },
          { rateLabel: '领取到店率', rate: fp(clmToStore), loss: fp(lossRate(clmToStore)), ext: true },
          { rateLabel: '到店核销率', rate: fp(storeRdm), loss: fp(lossRate(storeRdm)), ext: true },
        ];
        const nodes = isExt ? allNodes.filter(n => n.ext !== false) : allNodes;
        const arrows = isExt ? allArrows.filter(a => a.ext !== false) : allArrows;

        let html = '<div class="hfunnel-wrap">';
        nodes.forEach((n, i) => {
          html += `<div class="hfunnel-node">
            <div class="hfunnel-card" style="background:linear-gradient(135deg, #4F7DF5${n.opacity}, #3B63D1${n.opacity})">
              <span class="hfunnel-label">${n.label}</span>
              <span class="hfunnel-value">${n.value}<span class="hfunnel-unit">${n.unit}</span></span>
            </div>
          </div>`;
          if (i < arrows.length) {
            const a = arrows[i];
            html += `<div class="hfunnel-arrow">
              <div class="hfunnel-arrow-rate">${a.rateLabel}</div>
              <div class="hfunnel-arrow-icon">→</div>
              <div class="hfunnel-arrow-conv">${a.rate}</div>
              <div class="hfunnel-arrow-loss">流失 ${a.loss}</div>
            </div>`;
          }
        });
        html += '</div>';
        return html;
      })()}

      <!-- 下：过程指标对比 4列网格 -->
      <div class="hfunnel-metrics-grid">
        ${metrics.map(mk => {
          const val = b.metrics[mk.key];
          const med = meds[mk.key] || 0;
          const isBetter = val >= med;
          const isWorstRow = worstMetric && mk.key === worstMetric.key;
          const isSelected = mk.key === diagSelectedMetric;
          const diffPts = (Math.abs(val - med) * 100).toFixed(1);
          const diffText = isBetter ? '超 ' + diffPts + ' 百分点' : '差 ' + diffPts + ' 百分点';
          const borderCls = isBetter ? 'hmetric-good' : 'hmetric-bad';
          const cardCls = 'hmetric-card ' + borderCls + (isWorstRow ? ' hmetric-worst' : '') + (isSelected ? ' hmetric-selected' : '');
          return '<div class="' + cardCls + '" onclick="switchDiagMetric(\'' + mk.key + '\')">'
            + '<div class="hmetric-name">' + mk.label + '</div>'
            + '<div class="hmetric-brand-val">' + fmtPctDiag(val) + '</div>'
            + '<div class="hmetric-med">' + b.category + '中位数 ' + fmtPctDiag(med) + '</div>'
            + '<span class="hmetric-pill ' + (isBetter ? 'hmetric-pill-good' : 'hmetric-pill-bad') + '">'
            + (isBetter ? '↑' : '↓') + ' ' + ((!isNaN(val) && !isNaN(med)) ? diffText : '-')
            + '</span></div>';
        }).join('')}
      </div>

      ${worstMetric ? '<div class="hfunnel-alert" onclick="document.getElementById(\'diag-area-c\').scrollIntoView({behavior:\'smooth\',block:\'center\'})">'
        + '<span class="hfunnel-alert-icon">⚠️</span>'
        + '<span class="hfunnel-alert-text"><b>' + worstMetric.label + '</b>为当前最大瓶颈</span>'
        + '<span class="hfunnel-alert-link">点击查看行业标杆 →</span>'
        + '</div>' : ''}
    </div>

    <!-- 区域 C: 行业标杆参考 -->
    <div class="diag-card diag-area-c" style="animation:fadeInUp 0.7s ease" id="diag-area-c">
      <div id="diag-benchmark-content"></div>
    </div>

    <!-- 区域 D: 活动明细 -->
    <div class="diag-card diag-area-d" style="animation:fadeInUp 0.9s ease">
      <div class="diag-d-header">
        <div class="diag-d-header-left" onclick="toggleDiagDetail()">
          <h3 class="diag-section-title" style="margin:0">📋 活动明细 (${b.activities.length}个活动)</h3>
          <span id="diag-d-toggle" class="diag-d-toggle-text">展开 ∨</span>
        </div>
        <button class="diag-view-toggle-btn" id="diag-view-toggle" onclick="event.stopPropagation();toggleDiagView()">对比视图</button>
      </div>
      <div id="diag-d-body" style="display:none;margin-top:16px">${renderDiagActivities()}</div>
    </div>

    <!-- 口径说明 -->
    <div style="padding:8px 0 16px;font-size:11px;color:#94A3B8;line-height:1.6">
      口径说明：转化率为活动维度${(window.currentMetricType||'uv')==='pv'?'PV':'UV'}口径；到店${(window.currentMetricType||'uv')==='pv'?'次数':'人数'} = 核销/到店核销率（次卡场景用 领取×领取到店率）；领取到店率由预估到店反推；价格力原值÷100为实际折扣率
    </div>
  `;

  renderScoreRing(totalScore, scoreColor, scoreLabel);
  renderBenchmark();
  // 显示导出按钮
  const exportBtn = document.getElementById('diag-export-btn');
  if (exportBtn) exportBtn.style.display = 'inline-block';
}

// ============================================================
// 健康评分环形图（Canvas）
// ============================================================
function exportDiagnosis() {
  const container = document.getElementById('diag-result');
  if (!container) return;

  // 展开活动明细
  const detailBody = document.getElementById('diag-d-body');
  const detailToggle = document.getElementById('diag-d-toggle');
  const wasHidden = detailBody && detailBody.style.display === 'none';
  if (wasHidden && detailBody) {
    detailBody.style.display = 'block';
  }

  // 设置打印标题（显示在PDF文件名中）
  const modeLabel = diagMode === 'external' ? '_对外版' : '';
  const brandName = diagCurrentBrand?.brand_name || 'report';
  const origTitle = document.title;
  document.title = `品牌诊断${modeLabel}_${brandName}_${new Date().toISOString().slice(0,10)}`;

  // 标记打印区域
  document.body.classList.add('printing-diagnosis');
  container.classList.add('print-target');

  window.print();

  // 恢复
  document.body.classList.remove('printing-diagnosis');
  container.classList.remove('print-target');
  document.title = origTitle;

  if (wasHidden && detailBody) {
    detailBody.style.display = 'none';
    if (detailToggle) detailToggle.textContent = '展开 ∨';
  }
}

function renderScoreRing(score, color, label) {
  const wrap = document.getElementById('diag-score-ring');
  wrap.innerHTML = `<canvas id="score-canvas" width="320" height="320" style="width:160px;height:160px"></canvas>
    <div class="score-text"><span class="score-num" style="color:${color}">${score}</span><span class="score-100">/100</span></div>
    <div class="score-label" style="color:${color}">${label}</div>
    <div class="score-desc">价格力·曝光领取·领取核销·到店核销</div>`;

  const canvas = document.getElementById('score-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = 2;
  const cx = 80 * dpr, cy = 80 * dpr, r = 65 * dpr, lw = 12 * dpr;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#F0F0F0';
  ctx.lineWidth = lw;
  ctx.stroke();

  let progress = 0;
  const target = score / 100;
  function animate() {
    progress += 0.02;
    if (progress > target) progress = target;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
    if (progress < target) requestAnimationFrame(animate);
  }
  animate();
}

// ============================================================
// 雷达图（ECharts）
// ============================================================
function renderDiagRadar() {
  const wrap = document.getElementById('diag-radar-wrap');
  const b = diagCurrentBrand;
  const cat = b.category;
  const meds = diagCatMedians[cat] || {};
  const best = diagCatBest[cat] || {};

  const chart = echarts.init(wrap);
  const maxVals = DIAG_METRICS.map(mk => Math.max(b.metrics[mk.key], meds[mk.key] || 0, best[mk.key] || 0) * 1.3);

  chart.setOption({
    tooltip: { trigger: 'item' },
    radar: {
      radius: '55%',  // FIX: Bug #2 - 缩小radius给标签留空间
      indicator: DIAG_METRICS.map((mk, i) => ({
        name: mk.label.replace('率', ''), max: maxVals[i] || 0.1  // FIX: Bug #2 - 简称避免截断
      })),
      shape: 'polygon',
      axisName: { color: '#4B5563', fontSize: 13, fontWeight: 600 },
      splitArea: { areaStyle: { color: ['rgba(37,99,235,0.02)', 'rgba(37,99,235,0.04)'] } },
      splitLine: { lineStyle: { color: '#E5E7EB' } },
    },
    series: [{
      type: 'radar',
      data: [
        {
          value: DIAG_METRICS.map(mk => b.metrics[mk.key]),
          name: '品牌',
          areaStyle: { color: 'rgba(37,99,235,0.2)' },
          lineStyle: { color: '#2563EB', width: 2 },
          itemStyle: { color: '#2563EB' },
        },
        {
          value: DIAG_METRICS.map(mk => meds[mk.key] || 0),
          name: '中位数',
          lineStyle: { color: '#9CA3AF', type: 'dashed', width: 2 },
          itemStyle: { color: '#9CA3AF' },
          areaStyle: { color: 'transparent' },
        },
        {
          // FIX: Bug #3 area - 金色虚线加粗
          value: DIAG_METRICS.map(mk => best[mk.key] || 0),
          name: '最佳',
          lineStyle: { color: '#D97706', type: 'dotted', width: 2.5 },
          itemStyle: { color: '#D97706', borderWidth: 2 },
          areaStyle: { color: 'transparent' },
        },
      ],
    }],
    legend: {
      bottom: 0,
      data: [
        { name: '品牌', icon: 'rect' },
        { name: '中位数', icon: 'rect' },
        { name: '最佳', icon: 'rect' },
      ],
      textStyle: { fontSize: 11, color: '#6B7280' },
    },
  });
}

// ============================================================
// 区域 C: 行业标杆
// ============================================================
function renderBenchmark() {
  const b = diagCurrentBrand;
  const cat = b.category;
  const mk = DIAG_METRICS.find(m => m.key === diagSelectedMetric);
  const top3 = (diagCatTop3[cat] || {})[mk.key] || [];
  const med = (diagCatMedians[cat] || {})[mk.key] || 0;
  const p75Val = (diagCatP25[cat] || {})[mk.key] || 0;
  const brandVal = b.metrics[mk.key];
  const top1Val = top3.length > 0 ? top3[0][mk.key] : 0;

  const scaleMax = Math.max(top1Val * 1.15, brandVal * 1.2, 0.01);
  const brandPct = (brandVal / scaleMax) * 100;
  const medPct = (med / scaleMax) * 100;
  const p75Pct = (p75Val / scaleMax) * 100;

  const isWeak = brandVal < med;
  const diffMed = Math.abs(brandVal - med);
  const diffTop1 = Math.abs(top1Val - brandVal);

  let html = `
    <div class="diag-c-header">
      <h3 class="diag-section-title" style="margin:0">🏆 行业标杆参考（${cat} · ${mk.label} Top3）</h3>
      <div class="diag-c-tabs">
        ${(diagMode === 'external' ? DIAG_METRICS_EXT : DIAG_METRICS).map(m => `<span class="dc-tab ${m.key === diagSelectedMetric ? 'active' : ''}"
          onclick="switchDiagMetric('${m.key}')">${m.label}</span>`).join('')}
      </div>
    </div>

    <!-- 数轴式刻度尺 -->
    ${(() => {
      const brandClose = Math.abs(brandPct - medPct) < 5;
      const medalColors = ['#D97706', '#9CA3AF', '#B45309'];
      const medals = ['🥇', '🥈', '🥉'];
      const top3Markers = top3.map((t, i) => ({
        pct: (t[mk.key] / scaleMax) * 100,
        label: medals[i] + ' ' + fmtPctDiag(t[mk.key]),
        color: medalColors[i],
      }));
      for (let i = 1; i < top3Markers.length; i++) {
        if (Math.abs(top3Markers[i].pct - top3Markers[i-1].pct) < 3) {
          top3Markers[i].below = true;
        }
      }
      return `<div class="axis-scale">
        <div class="axis-track">
          <div class="axis-line"></div>
          <div class="axis-marker axis-marker-brand" style="left:${brandPct}%">
            <div class="axis-dot axis-dot-brand" style="background:${isWeak ? '#DC2626' : '#2563EB'}"></div>
            <div class="axis-label axis-label-below" style="color:${isWeak ? '#DC2626' : '#2563EB'}">${b.brand_name}<br>${fmtPctDiag(brandVal)}</div>
          </div>
          <div class="axis-marker axis-marker-med" style="left:${medPct}%">
            <div class="axis-vline"></div>
            <div class="axis-label ${brandClose ? 'axis-label-above' : 'axis-label-above'}" style="color:#D97706">中位<br>${fmtPctDiag(med)}</div>
          </div>
          ${top3Markers.map((m, i) => `<div class="axis-marker" style="left:${m.pct}%">
            <div class="axis-dot axis-dot-top" style="border-color:${m.color}"></div>
            <div class="axis-label ${m.below ? 'axis-label-below' : 'axis-label-above'}">${m.label}</div>
          </div>`).join('')}
        </div>
        <div class="axis-diff-row">
          <span class="axis-diff-item" style="color:${isWeak ? '#DC2626' : '#16A34A'}">距中位${isWeak ? '还差' : '超出'} <b>${(diffMed * 100).toFixed(1)}</b> 个百分点</span>
          <span class="axis-diff-item" style="color:#D97706">${diffTop1 < 0.001 ? '🎉 你就是 Top1！' : '距Top1还差 <b>' + (diffTop1 * 100).toFixed(1) + '</b> 个百分点'}</span>
        </div>
      </div>`;
    })()}

    <!-- Top3 列表 -->
    <div class="diag-top3-list">
      ${top3.map((t, i) => {
        const medals = ['🥇', '🥈', '🥉'];
        const medalColors = ['#D97706', '#9CA3AF', '#B45309'];
        const isBrandCard = String(t.brand_id) === String(b.brand_id);
        const cardCls = 'diag-top3-card' + (isBrandCard ? ' diag-top3-brand' : '');
        const subMetrics = DIAG_METRICS.map(m => {
          const subVal = t[m.key];
          const isCur = m.key === mk.key;
          return '<span class="' + (isCur ? 'dt3-sub-active' : 'dt3-sub') + '">' + m.label.replace('率','') + ' ' + fmtPctDiag(subVal) + '</span>';
        }).join(' <span class="dt3-sub-sep">｜</span> ');
        return `<div class="${cardCls}">
          ${isBrandCard ? '<span class="diag-top3-brand-tag">本品牌</span>' : ''}
          <div class="dt3-header">
            <span class="dt3-medal" style="color:${medalColors[i]}">${medals[i]}</span>
            <div class="dt3-info">
              <div class="dt3-brand">${t.brand_name} — ${t.activity_name}${t.batch_name ? ' <span style="font-size:11px;color:#94a3b8;font-weight:400">('+t.batch_name+')</span>' : ''}</div>
            </div>
            <div class="dt3-value">${fmtPctDiag(t[mk.key])}</div>
          </div>
          <div class="dt3-sub-metrics">${subMetrics}</div>
        </div>`;
      }).join('')}
    </div>

    <!-- FIX: Bug #9 - 标杆洞察卡片 -->
    <div style="background:#FFFBEB;border-radius:10px;padding:14px 18px;margin-top:16px;border:1px solid #FEF3C7">
      <div style="font-weight:600;font-size:14px;color:#92400E;margin-bottom:8px">💡 标杆洞察：Top3 活动的共性特征</div>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#78350F;line-height:1.8">
        ${generateInsights(top3, mk, cat)}
      </ul>
    </div>
  `;

  document.getElementById('diag-benchmark-content').innerHTML = html;
}

// FIX: Bug #9 - 自动生成标杆洞察
function generateInsights(top3, mk, cat) {
  if (top3.length === 0) return '<li>暂无足够数据生成洞察</li>';

  const items = [];

  // 转化率特征
  if (mk.key === 'exposure_claim') {
    items.push('高曝光领取率的活动通常具有<b>直观的券面价值展示</b>和<b>低领取门槛</b>');
    items.push('建议：优化券名称中的利益点表达，突出折扣力度或赠品价值');
  } else if (mk.key === 'claim_redeem') {
    items.push('高领取核销率说明券的<b>使用场景匹配度高</b>，用户领券后有明确的消费动机');
    items.push('建议：优化券面使用门槛和适用范围，降低核销阻力');
  } else if (mk.key === 'exposure_redeem') {
    items.push('全链路转化率是<b>综合竞争力</b>的体现，Top3 在曝光吸引力和核销转化上均表现优异');
    items.push('建议：关注转化漏斗中流失最大的环节，针对性优化');
  } else if (mk.key === 'store_redeem') {
    items.push('高到店核销率表明<b>门店承接能力强</b>，线上领券到线下消费的链路顺畅');
    items.push('建议：确保门店端核销流程便捷，同时提升店员主动提醒核销的意识');
  }

  return items.map(s => `<li>${s}</li>`).join('');
}

// FIX: Bug #10 - 切换指标时增强联动反馈
function switchDiagMetric(key) {
  diagSelectedMetric = key;
  renderDiagResult();
  setTimeout(() => {
    const areaC = document.getElementById('diag-area-c');
    if (areaC) {
      areaC.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 短暂高亮动画
      areaC.style.transition = 'box-shadow 0.3s';
      areaC.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.3)';
      setTimeout(() => { areaC.style.boxShadow = ''; }, 800);
    }
  }, 150);
}

// ============================================================
// 区域 D: 活动明细
// ============================================================
function renderDiagActivities() {
  const b = diagCurrentBrand;
  const cat = b.category;
  const meds = diagCatMedians[cat] || {};
  const isExt = diagMode === 'external';
  const t = window.currentMetricType || 'uv';
  const activities = [...b.activities].sort((a, c) => {
    const aE = t === 'uv' ? (c.exposure_uv||0) : (c.exposure_pv||0);
    const bE = t === 'uv' ? (a.exposure_uv||0) : (a.exposure_pv||0);
    return aE - bE;
  });

  return activities.map(a => {
    const eVal = t === 'uv' ? (a.exposure_uv||0) : (a.exposure_pv||0);
    const cVal = t === 'uv' ? (a.claim_uv||0) : (a.claim_pv||0);
    const rVal = t === 'uv' ? (a.redeem_uv||0) : (a.redeem_pv||0);
    const ecr = eVal > 0 ? cVal / eVal : 0;
    const crr = cVal > 0 ? rVal / cVal : 0;
    const err = eVal > 0 ? rVal / eVal : 0;
    // 活动级到店核销率（真实值）
    const actStoreRedeem = parseStoreRate(a.store_redeem_rate_uv);

    // 价格力（转为小数，与转化率同格式）
    const pp = a.price_power;
    const ppRate = (pp != null && pp > 0) ? pp / 10000 : 0; // 316 → 0.0316
    const ppMed = (meds.price_power || 0) / 10000;

    const allActMetrics = [
      { label: '价格力', val: ppRate, med: ppMed, ext: true },
      { label: '曝光领取率', val: ecr, med: meds.exposure_claim || 0, ext: false },
      { label: '领取核销率', val: crr, med: meds.claim_redeem || 0, ext: true },
      { label: '曝光核销率', val: err, med: meds.exposure_redeem || 0, ext: false },
      { label: '到店核销率', val: isNaN(actStoreRedeem) ? 0 : actStoreRedeem, med: meds.store_redeem || 0, ext: true },
    ];
    const actMetrics = isExt ? allActMetrics.filter(m => m.ext) : allActMetrics;
    const weakActMetrics = actMetrics.filter(m => m.val < m.med);
    const worstActMetric = weakActMetrics.length > 0
      ? weakActMetrics.reduce((worst, curr) => ((curr.med || 0) - curr.val) > ((worst.med || 0) - worst.val) ? curr : worst)
      : null;

    function rateRow(label, val, med) {
      const isBetter = val >= med;
      const isWorst = worstActMetric && worstActMetric.label === label;
      const diffPts = (Math.abs(val - med) * 100).toFixed(1);
      const diffText = isBetter ? '↑ 超均值 ' + diffPts + ' 个百分点' : '↓ 低于均值 ' + diffPts + ' 个百分点';
      const maxRef = Math.max(val, med, 0.001);
      const barFillPct = (val / maxRef) * 100;
      const medLinePct = (med / maxRef) * 100;
      const barColor = isBetter ? '#16A34A' : '#DC2626';
      const rowCls = 'diag-act-rate-row' + (isWorst ? ' diag-act-rate-worst' : '');
      return `<div class="${rowCls}">
        <span class="diag-act-rate-label">${label}</span>
        <div class="diag-act-rate-right">
          <span class="diag-act-rate-val ${isBetter ? 'diag-cmp-good' : 'diag-cmp-bad'}">${fmtPctDiag(val)}</span>
          <div class="diag-mini-bar"><div class="diag-mini-bar-fill" style="width:${barFillPct}%;background:${barColor}"></div><div class="diag-mini-bar-med" style="left:${medLinePct}%"></div></div>
          <span class="diag-act-rate-med">中位 ${fmtPctDiag(med)}</span>
          <span class="diag-act-rate-diff ${isBetter ? 'diag-cmp-good' : 'diag-cmp-bad'}">${diffText}</span>
        </div>
      </div>`;
    }

    return `<div class="diag-activity-card">
      <div class="diag-act-card-name">${a.activity_name}</div>
      <div class="diag-act-blocks">
        ${!isExt ? `<div class="diag-act-block diag-act-block-exposure">
          <div class="diag-act-block-label">曝光</div>
          <div class="diag-act-block-val">${fmtNum(eVal)}</div>
        </div>
        <div class="diag-act-conv-arrow">
          <span class="diag-act-conv-rate">${fmtPctDiag(ecr)}</span>
          <span class="diag-act-conv-icon">→</span>
        </div>` : ''}
        <div class="diag-act-block diag-act-block-claim">
          <div class="diag-act-block-label">领取</div>
          <div class="diag-act-block-val">${fmtNum(cVal)}</div>
        </div>
        <div class="diag-act-conv-arrow">
          <span class="diag-act-conv-rate">${fmtPctDiag(crr)}</span>
          <span class="diag-act-conv-icon">→</span>
        </div>
        <div class="diag-act-block diag-act-block-redeem">
          <div class="diag-act-block-label">核销</div>
          <div class="diag-act-block-val">${fmtNum(rVal)}</div>
        </div>
      </div>
      ${actMetrics.map(m => rateRow(m.label, m.val, m.med)).join('')}
    </div>`;
  }).join('');
}

function toggleDiagDetail() {
  const body = document.getElementById('diag-d-body');
  const toggle = document.getElementById('diag-d-toggle');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    toggle.textContent = '收起 ∧';
    body.style.animation = 'fadeInUp 0.4s ease';
  } else {
    body.style.display = 'none';
    toggle.textContent = '展开 ∨';
  }
}

function toggleDiagView() {
  diagViewMode = diagViewMode === 'card' ? 'table' : 'card';
  const body = document.getElementById('diag-d-body');
  const toggle = document.getElementById('diag-view-toggle');
  const expandToggle = document.getElementById('diag-d-toggle');

  if (body.style.display === 'none') {
    body.style.display = 'block';
    expandToggle.textContent = '收起 ∧';
  }

  if (diagViewMode === 'table') {
    body.innerHTML = renderDiagCompareTable();
    toggle.textContent = '卡片视图';
  } else {
    body.innerHTML = renderDiagActivities();
    toggle.textContent = '对比视图';
  }
  body.style.animation = 'fadeInUp 0.3s ease';
}

function renderDiagCompareTable() {
  const b = diagCurrentBrand;
  const cat = b.category;
  const meds = diagCatMedians[cat] || {};
  const activities = [...b.activities].sort((x, y) => (y.exposure_pv || 0) - (x.exposure_pv || 0)).slice(0, 5);

  const metrics = [
    { label: '曝光领取率', calc: a => a.exposure_pv > 0 ? a.claim_pv / a.exposure_pv : 0, med: meds.exposure_claim || 0 },
    { label: '领取核销率', calc: a => a.claim_pv > 0 ? a.redeem_pv / a.claim_pv : 0, med: meds.claim_redeem || 0 },
    { label: '曝光核销率', calc: a => a.exposure_pv > 0 ? a.redeem_pv / a.exposure_pv : 0, med: meds.exposure_redeem || 0 },
    { label: '到店核销率', calc: () => b.metrics.store_redeem, med: meds.store_redeem || 0 },
  ];

  let html = '<div class="diag-ct-wrap"><table class="diag-ct">';
  html += '<thead><tr><th class="diag-ct-th-label">指标</th>';
  for (const a of activities) {
    const name = a.activity_name.length > 10 ? a.activity_name.slice(0, 10) + '…' : a.activity_name;
    html += '<th class="diag-ct-th-act" title="' + a.activity_name.replace(/"/g, '&quot;') + '">' + name + '</th>';
  }
  html += '</tr></thead><tbody>';

  for (const mk of metrics) {
    html += '<tr><td class="diag-ct-td-label">' + mk.label + '</td>';
    for (const a of activities) {
      const val = mk.calc(a);
      const isBetter = val >= mk.med;
      const cls = isBetter ? 'diag-ct-cell-good' : 'diag-ct-cell-bad';
      html += '<td class="diag-ct-td ' + cls + '">' + fmtPctDiag(val) + '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

// ============================================================
// 工具函数
// ============================================================
function fmtPctDiag(v) {
  if (isNaN(v) || v === null || v === undefined) return '-';
  return (v * 100).toFixed(1) + '%';
}

function getCatColor(cat) {
  const map = { '茶饮咖啡': '#2563EB', '中式快餐': '#F59E0B', '西式快餐': '#DC2626', '正餐': '#1E40AF', '小吃': '#D97706', '甜品烘焙': '#EC4899' };
  return map[cat] || '#6B7280';
}
