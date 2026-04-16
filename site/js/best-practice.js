/**
 * best-practice.js - 分类目最佳实践 + 品牌诊断卡片
 */

// 固定行业顺序
const CATEGORY_ORDER = ['茶饮咖啡', '中式快餐', '西式快餐', '正餐', '小吃', '甜品烘焙'];

// 转化率异常阈值 — 超过即标记异常，Top3 统计时剔除
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

const METRICS = [
  { key: 'exposure_redeem', label: '曝光核销率', calcField: 'exposure_redeem_rate' },
  { key: 'exposure_claim',  label: '曝光领取率', calcField: 'exposure_claim_rate' },
  { key: 'claim_redeem',    label: '领取核销率', calcField: 'claim_redeem_rate' },
  { key: 'store_redeem',    label: '到店核销率', calcField: 'store_redeem_rate' },
];

const DIAG_METRICS = [
  { key: 'w7_exposure_pv',    label: '近7日曝光PV',  field: 'w7_avg_exposure_pv',    type: 'num' },
  { key: 'w7_claim_pv',       label: '近7日领取PV',  field: 'w7_avg_claim_pv',       type: 'num' },
  { key: 'w7_redeem_pv',      label: '近7日核销PV',  field: 'w7_avg_redeem_pv',      type: 'num' },
  { key: 'w7_exp_claim_rate', label: '曝光领取率',    field: 'w7_exposure_claim_rate', type: 'rate' },
  { key: 'w7_clm_red_rate',   label: '领取核销率',    field: 'w7_claim_redeem_rate',   type: 'rate' },
  { key: 'w7_exp_red_rate',   label: '曝光核销率',    field: 'w7_exposure_redeem_rate',type: 'rate' },
  { key: 'w7_store_rate',     label: '到店核销率',    field: 'w7_store_redeem_rate_uv',type: 'rate' },
];

let bestPracticeData = {};
let selectedCategories = new Set();
let allBrandDaily = [];
let allActivitiesForBP = [];
let trackedBrandIdsForDiag = new Set(); // 跟进表品牌

async function loadBestPracticeData() {
  const container = document.getElementById('best-practice-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载数据中...</p></div>';

  try {
    // 并行加载品牌日报 + 活动 + 商户对接
    const [brandResult, actResult, merchantResult] = await Promise.all([
      supabaseClient.from('tem_brand_daily')
        .select('brand_id, brand_name, category_l4, report_date, w7_exposure_claim_rate, w7_claim_redeem_rate, w7_exposure_redeem_rate, w7_store_redeem_rate_uv, w7_avg_exposure_pv, w7_avg_claim_pv, w7_avg_redeem_pv')
        .order('report_date', { ascending: false }).limit(5000),
      supabaseClient.from('tem_activities')
        .select('activity_id, brand_id, brand_name, activity_name, exposure_pv, claim_pv, redeem_pv, exposure_uv, claim_uv, redeem_uv')
        .limit(10000),
      supabaseClient.from('tem_merchant_contacts')
        .select('brand_id').limit(5000),
    ]);

    if (brandResult.error) throw brandResult.error;
    if (actResult.error) throw actResult.error;

    // 构建跟进表品牌id集合
    trackedBrandIdsForDiag = new Set();
    for (const m of (merchantResult.data || [])) {
      if (m.brand_id) trackedBrandIdsForDiag.add(String(m.brand_id));
    }

    const latestByBrand = {};
    for (const row of brandResult.data) {
      if (!row.brand_id) continue;
      if (!latestByBrand[row.brand_id]) latestByBrand[row.brand_id] = row;
    }
    allBrandDaily = Object.values(latestByBrand);

    const actData = actResult.data || [];

    // 按四级类目分组
    const categoryMap = {};
    allActivitiesForBP = [];

    for (const act of actData) {
      const brand = latestByBrand[act.brand_id];
      const cat = brand?.category_l4 || '';
      if (!isCategoryAllowed(cat)) continue;

      const eUv = act.exposure_uv || 0;
      const cUv = act.claim_uv || 0;
      const rUv = act.redeem_uv || 0;

      const item = {
        brand_name: act.brand_name || brand?.brand_name || '-',
        activity_name: act.activity_name || '',
        activity_id: act.activity_id,
        category_l4: cat,
        exposure_claim_rate: eUv > 0 ? cUv / eUv : 0,
        claim_redeem_rate: cUv > 0 ? rUv / cUv : 0,
        exposure_redeem_rate: eUv > 0 ? rUv / eUv : 0,
        store_redeem_rate: parseFloat(brand?.w7_store_redeem_rate_uv) || 0,
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
        const sorted = [...normalItems].sort((a, b) => b[mk.calcField] - a[mk.calcField]);
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

  // 按固定顺序排列
  const categories = CATEGORY_ORDER.filter(cat => {
    // 找到匹配的四级类目
    return Object.keys(bestPracticeData).some(k => k.includes(cat));
  });

  // 建立映射：行业关键词 → 实际四级类目名
  const catMapping = {};
  for (const kw of CATEGORY_ORDER) {
    const matchedCats = Object.keys(bestPracticeData).filter(k => k.includes(kw));
    if (matchedCats.length > 0) catMapping[kw] = matchedCats;
  }

  if (Object.keys(bestPracticeData).length === 0) {
    container.innerHTML = '<div class="loading"><p>暂无数据</p></div>';
    return;
  }

  let html = '';
  for (const kw of CATEGORY_ORDER) {
    const matchedCats = catMapping[kw] || [];
    for (const cat of matchedCats) {
      const checked = selectedCategories.has(cat) ? 'checked' : '';
      html += `<div class="cat-card" data-category="${cat}">
        <div class="card-header">
          <input type="checkbox" class="custom-check cat-check" data-cat="${cat}" ${checked} onchange="toggleCategory('${cat}', this.checked)">
          <span class="card-title">${cat}</span>
        </div>
        <div class="metric-columns">`;

      for (const metric of METRICS) {
        const top3 = bestPracticeData[cat][metric.key] || [];
        html += `<div class="metric-col">
          <div class="metric-col-header">${metric.label}</div>`;
        for (const item of top3) {
          const rateStr = (item.rate * 100).toFixed(1) + '%';
          html += `<div class="top-item">
            <span class="rank-badge rank-${item.rank}">${item.rank}</span>
            <div class="top-item-info">
              <span class="brand-name">${item.brand_name}</span>
              <span class="act-name" title="${item.activity_name}">${item.activity_name}</span>
            </div>
            <span class="rate-value">${rateStr}</span>
          </div>`;
        }
        if (top3.length === 0) {
          html += '<div class="top-item" style="color:var(--text-muted);font-size:12px">暂无数据</div>';
        }
        html += '</div>';
      }
      html += '</div></div>';
    }
  }
  container.innerHTML = html;
}

function toggleCategory(cat, checked) {
  if (checked) selectedCategories.add(cat);
  else selectedCategories.delete(cat);
}

function toggleAllCategories(checked) {
  const categories = Object.keys(bestPracticeData);
  selectedCategories = checked ? new Set(categories) : new Set();
  document.querySelectorAll('.cat-check').forEach(cb => cb.checked = checked);
}

async function exportCardsAsImage() {
  if (selectedCategories.size === 0) { alert('请先勾选要导出的类目'); return; }
  const cards = document.querySelectorAll('.cat-card');
  const exportArea = document.getElementById('export-canvas-area');
  exportArea.innerHTML = '';
  exportArea.style.cssText = 'position:absolute;left:0;top:0;width:1200px;background:#F8FAFC;padding:24px;display:grid;grid-template-columns:repeat(2,1fr);gap:20px;';

  for (const card of cards) {
    const cat = card.dataset.category;
    if (selectedCategories.has(cat)) {
      const clone = card.cloneNode(true);
      clone.querySelector('.cat-check')?.remove();
      exportArea.appendChild(clone);
    }
  }
  document.body.appendChild(exportArea);

  try {
    const canvas = await html2canvas(exportArea, { scale: 2, useCORS: true, backgroundColor: '#F8FAFC' });
    const link = document.createElement('a');
    link.download = `最佳实践_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) { alert('导出失败: ' + err.message); }
  exportArea.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
}

// ============================================================
// 品牌诊断卡片 - 搜索式下拉（只搜跟进表商户）
// ============================================================

let diagBrandList = [];

function initBrandDiagnostics() {
  // 只保留跟进表里有的品牌
  diagBrandList = allBrandDaily
    .filter(b => b.brand_name && b.category_l4 && trackedBrandIdsForDiag.has(String(b.brand_id)))
    .sort((a, b) => (a.brand_name || '').localeCompare(b.brand_name || ''));

  const input = document.getElementById('brand-diag-input');
  if (!input) return;

  input.addEventListener('input', () => {
    const keyword = input.value.trim().toLowerCase();
    showDiagDropdown(keyword);
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

  function median(arr) {
    const sorted = arr.filter(v => !isNaN(v) && v !== null).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const diagRows = [];
  for (const m of DIAG_METRICS) {
    const brandVal = parseFloat(brand[m.field]) || 0;
    const catValues = sameCatBrands.map(b => parseFloat(b[m.field]) || 0);
    const catMedian = median(catValues);

    let bestVal = 0, bestBrandName = '-';
    for (const b of sameCatBrands) {
      const v = parseFloat(b[m.field]) || 0;
      if (v > bestVal) { bestVal = v; bestBrandName = b.brand_name || '-'; }
    }

    const diff = brandVal - catMedian;
    const diffSign = diff >= 0 ? '+' : '';
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    const color = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)';

    diagRows.push({ label: m.label, brandVal, catMedian, catBest: bestVal, bestBrandName, diff, diffSign, arrow, color, type: m.type });
  }

  const container = document.getElementById('diag-card-container');
  const fmtV = (v, type) => type === 'rate' ? (v * 100).toFixed(1) + '%' : v.toFixed(1);

  let html = `
  <div class="diag-card" id="diag-card-export">
    <div class="diag-header">
      <div class="diag-brand-name">${brand.brand_name}</div>
      <div class="diag-cat">类目：${cat} | 类目品牌数：${sameCatBrands.length}</div>
    </div>
    <table class="diag-table">
      <thead><tr><th>指标</th><th>品牌值</th><th>类目中位数</th><th>vs 中位数</th><th>行业最佳</th><th>最佳品牌</th></tr></thead>
      <tbody>`;

  for (const r of diagRows) {
    html += `<tr>
      <td style="font-weight:500">${r.label}</td>
      <td style="font-weight:600">${fmtV(r.brandVal, r.type)}</td>
      <td>${fmtV(r.catMedian, r.type)}</td>
      <td style="color:${r.color};font-weight:600">${r.arrow} ${r.diffSign}${r.type === 'rate' ? (r.diff * 100).toFixed(1) + 'pp' : r.diff.toFixed(1)}</td>
      <td style="color:var(--primary);font-weight:500">${fmtV(r.catBest, r.type)}</td>
      <td>${r.bestBrandName}</td>
    </tr>`;
  }

  html += `</tbody></table>
    <div class="diag-footer">数据日期：${brand.report_date || '-'} | 类目：${cat}</div>
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
    const brandName = card.querySelector('.diag-brand-name')?.textContent || '品牌';
    link.download = `诊断卡片_${brandName}_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) { alert('导出失败: ' + err.message); }
}
