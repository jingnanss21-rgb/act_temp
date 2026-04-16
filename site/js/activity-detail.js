/**
 * activity-detail.js - 品牌活动明细模块
 */

let detailData = [];
let filteredData = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let allCategories = [];

async function loadActivityDetail() {
  const tableBody = document.getElementById('detail-table-body');
  const wrap = document.getElementById('detail-section');
  wrap.querySelector('.loading')?.remove();

  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  loadingEl.innerHTML = '<div class="spinner"></div><p>加载活动明细数据...</p>';
  wrap.insertBefore(loadingEl, wrap.firstChild);

  try {
    // 先取活动数据
    let allActivities = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const { data, error } = await supabaseClient
        .from('tem_activities')
        .select('*')
        .range(offset, offset + limit - 1);
      if (error) throw error;
      allActivities = allActivities.concat(data || []);
      if (!data || data.length < limit) break;
      offset += limit;
    }

    // 取品牌日报（最新日期的）
    const { data: brandRows, error: bErr } = await supabaseClient
      .from('tem_brand_daily')
      .select('brand_id, brand_name, category_l4, store_count, w7_avg_txn_count, w7_mini_program_ratio, w7_store_redeem_rate_uv, report_date')
      .order('report_date', { ascending: false })
      .limit(5000);
    if (bErr) throw bErr;

    // 按品牌取最新
    const brandMap = {};
    for (const b of brandRows) {
      if (!brandMap[b.brand_id]) brandMap[b.brand_id] = b;
    }

    // 合并数据
    detailData = allActivities.map(act => {
      const brand = brandMap[act.brand_id] || {};
      const eUv = act.exposure_uv || 0;
      const cUv = act.claim_uv || 0;
      const rUv = act.redeem_uv || 0;
      const ePv = act.exposure_pv || 0;
      const cPv = act.claim_pv || 0;
      const rPv = act.redeem_pv || 0;

      return {
        category_l4: brand.category_l4 || '-',
        brand_id: act.brand_id,
        brand_name: act.brand_name || brand.brand_name || '-',
        store_count: brand.store_count || '-',
        w7_avg_txn_count: brand.w7_avg_txn_count || '-',
        w7_mini_program_ratio: brand.w7_mini_program_ratio || '-',
        activity_id: act.activity_id,
        activity_name: act.activity_name || '-',
        exposure_uv: eUv,
        claim_uv: cUv,
        redeem_uv: rUv,
        uv_exposure_claim: eUv > 0 ? cUv / eUv : 0,
        uv_claim_redeem: cUv > 0 ? rUv / cUv : 0,
        uv_exposure_redeem: eUv > 0 ? rUv / eUv : 0,
        exposure_pv: ePv,
        claim_pv: cPv,
        redeem_pv: rPv,
        pv_exposure_claim: ePv > 0 ? cPv / ePv : 0,
        pv_claim_redeem: cPv > 0 ? rPv / cPv : 0,
        pv_exposure_redeem: ePv > 0 ? rPv / ePv : 0,
        w7_store_redeem_rate_uv: brand.w7_store_redeem_rate_uv || '-',
      };
    });

    // 收集类目
    allCategories = [...new Set(detailData.map(d => d.category_l4).filter(c => c && c !== '-'))].sort();
    populateCategoryFilter();

    filteredData = [...detailData];
    currentPage = 1;
    renderDetailTable();
  } catch (err) {
    loadingEl.innerHTML = `<p style="color:var(--danger)">加载失败: ${err.message}</p>`;
    console.error(err);
    return;
  }

  loadingEl.remove();
}

function populateCategoryFilter() {
  const sel = document.getElementById('category-filter');
  sel.innerHTML = '<option value="">全部类目</option>';
  for (const cat of allCategories) {
    sel.innerHTML += `<option value="${cat}">${cat}</option>`;
  }
}

function filterDetailData() {
  const cat = document.getElementById('category-filter').value;
  const keyword = document.getElementById('brand-search').value.trim().toLowerCase();

  filteredData = detailData.filter(row => {
    if (cat && row.category_l4 !== cat) return false;
    if (keyword && !row.brand_name.toLowerCase().includes(keyword) && !row.brand_id.toLowerCase().includes(keyword)) return false;
    return true;
  });

  currentPage = 1;
  renderDetailTable();
}

function fmtNum(n) {
  if (n === null || n === undefined || n === '-') return '-';
  if (typeof n === 'string') return n;
  return n.toLocaleString();
}

function fmtRate(r) {
  if (r === null || r === undefined || r === '-') return '-';
  if (typeof r === 'string') {
    const f = parseFloat(r);
    if (isNaN(f)) return r;
    // 如果已经是百分比字符串（如 "12.34%"），直接返回
    if (r.includes('%')) return r;
    // 如果是 0~1 的小数
    if (f <= 1) return (f * 100).toFixed(2) + '%';
    return f.toFixed(2) + '%';
  }
  return (r * 100).toFixed(2) + '%';
}

function rateClass(r) {
  if (typeof r === 'string') r = parseFloat(r);
  if (isNaN(r) || r === null || r === undefined) return '';
  // 如果是 0~1 的小数
  const pct = r <= 1 ? r * 100 : r;
  if (pct >= 10) return 'rate-high';
  if (pct >= 3) return 'rate-mid';
  return 'rate-low';
}

function renderDetailTable() {
  const tbody = document.getElementById('detail-table-body');
  const total = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = filteredData.slice(start, start + PAGE_SIZE);

  let html = '';
  for (const row of pageData) {
    html += `<tr>
      <td>${row.category_l4}</td>
      <td>${row.brand_id}</td>
      <td style="font-weight:500">${row.brand_name}</td>
      <td>${row.store_count}</td>
      <td>${row.w7_avg_txn_count}</td>
      <td>${fmtRate(row.w7_mini_program_ratio)}</td>
      <td>${row.activity_id}</td>
      <td title="${row.activity_name}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${row.activity_name}</td>
      <td>${fmtNum(row.exposure_uv)}</td>
      <td>${fmtNum(row.claim_uv)}</td>
      <td>${fmtNum(row.redeem_uv)}</td>
      <td class="${rateClass(row.uv_exposure_claim)}">${fmtRate(row.uv_exposure_claim)}</td>
      <td class="${rateClass(row.uv_claim_redeem)}">${fmtRate(row.uv_claim_redeem)}</td>
      <td class="${rateClass(row.uv_exposure_redeem)}">${fmtRate(row.uv_exposure_redeem)}</td>
      <td>${fmtNum(row.exposure_pv)}</td>
      <td>${fmtNum(row.claim_pv)}</td>
      <td>${fmtNum(row.redeem_pv)}</td>
      <td class="${rateClass(row.pv_exposure_claim)}">${fmtRate(row.pv_exposure_claim)}</td>
      <td class="${rateClass(row.pv_claim_redeem)}">${fmtRate(row.pv_claim_redeem)}</td>
      <td class="${rateClass(row.pv_exposure_redeem)}">${fmtRate(row.pv_exposure_redeem)}</td>
      <td class="${rateClass(row.w7_store_redeem_rate_uv)}">${fmtRate(row.w7_store_redeem_rate_uv)}</td>
    </tr>`;
  }
  tbody.innerHTML = html || '<tr><td colspan="21" style="text-align:center;padding:32px;color:var(--text-muted)">暂无数据</td></tr>';

  renderPagination(total, totalPages);
}

function renderPagination(total, totalPages) {
  const container = document.getElementById('pagination');
  let html = `<button onclick="goPage(1)" ${currentPage === 1 ? 'disabled' : ''}>&laquo;</button>`;
  html += `<button onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;

  const maxVisible = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

  for (let p = startPage; p <= endPage; p++) {
    html += `<button onclick="goPage(${p})" class="${p === currentPage ? 'active' : ''}">${p}</button>`;
  }

  html += `<button onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
  html += `<button onclick="goPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>&raquo;</button>`;
  html += `<span class="info">共 ${total} 条 / ${totalPages} 页</span>`;

  container.innerHTML = html;
}

function goPage(p) {
  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(p, totalPages));
  renderDetailTable();
  document.getElementById('detail-section').scrollIntoView({ behavior: 'smooth' });
}
