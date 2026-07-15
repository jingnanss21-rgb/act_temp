/**
 * sp-review.js — 服务商复盘 Tab
 *
 * 模块功能:
 * A. 概览卡片 (在线/流失/筹备/新上线) + 按周趋势图 (累计上线+当期在线)
 * B. 服务商品牌 · 分业态 Top3
 * C. 品牌状态明细表
 * D. 全行业标杆 · 分业态 Top3
 * + 导出PDF功能
 */

let spReviewInitialized = false;
let spReviewData = {
  merchants: [],       // tem_merchant_contacts 全量
  spList: [],          // 服务商列表
  brandDaily: [],      // tem_brand_daily 该服务商品牌的数据
  activities: [],      // tem_activity_daily 区间内数据
};

// ===== 初始化 =====
async function initSpReview() {
  const container = document.getElementById('sp-review-container');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载服务商数据...</p></div>';

  try {
    // 1. 加载跟进表 (服务商+品牌状态)
    spReviewData.merchants = await fetchAllFromView('tem_merchant_contacts', '*');

    // 2. 提取制券服务商列表
    const spSet = new Set(spReviewData.merchants.map(m => m.coupon_sp).filter(Boolean));
    spReviewData.spList = [...spSet].sort();

    // 3. 渲染筛选栏
    renderSpReviewFilters(container);

    // 4. 默认选第一个服务商，日期默认近7天（数据从0414开始）
    const DATA_MIN_DATE = '2026-04-14';
    const now = new Date();
    const end = new Date(now); end.setDate(end.getDate() - 1); // 昨天
    const start = new Date(end); start.setDate(start.getDate() - 6); // 往前7天
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const sprStart = document.getElementById('spr-date-start');
    const sprEnd = document.getElementById('spr-date-end');
    sprStart.min = DATA_MIN_DATE;
    sprEnd.min = DATA_MIN_DATE;
    sprStart.value = startStr < DATA_MIN_DATE ? DATA_MIN_DATE : startStr;
    sprEnd.value = endStr < DATA_MIN_DATE ? DATA_MIN_DATE : endStr;

    if (spReviewData.spList.length > 0) {
      document.getElementById('spr-sp-select').value = spReviewData.spList[0];
      await loadSpReviewData();
    }
  } catch (e) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">加载失败: ' + e.message + '</div>';
    console.error('[sp-review]', e);
  }
}

// ===== 筛选栏 =====
function renderSpReviewFilters(container) {
  const spOptions = spReviewData.spList.map(sp => `<option value="${sp}">${sp}</option>`).join('');
  container.innerHTML = `
    <div id="spr-filter-bar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px;padding:14px 18px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      <label style="font-size:12px;font-weight:600;color:#475569">制券服务商</label>
      <select id="spr-sp-select" onchange="loadSpReviewData()" style="padding:6px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">${spOptions}</select>
      <label style="font-size:12px;font-weight:600;color:#475569;margin-left:12px">日期区间</label>
      <input type="date" id="spr-date-start" onchange="loadSpReviewData()" style="padding:5px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">
      <span style="color:#94a3b8">~</span>
      <input type="date" id="spr-date-end" onchange="loadSpReviewData()" style="padding:5px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">
      <button onclick="exportSpReviewPDF()" style="margin-left:auto;padding:8px 16px;background:#1e40af;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">📄 导出PDF</button>
    </div>
    <div id="spr-content"></div>
  `;
}

// ===== 加载数据并渲染 =====
async function loadSpReviewData() {
  const sp = document.getElementById('spr-sp-select').value;
  const startDate = document.getElementById('spr-date-start').value;
  const endDate = document.getElementById('spr-date-end').value;
  const content = document.getElementById('spr-content');
  if (!sp || !startDate || !endDate || !content) return;

  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载中...</p></div>';

  try {
    // 该制券服务商的品牌
    const spBrands = spReviewData.merchants.filter(m => m.coupon_sp === sp);
    const brandIds = spBrands.map(m => m.brand_id).filter(Boolean);
    const brandNames = spBrands.map(m => m.brand_name).filter(Boolean);

    // 加载品牌日报 (用于明细表业态映射)
    let brandDaily = [];
    for (let i = 0; i < brandIds.length; i += 20) {
      const batch = brandIds.slice(i, i + 20).filter(id => id && id !== '/');
      if (!batch.length) continue;
      const res = await supabaseClient.from('tem_brand_daily')
        .select('brand_id,brand_name,report_date,category_l4')
        .in('brand_id', batch)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .limit(1000);
      if (res.error) { console.warn('[sp-review] brandDaily error:', res.error); continue; }
      if (res.data) brandDaily = brandDaily.concat(res.data);
    }

    // 加载活动数据 — Top3 用视图（跟随全局时间段）
    const viewName = getViewName();
    const allActivities = await fetchAllFromView(viewName, '*');
    const brandIdSet = new Set(brandIds);
    const activitiesForTop3 = allActivities.filter(a => brandIdSet.has(String(a.brand_id)));

    // 品牌明细表用原始日报按筛选日期聚合
    let activitiesForDetail = [];
    for (let i = 0; i < brandIds.length; i += 20) {
      const batch = brandIds.slice(i, i + 20).filter(id => id && id !== '/');
      if (!batch.length) continue;
      const res = await supabaseClient.from('tem_activity_daily')
        .select('brand_id,activity_id,activity_name,batch_name,exposure_pv,claim_pv,redeem_pv')
        .in('brand_id', batch)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .limit(1000);
      if (res.error) { console.warn('[sp-review] detail error:', res.error); continue; }
      if (res.data) activitiesForDetail = activitiesForDetail.concat(res.data);
    }

    // 渲染
    renderSpReview(content, sp, spBrands, brandDaily, activitiesForTop3, activitiesForDetail, allActivities, startDate, endDate);
  } catch (e) {
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">数据加载失败: ' + e.message + '</div>';
    console.error('[sp-review]', e);
  }
}

// ===== 主渲染 =====
function renderSpReview(container, sp, spBrands, brandDaily, activitiesForTop3, activitiesForDetail, allActivities, startDate, endDate) {
  const online = spBrands.filter(b => b.brand_status === '在线');
  const lost = spBrands.filter(b => b.brand_status === '流失');
  const prep = spBrands.filter(b => b.brand_status === '筹备中');

  // 全局时间段标签
  const period = window.currentPeriod || '7d';
  const periodLabel = period === 'today' ? '当日' : period === '7d' ? '近7日' : '近30日';

  let html = '';

  // ===== A. 概览卡片 =====
  html += `<div id="spr-print-area">`;
  html += `<div style="text-align:center;margin-bottom:16px"><h2 style="font-size:18px;font-weight:700;color:#1e293b;margin:0">${sp} · 服务商复盘</h2><p style="font-size:12px;color:#64748b;margin:4px 0 0">${startDate} ~ ${endDate}</p></div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">`;
  html += sprCard('在线品牌', online.length, '#059669', '#f0fdf4');
  html += sprCard('流失品牌', lost.length, '#dc2626', '#fef2f2');
  html += sprCard('筹备品牌', prep.length, '#d97706', '#fffbeb');
  html += `</div>`;

  // ===== B. 服务商品牌 Top3 =====
  html += `<div style="margin-bottom:24px"><h3 style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px">🏆 ${sp} 品牌 · 分业态转化率 Top3</h3>`;
  html += `<p style="font-size:11px;color:#94a3b8;margin:0 0 12px">统计口径：UV曝光核销率（活动累计口径，与时间范围无关）</p>`;
  html += renderTop3Section(activitiesForTop3, true);
  html += `</div>`;

  // ===== C. 品牌明细表 =====
  html += `<div style="margin-bottom:24px"><h3 style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px">📋 品牌状态明细</h3>`;
  html += `<p style="font-size:11px;color:#94a3b8;margin:0 0 12px">统计周期：${startDate} ~ ${endDate}（数量为区间PV求和，转化率为活动累计口径）</p>`;
  html += renderBrandDetailTable(spBrands, brandDaily, activitiesForDetail, activitiesForTop3);
  html += `</div>`;

  // ===== D. 全行业 Top3 =====
  html += `<div style="margin-bottom:24px"><h3 style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px">🌐 全行业标杆 · 分业态转化率 Top3</h3>`;
  html += `<p style="font-size:11px;color:#94a3b8;margin:0 0 12px">统计口径：UV曝光核销率（活动累计口径，与时间范围无关）</p>`;
  html += renderTop3Section(allActivities, false);
  html += `</div>`;

  html += `</div>`; // #spr-print-area end

  container.innerHTML = html;
}

// ===== 卡片组件 =====
function sprCard(label, value, color, bg) {
  return `<div style="background:${bg};border-radius:10px;padding:16px;border-left:4px solid ${color}"><div style="font-size:12px;color:#64748b;font-weight:600">${label}</div><div style="font-size:28px;font-weight:800;color:${color};margin-top:4px">${value}</div></div>`;
}

// ===== Top3 分业态 =====
function renderTop3Section(activities, isSp) {
  const CATS = ['茶饮咖啡', '中式快餐', '西式快餐', '正餐', '小吃', '甜品烘焙'];

  // 和 best-practice.js 完全一致的计算+异常过滤逻辑
  const items = activities.filter(a => (a.exposure_uv || 0) > 0).map(a => {
    // 转化率用生命周期累计 UV（周期无关，避免窗口内领取/核销错配虚高）
    const eUv = a.exposure_uv_cum || 0;
    const cUv = a.claim_uv_cum || 0;
    const rUv = a.redeem_uv_cum || 0;
    const exposure_claim_rate = eUv > 0 ? cUv / eUv : 0;
    const claim_redeem_rate = cUv > 0 ? rUv / cUv : 0;
    const exposure_redeem_rate = eUv > 0 ? rUv / eUv : 0;
    const store_redeem_rate = parseFloat(a.claim_to_store_rate_uv) || 0;
    // 异常判定（同 best-practice RATE_CAPS）
    const is_anomaly = exposure_claim_rate > 0.40 ||
      claim_redeem_rate > 0.80 ||
      exposure_redeem_rate > 0.10 ||
      store_redeem_rate >= 1.00;
    return { ...a, exposure_redeem_rate, is_anomaly };
  }).filter(a => !a.is_anomaly && a.exposure_redeem_rate > 0);

  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">';

  CATS.forEach(cat => {
    // 用 includes 匹配类目（和 getCategoryKey 逻辑一致）
    const catItems = items.filter(a => {
      const catField = a.category_l4 || a.category_name || '';
      return catField.includes(cat);
    });
    const sorted = catItems.sort((a, b) => b.exposure_redeem_rate - a.exposure_redeem_rate);
    const top3 = sorted.slice(0, 3);

    if (top3.length === 0) return;

    const medals = ['🥇', '🥈', '🥉'];
    html += `<div style="background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">`;
    html += `<div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:10px;border-bottom:1px solid #f1f5f9;padding-bottom:8px">${cat}</div>`;
    top3.forEach((t, i) => {
      const rate = (t.exposure_redeem_rate * 100).toFixed(2);
      const batchLine = t.batch_name ? `<div style="font-size:10px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">券: ${t.batch_name}</div>` : '';
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;${i < 2 ? 'border-bottom:1px solid #f8fafc' : ''}">
        <span style="font-size:16px">${medals[i]}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.brand_name}</div>
          <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.activity_name}</div>
          ${batchLine}
        </div>
        <div style="font-size:13px;font-weight:700;color:#2563eb;white-space:nowrap">${rate}%</div>
      </div>`;
    });
    html += `</div>`;
  });

  html += '</div>';
  if (items.length === 0) html = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">暂无数据</div>';
  return html;
}

// ===== 品牌明细表 =====
function renderBrandDetailTable(spBrands, brandDaily, activities, viewRows) {
  // 按品牌聚合活动数据（区间内求和，用于数量列）
  const brandAgg = {};
  activities.forEach(a => {
    const bid = a.brand_id;
    if (!brandAgg[bid]) brandAgg[bid] = { exp: 0, redeem: 0, claim: 0, actIds: new Set() };
    brandAgg[bid].exp += (a.exposure_pv || 0);
    brandAgg[bid].redeem += (a.redeem_pv || 0);
    brandAgg[bid].claim += (a.claim_pv || 0);
    if (a.activity_id) brandAgg[bid].actIds.add(a.activity_id);
  });

  // 转化率口径：用视图行的生命周期累计 PV（周期无关），按品牌汇总
  const cumByBrand = {};
  (viewRows || []).forEach(a => {
    const bid = a.brand_id;
    if (!cumByBrand[bid]) cumByBrand[bid] = { exp: 0, redeem: 0 };
    cumByBrand[bid].exp += (a.exposure_pv_cum || 0);
    cumByBrand[bid].redeem += (a.redeem_pv_cum || 0);
  });

  // 品牌日报里的四级类目名称
  const brandCat = {};
  brandDaily.forEach(r => { if (r.category_l4) brandCat[r.brand_id] = r.category_l4; });

  // 主排序: 状态(在线>筹备>流失); 次排序: 核销倒序
  const statusOrder = { '在线': 0, '筹备中': 1, '流失': 2 };
  const sorted = [...spBrands].sort((a, b) => {
    const sa = statusOrder[a.brand_status] ?? 9;
    const sb = statusOrder[b.brand_status] ?? 9;
    if (sa !== sb) return sa - sb;
    const ra = (brandAgg[a.brand_id] || {}).redeem || 0;
    const rb = (brandAgg[b.brand_id] || {}).redeem || 0;
    return rb - ra;
  });

  let html = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
      <th style="padding:10px 8px;text-align:left;font-weight:600;color:#475569">品牌</th>
      <th style="padding:10px 8px;text-align:center">业态</th>
      <th style="padding:10px 8px;text-align:center">状态</th>
      <th style="padding:10px 8px;text-align:center">活动数</th>
      <th style="padding:10px 8px;text-align:center">曝光PV</th>
      <th style="padding:10px 8px;text-align:center">领取PV</th>
      <th style="padding:10px 8px;text-align:center">核销PV</th>
      <th style="padding:10px 8px;text-align:center">曝光核销率</th>
    </tr></thead><tbody>`;

  sorted.forEach(b => {
    const agg = brandAgg[b.brand_id] || {};
    const cat = brandCat[b.brand_id] || '-';
    const cb = cumByBrand[b.brand_id] || {};
    const rate = cb.exp > 0 ? (cb.redeem / cb.exp * 100).toFixed(2) + '%' : '-';
    const statusColor = b.brand_status === '在线' ? '#059669' : b.brand_status === '流失' ? '#dc2626' : '#d97706';
    html += `<tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:8px;font-weight:600">${b.brand_name || '-'}</td>
      <td style="padding:8px;text-align:center;color:#64748b">${cat}</td>
      <td style="padding:8px;text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${statusColor}15;color:${statusColor}">${b.brand_status}</span></td>
      <td style="padding:8px;text-align:center">${agg.actIds ? agg.actIds.size : 0}</td>
      <td style="padding:8px;text-align:center">${agg.exp ? agg.exp.toLocaleString() : '-'}</td>
      <td style="padding:8px;text-align:center">${agg.claim ? agg.claim.toLocaleString() : '-'}</td>
      <td style="padding:8px;text-align:center">${agg.redeem ? agg.redeem.toLocaleString() : '-'}</td>
      <td style="padding:8px;text-align:center;font-weight:600;color:${cb.exp > 0 ? '#1e293b' : '#94a3b8'}">${rate}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

// ===== PDF 导出 =====
async function exportSpReviewPDF() {
  const el = document.getElementById('spr-print-area');
  if (!el) return alert('无内容可导出');

  const sp = document.getElementById('spr-sp-select').value;
  const startDate = document.getElementById('spr-date-start').value;
  const endDate = document.getElementById('spr-date-end').value;

  // 动态加载 html2pdf.js
  if (!window.html2pdf) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    document.head.appendChild(script);
    await new Promise(resolve => { script.onload = resolve; });
  }

  const opt = {
    margin: [10, 10, 10, 10],
    filename: `${sp}_复盘_${startDate}_${endDate}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };

  html2pdf().set(opt).from(el).save();
}
