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
let alertAllLimit = [];     // 限领配置预警
let alertFilterAssistant = new Set();
let alertFilterSP = new Set();
let alertPinnedBrandIds = new Set();  // 置顶品牌
let alertPinnedOnly = false;          // 是否只看置顶

// 限领预警阈值
const LIMIT_ALERT_THRESHOLDS = {
  single_user: 100,    // 单用户限领 < 100 触发
  daily:       10000,  // 单日限领   < 10000 触发
};

// 判断"是否设了限"：null/0/超大值都视为无限制，不参与告警
function _isLimitConfigured(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = parseFloat(v);
  if (isNaN(n) || n <= 0) return false;
  if (n >= 100000000) return false;  // 1亿以上视为无限
  return true;
}

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
    const [data, merchantResult, spResult, pinnedResult] = await Promise.all([
      fetchAllFromView('v_activity_7d', '*'),
      supabaseClient.from('tem_merchant_contacts')
        .select('brand_id, operating_sp, contact_assistant').limit(5000),
      supabaseClient.from('tem_sp_assignments')
        .select('sp_name, owner').limit(500),
      supabaseClient.from('brand_top_records')
        .select('brand_id').limit(100),
    ]);

    // 构建置顶品牌集合
    alertPinnedBrandIds = new Set();
    for (const p of (pinnedResult.data || [])) {
      if (p.brand_id) alertPinnedBrandIds.add(String(p.brand_id));
    }

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
    alertAllLimit = [];

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

      // 限领配置预警（单用户<100 或 单日<10000，0/null/超大值视为不限不告警）
      const userLimit = act.single_user_limit;
      const dayLimit  = act.daily_limit;
      const userTooLow = _isLimitConfigured(userLimit) && parseFloat(userLimit) < LIMIT_ALERT_THRESHOLDS.single_user;
      const dayTooLow  = _isLimitConfigured(dayLimit)  && parseFloat(dayLimit)  < LIMIT_ALERT_THRESHOLDS.daily;
      if (userTooLow || dayTooLow) {
        const reasons = [];
        if (userTooLow) reasons.push('单用户');
        if (dayTooLow)  reasons.push('单日');
        alertAllLimit.push({
          ...enriched,
          single_user_limit: userLimit,
          daily_limit: dayLimit,
          user_too_low: userTooLow,
          day_too_low: dayTooLow,
          reason: reasons.join(' · ') + '偏低',
        });
      }

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
    // 限领预警按"两种都偏低"在前、单用户限领升序为辅排
    alertAllLimit.sort((a, b) => {
      const sevA = (a.user_too_low ? 1 : 0) + (a.day_too_low ? 1 : 0);
      const sevB = (b.user_too_low ? 1 : 0) + (b.day_too_low ? 1 : 0);
      if (sevB !== sevA) return sevB - sevA;
      const ua = parseFloat(a.single_user_limit) || Infinity;
      const ub = parseFloat(b.single_user_limit) || Infinity;
      return ua - ub;
    });

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
    if (alertPinnedOnly && !alertPinnedBrandIds.has(String(a.brand_id))) return false;
    return true;
  });
}

function renderAlerts() {
  const container = document.getElementById('alert-container');
  const expiryAlerts = filterAlertItems(alertAllExpiry);
  const stockAlerts = filterAlertItems(alertAllStock);
  const limitAlerts = filterAlertItems(alertAllLimit);

  const redExpiry = expiryAlerts.filter(a => a.level === 'red').length;
  const yellowExpiry = expiryAlerts.filter(a => a.level === 'yellow').length;
  const redStock = stockAlerts.filter(a => a.level === 'red').length;
  const yellowStock = stockAlerts.filter(a => a.level === 'yellow').length;
  const limitCount = limitAlerts.length;

  // 收集筛选选项
  const allItems = [...alertAllExpiry, ...alertAllStock, ...alertAllLimit];
  const assistants = [...new Set(allItems.map(a => a.contact_assistant).filter(v => v && v !== '-'))].sort();
  const sps = [...new Set(allItems.map(a => a.operating_sp).filter(v => v && v !== '-'))].sort();

  let html = `<div class="alert-page" style="padding:16px 32px">
    <!-- 筛选栏 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div class="multi-select-wrap" id="alert-ms-assistant"></div>
      <div class="multi-select-wrap" id="alert-ms-sp"></div>
      <label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#475569;cursor:pointer">
        <input type="checkbox" id="alert-pinned-only" onchange="onAlertPinnedChange()" ${alertPinnedOnly ? 'checked' : ''}> 只看置顶品牌
      </label>
      <span style="margin-left:auto;font-size:12px;color:#94A3B8">
        🔴 ≤3天 &nbsp; 🟡 4-7天 &nbsp; 🟠 限领配置 &nbsp; 共${alertsData.length}个活动
      </span>
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
      <div class="alert-summary-card" style="border-left:4px solid #EA580C">
        <h3>🟠 限领配置偏低</h3>
        <div class="alert-count ${limitCount > 0 ? 'yellow' : 'green'}">${limitCount}</div>
        <div style="font-size:12px;color:#94A3B8">单用户&lt;100 或 单日&lt;10000</div>
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

    <!-- 限领配置预警（独占一栏，全宽） -->
    <div class="alert-col" style="margin-top:16px">
      <div class="alert-col-header">🚦 限领配置预警 · 单用户限领&lt;100 或 单日限领&lt;10000 (${limitAlerts.length})</div>
      <div class="alert-col-body">
        ${limitAlerts.length === 0 ? '<div class="alert-empty">暂无限领配置预警 🎉</div>' : ''}
        ${limitAlerts.map(a => `
          <div class="alert-item level-yellow" style="border-left-color:#EA580C">
            <div class="alert-badge yellow" style="background:#FFF7ED;color:#C2410C;border-color:#FED7AA">
              ${a.user_too_low && a.day_too_low ? '双低' : (a.user_too_low ? '单用户' : '单日')}
            </div>
            <div class="alert-info">
              <div class="alert-brand">${a.brand_name || '-'}</div>
              <div class="alert-act" title="${a.activity_name}">${a.activity_name || '-'}</div>
            </div>
            <div class="alert-detail">
              ${a.contact_assistant !== '-' ? '<span style="color:#2563EB">' + a.contact_assistant + '</span> · ' : ''}${a.operating_sp !== '-' ? a.operating_sp + '<br>' : ''}
              单用户 <strong style="color:${a.user_too_low ? '#DC2626' : '#475569'}">${fmtLimitVal(a.single_user_limit)}</strong>
              · 单日 <strong style="color:${a.day_too_low ? '#DC2626' : '#475569'}">${fmtLimitVal(a.daily_limit)}</strong>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </div>`;

  container.innerHTML = html;

  // 构建多选筛选器
  buildAlertMultiSelect('alert-ms-assistant', '对接助理', assistants, alertFilterAssistant);
  buildAlertMultiSelect('alert-ms-sp', '服务商', sps, alertFilterSP);
}

// 限领值的展示格式（为 0/未配置 显示"不限"）
function fmtLimitVal(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = parseFloat(v);
  if (isNaN(n)) return '-';
  if (n === 0 || n >= 100000000) return '不限';
  return n.toLocaleString('zh-CN');
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

function onAlertPinnedChange() {
  alertPinnedOnly = document.getElementById('alert-pinned-only')?.checked || false;
  renderAlerts();
}
