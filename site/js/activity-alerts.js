/**
 * activity-alerts.js - 活动预警模块（Tab4）
 * 到期预警：活动结束日期 ≤7天
 * 库存预警：按日均消耗预测剩余天数 ≤7天
 * 支持按服务商、对接助理多选筛选
 */

let alertsData = [];
let alertMerchantMap = {};  // brand_id → { contact_assistant, operating_sp }
let alertSpOwnerMap = {};   // sp_name → owner
let alertAllExpiry = [];
let alertAllStock = [];
let alertFilterAssistant = new Set();
let alertFilterSP = new Set();

function parseEndDate(dateStr) {
  if (!dateStr || dateStr === '-') return null;
  const s = String(dateStr).trim();
  if (s.length === 8) {
    const y = parseInt(s.slice(0, 4));
    const m = parseInt(s.slice(4, 6)) - 1;
    const d = parseInt(s.slice(6, 8));
    return new Date(y, m, d);
  }
  return null;
}

function daysUntil(dateStr) {
  const d = parseEndDate(dateStr);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d - today) / 86400000);
}

function alertLevel(days) {
  if (days === null || days < 0) return null;  // 已过期不预警
  if (days <= 3) return 'red';
  if (days <= 7) return 'yellow';
  return null;
}

async function loadActivityAlerts() {
  const container = document.getElementById('alert-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载预警数据...</p></div>';

  try {
    const [data, merchantResult, spResult] = await Promise.all([
      fetchAllFromView('v_activity_7d', '*'),
      supabaseClient.from('tem_merchant_contacts')
        .select('brand_id, operating_sp, contact_assistant').limit(5000),
      supabaseClient.from('tem_sp_assignments')
        .select('sp_name, owner').limit(500),
    ]);

    // 构建关联 map
    alertMerchantMap = {};
    for (const m of (merchantResult.data || [])) {
      if (m.brand_id) {
        alertMerchantMap[String(m.brand_id)] = {
          contact_assistant: m.contact_assistant || '',
          operating_sp: m.operating_sp || '',
        };
      }
    }
    alertSpOwnerMap = {};
    for (const s of (spResult.data || [])) {
      if (s.sp_name) alertSpOwnerMap[s.sp_name] = s.owner || '';
    }

    alertsData = data;
    alertAllExpiry = [];
    alertAllStock = [];

    for (const act of data) {
      const bid = String(act.brand_id);
      const merchant = alertMerchantMap[bid] || {};
      const enriched = {
        ...act,
        contact_assistant: merchant.contact_assistant || '-',
        operating_sp: merchant.operating_sp || '-',
      };

      const daysLeft = daysUntil(act.end_date);
      const level = alertLevel(daysLeft);

      if (level) {
        alertAllExpiry.push({ ...enriched, days_left: daysLeft, level: level });
      }

      const totalStock = act.total_stock || 0;
      const remainStock = act.remain_stock || 0;
      const dayCount = act.day_count || 1;

      if (totalStock >= 100000000 || totalStock <= 0) continue;

      const consumed = totalStock - remainStock;
      const dailyConsumption = consumed / dayCount;

      if (dailyConsumption > 0) {
        const daysToDeplete = Math.ceil(remainStock / dailyConsumption);
        const stockLevel = alertLevel(daysToDeplete);
        if (stockLevel) {
          alertAllStock.push({
            ...enriched,
            days_to_deplete: daysToDeplete,
            daily_consumption: Math.round(dailyConsumption),
            remain_pct: totalStock > 0 ? (remainStock / totalStock * 100).toFixed(1) : 0,
            level: stockLevel,
          });
        }
      }
    }

    alertAllExpiry.sort((a, b) => a.days_left - b.days_left);
    alertAllStock.sort((a, b) => a.days_to_deplete - b.days_to_deplete);

    // Reset filters
    alertFilterAssistant = new Set();
    alertFilterSP = new Set();

    renderAlerts();
  } catch (err) {
    container.innerHTML = `<div style="padding:32px;color:#DC2626">加载失败: ${err.message}</div>`;
    console.error(err);
  }
}

function filterAlertItems(items) {
  return items.filter(a => {
    if (alertFilterAssistant.size > 0 && !alertFilterAssistant.has(a.contact_assistant)) return false;
    if (alertFilterSP.size > 0 && !alertFilterSP.has(a.operating_sp)) return false;
    return true;
  });
}

function renderAlerts() {
  const container = document.getElementById('alert-container');
  const expiryAlerts = filterAlertItems(alertAllExpiry);
  const stockAlerts = filterAlertItems(alertAllStock);

  const redExpiry = expiryAlerts.filter(a => a.level === 'red').length;
  const yellowExpiry = expiryAlerts.filter(a => a.level === 'yellow').length;
  const redStock = stockAlerts.filter(a => a.level === 'red').length;
  const yellowStock = stockAlerts.filter(a => a.level === 'yellow').length;

  // 收集筛选选项
  const allItems = [...alertAllExpiry, ...alertAllStock];
  const assistants = [...new Set(allItems.map(a => a.contact_assistant).filter(v => v && v !== '-'))].sort();
  const sps = [...new Set(allItems.map(a => a.operating_sp).filter(v => v && v !== '-'))].sort();

  let html = `<div class="alert-page" style="padding:16px 32px">
    <!-- 筛选栏 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div class="multi-select-wrap" id="alert-ms-assistant"></div>
      <div class="multi-select-wrap" id="alert-ms-sp"></div>
      <span style="margin-left:auto;font-size:12px;color:#94A3B8">🔴 ≤3天 &nbsp; 🟡 4-7天 &nbsp; 共${alertsData.length}个活动</span>
    </div>

    <!-- 汇总卡片 -->
    <div class="alert-summary">
      <div class="alert-summary-card" style="border-left:4px solid #DC2626">
        <h3>🔴 紧急（≤3天）</h3>
        <div class="alert-count ${(redExpiry + redStock) > 0 ? 'red' : 'green'}">${redExpiry + redStock}</div>
        <div style="font-size:12px;color:#94A3B8">${redExpiry}个到期 + ${redStock}个库存</div>
      </div>
      <div class="alert-summary-card" style="border-left:4px solid #D97706">
        <h3>🟡 关注（4-7天）</h3>
        <div class="alert-count ${(yellowExpiry + yellowStock) > 0 ? 'yellow' : 'green'}">${yellowExpiry + yellowStock}</div>
        <div style="font-size:12px;color:#94A3B8">${yellowExpiry}个到期 + ${yellowStock}个库存</div>
      </div>
    </div>

    <!-- 两栏详情 -->
    <div class="alert-two-col">
      <div class="alert-col">
        <div class="alert-col-header">⏰ 活动到期预警 · 结束日期距今 ≤7天 (${expiryAlerts.length})</div>
        <div class="alert-col-body">
          ${expiryAlerts.length === 0 ? '<div class="alert-empty">暂无到期预警 🎉</div>' : ''}
          ${expiryAlerts.map(a => `
            <div class="alert-item level-${a.level}">
              <div class="alert-badge ${a.level}">${a.days_left}天</div>
              <div class="alert-info">
                <div class="alert-brand">${a.brand_name || '-'}</div>
                <div class="alert-act" title="${a.activity_name}">${a.activity_name || '-'}</div>
              </div>
              <div class="alert-detail">
                ${a.contact_assistant !== '-' ? '<span style="color:#2563EB">' + a.contact_assistant + '</span> · ' : ''}${a.operating_sp !== '-' ? a.operating_sp + '<br>' : ''}
                截止 ${formatEndDate(a.end_date)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="alert-col">
        <div class="alert-col-header">📦 库存耗尽预警 · 按日均消耗预计 ≤7天耗尽 (${stockAlerts.length})</div>
        <div class="alert-col-body">
          ${stockAlerts.length === 0 ? '<div class="alert-empty">暂无库存预警 🎉</div>' : ''}
          ${stockAlerts.map(a => `
            <div class="alert-item level-${a.level}">
              <div class="alert-badge ${a.level}">${a.days_to_deplete}天</div>
              <div class="alert-info">
                <div class="alert-brand">${a.brand_name || '-'}</div>
                <div class="alert-act" title="${a.activity_name}">${a.activity_name || '-'}</div>
              </div>
              <div class="alert-detail">
                ${a.contact_assistant !== '-' ? '<span style="color:#2563EB">' + a.contact_assistant + '</span> · ' : ''}${a.operating_sp !== '-' ? a.operating_sp + '<br>' : ''}
                剩余 ${a.remain_pct}% · 日均 ${fmtAlertNum(a.daily_consumption)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>`;

  container.innerHTML = html;

  // 构建多选筛选器
  buildAlertMultiSelect('alert-ms-assistant', '对接助理', assistants, alertFilterAssistant);
  buildAlertMultiSelect('alert-ms-sp', '服务商', sps, alertFilterSP);
}

function buildAlertMultiSelect(containerId, label, options, stateSet) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="multi-select-btn" onclick="toggleAlertDropdown('${containerId}')">
      <span>${label} <span class="multi-count-${containerId}"></span></span>
      <span class="arrow">▾</span>
    </div>
    <div class="multi-select-dropdown" id="dd-${containerId}">
      ${options.map(opt =>
        `<label class="multi-select-option">
          <input type="checkbox" value="${opt}" onchange="onAlertFilterChange('${containerId}', this)" ${stateSet.has(opt) ? 'checked' : ''}>
          ${opt}
        </label>`
      ).join('')}
    </div>`;
  updateAlertMultiCount(containerId, stateSet);
}

function toggleAlertDropdown(containerId) {
  const dd = document.getElementById('dd-' + containerId);
  dd?.classList.toggle('show');
  // 关闭其他
  document.querySelectorAll('#alert-container .multi-select-dropdown').forEach(el => {
    if (el.id !== 'dd-' + containerId) el.classList.remove('show');
  });
}

function onAlertFilterChange(containerId, checkbox) {
  let stateSet = containerId === 'alert-ms-assistant' ? alertFilterAssistant : alertFilterSP;
  if (checkbox.checked) stateSet.add(checkbox.value);
  else stateSet.delete(checkbox.value);
  updateAlertMultiCount(containerId, stateSet);
  renderAlerts();
}

function updateAlertMultiCount(containerId, stateSet) {
  const countEl = document.querySelector(`.multi-count-${containerId}`);
  if (countEl) {
    countEl.innerHTML = stateSet.size > 0 ? `<span class="multi-select-count">${stateSet.size}</span>` : '';
  }
}

function formatEndDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const s = String(dateStr).trim();
  if (s.length === 8) {
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  return s;
}

function fmtAlertNum(n) {
  if (n === null || n === undefined) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
