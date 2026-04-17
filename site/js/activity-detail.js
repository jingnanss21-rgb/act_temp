/**
 * activity-detail.js - 品牌活动明细模块（Tab2）
 * 关联对接助理、服务商、负责人
 * 多选筛选 + 导出表格 + 只保留跟进表(商户对接)里有的商户
 */

let detailData = [];
let filteredData = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let allCategories = [];

// 转化率异常阈值
const DETAIL_RATE_CAPS = {
  exposure_claim: 0.40,   // 曝光领取率 40%
  claim_redeem: 0.80,     // 领取核销率 80%
  exposure_redeem: 0.10,  // 曝光核销率 10%
  store_redeem: 100,      // 到店核销率 100%（底表存的是百分比数值如52.86）
};

function isRateAnomaly(field, value) {
  if (field === 'exposure_claim' && value > DETAIL_RATE_CAPS.exposure_claim) return true;
  if (field === 'claim_redeem' && value > DETAIL_RATE_CAPS.claim_redeem) return true;
  if (field === 'exposure_redeem' && value > DETAIL_RATE_CAPS.exposure_redeem) return true;
  if (field === 'store_redeem' && value > DETAIL_RATE_CAPS.store_redeem) return true;
  return false;
}

function fmtRateWithAnomaly(rate, field) {
  const str = fmtRate(rate);
  if (typeof rate !== 'number' || isNaN(rate)) return str;
  if (isRateAnomaly(field, rate)) {
    return `<span class="anomaly-value" title="转化率超过阈值">⚠ 数据异常</span>`;
  }
  return str;
}

// 到店核销率专用：底表存的是百分比字符串如 "52.86%"，不能 parseFloat 后再乘100
function fmtStoreRate(val) {
  if (!val || val === '-') return '-';
  const s = String(val).trim();
  if (s.includes('%')) {
    const num = parseFloat(s);
    if (!isNaN(num) && num >= 100) return '<span class="anomaly-value" title="转化率超过阈值">⚠ 数据异常</span>';
    return s;
  }
  const f = parseFloat(s);
  if (isNaN(f)) return '-';
  if (f >= 100) return '<span class="anomaly-value" title="转化率超过阈值">⚠ 数据异常</span>';
  if (f <= 1) return (f * 100).toFixed(1) + '%';
  return f.toFixed(1) + '%';
}

// 关联数据
let merchantMap = {};     // brand_id → { contact_assistant, operating_sp }
let spOwnerMap = {};      // sp_name → owner (负责人)
let kaOwnerMap = {};      // brand_id → owner (KA负责人)
let trackedBrandIds = new Set(); // 跟进表里有的品牌id

// 多选筛选状态
let filterAssistants = new Set();
let filterSPs = new Set();
let filterOwners = new Set();

async function loadActivityDetail() {
  const wrap = document.getElementById('detail-section');
  wrap.querySelector('.loading')?.remove();

  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  loadingEl.innerHTML = '<div class="spinner"></div><p>加载活动明细数据...</p>';
  wrap.insertBefore(loadingEl, wrap.firstChild);

  try {
    // 并行加载所有数据
    const [actResult, brandResult, merchantResult, spResult, kaResult] = await Promise.all([
      fetchAll('tem_activities', '*', 'report_date.desc'),
      supabaseClient.from('tem_brand_daily')
        .select('brand_id, brand_name, category_l4, store_count, w7_avg_txn_count, w7_mini_program_ratio, w7_store_redeem_rate_uv, report_date')
        .order('report_date', { ascending: false }).limit(5000),
      supabaseClient.from('tem_merchant_contacts')
        .select('brand_id, brand_name, operating_sp, contact_assistant, brand_status').limit(5000),
      supabaseClient.from('tem_sp_assignments')
        .select('sp_name, owner').limit(500),
      supabaseClient.from('tem_ka_assignments')
        .select('brand_id, owner').limit(500),
    ]);

    const allActivities = actResult;

    // 活动去重：同一 activity_id 可能有多个 report_date，只保留最新一条
    const seenActivityIds = new Set();
    const uniqueActivities = [];
    for (const act of allActivities) {
      if (!seenActivityIds.has(act.activity_id)) {
        seenActivityIds.add(act.activity_id);
        uniqueActivities.push(act);
      }
    }

    const brandRows = brandResult.data || [];
    const merchantRows = merchantResult.data || [];
    const spRows = spResult.data || [];
    const kaRows = kaResult.data || [];

    // 构建 merchantMap + trackedBrandIds
    merchantMap = {};
    trackedBrandIds = new Set();
    for (const m of merchantRows) {
      if (!m.brand_id) continue;
      const bid = String(m.brand_id);
      trackedBrandIds.add(bid);
      merchantMap[bid] = {
        contact_assistant: m.contact_assistant || '',
        operating_sp: m.operating_sp || '',
      };
    }

    // 构建 spOwnerMap
    spOwnerMap = {};
    for (const s of spRows) {
      if (s.sp_name) spOwnerMap[s.sp_name] = s.owner || '';
    }

    // 构建 kaOwnerMap
    kaOwnerMap = {};
    for (const k of kaRows) {
      if (k.brand_id) kaOwnerMap[String(k.brand_id)] = k.owner || '';
    }

    // 品牌日报按品牌取最新
    const brandMap = {};
    for (const b of brandRows) {
      if (!brandMap[b.brand_id]) brandMap[b.brand_id] = b;
    }

    // 合并数据 — 只保留跟进表里有的商户
    detailData = [];
    for (const act of uniqueActivities) {
      const bid = String(act.brand_id);
      if (!trackedBrandIds.has(bid)) continue; // 过滤掉不在跟进表的

      const brand = brandMap[bid] || {};
      const merchant = merchantMap[bid] || {};
      const eUv = act.exposure_uv || 0;
      const cUv = act.claim_uv || 0;
      const rUv = act.redeem_uv || 0;
      const ePv = act.exposure_pv || 0;
      const cPv = act.claim_pv || 0;
      const rPv = act.redeem_pv || 0;

      // 过滤曝光=0的活动
      if (ePv === 0 && eUv === 0) continue;

      // 负责人逻辑：先查 KA分工，再查 品牌→经营服务商→服务商分工→负责人
      let owner = kaOwnerMap[bid] || '';
      if (!owner && merchant.operating_sp) {
        owner = spOwnerMap[merchant.operating_sp] || '';
      }

      detailData.push({
        category_l4: brand.category_l4 || '-',
        brand_id: bid,
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
        contact_assistant: merchant.contact_assistant || '-',
        operating_sp: merchant.operating_sp || '-',
        owner: owner || '-',
      });
    }

    // 收集筛选选项
    allCategories = [...new Set(detailData.map(d => d.category_l4).filter(c => c && c !== '-'))].sort();
    populateFilters();

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

// 分页加载全量数据
async function fetchAll(table, select, order) {
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    let query = supabaseClient.from(table).select(select);
    if (order) {
      const [col, dir] = order.split('.');
      query = query.order(col, { ascending: dir !== 'desc' });
    }
    const { data, error } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < limit) break;
    offset += limit;
  }
  return all;
}

function populateFilters() {
  // 类目
  const catSel = document.getElementById('category-filter');
  catSel.innerHTML = '<option value="">全部类目</option>';
  for (const cat of allCategories) {
    catSel.innerHTML += `<option value="${cat}">${cat}</option>`;
  }

  // 多选筛选列表
  const assistants = [...new Set(detailData.map(d => d.contact_assistant).filter(v => v && v !== '-'))].sort();
  const sps = [...new Set(detailData.map(d => d.operating_sp).filter(v => v && v !== '-'))].sort();
  const owners = [...new Set(detailData.map(d => d.owner).filter(v => v && v !== '-'))].sort();

  buildMultiSelect('ms-assistant', '对接助理', assistants, filterAssistants);
  buildMultiSelect('ms-sp', '服务商', sps, filterSPs);
  buildMultiSelect('ms-owner', '负责人', owners, filterOwners);
}

function buildMultiSelect(containerId, label, options, stateSet) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="multi-select-btn" onclick="toggleMultiDropdown('${containerId}')">
      <span>${label} <span class="multi-count-${containerId}"></span></span>
      <span class="arrow">▾</span>
    </div>
    <div class="multi-select-dropdown" id="dd-${containerId}">
      ${options.map(opt =>
        `<label class="multi-select-option">
          <input type="checkbox" value="${opt}" onchange="onMultiSelectChange('${containerId}', this)" ${stateSet.has(opt) ? 'checked' : ''}>
          ${opt}
        </label>`
      ).join('')}
    </div>`;
  updateMultiCount(containerId, stateSet);
}

function toggleMultiDropdown(containerId) {
  const dd = document.getElementById('dd-' + containerId);
  const btn = dd?.previousElementSibling;
  dd?.classList.toggle('show');
  btn?.classList.toggle('open');

  // 关闭其他
  document.querySelectorAll('.multi-select-dropdown').forEach(el => {
    if (el.id !== 'dd-' + containerId) el.classList.remove('show');
  });
}

function onMultiSelectChange(containerId, checkbox) {
  let stateSet;
  if (containerId === 'ms-assistant') stateSet = filterAssistants;
  else if (containerId === 'ms-sp') stateSet = filterSPs;
  else stateSet = filterOwners;

  if (checkbox.checked) stateSet.add(checkbox.value);
  else stateSet.delete(checkbox.value);

  updateMultiCount(containerId, stateSet);
  filterDetailData();
}

function updateMultiCount(containerId, stateSet) {
  const countEl = document.querySelector(`.multi-count-${containerId}`);
  if (countEl) {
    countEl.innerHTML = stateSet.size > 0 ? `<span class="multi-select-count">${stateSet.size}</span>` : '';
  }
}

// 点击外部关闭多选下拉
document.addEventListener('click', (e) => {
  if (!e.target.closest('.multi-select-wrap')) {
    document.querySelectorAll('.multi-select-dropdown').forEach(el => el.classList.remove('show'));
    document.querySelectorAll('.multi-select-btn').forEach(el => el.classList.remove('open'));
  }
});

// 品牌搜索下拉
function showBrandDropdown(query) {
  const dd = document.getElementById('brand-search-dropdown');
  if (!dd) return;
  const q = (query || '').trim().toLowerCase();
  if (!q) { dd.style.display = 'none'; return; }

  // 从 detailData 中提取唯一品牌
  const seen = new Set();
  const matches = [];
  for (const row of detailData) {
    const key = row.brand_id;
    if (seen.has(key)) continue;
    if (String(row.brand_id).includes(q) || (row.brand_name || '').toLowerCase().includes(q)) {
      seen.add(key);
      matches.push({ id: row.brand_id, name: row.brand_name });
      if (matches.length >= 10) break;
    }
  }

  if (matches.length === 0) { dd.style.display = 'none'; return; }

  dd.innerHTML = matches.map(m =>
    `<div class="search-dd-item" onclick="selectBrandSearch('${m.id}','${(m.name||'').replace(/'/g,"\\'")}')">
      <span style="color:#94A3B8;font-size:13px;margin-right:6px">${m.id}</span><span style="font-size:13px;font-weight:500;color:#1E293B">${m.name}</span>
    </div>`
  ).join('');
  dd.style.display = 'block';
}

function selectBrandSearch(id, name) {
  document.getElementById('brand-search').value = name || id;
  hideBrandDropdown();
  filterDetailData();
}

function hideBrandDropdown() {
  const dd = document.getElementById('brand-search-dropdown');
  if (dd) dd.style.display = 'none';
}

// 点击外部关闭下拉
document.addEventListener('click', function(e) {
  if (!e.target.closest('#brand-search') && !e.target.closest('#brand-search-dropdown')) {
    hideBrandDropdown();
  }
});

function filterDetailData() {
  const cat = document.getElementById('category-filter').value;
  const keyword = document.getElementById('brand-search').value.trim().toLowerCase();

  filteredData = detailData.filter(row => {
    if (cat && row.category_l4 !== cat) return false;
    if (keyword && !row.brand_name.toLowerCase().includes(keyword) && !row.brand_id.toLowerCase().includes(keyword)) return false;
    if (filterAssistants.size > 0 && !filterAssistants.has(row.contact_assistant)) return false;
    if (filterSPs.size > 0 && !filterSPs.has(row.operating_sp)) return false;
    if (filterOwners.size > 0 && !filterOwners.has(row.owner)) return false;
    return true;
  });

  currentPage = 1;
  renderDetailTable();
}

function fmtNum(n) {
  if (n === null || n === undefined || n === '-') return '-';
  if (typeof n === 'string') {
    const f = parseFloat(n);
    if (isNaN(f)) return n;
    return f.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtRate(r) {
  if (r === null || r === undefined || r === '-') return '-';
  if (typeof r === 'string') {
    const f = parseFloat(r);
    if (isNaN(f)) return r;
    if (r.includes('%')) return r;
    if (f <= 1) return (f * 100).toFixed(1) + '%';
    return f.toFixed(1) + '%';
  }
  return (r * 100).toFixed(1) + '%';
}

function rateClass(r) {
  if (typeof r === 'string') r = parseFloat(r);
  if (isNaN(r) || r === null || r === undefined) return '';
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
    // 判断该活动是否有异常转化率
    const hasAnomaly =
      isRateAnomaly('exposure_claim', row.uv_exposure_claim) ||
      isRateAnomaly('claim_redeem', row.uv_claim_redeem) ||
      isRateAnomaly('exposure_redeem', row.uv_exposure_redeem) ||
      isRateAnomaly('exposure_claim', row.pv_exposure_claim) ||
      isRateAnomaly('claim_redeem', row.pv_claim_redeem) ||
      isRateAnomaly('exposure_redeem', row.pv_exposure_redeem) ||
      isRateAnomaly('store_redeem', parseFloat(row.w7_store_redeem_rate_uv) || 0);

    const rowClass = hasAnomaly ? ' class="anomaly-row"' : '';
    html += `<tr${rowClass}>
      <td>${row.category_l4}</td>
      <td>${row.brand_id}</td>
      <td style="font-weight:500">${row.brand_name}</td>
      <td>${fmtNum(row.store_count)}</td>
      <td>${fmtNum(row.w7_avg_txn_count)}</td>
      <td>${fmtRate(row.w7_mini_program_ratio)}</td>
      <td>${row.contact_assistant}</td>
      <td>${row.operating_sp}</td>
      <td>${row.owner}</td>
      <td>${row.activity_id}</td>
      <td title="${row.activity_name}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${row.activity_name}</td>
      <td>${fmtNum(row.exposure_uv)}</td>
      <td>${fmtNum(row.claim_uv)}</td>
      <td>${fmtNum(row.redeem_uv)}</td>
      <td class="${rateClass(row.uv_exposure_claim)}">${fmtRateWithAnomaly(row.uv_exposure_claim, 'exposure_claim')}</td>
      <td class="${rateClass(row.uv_claim_redeem)}">${fmtRateWithAnomaly(row.uv_claim_redeem, 'claim_redeem')}</td>
      <td class="${rateClass(row.uv_exposure_redeem)}">${fmtRateWithAnomaly(row.uv_exposure_redeem, 'exposure_redeem')}</td>
      <td>${fmtNum(row.exposure_pv)}</td>
      <td>${fmtNum(row.claim_pv)}</td>
      <td>${fmtNum(row.redeem_pv)}</td>
      <td class="${rateClass(row.pv_exposure_claim)}">${fmtRateWithAnomaly(row.pv_exposure_claim, 'exposure_claim')}</td>
      <td class="${rateClass(row.pv_claim_redeem)}">${fmtRateWithAnomaly(row.pv_claim_redeem, 'claim_redeem')}</td>
      <td class="${rateClass(row.pv_exposure_redeem)}">${fmtRateWithAnomaly(row.pv_exposure_redeem, 'exposure_redeem')}</td>
      <td class="${rateClass(row.w7_store_redeem_rate_uv)}">${fmtStoreRate(row.w7_store_redeem_rate_uv)}</td>
    </tr>`;
  }
  tbody.innerHTML = html || '<tr><td colspan="24" style="text-align:center;padding:32px;color:var(--text-muted)">暂无数据</td></tr>';

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

// ============================================================
// 导出表格为 CSV
// ============================================================
function exportDetailCSV() {
  if (filteredData.length === 0) { alert('暂无数据可导出'); return; }

  const headers = [
    '类目', '品牌ID', '品牌名称', '门店数', '日均交易笔数', '小程序占比',
    '对接助理', '服务商', '负责人',
    '活动ID', '活动名称',
    '曝光UV', '领取UV', '核销UV', 'UV曝光领取率', 'UV领取核销率', 'UV曝光核销率',
    '曝光PV', '领取PV', '核销PV', 'PV曝光领取率', 'PV领取核销率', 'PV曝光核销率',
    '到店核销率',
  ];

  const csvRows = [headers.join(',')];

  for (const row of filteredData) {
    const vals = [
      row.category_l4, row.brand_id, `"${row.brand_name}"`, row.store_count, row.w7_avg_txn_count,
      fmtRate(row.w7_mini_program_ratio),
      `"${row.contact_assistant}"`, `"${row.operating_sp}"`, `"${row.owner}"`,
      row.activity_id, `"${row.activity_name}"`,
      row.exposure_uv, row.claim_uv, row.redeem_uv,
      fmtRate(row.uv_exposure_claim), fmtRate(row.uv_claim_redeem), fmtRate(row.uv_exposure_redeem),
      row.exposure_pv, row.claim_pv, row.redeem_pv,
      fmtRate(row.pv_exposure_claim), fmtRate(row.pv_claim_redeem), fmtRate(row.pv_exposure_redeem),
      fmtRate(row.w7_store_redeem_rate_uv),
    ];
    csvRows.push(vals.join(','));
  }

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `活动明细_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
