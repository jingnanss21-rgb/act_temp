/**
 * best-practice.js - 分类目最佳实践模块
 */

const METRICS = [
  { key: 'exposure_redeem', label: '曝光核销率', field_daily: 'daily_exposure_redeem_rate', field_w7: 'w7_exposure_redeem_rate' },
  { key: 'exposure_claim',  label: '曝光领取率', field_daily: 'daily_exposure_claim_rate',  field_w7: 'w7_exposure_claim_rate' },
  { key: 'claim_redeem',    label: '领取核销率', field_daily: 'daily_claim_redeem_rate',    field_w7: 'w7_claim_redeem_rate' },
  { key: 'store_redeem',    label: '到店核销率', field_daily: null,                         field_w7: 'w7_store_redeem_rate_uv' },
];

let bestPracticeData = {};
let selectedCategories = new Set();

async function loadBestPracticeData() {
  const container = document.getElementById('best-practice-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载数据中...</p></div>';

  try {
    // 取品牌日报最新日期的数据
    const { data: brandData, error: bErr } = await supabaseClient
      .from('tem_brand_daily')
      .select('brand_id, brand_name, category_l1, report_date, w7_exposure_claim_rate, w7_claim_redeem_rate, w7_exposure_redeem_rate, w7_store_redeem_rate_uv')
      .order('report_date', { ascending: false })
      .limit(5000);

    if (bErr) throw bErr;

    // 按品牌取最新一条
    const latestByBrand = {};
    for (const row of brandData) {
      if (!row.brand_id || !row.category_l1) continue;
      if (!latestByBrand[row.brand_id]) {
        latestByBrand[row.brand_id] = row;
      }
    }

    // 取活动数据
    const { data: actData, error: aErr } = await supabaseClient
      .from('tem_activities')
      .select('activity_id, brand_id, brand_name, activity_name, exposure_pv, claim_pv, redeem_pv, exposure_uv, claim_uv, redeem_uv')
      .limit(10000);

    if (aErr) throw aErr;

    // 按类目分组计算 Top3
    const categoryMap = {};
    for (const act of actData) {
      const brand = latestByBrand[act.brand_id];
      if (!brand || !brand.category_l1) continue;
      const cat = brand.category_l1;
      if (!categoryMap[cat]) {
        categoryMap[cat] = [];
      }

      const eUv = act.exposure_uv || 0;
      const cUv = act.claim_uv || 0;
      const rUv = act.redeem_uv || 0;

      categoryMap[cat].push({
        brand_name: act.brand_name || brand.brand_name,
        activity_name: act.activity_name || '',
        activity_id: act.activity_id,
        exposure_claim_rate: eUv > 0 ? cUv / eUv : 0,
        claim_redeem_rate: cUv > 0 ? rUv / cUv : 0,
        exposure_redeem_rate: eUv > 0 ? rUv / eUv : 0,
        store_redeem_rate: parseFloat(brand.w7_store_redeem_rate_uv) || 0,
      });
    }

    bestPracticeData = {};
    for (const [cat, items] of Object.entries(categoryMap)) {
      bestPracticeData[cat] = {};
      const metricKeys = [
        { key: 'exposure_redeem', field: 'exposure_redeem_rate' },
        { key: 'exposure_claim', field: 'exposure_claim_rate' },
        { key: 'claim_redeem', field: 'claim_redeem_rate' },
        { key: 'store_redeem', field: 'store_redeem_rate' },
      ];
      for (const mk of metricKeys) {
        const sorted = [...items].sort((a, b) => b[mk.field] - a[mk.field]);
        bestPracticeData[cat][mk.key] = sorted.slice(0, 3).map((item, idx) => ({
          rank: idx + 1,
          brand_name: item.brand_name,
          activity_name: item.activity_name,
          rate: item[mk.field],
        }));
      }
    }

    renderBestPracticeCards();
  } catch (err) {
    container.innerHTML = `<div class="loading"><p style="color: var(--danger);">数据加载失败: ${err.message}</p></div>`;
    console.error(err);
  }
}

function renderBestPracticeCards() {
  const container = document.getElementById('best-practice-container');
  const categories = Object.keys(bestPracticeData).sort();

  if (categories.length === 0) {
    container.innerHTML = '<div class="loading"><p>暂无数据</p></div>';
    return;
  }

  let html = '';
  for (const cat of categories) {
    const checked = selectedCategories.has(cat) ? 'checked' : '';
    html += `<div class="cat-card" data-category="${cat}">
      <div class="card-header">
        <input type="checkbox" class="custom-check cat-check" data-cat="${cat}" ${checked} onchange="toggleCategory('${cat}', this.checked)">
        <span class="card-title">${cat}</span>
      </div>`;

    for (const metric of METRICS) {
      const top3 = bestPracticeData[cat][metric.key] || [];
      html += `<div class="metric-block">
        <span class="metric-label">${metric.label}</span>`;
      for (const item of top3) {
        const rateStr = (item.rate * 100).toFixed(2) + '%';
        html += `<div class="top-item">
          <span class="rank-badge rank-${item.rank}">${item.rank}</span>
          <span class="brand-name">${item.brand_name}</span>
          <span class="act-name" title="${item.activity_name}">${item.activity_name}</span>
          <span class="rate-value">${rateStr}</span>
        </div>`;
      }
      if (top3.length === 0) {
        html += '<div class="top-item" style="color:var(--text-muted)">暂无数据</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function toggleCategory(cat, checked) {
  if (checked) {
    selectedCategories.add(cat);
  } else {
    selectedCategories.delete(cat);
  }
}

function toggleAllCategories(checked) {
  const categories = Object.keys(bestPracticeData);
  selectedCategories = checked ? new Set(categories) : new Set();
  document.querySelectorAll('.cat-check').forEach(cb => cb.checked = checked);
}

async function exportCardsAsImage() {
  if (selectedCategories.size === 0) {
    alert('请先勾选要导出的类目');
    return;
  }

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
  } catch (err) {
    alert('导出失败: ' + err.message);
  }

  exportArea.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
}
