// ============================================================
// 品牌诊断模块 - brand-diagnosis.js
// A区：品牌概览 + 健康评分环形图
// B区：四维雷达图 + 指标对比表（可点击联动C区）
// C区：行业标杆参考（位置刻度尺 + Top3 列表 + 标杆洞察）
// D区：活动明细（可折叠，4指标进度条 + 迷你漏斗）
// ============================================================

const DIAG_METRICS = [
  { key: 'exposure_claim', label: '曝光领取率', short: '曝光领取' },
  { key: 'claim_redeem', label: '领取核销率', short: '领取核销' },
  { key: 'exposure_redeem', label: '曝光核销率', short: '曝光核销' },
  { key: 'store_redeem', label: '到店核销率', short: '到店核销' },
];

const DIAG_COLORS = {
  brand: '#1677FF',
  good: '#52C41A',
  warn: '#FAAD14',
  bad: '#FF4D4F',
  muted: '#8C8C8C',
  best: '#D4A017',
};

let diagSelectedMetric = 0; // 默认选中第一个指标
let diagBrandData = null;

// 健康评分计算：4维度各25分，基准线为同类目Top3均值
function calcHealthScore(brandRates, top3Avgs) {
  let total = 0;
  const details = [];
  for (let i = 0; i < DIAG_METRICS.length; i++) {
    const mk = DIAG_METRICS[i];
    const bv = brandRates[mk.key] || 0;
    const t3 = top3Avgs[mk.key] || 1;
    const score = Math.min(bv / t3, 1.0) * 25;
    total += score;
    details.push({ key: mk.key, label: mk.label, brandVal: bv, top3Avg: t3, score });
  }
  return { total: Math.round(total), details };
}

// 环形图 SVG
function healthRingSvg(score, size = 120) {
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = score / 100;
  const offset = circumference * (1 - pct);
  let color = DIAG_COLORS.good;
  let label = '优秀';
  if (score < 60) { color = DIAG_COLORS.bad; label = '需关注'; }
  else if (score < 80) { color = DIAG_COLORS.warn; label = '待优化'; }

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#F0F0F0" stroke-width="10"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"
      style="transition: stroke-dashoffset 0.8s ease"/>
    <text x="${size/2}" y="${size/2 - 6}" text-anchor="middle" font-size="28" font-weight="800" fill="${color}">${score}</text>
    <text x="${size/2}" y="${size/2 + 14}" text-anchor="middle" font-size="11" fill="${DIAG_COLORS.muted}">/ 100</text>
    <text x="${size/2}" y="${size/2 + 30}" text-anchor="middle" font-size="12" font-weight="600" fill="${color}">${label}</text>
  </svg>`;
}

// 雷达图 SVG（Canvas 版 - 用 SVG polygon）
function radarChartSvg(brandVals, medianVals, bestVals, size = 220) {
  const cx = size / 2, cy = size / 2, maxR = size / 2 - 30;
  const labels = DIAG_METRICS.map(m => m.short);
  const n = labels.length;
  const angles = labels.map((_, i) => (Math.PI * 2 * i / n) - Math.PI / 2);

  function toPoint(angle, val, maxVal) {
    const r = maxR * Math.min(val / maxVal, 1);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  // 找最大值作为坐标系
  const allVals = [...Object.values(brandVals), ...Object.values(medianVals), ...Object.values(bestVals)].filter(v => !isNaN(v));
  const maxVal = Math.max(...allVals, 0.01);

  // 网格线
  let gridLines = '';
  for (let level = 1; level <= 4; level++) {
    const pts = angles.map(a => toPoint(a, maxVal * level / 4, maxVal).join(',')).join(' ');
    gridLines += `<polygon points="${pts}" fill="none" stroke="#E5E7EB" stroke-width="0.5"/>`;
  }

  // 轴线
  let axisLines = '';
  angles.forEach(a => {
    const [ex, ey] = toPoint(a, maxVal, maxVal);
    axisLines += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#E5E7EB" stroke-width="0.5"/>`;
  });

  // 标签
  let labelTexts = '';
  angles.forEach((a, i) => {
    const [lx, ly] = toPoint(a, maxVal * 1.22, maxVal);
    labelTexts += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#333">${labels[i]}</text>`;
  });

  // 数据区域
  function polyPoints(vals) {
    const keys = DIAG_METRICS.map(m => m.key);
    return angles.map((a, i) => toPoint(a, vals[keys[i]] || 0, maxVal).join(',')).join(' ');
  }

  const bestPoly = `<polygon points="${polyPoints(bestVals)}" fill="none" stroke="${DIAG_COLORS.best}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`;
  const medPoly = `<polygon points="${polyPoints(medianVals)}" fill="none" stroke="${DIAG_COLORS.muted}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`;
  const brandPoly = `<polygon points="${polyPoints(brandVals)}" fill="${DIAG_COLORS.brand}" fill-opacity="0.15" stroke="${DIAG_COLORS.brand}" stroke-width="2"/>`;

  // 品牌数据点
  let dots = '';
  const keys = DIAG_METRICS.map(m => m.key);
  angles.forEach((a, i) => {
    const [px, py] = toPoint(a, brandVals[keys[i]] || 0, maxVal);
    dots += `<circle cx="${px}" cy="${py}" r="3.5" fill="${DIAG_COLORS.brand}" stroke="#fff" stroke-width="1.5"/>`;
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${gridLines}${axisLines}${bestPoly}${medPoly}${brandPoly}${dots}${labelTexts}
  </svg>
  <div style="display:flex;gap:16px;justify-content:center;margin-top:4px;font-size:11px">
    <span><span style="display:inline-block;width:12px;height:2px;background:${DIAG_COLORS.brand};margin-right:4px;vertical-align:middle"></span>品牌(蓝)</span>
    <span><span style="display:inline-block;width:12px;height:2px;background:${DIAG_COLORS.muted};border-top:1px dashed ${DIAG_COLORS.muted};margin-right:4px;vertical-align:middle"></span>中位(灰)</span>
    <span><span style="display:inline-block;width:12px;height:2px;background:${DIAG_COLORS.best};border-top:1px dashed ${DIAG_COLORS.best};margin-right:4px;vertical-align:middle"></span>最佳(金)</span>
  </div>`;
}

// 位置刻度尺
function positionScaleBar(brandVal, medianVal, top3Items, metricLabel) {
  const top1Val = top3Items.length > 0 ? top3Items[0].val : brandVal;
  const maxVal = Math.max(top1Val * 1.1, brandVal * 1.1, medianVal * 1.1, 0.01);

  function pct(v) { return Math.min(v / maxVal * 100, 100); }

  const brandPct = pct(brandVal);
  const medPct = pct(medianVal);

  let markers = '';
  top3Items.forEach((item, i) => {
    const p = pct(item.val);
    const icons = ['🥇', '🥈', '🥉'];
    markers += `<div style="position:absolute;left:${p}%;transform:translateX(-50%);top:-18px;font-size:10px">${icons[i]}</div>`;
  });

  const gap = top1Val - brandVal;
  const gapText = gap > 0 ? `距 Top1 还差 ${(gap * 100).toFixed(1)} 个百分点` : '已达到 Top1 水平';
  const belowMedian = brandVal < medianVal;
  const medGap = medianVal - brandVal;

  return `<div style="position:relative;margin:16px 0 24px;padding-top:24px">
    <div style="position:relative;height:8px;background:linear-gradient(90deg,#E5E7EB,${DIAG_COLORS.brand});border-radius:4px">
      <div style="position:absolute;left:${medPct}%;top:-4px;width:2px;height:16px;background:${DIAG_COLORS.muted};z-index:1" title="中位数"></div>
      <div style="position:absolute;left:${medPct}%;top:14px;font-size:9px;color:${DIAG_COLORS.muted};transform:translateX(-50%)">中位 ${fmtPct(medianVal)}</div>
      ${markers}
      <div style="position:absolute;left:${brandPct}%;top:-22px;transform:translateX(-50%)">
        <div style="font-size:10px;color:${DIAG_COLORS.brand};font-weight:600;white-space:nowrap">▼ ${fmtPct(brandVal)}</div>
      </div>
    </div>
    <div style="margin-top:20px;text-align:center">
      <span style="background:${belowMedian ? '#FFF1F0' : '#F6FFED'};color:${belowMedian ? DIAG_COLORS.bad : DIAG_COLORS.good};padding:4px 12px;border-radius:4px;font-size:12px;font-weight:500">
        ${belowMedian ? `距中位还差 ${(medGap*100).toFixed(1)} 个百分点 | ` : ''}${gapText}
      </span>
    </div>
  </div>`;
}

// 生成品牌诊断
function generateDiagCard() {
  const input = document.getElementById('brand-diag-input').value.trim();
  if (!input) return;

  // 找品牌
  const brandId = Object.keys(latestByBrand).find(id =>
    id === input || (latestByBrand[id]?.brand_name || '').includes(input)
  );
  if (!brandId) {
    document.getElementById('diag-card-container').innerHTML = '<p style="color:#FF4D4F;padding:16px">未找到该品牌</p>';
    return;
  }

  const brandInfo = latestByBrand[brandId];
  const catKey = brandInfo?.category_l4 || '';
  const emoji = CATEGORY_EMOJI[catKey] || '';
  const meds = catMedians[catKey] || {};

  // 品牌的所有活动（过滤曝光=0）
  const brandActivities = allActivitiesForBP.filter(a =>
    String(a.brand_id) === String(brandId) && a.exposure_uv > 0
  );

  // 品牌聚合指标（PV维度）
  const totalExpPv = brandActivities.reduce((s, a) => s + (a.exposure_pv || 0), 0);
  const totalClmPv = brandActivities.reduce((s, a) => s + (a.claim_pv || 0), 0);
  const totalRdmPv = brandActivities.reduce((s, a) => s + (a.redeem_pv || 0), 0);
  const totalExpUv = brandActivities.reduce((s, a) => s + (a.exposure_uv || 0), 0);
  const totalClmUv = brandActivities.reduce((s, a) => s + (a.claim_uv || 0), 0);
  const totalRdmUv = brandActivities.reduce((s, a) => s + (a.redeem_uv || 0), 0);

  const brandRates = {
    exposure_claim: totalExpPv > 0 ? totalClmPv / totalExpPv : 0,
    claim_redeem: totalClmPv > 0 ? totalRdmPv / totalClmPv : 0,
    exposure_redeem: totalExpPv > 0 ? totalRdmPv / totalExpPv : 0,
    store_redeem: parseRateValue(brandInfo?.w7_store_redeem_rate_uv) || 0,
  };

  // Top3 均值和最佳值
  const top3Avgs = {};
  const bestVals = {};
  const top3ByMetric = {};
  for (const mk of DIAG_METRICS) {
    const bpItems = (bestPracticeData[catKey] || {})[mk.key] || [];
    const vals = bpItems.map(i => i[mk.calcField || mk.key + '_rate'] || 0).filter(v => v > 0);
    top3Avgs[mk.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.01;
    bestVals[mk.key] = vals.length > 0 ? vals[0] : 0;
    top3ByMetric[mk.key] = bpItems.slice(0, 3).map(i => ({
      brand_name: i.brand_name,
      activity_name: i.activity_name,
      val: i[mk.calcField || mk.key + '_rate'] || 0,
    }));
  }

  // 健康评分
  const health = calcHealthScore(brandRates, top3Avgs);
  const weakMetrics = health.details.filter(d => d.brandVal < (meds[d.key] || 0));

  // 中位数值
  const medianVals = {
    exposure_claim: meds.exposure_claim || 0,
    claim_redeem: meds.claim_redeem || 0,
    exposure_redeem: meds.exposure_redeem || 0,
    store_redeem: meds.store_redeem || 0,
  };

  diagBrandData = { brandId, brandInfo, catKey, brandActivities, brandRates, medianVals, bestVals, top3Avgs, top3ByMetric, health, weakMetrics, totalExpPv, totalClmPv, totalRdmPv, totalExpUv, totalClmUv, totalRdmUv };
  diagSelectedMetric = weakMetrics.length > 0 ? DIAG_METRICS.findIndex(m => m.key === weakMetrics[0].key) : 0;

  renderDiagCard();
}

function renderDiagCard() {
  const d = diagBrandData;
  if (!d) return;
  const { brandId, brandInfo, catKey, brandActivities, brandRates, medianVals, bestVals, top3Avgs, top3ByMetric, health, weakMetrics, totalExpPv, totalClmPv, totalRdmPv, totalExpUv, totalClmUv, totalRdmUv } = d;
  const emoji = CATEGORY_EMOJI[catKey] || '';
  const mk = DIAG_METRICS[diagSelectedMetric];

  // 短板气泡
  const weakBubble = weakMetrics.length > 0
    ? `<div class="diag-bubble diag-bubble-warn">⚠ ${weakMetrics.length} 项指标低于行业中位数，建议重点关注${weakMetrics[0].label}</div>`
    : `<div class="diag-bubble diag-bubble-ok">✅ 所有指标均高于行业中位数</div>`;

  // 指标对比表行
  let metricsRows = '';
  DIAG_METRICS.forEach((m, i) => {
    const bv = brandRates[m.key];
    const mv = medianVals[m.key];
    const best = bestVals[m.key];
    const isWeak = bv < mv;
    const isSelected = i === diagSelectedMetric;
    const statusClass = isWeak ? 'diag-status-bad' : 'diag-status-good';
    const statusText = isWeak ? `▲ 低于中位 ${Math.round((mv - bv) / mv * 100)}%` : '✓ 高于中位';
    const rowClass = isSelected ? 'diag-metric-row selected' : 'diag-metric-row';
    const bgClass = isWeak ? ' diag-row-weak' : '';

    metricsRows += `<tr class="${rowClass}${bgClass}" onclick="diagSelectMetric(${i})" style="cursor:pointer">
      <td style="width:28px;text-align:center;color:${DIAG_COLORS.muted}">${i + 1}</td>
      <td style="font-weight:500">${m.label}</td>
      <td style="font-weight:700;color:${DIAG_COLORS.brand}">${fmtPct(bv)}</td>
      <td style="color:${DIAG_COLORS.muted}">${fmtPct(mv)}</td>
      <td style="color:${DIAG_COLORS.best};font-weight:500">${fmtPct(best)}</td>
      <td><span class="${statusClass}">${statusText}</span></td>
    </tr>`;
  });

  // C区：行业标杆
  const selMetric = DIAG_METRICS[diagSelectedMetric];
  const t3 = top3ByMetric[selMetric.key] || [];
  let t3List = '';
  const medals = ['🥇', '🥈', '🥉'];
  t3.forEach((item, i) => {
    t3List += `<div class="diag-t3-item">
      <span class="diag-t3-medal">${medals[i]}</span>
      <div class="diag-t3-info">
        <div class="diag-t3-brand">${item.brand_name} — ${item.activity_name}</div>
      </div>
      <div class="diag-t3-val">${fmtPct(item.val)}</div>
    </div>`;
  });

  // D区：活动明细
  let activityCards = '';
  brandActivities.forEach(act => {
    const ecr = act.claim_pv / (act.exposure_pv || 1);
    const crr = act.redeem_pv / (act.claim_pv || 1);
    const err = act.redeem_pv / (act.exposure_pv || 1);
    const srr = brandRates.store_redeem;

    activityCards += `<div class="diag-act-card">
      <div class="diag-act-header">
        <strong>${act.activity_name}</strong>
        <span style="color:${DIAG_COLORS.muted};font-size:12px">曝光 ${fmtNum(act.exposure_pv)} | 领取 ${fmtNum(act.claim_pv)} | 核销 ${fmtNum(act.redeem_pv)}</span>
      </div>
      <div class="diag-act-metrics">
        ${diagActMetricBar('曝光领取率', ecr, medianVals.exposure_claim)}
        ${diagActMetricBar('领取核销率', crr, medianVals.claim_redeem)}
        ${diagActMetricBar('曝光核销率', err, medianVals.exposure_redeem)}
        ${diagActMetricBar('到店核销率', srr, medianVals.store_redeem)}
      </div>
      <div class="diag-act-funnel">
        <span class="daf-step" style="background:${DIAG_COLORS.brand}">曝光 ${fmtNum(act.exposure_pv)}</span>
        <span class="daf-arrow">→${fmtPct(ecr)}→</span>
        <span class="daf-step" style="background:${DIAG_COLORS.brand}CC">领取 ${fmtNum(act.claim_pv)}</span>
        <span class="daf-arrow">→${fmtPct(crr)}→</span>
        <span class="daf-step" style="background:${DIAG_COLORS.brand}88">核销 ${fmtNum(act.redeem_pv)}</span>
      </div>
    </div>`;
  });

  const container = document.getElementById('diag-card-container');
  container.innerHTML = `
    <div class="diag-report">
      <!-- A区：品牌概览 -->
      <div class="diag-area-a">
        <div class="diag-brand-info">
          <div class="diag-brand-name">${brandInfo?.brand_name || brandId} <span class="diag-cat-tag">${emoji} ${catKey}</span></div>
          <div class="diag-brand-meta">数据日期：${brandInfo?.report_date || '-'}</div>
          <div class="diag-brand-stats">
            <div class="dbs-item"><div class="dbs-num">${brandActivities.length}</div><div class="dbs-label">活动数</div></div>
            <div class="dbs-item"><div class="dbs-num">${fmtNum(totalExpUv)}</div><div class="dbs-label">曝光</div></div>
            <div class="dbs-item"><div class="dbs-num">${fmtNum(totalClmUv)}</div><div class="dbs-label">领取</div></div>
            <div class="dbs-item"><div class="dbs-num">${fmtNum(totalRdmUv)}</div><div class="dbs-label">核销</div></div>
          </div>
        </div>
        <div class="diag-health-ring">
          ${healthRingSvg(health.total, 130)}
          <div style="text-align:center;font-size:11px;color:${DIAG_COLORS.muted};margin-top:4px">综合4项指标相对业态中位数的表现</div>
        </div>
      </div>

      ${weakBubble}

      <!-- B区：雷达图 + 指标表 -->
      <div class="diag-area-b">
        <div class="diag-radar-wrap">
          ${radarChartSvg(brandRates, medianVals, bestVals, 240)}
        </div>
        <div class="diag-metrics-table-wrap">
          <table class="diag-metrics-table">
            <thead><tr>
              <th></th><th>指标</th><th style="color:${DIAG_COLORS.brand}">品牌</th><th>中位数</th><th style="color:${DIAG_COLORS.best}">最佳</th><th>状态</th>
            </tr></thead>
            <tbody>${metricsRows}</tbody>
          </table>
          <div style="font-size:11px;color:${DIAG_COLORS.muted};margin-top:8px;text-align:right">点击指标行查看行业标杆详情 ↓</div>
        </div>
      </div>

      <!-- C区：行业标杆参考 -->
      <div class="diag-area-c">
        <h3 class="diag-section-title">🏆 行业标杆参考（${catKey} · ${selMetric.label} Top3）</h3>
        ${positionScaleBar(brandRates[selMetric.key], medianVals[selMetric.key], t3, selMetric.label)}
        <div class="diag-t3-list">${t3List}</div>
      </div>

      <!-- D区：活动明细 -->
      <div class="diag-area-d">
        <h3 class="diag-section-title" onclick="toggleDiagActivities()" style="cursor:pointer">
          📋 活动明细 <span id="diag-act-toggle" style="font-size:12px;color:${DIAG_COLORS.muted}">收起 ▲</span>
        </h3>
        <div id="diag-act-list" class="diag-act-list">${activityCards}</div>
      </div>
    </div>
  `;
}

function diagActMetricBar(label, val, med) {
  const maxW = Math.max(val, med, 0.01);
  const brandW = Math.min(val / maxW * 100, 100);
  const medPos = Math.min(med / maxW * 100, 100);
  const isWeak = val < med;
  return `<div class="diag-act-mb">
    <div class="damb-label">${label}</div>
    <div class="damb-bar-wrap">
      <div class="damb-bar" style="width:${brandW}%;background:${isWeak ? DIAG_COLORS.bad : DIAG_COLORS.brand}"></div>
      <div class="damb-med" style="left:${medPos}%" title="中位 ${fmtPct(med)}"></div>
    </div>
    <div class="damb-val">${fmtPct(val)} <span style="color:${DIAG_COLORS.muted};font-size:10px">(中位 ${fmtPct(med)})</span></div>
  </div>`;
}

function diagSelectMetric(idx) {
  diagSelectedMetric = idx;
  renderDiagCard();
}

function toggleDiagActivities() {
  const list = document.getElementById('diag-act-list');
  const toggle = document.getElementById('diag-act-toggle');
  if (list.style.display === 'none') {
    list.style.display = '';
    toggle.textContent = '收起 ▲';
  } else {
    list.style.display = 'none';
    toggle.textContent = '展开 ▼';
  }
}
