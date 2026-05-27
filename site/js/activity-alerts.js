/**
 * activity-alerts.js - 活动预警模块（Tab3）
 * 到期预警：活动结束日期距今 ≤7天（支持 by 3天/7天 筛选）
 * 限领配置预警：单用户<100 或 单日<10000（支持阈值筛选）
 * 支持按服务商、对接助理多选筛选 + 置顶品牌筛选
 */

let alertsData = [];
let alertMerchantMap = {};
let alertSpOwnerMap = {};
let alertAllExpiry = [];
let alertAllLimit = [];
let alertFilterAssistant = new Set();
let alertFilterSP = new Set();
let alertPinnedBrandIds = new Set();
let alertPinnedOnly = false;

// ── 到期预警筛选状态 ──
let expiryDaysFilter = 7;  // 默认 <=7天；可选 3 / 7

// ── 限领预警筛选状态 ──
let limitUserFilter = 100;    // 单人限领阈值；可选 5/10/100
let limitDailyFilter = 10000; // 单日限领阈值；可选 1000/3000/5000/10000

// 限领预警阈值（用于数据收集，取最大范围）
const LIMIT_COLLECT_THRESHOLDS = {
  single_user: 100,
  daily:       10000,
};

function _isLimitConfigured(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = parseFloat(v);
  if (isNaN(n) || n <= 0) return false;
  if (n >= 100000000) return false;
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

    alertPinnedBrandIds = new Set();
    for (const p of (pinnedResult.data || [])) {
      if (p.brand_id) alertPinnedBrandIds.add(String(p.brand_id));
    }

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
    alertAllLimit = [];

    for (const act of data) {
      const bid = String(act.brand_id);
      const merchant = alertMerchantMap[bid] || {};

      // 过滤已结束活动：end_date < latest_date（日报周期）说明活动已结束，不展示
      if (act.end_date && act.latest_date) {
        const endNorm = String(act.end_date).replace(/[-/]/g, '').trim();  // "20260516"
        const latestNorm = String(act.latest_date).replace(/[-/]/g, '').trim(); // "20260526"
        if (endNorm.length === 8 && latestNorm.length === 8 && endNorm < latestNorm) {
          continue; // 活动已结束，跳过
        }
      }

      const enriched = {
        ...act,
        contact_assistant: merchant.contact_assistant || '-',
        operating_sp: merchant.operating_sp || '-',
      };

      // 到期预警：收集 <=7 天的全部（筛选在渲染时做）
      const daysLeft = daysUntil(act.end_date);
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7) {
        alertAllExpiry.push({ ...enriched, days_left: daysLeft });
      }

      // 限领预警：收集所有 <100（单人）或 <10000（单日）的
      const userLimit = act.single_user_limit;
      const dayLimit  = act.daily_limit;
      const userConfigured = _isLimitConfigured(userLimit);
      const dayConfigured  = _isLimitConfigured(dayLimit);
      const userTooLow = userConfigured && parseFloat(userLimit) < LIMIT_COLLECT_THRESHOLDS.single_user;
      const dayTooLow  = dayConfigured  && parseFloat(dayLimit)  < LIMIT_COLLECT_THRESHOLDS.daily;
      if (userTooLow || dayTooLow) {
        alertAllLimit.push({
          ...enriched,
          single_user_limit: userLimit,
          daily_limit: dayLimit,
          user_val: userConfigured ? parseFloat(userLimit) : Infinity,
          day_val: dayConfigured ? parseFloat(dayLimit) : Infinity,
        });
      }
    }

    alertAllExpiry.sort((a, b) => a.days_left - b.days_left);
    alertAllLimit.sort((a, b) => {
      const ua = a.user_val !== undefined ? a.user_val : Infinity;
      const ub = b.user_val !== undefined ? b.user_val : Infinity;
      return ua - ub;
    });

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

function getFilteredExpiry() {
  return filterAlertItems(alertAllExpiry).filter(a => a.days_left <= expiryDaysFilter);
}

function getFilteredLimit() {
  return filterAlertItems(alertAllLimit).filter(a => {
    // 每个已配置的维度都必须满足当前阈值（AND 叠加）
    const userRelevant = a.user_val < Infinity;  // 该维度有配置
    const dayRelevant  = a.day_val < Infinity;

    // 如果该维度有配置但不满足当前筛选阈值 → 排除
    if (userRelevant && a.user_val >= limitUserFilter) return false;
    if (dayRelevant && a.day_val >= limitDailyFilter) return false;

    return true;
  });
}

function renderAlerts() {
  const container = document.getElementById('alert-container');
  const expiryAlerts = getFilteredExpiry();
  const limitAlerts = getFilteredLimit();

  const expiryCount = expiryAlerts.length;
  const limitCount = limitAlerts.length;

  // 收集筛选选项
  const allItems = [...alertAllExpiry, ...alertAllLimit];
  const assistants = [...new Set(allItems.map(a => a.contact_assistant).filter(v => v && v !== '-'))].sort();
  const sps = [...new Set(allItems.map(a => a.operating_sp).filter(v => v && v !== '-'))].sort();

  let html = `<div class="alert-page" style="padding:16px 32px">
    <!-- 全局筛选栏 -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div class="multi-select-wrap" id="alert-ms-assistant"></div>
      <div class="multi-select-wrap" id="alert-ms-sp"></div>
      <label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#475569;cursor:pointer">
        <input type="checkbox" id="alert-pinned-only" onchange="onAlertPinnedChange()" ${alertPinnedOnly ? 'checked' : ''}> 只看置顶品牌
      </label>
      <span style="margin-left:auto;font-size:12px;color:#94A3B8">共${alertsData.length}个活动</span>
    </div>

    <!-- 汇总卡片 -->
    <div class="alert-summary">
      <div class="alert-summary-card" style="border-left:4px solid #D97706">
        <h3>⏰ 即将到期</h3>
        <div class="alert-count ${expiryCount > 0 ? 'yellow' : 'green'}">${expiryCount}</div>
        <div style="font-size:12px;color:#94A3B8">≤${expiryDaysFilter}天</div>
      </div>
      <div class="alert-summary-card" style="border-left:4px solid #EA580C">
        <h3>🚦 限领配置偏低</h3>
        <div class="alert-count ${limitCount > 0 ? 'yellow' : 'green'}">${limitCount}</div>
        <div style="font-size:12px;color:#94A3B8">单人&lt;${limitUserFilter} 或 单日&lt;${limitDailyFilter}</div>
      </div>
    </div>

    <!-- 到期预警 -->
    <div class="alert-col" style="margin-top:16px">
      <div class="alert-col-header" style="display:flex;align-items:center;justify-content:space-between">
        <span>⏰ 活动到期预警 (${expiryAlerts.length})</span>
        <div class="alert-filter-pills">
          <span style="font-size:12px;color:#64748B;margin-right:6px">到期天数≤</span>
          <button class="pill-btn ${expiryDaysFilter === 3 ? 'active' : ''}" onclick="setExpiryFilter(3)">3天</button>
          <button class="pill-btn ${expiryDaysFilter === 7 ? 'active' : ''}" onclick="setExpiryFilter(7)">7天</button>
        </div>
      </div>
      <div class="alert-col-body">
        ${expiryAlerts.length === 0 ? '<div class="alert-empty">暂无到期预警 🎉</div>' : ''}
        ${expiryAlerts.map(a => `
          <div class="alert-item level-yellow">
            <div class="alert-badge yellow">${a.days_left}天</div>
            <div class="alert-info">
              <div class="alert-brand">${a.brand_name || '-'} <span style="font-size:11px;color:#94A3B8;font-weight:400">${a.brand_id || ''}</span></div>
              <div class="alert-act" title="${a.activity_name}">${a.activity_name || '-'} <span style="font-size:11px;color:#94A3B8">${a.activity_id || ''}</span></div>
            </div>
            <div class="alert-detail">
              ${a.contact_assistant !== '-' ? '<span style="color:#2563EB">' + a.contact_assistant + '</span> · ' : ''}${a.operating_sp !== '-' ? a.operating_sp + '<br>' : ''}
              截止 ${formatEndDate(a.end_date)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 限领配置预警 -->
    <div class="alert-col" style="margin-top:16px">
      <div class="alert-col-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span>🚦 限领配置预警 (${limitAlerts.length})</span>
        <div class="alert-filter-pills" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:12px;color:#64748B">单人&lt;</span>
            <button class="pill-btn ${limitUserFilter === 5 ? 'active' : ''}" onclick="setLimitUserFilter(5)">5</button>
            <button class="pill-btn ${limitUserFilter === 10 ? 'active' : ''}" onclick="setLimitUserFilter(10)">10</button>
            <button class="pill-btn ${limitUserFilter === 100 ? 'active' : ''}" onclick="setLimitUserFilter(100)">100</button>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:12px;color:#64748B">单日&lt;</span>
            <button class="pill-btn ${limitDailyFilter === 1000 ? 'active' : ''}" onclick="setLimitDailyFilter(1000)">1千</button>
            <button class="pill-btn ${limitDailyFilter === 3000 ? 'active' : ''}" onclick="setLimitDailyFilter(3000)">3千</button>
            <button class="pill-btn ${limitDailyFilter === 5000 ? 'active' : ''}" onclick="setLimitDailyFilter(5000)">5千</button>
            <button class="pill-btn ${limitDailyFilter === 10000 ? 'active' : ''}" onclick="setLimitDailyFilter(10000)">1万</button>
          </div>
        </div>
      </div>
      <div class="alert-col-body">
        ${limitAlerts.length === 0 ? '<div class="alert-empty">暂无限领配置预警 🎉</div>' : ''}
        ${limitAlerts.map(a => {
          const userTooLow = a.user_val < limitUserFilter;
          const dayTooLow = a.day_val < limitDailyFilter;
          return `
          <div class="alert-item level-yellow" style="border-left-color:#EA580C">
            <div class="alert-badge yellow" style="background:#FFF7ED;color:#C2410C;border-color:#FED7AA">
              ${userTooLow && dayTooLow ? '双低' : (userTooLow ? '单人' : '单日')}
            </div>
            <div class="alert-info">
              <div class="alert-brand">${a.brand_name || '-'} <span style="font-size:11px;color:#94A3B8;font-weight:400">${a.brand_id || ''}</span></div>
              <div class="alert-act" title="${a.activity_name}">${a.activity_name || '-'} <span style="font-size:11px;color:#94A3B8">${a.activity_id || ''}</span></div>
            </div>
            <div class="alert-detail">
              ${a.contact_assistant !== '-' ? '<span style="color:#2563EB">' + a.contact_assistant + '</span> · ' : ''}${a.operating_sp !== '-' ? a.operating_sp + '<br>' : ''}
              单人 <strong style="color:${userTooLow ? '#DC2626' : '#475569'}">${fmtLimitVal(a.single_user_limit)}</strong>
              · 单日 <strong style="color:${dayTooLow ? '#DC2626' : '#475569'}">${fmtLimitVal(a.daily_limit)}</strong>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;

  container.innerHTML = html;

  buildAlertMultiSelect('alert-ms-assistant', '对接助理', assistants, alertFilterAssistant);
  buildAlertMultiSelect('alert-ms-sp', '服务商', sps, alertFilterSP);
}

// ── 筛选器事件 ──

function setExpiryFilter(days) {
  expiryDaysFilter = days;
  renderAlerts();
}

function setLimitUserFilter(val) {
  limitUserFilter = val;
  renderAlerts();
}

function setLimitDailyFilter(val) {
  limitDailyFilter = val;
  renderAlerts();
}

// ── 工具函数 ──

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
