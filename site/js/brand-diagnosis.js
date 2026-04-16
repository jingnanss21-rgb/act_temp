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
let diagCatTop3 = {};
let diagAllBrands = [];
let diagCurrentBrand = null;
let diagSelectedMetric = 'exposure_claim';

const DIAG_METRICS = [
  { key: 'exposure_claim', label: '曝光领取率', desc: '券吸引力' },
  { key: 'claim_redeem', label: '领取核销率', desc: '券转化力' },
  { key: 'exposure_redeem', label: '曝光核销率', desc: '全链路效率' },
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
    const [actRes, bdRes, mcRes] = await Promise.all([
      supabaseClient.from('tem_v_activity_detail').select('*'),
      supabaseClient.from('tem_brand_daily').select('*').order('report_date', { ascending: false }),
      supabaseClient.from('tem_merchant_contacts').select('brand_id,brand_name,operating_sp,contact_assistant'),
    ]);

    diagActivities = (actRes.data || []).filter(a => a.exposure_uv > 0 && a.exposure_pv > 0);

    for (const bd of (bdRes.data || [])) {
      if (!diagBrandDaily[bd.brand_id]) diagBrandDaily[bd.brand_id] = bd;
    }

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
    const bd = diagBrandDaily[a.brand_id];
    if (!bd) continue;
    const cat = bd.category_l4;
    if (!cat || !DIAG_CATEGORIES.includes(cat)) continue;

    const item = {
      ...a,
      category: cat,
      exposure_claim: a.claim_pv / a.exposure_pv,
      claim_redeem: a.redeem_pv / a.claim_pv,
      exposure_redeem: a.redeem_pv / a.exposure_pv,
      store_redeem: parseStoreRate(bd.w7_store_redeem_rate_uv),
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

      // Top3
      const sorted = [...items].filter(i => !isNaN(i[mk.key]) && i[mk.key] > 0)
        .sort((a, b) => b[mk.key] - a[mk.key]);
      diagCatTop3[cat][mk.key] = sorted.slice(0, 3);

      // FIX: Bug #2 - 最佳值取真正的 max（而非 Top3 平均），确保 >= 所有品牌值
      diagCatBest[cat][mk.key] = sorted.length > 0 ? sorted[0][mk.key] : 0;
    }
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

  const brandDaily = diagBrandDaily[brandId];

  if (brandActivities.length === 0 || !brandDaily) {
    document.getElementById('diag-result').innerHTML =
      '<div style="padding:24px;color:#DC2626;font-size:16px">未找到该品牌的活动数据</div>';
    return;
  }

  diagCurrentBrand = {
    brand_id: brandId,
    brand_name: brandActivities[0].brand_name,
    brand_daily: brandDaily,
    activities: brandActivities,
    category: brandDaily.category_l4 || '未知',
  };

  diagSelectedMetric = 'exposure_claim';

  const totalExposurePv = brandActivities.reduce((s, a) => s + (a.exposure_pv || 0), 0);
  const totalClaimPv = brandActivities.reduce((s, a) => s + (a.claim_pv || 0), 0);
  const totalRedeemPv = brandActivities.reduce((s, a) => s + (a.redeem_pv || 0), 0);
  const storeRate = parseStoreRate(brandDaily.w7_store_redeem_rate_uv);

  diagCurrentBrand.metrics = {
    exposure_claim: totalExposurePv > 0 ? totalClaimPv / totalExposurePv : 0,
    claim_redeem: totalClaimPv > 0 ? totalRedeemPv / totalClaimPv : 0,
    exposure_redeem: totalExposurePv > 0 ? totalRedeemPv / totalExposurePv : 0,
    store_redeem: storeRate || 0,
  };

  diagCurrentBrand.totals = {
    exposure_pv: totalExposurePv,
    claim_pv: totalClaimPv,
    redeem_pv: totalRedeemPv,
  };

  // 短板检测——自动选中最弱指标
  const cat = diagCurrentBrand.category;
  const meds = diagCatMedians[cat] || {};
  const weakMetrics = DIAG_METRICS.filter(mk => diagCurrentBrand.metrics[mk.key] < (meds[mk.key] || 0));
  const worstMetric = weakMetrics.length > 0
    ? weakMetrics.reduce((a, c) => (diagCurrentBrand.metrics[c.key] / (meds[c.key] || 1)) < (diagCurrentBrand.metrics[a.key] / (meds[a.key] || 1)) ? c : a)
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
  const best = diagCatBest[cat] || {};

  // 健康评分（基准=P25）
  let totalScore = 0;
  for (const mk of DIAG_METRICS) {
    const base = p25[mk.key] || 0.01;
    totalScore += Math.min(b.metrics[mk.key] / base, 1.0) * 25;
  }
  totalScore = Math.round(totalScore);

  const scoreColor = totalScore >= 80 ? '#16A34A' : totalScore >= 60 ? '#F59E0B' : '#DC2626';
  const scoreLabel = totalScore >= 80 ? '优秀' : totalScore >= 60 ? '待优化' : '需关注';

  const weakMetrics = DIAG_METRICS.filter(mk => b.metrics[mk.key] < (meds[mk.key] || 0));
  const worstMetric = weakMetrics.length > 0
    ? weakMetrics.reduce((a, c) => (b.metrics[c.key] / (meds[c.key] || 1)) < (b.metrics[a.key] / (meds[a.key] || 1)) ? c : a)
    : null;

  const resultDiv = document.getElementById('diag-result');
  resultDiv.innerHTML = `
    <!-- 区域 A: 品牌概览 -->
    <div class="diag-card diag-area-a" style="animation:fadeInUp 0.3s ease">
      <div class="diag-a-left">
        <div class="diag-brand-name">${b.brand_name} <span class="diag-cat-tag" style="background:${getCatColor(cat)}20;color:${getCatColor(cat)}">${cat}</span></div>
        <div class="diag-date">数据日期：${b.brand_daily.report_date}</div>
        <div class="diag-summary-grid">
          <div class="diag-summary-item"><div class="ds-label">活动数</div><div class="ds-value">${b.activities.length}</div></div>
          <div class="diag-summary-item"><div class="ds-label">曝光</div><div class="ds-value">${fmtNum(b.totals.exposure_pv)}</div></div>
          <div class="diag-summary-item"><div class="ds-label">领取</div><div class="ds-value">${fmtNum(b.totals.claim_pv)}</div></div>
          <div class="diag-summary-item"><div class="ds-label">核销</div><div class="ds-value">${fmtNum(b.totals.redeem_pv)}</div></div>
        </div>
        ${weakMetrics.length > 0 ? `<div class="diag-alert" style="background:${scoreColor}10;border-left:3px solid ${scoreColor};color:${scoreColor}">
          ⚠️ ${weakMetrics.length} 项指标低于行业中位数，建议重点关注${worstMetric.label}
        </div>` : '<div class="diag-alert" style="background:#16A34A10;border-left:3px solid #16A34A;color:#16A34A">✅ 所有指标均优于行业中位数</div>'}
      </div>
      <div class="diag-a-right">
        <div class="diag-score-ring" id="diag-score-ring"></div>
      </div>
    </div>

    <!-- 区域 B: 雷达图 + 指标表 -->
    <div class="diag-card diag-area-b" style="animation:fadeInUp 0.5s ease">
      <!-- FIX: Bug #3 - 副标题缩短避免截断 -->
      <h3 class="diag-section-title">📊 四维转化诊断 <span style="font-size:12px;color:#8C8C8C;font-weight:400;white-space:nowrap">品牌 vs 中位 vs 最佳</span></h3>
      <div class="diag-b-content">
        <div class="diag-radar-wrap" id="diag-radar-wrap"></div>
        <div class="diag-metric-table">
          <div class="dmt-header">
            <span class="dmt-h-num">#</span>
            <span class="dmt-h-label">指标</span>
            <span class="dmt-h-val">品牌</span>
            <span class="dmt-h-val">中位数</span>
            <span class="dmt-h-val">最佳</span>
            <span class="dmt-h-status">状态</span>
            <span class="dmt-h-bar">进度</span>
          </div>
          ${DIAG_METRICS.map((mk, i) => {
            const val = b.metrics[mk.key];
            const med = meds[mk.key] || 0;
            const bestVal = best[mk.key] || 0;
            const isBetter = val >= med;
            const isSelected = mk.key === diagSelectedMetric;
            const diffPct = med > 0 ? Math.round(Math.abs(val - med) / med * 100) : 0;
            // FIX: Bug #4 - 进度条宽度 = 品牌值/最佳值（确保最佳值 >= 品牌值）
            const barMax = Math.max(bestVal, val, 0.001);
            const barPct = Math.min((val / barMax) * 100, 100);
            return `<div class="diag-metric-row ${isSelected ? 'selected' : ''} ${!isBetter ? 'weak' : ''}"
              onclick="switchDiagMetric('${mk.key}')">
              <div class="dmr-num">${i + 1}</div>
              <div class="dmr-label">${mk.label}</div>
              <div class="dmr-brand">${fmtPctDiag(val)}</div>
              <div class="dmr-med">${fmtPctDiag(med)}</div>
              <div class="dmr-best" style="color:#D97706">${fmtPctDiag(bestVal)}</div>
              <div class="dmr-status ${isBetter ? 'good' : 'bad'}">
                ${isBetter ? '✅ 高于中位' : `⚠️ <span style="color:#DC2626">低于中位 ${diffPct}%</span>`}
              </div>
              <div class="dmr-bar">
                <div class="dmr-bar-fill" style="width:${barPct}%;background:${isBetter ? '#2563EB' : '#DC2626'}"></div>
                <div class="dmr-bar-max-line" style="left:100%" title="最佳 ${fmtPctDiag(bestVal)}"></div>
              </div>
            </div>`;
          }).join('')}
          <div style="font-size:11px;color:#8C8C8C;margin-top:8px;text-align:right;cursor:pointer" onclick="document.getElementById('diag-area-c').scrollIntoView({behavior:'smooth',block:'center'})">点击指标行查看行业标杆详情 ↓</div>
        </div>
      </div>
    </div>

    <!-- 区域 C: 行业标杆参考 -->
    <div class="diag-card diag-area-c" style="animation:fadeInUp 0.7s ease" id="diag-area-c">
      <div id="diag-benchmark-content"></div>
    </div>

    <!-- 区域 D: 活动明细 -->
    <div class="diag-card diag-area-d" style="animation:fadeInUp 0.9s ease">
      <div class="diag-d-header" onclick="toggleDiagDetail()">
        <h3 class="diag-section-title" style="margin:0">📋 活动明细 (${b.activities.length}个活动)</h3>
        <span id="diag-d-toggle" style="font-size:14px;color:#8C8C8C;cursor:pointer">展开 ∨</span>
      </div>
      <div id="diag-d-body" style="display:none;margin-top:16px">${renderDiagActivities()}</div>
    </div>
  `;

  renderScoreRing(totalScore, scoreColor, scoreLabel);
  renderDiagRadar();
  renderBenchmark();
}

// ============================================================
// 健康评分环形图（Canvas）
// ============================================================
function renderScoreRing(score, color, label) {
  const wrap = document.getElementById('diag-score-ring');
  wrap.innerHTML = `<canvas id="score-canvas" width="160" height="160"></canvas>
    <div class="score-text"><span class="score-num" style="color:${color}">${score}</span><span class="score-100">/100</span></div>
    <div class="score-label" style="color:${color}">${label}</div>
    <div class="score-desc">综合4项指标相对业态的表现</div>`;

  const canvas = document.getElementById('score-canvas');
  const ctx = canvas.getContext('2d');
  const cx = 80, cy = 80, r = 65, lw = 12;

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
      indicator: DIAG_METRICS.map((mk, i) => ({
        name: mk.label, max: maxVals[i] || 0.1
      })),
      shape: 'polygon',
      axisName: { color: '#4B5563', fontSize: 12, fontWeight: 500 },
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
  const brandVal = b.metrics[mk.key];
  const top1Val = top3.length > 0 ? top3[0][mk.key] : 0;

  const scaleMax = Math.max(top1Val * 1.15, brandVal * 1.2, 0.01);
  const brandPct = (brandVal / scaleMax) * 100;
  const medPct = (med / scaleMax) * 100;

  const isWeak = brandVal < med;
  const diffMed = Math.abs(brandVal - med);
  const diffTop1 = Math.abs(top1Val - brandVal);

  let html = `
    <div class="diag-c-header">
      <h3 class="diag-section-title" style="margin:0">🏆 行业标杆参考（${cat} · ${mk.label} Top3）</h3>
      <div class="diag-c-tabs">
        ${DIAG_METRICS.map(m => `<span class="dc-tab ${m.key === diagSelectedMetric ? 'active' : ''}"
          onclick="switchDiagMetric('${m.key}')">${m.label}</span>`).join('')}
      </div>
    </div>

    <!-- 位置刻度尺 -->
    <div class="diag-scale">
      <div class="scale-bar">
        <div class="scale-fill" style="width:${brandPct}%;background:${isWeak ? '#DC2626' : '#2563EB'}"></div>
        <div class="scale-marker scale-med" style="left:${medPct}%"><div class="sm-line"></div><div class="sm-label">中位 ${fmtPctDiag(med)}</div></div>
        <div class="scale-marker scale-brand" style="left:${Math.min(brandPct, 95)}%"><div class="sm-dot" style="background:${isWeak ? '#DC2626' : '#2563EB'}"></div><div class="sm-label" style="color:${isWeak ? '#DC2626' : '#2563EB'}">▼ ${b.brand_name} ${fmtPctDiag(brandVal)}</div></div>
        ${top3.map((t, i) => {
          const pos = (t[mk.key] / scaleMax) * 100;
          const medals = ['🥇', '🥈', '🥉'];
          // FIX: Bug #6 - 奖牌旁加数值标注
          return `<div class="scale-marker scale-top" style="left:${Math.min(pos, 98)}%">
            <div class="sm-label" style="font-size:10px;white-space:nowrap">${medals[i]}<br>${fmtPctDiag(t[mk.key])}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="scale-diff">
        <span style="color:${isWeak ? '#DC2626' : '#16A34A'}">距中位${isWeak ? '还差' : '超出'} <b>${(diffMed * 100).toFixed(1)}</b> 个百分点</span>
        <span style="color:#D97706;margin-left:12px">距Top1还差 <b>${(diffTop1 * 100).toFixed(1)}</b> 个百分点</span>
      </div>
    </div>

    <!-- Top3 列表 -->
    <div class="diag-top3-list">
      ${top3.map((t, i) => {
        const medals = ['🥇', '🥈', '🥉'];
        const medalColors = ['#D97706', '#9CA3AF', '#B45309'];
        const duration = (t.start_date && t.end_date) ? Math.max(1, Math.round((parseInt(t.end_date) - parseInt(t.start_date)))) : '-';
        return `<div class="diag-top3-card" onmouseenter="this.style.borderLeftColor='#2563EB'" onmouseleave="this.style.borderLeftColor='transparent'">
          <div class="dt3-header">
            <span class="dt3-medal" style="color:${medalColors[i]}">${medals[i]}</span>
            <div class="dt3-info">
              <div class="dt3-brand">${t.brand_name} — ${t.activity_name}</div>
              <div class="dt3-meta">活动时长: ${duration}天</div>
            </div>
            <div class="dt3-value">${fmtPctDiag(t[mk.key])}</div>
          </div>
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
  // 活动时长分析
  const durations = top3.map(t => {
    if (t.start_date && t.end_date) return Math.max(1, Math.round(parseInt(t.end_date) - parseInt(t.start_date)));
    return null;
  }).filter(d => d !== null);
  if (durations.length > 0) {
    const avgDur = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
    items.push(`Top3 活动平均时长约 <b>${avgDur} 天</b>，${avgDur <= 14 ? '短周期活动有助于制造紧迫感，促进快速转化' : '长周期活动有助于持续曝光和用户触达'}`);
  }

  // 转化率特征
  if (mk.key === 'exposure_claim') {
    items.push('高曝光领取率的活动通常具有<b>直观的券面价值展示</b>和<b>低领取门槛</b>');
    items.push('建议：优化券名称中的利益点表达，突出折扣力度或赠品价值');
  } else if (mk.key === 'claim_redeem') {
    items.push('高领取核销率说明券的<b>使用场景匹配度高</b>，用户领券后有明确的消费动机');
    items.push('建议：缩短券有效期至 3-7 天，制造使用紧迫感');
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
  const activities = [...b.activities].sort((a, c) => (c.exposure_pv || 0) - (a.exposure_pv || 0));
  const storeRate = b.metrics.store_redeem;

  return activities.map(a => {
    const ecr = a.exposure_pv > 0 ? a.claim_pv / a.exposure_pv : 0;
    const crr = a.claim_pv > 0 ? a.redeem_pv / a.claim_pv : 0;
    const err = a.exposure_pv > 0 ? a.redeem_pv / a.exposure_pv : 0;

    // FIX: Bug #7 - 进度条颜色区分高于/低于中位
    function progressBar(label, val, med) {
      const barMax = Math.max(med * 2, val * 1.2, 0.01);
      const pct = Math.min((val / barMax) * 100, 100);
      const medPct = Math.min((med / barMax) * 100, 100);
      const color = val >= med ? '#2563EB' : '#DC2626';
      return `<div class="da-metric">
        <div class="da-m-header"><span class="da-m-label">${label}</span><span class="da-m-val" style="color:${color}">${fmtPctDiag(val)}</span></div>
        <div class="da-m-bar"><div class="da-m-fill" style="width:${pct}%;background:${color}"></div>
          <div class="da-m-med-line" style="left:${medPct}%" title="中位数 ${fmtPctDiag(med)}"></div>
        </div>
        <div class="da-m-ref">中位 ${fmtPctDiag(med)}</div>
      </div>`;
    }

    return `<div class="diag-activity-card">
      <div class="dac-header">
        <div class="dac-name">${a.activity_name}</div>
        <div class="dac-stats">曝光 ${fmtNum(a.exposure_pv)} | 领取 ${fmtNum(a.claim_pv)} | 核销 ${fmtNum(a.redeem_pv)}</div>
      </div>
      <div class="dac-funnel-mini">
        <span class="dac-f-step">曝光 ${fmtNum(a.exposure_pv)}</span>
        <span class="dac-f-arrow">→<span style="font-size:10px;color:#2563EB">${fmtPctDiag(ecr)}</span>→</span>
        <span class="dac-f-step">领取 ${fmtNum(a.claim_pv)}</span>
        <span class="dac-f-arrow">→<span style="font-size:10px;color:#2563EB">${fmtPctDiag(crr)}</span>→</span>
        <span class="dac-f-step">核销 ${fmtNum(a.redeem_pv)}</span>
      </div>
      <div class="dac-grid">
        ${progressBar('曝光领取率', ecr, meds.exposure_claim || 0)}
        ${progressBar('领取核销率', crr, meds.claim_redeem || 0)}
        ${progressBar('曝光核销率', err, meds.exposure_redeem || 0)}
        ${progressBar('到店核销率', storeRate, meds.store_redeem || 0)}
      </div>
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
