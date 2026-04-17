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
          <button class="btn-export" style="display:none" id="diag-export-btn" onclick="exportDiagnosis()">导出诊断报告</button>
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
  let totalScore = 0;
  const scoreMetrics = isExt ? DIAG_METRICS_EXT : DIAG_METRICS;
  const scorePerItem = 100 / scoreMetrics.length;
  for (const mk of scoreMetrics) {
    const base = p85[mk.key] || 0.01;
    totalScore += Math.min(b.metrics[mk.key] / base, 1.0) * scorePerItem;
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
          ${!isExt ? `<div style="flex:1;background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">曝光</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${fmtNum(b.totals.exposure_pv)}</div>
          </div>` : ''}
          <div style="flex:1;background:#F0FDF4;border:1px solid #DCFCE7;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">领取</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${fmtNum(b.totals.claim_pv)}</div>
          </div>
          <div style="flex:1;background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px 14px;text-align:center">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">核销</div>
            <div style="font-size:20px;font-weight:700;color:#1E293B">${fmtNum(b.totals.redeem_pv)}</div>
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
        const exposurePv = b.totals.exposure_pv;
        const claimPv = b.totals.claim_pv;
        const redeemPv = b.totals.redeem_pv;
        const storeRdmRate = b.metrics.store_redeem;
        const storeVisit = (storeRdmRate > 0) ? Math.round(redeemPv / storeRdmRate) : null;
        const expClm = claimPv / Math.max(exposurePv, 1);
        const clmToStore = (storeVisit && claimPv > 0) ? storeVisit / claimPv : NaN;
        const storeRdm = storeRdmRate;
        const lossRate = (r) => isNaN(r) ? NaN : 1 - r;
        const fp = (v) => isNaN(v) ? '-' : (v * 100).toFixed(1) + '%';

        const allNodes = [
          { label: '曝光人数', value: fmtNum(exposurePv), unit: '人', opacity: '', ext: false },
          { label: '领取人数', value: fmtNum(claimPv), unit: '人', opacity: isExt ? '' : 'CC', ext: true },
          { label: '到店人数', value: storeVisit !== null ? fmtNum(storeVisit) : '-', unit: '人*预估', opacity: isExt ? 'CC' : 'AA', ext: true },
          { label: '核销人数', value: fmtNum(redeemPv), unit: '人', opacity: isExt ? '88' : '88', ext: true },
        ];
        const allArrows = [
          { rateLabel: '曝光领取率', rate: fp(expClm), loss: fp(lossRate(expClm)), ext: false },
          { rateLabel: '领取到店率*预估', rate: fp(clmToStore), loss: fp(lossRate(clmToStore)), ext: true },
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
async function exportDiagnosis() {
  const btn = document.getElementById('diag-export-btn');
  const container = document.getElementById('diag-result');
  if (!container || !btn) return;

  btn.textContent = '导出中...';
  btn.disabled = true;

  const detailBody = document.getElementById('diag-d-body');
  const detailToggle = document.getElementById('diag-d-toggle');
  const wasHidden = detailBody && detailBody.style.display === 'none';

  try {
    // 强制禁用所有动画和透明度
    container.classList.add('export-mode');

    // 展开活动明细
    if (wasHidden && detailBody) {
      detailBody.style.display = 'block';
    }

    // 等两帧确保样式生效
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#F8FAFC',
      scrollY: -window.scrollY,
      windowHeight: container.scrollHeight
    });
    const modeLabel = diagMode === 'external' ? '_对外版' : '';
    const link = document.createElement('a');
    link.download = `品牌诊断${modeLabel}_${diagCurrentBrand?.brand_name || 'report'}_${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (e) {
    alert('导出失败，请重试');
    console.error('导出失败', e);
  } finally {
    container.classList.remove('export-mode');

    if (wasHidden && detailBody) {
      detailBody.style.display = 'none';
      if (detailToggle) detailToggle.textContent = '展开 ∨';
    }

    btn.textContent = '导出诊断报告';
    btn.disabled = false;
  }
}

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
              <div class="dt3-brand">${t.brand_name} — ${t.activity_name}</div>
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
  const activities = [...b.activities].sort((a, c) => (c.exposure_pv || 0) - (a.exposure_pv || 0));
  const storeRate = b.metrics.store_redeem;

  return activities.map(a => {
    const ecr = a.exposure_pv > 0 ? a.claim_pv / a.exposure_pv : 0;
    const crr = a.claim_pv > 0 ? a.redeem_pv / a.claim_pv : 0;
    const err = a.exposure_pv > 0 ? a.redeem_pv / a.exposure_pv : 0;

    const allActMetrics = [
      { label: '曝光领取率', val: ecr, med: meds.exposure_claim || 0, ext: false },
      { label: '领取核销率', val: crr, med: meds.claim_redeem || 0, ext: true },
      { label: '曝光核销率', val: err, med: meds.exposure_redeem || 0, ext: false },
      { label: '到店核销率', val: storeRate, med: meds.store_redeem || 0, ext: true },
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
          <div class="diag-act-block-val">${fmtNum(a.exposure_pv)}</div>
        </div>
        <div class="diag-act-conv-arrow">
          <span class="diag-act-conv-rate">${fmtPctDiag(ecr)}</span>
          <span class="diag-act-conv-icon">→</span>
        </div>` : ''}
        <div class="diag-act-block diag-act-block-claim">
          <div class="diag-act-block-label">领取</div>
          <div class="diag-act-block-val">${fmtNum(a.claim_pv)}</div>
        </div>
        <div class="diag-act-conv-arrow">
          <span class="diag-act-conv-rate">${fmtPctDiag(crr)}</span>
          <span class="diag-act-conv-icon">→</span>
        </div>
        <div class="diag-act-block diag-act-block-redeem">
          <div class="diag-act-block-label">核销</div>
          <div class="diag-act-block-val">${fmtNum(a.redeem_pv)}</div>
        </div>
      </div>
      ${actMetrics.map(m => rateRow(m.label, m.val, m.med)).join('')}
      ${rateRow('到店核销率', storeRate, meds.store_redeem || 0)}
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
