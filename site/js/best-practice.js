/**
 * best-practice.js - 分类目最佳实践 + 品牌诊断卡片
 */

// 固定行业顺序
const CATEGORY_ORDER = ['茶饮咖啡', '中式快餐', '西式快餐', '正餐', '小吃', '甜品烘焙'];

// 转化率异常阈值
const RATE_CAPS = {
  exposure_claim: 0.40,
  claim_redeem: 0.40,
  exposure_redeem: 0.10,
  store_redeem: 1.00,
};

function isAnomalyActivity(item) {
  return (
    item.exposure_claim_rate > RATE_CAPS.exposure_claim ||
    item.claim_redeem_rate > RATE_CAPS.claim_redeem ||
    item.exposure_redeem_rate > RATE_CAPS.exposure_redeem ||
    item.store_redeem_rate > RATE_CAPS.store_redeem
  );
}

function isCategoryAllowed(catL4) {
  if (!catL4) return false;
  return CATEGORY_ORDER.some(kw => catL4.includes(kw));
}

// 解析百分比字符串 "52.86%" → 0.5286，小数 0.176 → 0.176
function parseRateValue(val) {
  if (val === null || val === undefined || val === '' || val === '<NA>') return NaN;
  const s = String(val).trim();
  if (s.endsWith('%')) {
    return parseFloat(s) / 100;
  }
  return parseFloat(s);
}

// 格式化为百分比字符串
function fmtPct(v) {
  if (isNaN(v) || v === null || v === undefined) return '-';
  return (v * 100).toFixed(1) + '%';
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '' || v === '<NA>') return '-';
  const n = parseFloat(v);
  if (isNaN(n)) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

const METRICS = [
  { key: 'exposure_redeem', label: '曝光核销率', calcField: 'exposure_redeem_rate' },
  { key: 'exposure_claim',  label: '曝光领取率', calcField: 'exposure_claim_rate' },
  { key: 'claim_redeem',    label: '领取核销率', calcField: 'claim_redeem_rate' },
  { key: 'store_redeem',    label: '到店核销率', calcField: 'store_redeem_rate' },
];

let bestPracticeData = {};
let selectedCategories = new Set();
let allBrandDaily = [];
let allActivitiesForBP = [];
let trackedBrandIdsForDiag = new Set();
let latestByBrand = {};

async function loadBestPracticeData() {
  const container = document.getElementById('best-practice-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载数据中...</p></div>';

  try {
    const [brandResult, actResult, merchantResult] = await Promise.all([
      supabaseClient.from('tem_brand_daily')
        .select('brand_id, brand_name, category_l4, report_date, w7_exposure_claim_rate, w7_claim_redeem_rate, w7_exposure_redeem_rate, w7_store_redeem_rate_uv, w7_avg_exposure_pv, w7_avg_claim_pv, w7_avg_redeem_pv, w7_avg_store_redeem, store_count')
        .order('report_date', { ascending: false }).limit(5000),
      supabaseClient.from('tem_activities')
        .select('activity_id, brand_id, brand_name, activity_name, exposure_pv, claim_pv, redeem_pv, exposure_uv, claim_uv, redeem_uv')
        .limit(10000),
      supabaseClient.from('tem_merchant_contacts')
        .select('brand_id').limit(5000),
    ]);

    if (brandResult.error) throw brandResult.error;
    if (actResult.error) throw actResult.error;

    trackedBrandIdsForDiag = new Set();
    for (const m of (merchantResult.data || [])) {
      if (m.brand_id) trackedBrandIdsForDiag.add(String(m.brand_id));
    }

    latestByBrand = {};
    for (const row of brandResult.data) {
      if (!row.brand_id) continue;
      if (!latestByBrand[row.brand_id]) latestByBrand[row.brand_id] = row;
    }
    allBrandDaily = Object.values(latestByBrand);

    const actData = actResult.data || [];
    const categoryMap = {};
    allActivitiesForBP = [];

    for (const act of actData) {
      const brand = latestByBrand[act.brand_id];
      const cat = brand?.category_l4 || '';
      if (!isCategoryAllowed(cat)) continue;

      const ePv = act.exposure_pv || 0;
      const cPv = act.claim_pv || 0;
      const rPv = act.redeem_pv || 0;
      const eUv = act.exposure_uv || 0;
      const cUv = act.claim_uv || 0;
      const rUv = act.redeem_uv || 0;

      // 过滤曝光=0的活动
      if (ePv === 0 && eUv === 0) continue;

      const item = {
        brand_id: act.brand_id,
        brand_name: act.brand_name || brand?.brand_name || '-',
        activity_name: act.activity_name || '',
        activity_id: act.activity_id,
        category_l4: cat,
        exposure_pv: ePv, claim_pv: cPv, redeem_pv: rPv,
        exposure_uv: eUv, claim_uv: cUv, redeem_uv: rUv,
        // PV 维度转化率
        pv_exposure_claim: ePv > 0 ? cPv / ePv : 0,
        pv_claim_redeem: cPv > 0 ? rPv / cPv : 0,
        pv_exposure_redeem: ePv > 0 ? rPv / ePv : 0,
        // UV 维度转化率
        exposure_claim_rate: eUv > 0 ? cUv / eUv : 0,
        claim_redeem_rate: cUv > 0 ? rUv / cUv : 0,
        exposure_redeem_rate: eUv > 0 ? rUv / eUv : 0,
        // 到店核销率（品牌级，百分比字符串）
        store_redeem_rate: parseRateValue(brand?.w7_store_redeem_rate_uv),
      };
      item.is_anomaly = isAnomalyActivity(item);

      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(item);
      allActivitiesForBP.push(item);
    }

    bestPracticeData = {};
    for (const [cat, items] of Object.entries(categoryMap)) {
      bestPracticeData[cat] = {};
      const normalItems = items.filter(i => !i.is_anomaly);
      for (const mk of METRICS) {
        const sorted = [...normalItems]
          .filter(i => !isNaN(i[mk.calcField]) && i[mk.calcField] > 0)
          .sort((a, b) => b[mk.calcField] - a[mk.calcField]);
        bestPracticeData[cat][mk.key] = sorted.slice(0, 3).map((item, idx) => ({
          rank: idx + 1,
          brand_name: item.brand_name,
          activity_name: item.activity_name,
          rate: item[mk.calcField],
        }));
      }
    }

    renderBestPracticeCards();
    initBrandDiagnostics();
  } catch (err) {
    container.innerHTML = `<div class="loading"><p style="color: var(--danger);">数据加载失败: ${err.message}</p></div>`;
    console.error(err);
  }
}

function renderBestPracticeCards() {
  const container = document.getElementById('best-practice-container');

  if (Object.keys(bestPracticeData).length === 0) {
    container.innerHTML = '<div class="loading"><p>暂无数据</p></div>';
    return;
  }

  // 业态emoji映射
  const emojiMap = {
    '茶饮咖啡': '🧋', '中式快餐': '🍚', '西式快餐': '🍔',
    '正餐': '🍽️', '小吃': '🍢', '甜品烘焙': '🍰',
  };

  // 统一视图：按指标 × 行业 Top3
  let html = '';
  for (const metric of METRICS) {
    html += `<div class="unified-metric-section">
      <div class="metric-section-header">${metric.label}</div>
      <table class="metric-table">
        <thead><tr>
          <th style="width:140px">行业</th>
          <th style="width:32px">排名</th>
          <th>品牌</th>
          <th>活动名称</th>
          <th style="width:80px;text-align:right">${metric.label}</th>
        </tr></thead><tbody>`;

    for (const kw of CATEGORY_ORDER) {
      const matchedCats = Object.keys(bestPracticeData).filter(k => k.includes(kw));
      for (const cat of matchedCats) {
        const top3 = bestPracticeData[cat][metric.key] || [];
        const emoji = emojiMap[kw] || '';
        const catDisplay = cat.length > 8 ? cat.slice(0, 8) + '…' : cat;
        for (let i = 0; i < top3.length; i++) {
          const item = top3[i];
          const rateStr = (item.rate * 100).toFixed(1) + '%';
          html += `<tr>
            ${i === 0 ? `<td rowspan="${top3.length}" class="cat-cell">${emoji} ${catDisplay}</td>` : ''}
            <td class="rank-cell"><span class="rank-badge rank-${item.rank}">${item.rank}</span></td>
            <td class="brand-cell">${item.brand_name}</td>
            <td class="act-cell" title="${item.activity_name}">${item.activity_name}</td>
            <td class="rate-cell">${rateStr}</td>
          </tr>`;
        }
        if (top3.length === 0) {
          html += `<tr><td class="cat-cell">${emoji} ${catDisplay}</td><td colspan="4" style="color:var(--text-muted);text-align:center;font-size:12px">暂无数据</td></tr>`;
        }
      }
    }
    html += '</tbody></table></div>';
  }

  container.innerHTML = html;
}

// ============================================================
// 品牌诊断卡片 - 搜索式下拉（只搜跟进表商户）
// ============================================================

let diagBrandList = [];

function initBrandDiagnostics() {
  diagBrandList = allBrandDaily
    .filter(b => b.brand_name && b.category_l4 && trackedBrandIdsForDiag.has(String(b.brand_id)))
    .sort((a, b) => (a.brand_name || '').localeCompare(b.brand_name || ''));

  const input = document.getElementById('brand-diag-input');
  if (!input) return;

  input.addEventListener('input', () => {
    showDiagDropdown(input.value.trim().toLowerCase());
  });
  input.addEventListener('focus', () => {
    showDiagDropdown(input.value.trim().toLowerCase());
  });
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
    filtered = diagBrandList.filter(b =>
      (b.brand_name || '').toLowerCase().includes(keyword) ||
      (b.brand_id || '').toLowerCase().includes(keyword)
    );
  }

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px">未找到匹配品牌（仅支持跟进表商户）</div>';
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
  const input = document.getElementById('brand-diag-input');
  input.value = `${brand.brand_id} - ${brand.brand_name}`;
  document.getElementById('brand-diag-dropdown')?.classList.remove('show');
}

function generateDiagCard() {
  if (!selectedDiagBrandId) { alert('请先输入并选择一个品牌'); return; }

  const brand = allBrandDaily.find(b => b.brand_id === selectedDiagBrandId);
  if (!brand) { alert('未找到品牌数据'); return; }

  const cat = brand.category_l4;
  const sameCatBrands = allBrandDaily.filter(b => b.category_l4 === cat);

  // 该品牌的所有活动
  const brandActivities = allActivitiesForBP.filter(a => String(a.brand_id) === String(selectedDiagBrandId));

  // 同类目所有活动（非异常）
  const sameCatActivities = allActivitiesForBP.filter(a => a.category_l4 === cat && !a.is_anomaly);

  // 品牌级汇总
  const totalExposurePV = brandActivities.reduce((s, a) => s + (a.exposure_pv || 0), 0);
  const totalClaimPV = brandActivities.reduce((s, a) => s + (a.claim_pv || 0), 0);
  const totalRedeemPV = brandActivities.reduce((s, a) => s + (a.redeem_pv || 0), 0);

  function median(arr) {
    const sorted = arr.filter(v => !isNaN(v) && v !== null && v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return NaN;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 同类目中位数（活动级 PV 转化率）
  const catMedianExpClaim = median(sameCatActivities.map(a => a.pv_exposure_claim));
  const catMedianClmRdm  = median(sameCatActivities.map(a => a.pv_claim_redeem));
  const catMedianExpRdm   = median(sameCatActivities.map(a => a.pv_exposure_redeem));
  // 到店核销率中位数（品牌级）
  const catMedianStore = median(sameCatBrands.map(b => parseRateValue(b.w7_store_redeem_rate_uv)));

  // 同类目最佳活动
  function findBest(items, field) {
    let best = null;
    for (const a of items) {
      if (!isNaN(a[field]) && a[field] > 0) {
        if (!best || a[field] > best[field]) best = a;
      }
    }
    return best;
  }

  const bestExpClaim = findBest(sameCatActivities, 'pv_exposure_claim');
  const bestClmRdm = findBest(sameCatActivities, 'pv_claim_redeem');
  const bestExpRdm = findBest(sameCatActivities, 'pv_exposure_redeem');

  // 到店核销率最佳品牌
  let bestStoreBrand = null;
  for (const b of sameCatBrands) {
    const v = parseRateValue(b.w7_store_redeem_rate_uv);
    if (!isNaN(v) && v > 0 && v <= 1.0) {
      if (!bestStoreBrand || v > parseRateValue(bestStoreBrand.w7_store_redeem_rate_uv)) {
        bestStoreBrand = b;
      }
    }
  }

  const container = document.getElementById('diag-card-container');

  // ============ 第一部分：品牌活动表现 ============
  let html = `<div class="diag-card" id="diag-card-export">
    <div class="diag-header">
      <div class="diag-brand-name">${brand.brand_name}</div>
      <div class="diag-cat">类目：${cat} | 数据日期：${brand.report_date || '-'}</div>
    </div>

    <h3 class="diag-subtitle">📊 品牌活动表现（按活动维度）</h3>
    <table class="diag-table">
      <thead><tr>
        <th>活动名称</th>
        <th>曝光PV</th><th>领取PV</th><th>核销PV</th>
        <th>曝光占比</th><th>领取占比</th><th>核销占比</th>
        <th>曝光领取率</th><th>类目中位</th>
        <th>领取核销率</th><th>类目中位</th>
        <th>曝光核销率</th><th>类目中位</th>
        <th>到店核销率</th><th>类目中位</th>
      </tr></thead><tbody>`;

  const storeRate = parseRateValue(brand.w7_store_redeem_rate_uv);

  for (const act of brandActivities) {
    const expShare = totalExposurePV > 0 ? act.exposure_pv / totalExposurePV : 0;
    const clmShare = totalClaimPV > 0 ? act.claim_pv / totalClaimPV : 0;
    const rdmShare = totalRedeemPV > 0 ? act.redeem_pv / totalRedeemPV : 0;

    html += `<tr>
      <td title="${act.activity_name}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${act.activity_name}</td>
      <td>${fmtNum(act.exposure_pv)}</td>
      <td>${fmtNum(act.claim_pv)}</td>
      <td>${fmtNum(act.redeem_pv)}</td>
      <td>${fmtPct(expShare)}</td>
      <td>${fmtPct(clmShare)}</td>
      <td>${fmtPct(rdmShare)}</td>
      <td class="${rateDiffClass(act.pv_exposure_claim, catMedianExpClaim)}">${fmtPct(act.pv_exposure_claim)}</td>
      <td style="color:var(--text-muted)">${fmtPct(catMedianExpClaim)}</td>
      <td class="${rateDiffClass(act.pv_claim_redeem, catMedianClmRdm)}">${fmtPct(act.pv_claim_redeem)}</td>
      <td style="color:var(--text-muted)">${fmtPct(catMedianClmRdm)}</td>
      <td class="${rateDiffClass(act.pv_exposure_redeem, catMedianExpRdm)}">${fmtPct(act.pv_exposure_redeem)}</td>
      <td style="color:var(--text-muted)">${fmtPct(catMedianExpRdm)}</td>
      <td class="${rateDiffClass(storeRate, catMedianStore)}">${fmtPct(storeRate)}</td>
      <td style="color:var(--text-muted)">${fmtPct(catMedianStore)}</td>
    </tr>`;
  }

  if (brandActivities.length === 0) {
    html += '<tr><td colspan="15" style="text-align:center;color:var(--text-muted);padding:16px">该品牌暂无活动数据</td></tr>';
  }

  // 汇总行
  const totalExpClm = totalExposurePV > 0 ? totalClaimPV / totalExposurePV : 0;
  const totalClmRdm = totalClaimPV > 0 ? totalRedeemPV / totalClaimPV : 0;
  const totalExpRdm = totalExposurePV > 0 ? totalRedeemPV / totalExposurePV : 0;
  const storeRedeem1 = brand.w7_avg_store_redeem; // CA列 - 一店几核

  html += `</tbody>
    <tfoot><tr style="font-weight:600;background:#F0F5FF">
      <td>🔖 品牌汇总（近7日）</td>
      <td>${fmtNum(totalExposurePV)}</td>
      <td>${fmtNum(totalClaimPV)}</td>
      <td>${fmtNum(totalRedeemPV)}</td>
      <td>-</td><td>-</td><td>-</td>
      <td>${fmtPct(totalExpClm)}</td><td></td>
      <td>${fmtPct(totalClmRdm)}</td><td></td>
      <td>${fmtPct(totalExpRdm)}</td><td></td>
      <td colspan="2">1店几核: ${storeRedeem1 && storeRedeem1 !== '<NA>' ? parseFloat(storeRedeem1).toFixed(2) : '-'}</td>
    </tr></tfoot>
  </table>`;

  // ============ 第二部分：行业最佳实践 ============
  html += `<h3 class="diag-subtitle" style="margin-top:20px">🏆 行业最佳实践（${cat}）</h3>
    <table class="diag-table">
      <thead><tr><th>指标</th><th>最佳值</th><th>最佳品牌</th><th>最佳活动</th></tr></thead>
      <tbody>`;

  // 曝光领取率
  if (bestExpClaim) {
    html += `<tr><td style="font-weight:500">曝光领取率</td><td style="color:var(--primary);font-weight:600">${fmtPct(bestExpClaim.pv_exposure_claim)}</td><td>${bestExpClaim.brand_name}</td><td title="${bestExpClaim.activity_name}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bestExpClaim.activity_name}</td></tr>`;
  }
  // 领取核销率
  if (bestClmRdm) {
    html += `<tr><td style="font-weight:500">领取核销率</td><td style="color:var(--primary);font-weight:600">${fmtPct(bestClmRdm.pv_claim_redeem)}</td><td>${bestClmRdm.brand_name}</td><td title="${bestClmRdm.activity_name}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bestClmRdm.activity_name}</td></tr>`;
  }
  // 曝光核销率
  if (bestExpRdm) {
    html += `<tr><td style="font-weight:500">曝光核销率</td><td style="color:var(--primary);font-weight:600">${fmtPct(bestExpRdm.pv_exposure_redeem)}</td><td>${bestExpRdm.brand_name}</td><td title="${bestExpRdm.activity_name}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bestExpRdm.activity_name}</td></tr>`;
  }
  // 到店核销率（品牌级）
  if (bestStoreBrand) {
    html += `<tr><td style="font-weight:500">到店核销率</td><td style="color:var(--primary);font-weight:600">${fmtPct(parseRateValue(bestStoreBrand.w7_store_redeem_rate_uv))}</td><td>${bestStoreBrand.brand_name}</td><td>-</td></tr>`;
  }

  html += `</tbody></table>
    <div class="diag-footer">类目品牌数：${sameCatBrands.length} | 类目活动数：${sameCatActivities.length}</div>
  </div>
  <button class="btn-primary" style="margin-top:12px" onclick="exportDiagCard()">📥 导出诊断卡片</button>`;

  container.innerHTML = html;
}

function rateDiffClass(val, median) {
  if (isNaN(val) || isNaN(median)) return '';
  if (val > median) return 'rate-above';
  if (val < median) return 'rate-below';
  return '';
}

async function exportDiagCard() {
  const card = document.getElementById('diag-card-export');
  if (!card) return;
  try {
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: '#F8FAFC' });
    const link = document.createElement('a');
    const brandName = card.querySelector('.diag-brand-name')?.textContent || '品牌';
    link.download = `诊断卡片_${brandName}_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) { alert('导出失败: ' + err.message); }
}
