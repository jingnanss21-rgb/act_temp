/**
 * activity-alerts.js - 活动预警模块（Tab4）
 * 到期预警：活动结束日期 ≤7天
 * 库存预警：按日均消耗预测剩余天数 ≤7天
 */

let alertsData = [];

function parseEndDate(dateStr) {
  // 格式 "20260429" → Date
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
  if (days === null) return null;
  if (days <= 3) return 'red';
  if (days <= 7) return 'yellow';
  return null;
}

async function loadActivityAlerts() {
  const container = document.getElementById('alert-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载预警数据...</p></div>';

  try {
    // 从7d视图取数据（需要 day_count 计算日均消耗）
    const data = await fetchAllFromView('v_activity_7d', '*');
    alertsData = data;

    const expiryAlerts = [];
    const stockAlerts = [];

    for (const act of data) {
      const daysLeft = daysUntil(act.end_date);
      const level = alertLevel(daysLeft);

      // 到期预警
      if (level) {
        expiryAlerts.push({
          ...act,
          days_left: daysLeft,
          level: level,
        });
      }

      // 库存预警（排除无限库存）
      const totalStock = act.total_stock || 0;
      const remainStock = act.remain_stock || 0;
      const dayCount = act.day_count || 1;

      if (totalStock >= 100000000) continue; // 无限库存
      if (totalStock <= 0) continue; // 无库存信息

      const consumed = totalStock - remainStock;
      const dailyConsumption = consumed / dayCount;

      if (dailyConsumption > 0) {
        const daysToDeplete = Math.ceil(remainStock / dailyConsumption);
        const stockLevel = alertLevel(daysToDeplete);
        if (stockLevel) {
          stockAlerts.push({
            ...act,
            days_to_deplete: daysToDeplete,
            daily_consumption: Math.round(dailyConsumption),
            remain_pct: totalStock > 0 ? (remainStock / totalStock * 100).toFixed(1) : 0,
            level: stockLevel,
          });
        }
      }
    }

    // 排序：红色优先，然后按天数升序
    expiryAlerts.sort((a, b) => a.days_left - b.days_left);
    stockAlerts.sort((a, b) => a.days_to_deplete - b.days_to_deplete);

    const redExpiry = expiryAlerts.filter(a => a.level === 'red').length;
    const yellowExpiry = expiryAlerts.filter(a => a.level === 'yellow').length;
    const redStock = stockAlerts.filter(a => a.level === 'red').length;
    const yellowStock = stockAlerts.filter(a => a.level === 'yellow').length;

    let html = `<div class="alert-page">
      <h2 class="section-title">⚠️ 活动预警</h2>
      <p style="margin:4px 0 16px;font-size:13px;color:var(--text-muted)">
        监控活动到期和库存耗尽风险，红色 ≤3天，黄色 4-7天
      </p>

      <!-- 汇总卡片 -->
      <div class="alert-summary">
        <div class="alert-summary-card" style="border-left:4px solid #DC2626">
          <h3>🔴 紧急预警</h3>
          <div class="alert-count ${(redExpiry + redStock) > 0 ? 'red' : 'green'}">${redExpiry + redStock}</div>
          <div style="font-size:12px;color:#94A3B8">${redExpiry}个到期 + ${redStock}个库存</div>
        </div>
        <div class="alert-summary-card" style="border-left:4px solid #D97706">
          <h3>🟡 关注预警</h3>
          <div class="alert-count ${(yellowExpiry + yellowStock) > 0 ? 'yellow' : 'green'}">${yellowExpiry + yellowStock}</div>
          <div style="font-size:12px;color:#94A3B8">${yellowExpiry}个到期 + ${yellowStock}个库存</div>
        </div>
        <div class="alert-summary-card" style="border-left:4px solid #16A34A">
          <h3>📊 监控总量</h3>
          <div class="alert-count green">${data.length}</div>
          <div style="font-size:12px;color:#94A3B8">活动总数</div>
        </div>
      </div>

      <!-- 两栏详情 -->
      <div class="alert-two-col">
        <div class="alert-col">
          <div class="alert-col-header">⏰ 到期预警 (${expiryAlerts.length})</div>
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
                  ${a.category_name || '-'}<br>
                  截止 ${formatEndDate(a.end_date)}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="alert-col">
          <div class="alert-col-header">📦 库存预警 (${stockAlerts.length})</div>
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
                  剩余 ${a.remain_pct}%<br>
                  日均消耗 ${fmtAlertNum(a.daily_consumption)}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>`;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="padding:32px;color:#DC2626">加载失败: ${err.message}</div>`;
    console.error(err);
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
