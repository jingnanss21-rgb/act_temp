/**
 * pin-analysis.js - 策略分析模块 (Tab5)
 * 数据源:
 *   - tem_pinned_ops       置顶操作记录
 *   - tem_waist_qualified  腰部达标标记
 *   - tem_pinned_notes     人工备注
 *   - tem_activity_daily   活动日表（每日曝光/核销/老客尽曝率）
 *   - tem_brand_daily      品牌日报（日均交易笔数/是否存活）
 */

let pinData = {
  pinnedOps: [],          // [{brand_id, pin_date, ...}]
  waistQualified: {},     // brand_id → {is_qualified, is_alive, brand_name, category, ...}
  brandDaily: {},         // brand_id → latest brand_daily record
  brandDailyAll: [],      // all brand_daily rows (for survival trend)
  activityDaily: {},      // brand_id → [{report_date, exposure_uv, claim_uv, redeem_uv, store_redeem_rate_uv}...]
  notes: {},              // brand_id → note
  survivalTrend: { pinned: [], qualified: [], waist: [] },
  survivalPeriod: '30d',  // '7d' | '30d'
  classified: {
    qualified_pinned: [],
    qualified_unpinned: [],
    unqualified_pinned: [],
  },
  effectTab: 'alive',  // 'alive' | 'dead'
};

let pinMetricsCache = {};  // brand_id → {daily_exposure_avg, daily_claim_avg, ...}
let pinCurrentModalBrand = null;

async function loadPinAnalysis() {
  const container = document.getElementById('pin-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载策略数据...</p></div>';

  try {
    // 并行加载全部数据
    async function fetchAll(table, select, order) {
      let all = [], offset = 0, limit = 1000;
      while (true) {
        let q = supabaseClient.from(table).select(select || '*');
        if (order) {
          const [col, dir] = order.split('.');
          q = q.order(col, { ascending: dir !== 'desc' });
        }
        const { data, error } = await q.range(offset, offset + limit - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < limit) break;
        offset += limit;
      }
      return all;
    }

    const [pinnedOps, waistQual, brandDaily, actDaily, notes] = await Promise.all([
      fetchAll('tem_pinned_ops', '*'),
      fetchAll('tem_waist_qualified', '*'),
      fetchAll('tem_brand_daily', 'brand_id,brand_name,category_l4,w7_avg_txn_count,is_online_today,is_alive_w7,report_date,daily_exposure_pv,daily_claim_pv,daily_redeem_pv,daily_exposure_redeem_rate,w7_high_freq_rate_uv,w7_low_freq_rate_uv,w7_store_redeem_rate_uv', 'report_date.desc'),
      fetchAll('tem_activity_daily', 'brand_id,activity_id,activity_name,report_date,exposure_uv,claim_uv,redeem_uv,store_redeem_rate_uv,exposure_pv,claim_pv,redeem_pv'),
      fetchAll('tem_pinned_notes', '*'),
    ]);

    pinData.pinnedOps = pinnedOps;

    // waist 索引
    pinData.waistQualified = {};
    for (const w of waistQual) {
      pinData.waistQualified[String(w.brand_id)] = w;
    }

    // brandDaily: 保留全量用于趋势，同时建 brand_id → latest 索引
    pinData.brandDailyAll = brandDaily;
    pinData.brandDaily = {};
    for (const b of brandDaily) {
      const bid = String(b.brand_id);
      if (!pinData.brandDaily[bid]) pinData.brandDaily[bid] = b;
    }

    // activityDaily: 按 brand_id 分组
    pinData.activityDaily = {};
    for (const a of actDaily) {
      const bid = String(a.brand_id);
      if (!pinData.activityDaily[bid]) pinData.activityDaily[bid] = [];
      pinData.activityDaily[bid].push(a);
    }

    // notes
    pinData.notes = {};
    for (const n of notes) {
      pinData.notes[String(n.brand_id)] = n.note;
    }

    // 分类
    classifyBrands();

    // 渲染
    renderPinAnalysis();
  } catch (err) {
    container.innerHTML = `<div style="padding:32px;color:#DC2626">加载失败: ${err.message}</div>`;
    console.error(err);
  }
}

// ============================================================
// 品牌分类
// ============================================================
function classifyBrands() {
  const pinnedSet = new Set(pinData.pinnedOps.map(p => String(p.brand_id)));
  const waistSet = new Set(Object.keys(pinData.waistQualified));

  pinData.classified = {
    qualified_pinned: [],
    qualified_unpinned: [],
    unqualified_pinned: [],
  };

  // 遍历腰部达标表
  for (const bid of waistSet) {
    const w = pinData.waistQualified[bid];
    const qualified = w.is_qualified === '达标';
    const pinned = pinnedSet.has(bid);
    if (qualified && pinned) {
      pinData.classified.qualified_pinned.push(bid);
    } else if (qualified && !pinned) {
      pinData.classified.qualified_unpinned.push(bid);
    } else if (!qualified && pinned) {
      pinData.classified.unqualified_pinned.push(bid);
    }
  }
}

// ============================================================
// 存活率趋势（3条线：置顶 / 达标 / 全量腰部）
// 分母 = 当日 is_online_today=1 的品牌数
// 分子 = 其中 is_alive_w7=1 的品牌数
// ============================================================
function computeSurvivalTrend() {
  const pinnedIds = new Set(pinData.pinnedOps.map(p => String(p.brand_id)));
  const qualifiedIds = new Set();
  const waistIds = new Set();
  for (const [bid, w] of Object.entries(pinData.waistQualified)) {
    waistIds.add(bid);
    if (w.is_qualified === '达标') qualifiedIds.add(bid);
  }

  function isOnline(v) { return String(v).startsWith('1'); }
  function isAlive(v) { return String(v).startsWith('1'); }

  // date → { group → { online: Set, alive: Set } }
  const dateMap = {};
  const groups = ['pinned', 'qualified', 'waist'];

  for (const b of pinData.brandDailyAll) {
    const bid = String(b.brand_id);
    const d = b.report_date;
    if (!d) continue;
    const online = isOnline(b.is_online_today);
    const alive = isAlive(b.is_alive_w7);

    const belongs = [];
    if (pinnedIds.has(bid)) belongs.push('pinned');
    if (qualifiedIds.has(bid)) belongs.push('qualified');
    if (waistIds.has(bid)) belongs.push('waist');
    if (belongs.length === 0) continue;

    if (!dateMap[d]) {
      dateMap[d] = {};
      for (const g of groups) dateMap[d][g] = { online: new Set(), alive: new Set() };
    }

    for (const g of belongs) {
      if (online) {
        dateMap[d][g].online.add(bid);
        if (alive) dateMap[d][g].alive.add(bid);
      }
    }
  }

  const allDates = Object.keys(dateMap).filter(d => d >= '2026-04-01').sort();
  // 根据 period 筛选
  const period = pinData.survivalPeriod || '30d';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (period === '7d' ? 7 : 30));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const dates = allDates.filter(d => d >= cutoffStr);
  function buildSeries(group) {
    return dates.map(d => {
      const onlineCount = dateMap[d][group].online.size;
      const aliveCount = dateMap[d][group].alive.size;
      return {
        date: d,
        alive: aliveCount,
        total: onlineCount,
        rate: onlineCount > 0 ? aliveCount / onlineCount : 0,
      };
    });
  }
  return { pinned: buildSeries('pinned'), qualified: buildSeries('qualified'), waist: buildSeries('waist') };
}

// ============================================================
// 主渲染
// ============================================================
function renderPinAnalysis() {
  const container = document.getElementById('pin-container');
  const c = pinData.classified;
  const qualifiedTotal = c.qualified_pinned.length + c.qualified_unpinned.length;
  const qpPct = qualifiedTotal > 0 ? ((c.qualified_pinned.length / qualifiedTotal) * 100).toFixed(1) : 0;
  const quPct = qualifiedTotal > 0 ? ((c.qualified_unpinned.length / qualifiedTotal) * 100).toFixed(1) : 0;

  // 告警列表：不在线 = 置顶品牌中今日 is_online_today != 1
  const allPinnedBids = pinData.pinnedOps.map(p => String(p.brand_id));
  const notOnline = allPinnedBids.filter(bid => {
    const b = pinData.brandDaily[bid];
    return !b || String(b.is_online_today) !== '1';
  });
  const notQualified = c.unqualified_pinned;

  // 存活率趋势（双线）
  const survival = computeSurvivalTrend();
  pinData.survivalTrend = survival;

  container.innerHTML = `
    <div class="pin-page">

      <!-- 第一部分：概览+告警 -->
      <div class="pin-section">
        <h3 class="pin-section-title">📊 策略概览</h3>
        <div class="pin-overview">
          <div class="pin-overview-item">
            <div class="pin-ov-label">达标总数</div>
            <div class="pin-ov-value">${qualifiedTotal}</div>
          </div>
          <div class="pin-overview-item">
            <div class="pin-ov-label">达标已置顶</div>
            <div class="pin-ov-value">${c.qualified_pinned.length} <span class="pin-ov-pct">(${qpPct}%)</span></div>
          </div>
          <div class="pin-overview-item">
            <div class="pin-ov-label">达标未置顶</div>
            <div class="pin-ov-value">${c.qualified_unpinned.length} <span class="pin-ov-pct">(${quPct}%)</span></div>
          </div>
        </div>

        <!-- 存活率趋势 -->
        <div class="pin-trend-card">
          <div class="pin-trend-header">
            <span>存活率趋势（在线商户中近7日存活占比）</span>
            <div>
              <button class="pin-period-btn ${pinData.survivalPeriod === '7d' ? 'active' : ''}" onclick="switchSurvivalPeriod('7d')">近7天</button>
              <button class="pin-period-btn ${pinData.survivalPeriod === '30d' ? 'active' : ''}" onclick="switchSurvivalPeriod('30d')">近30天</button>
            </div>
          </div>
          <div class="pin-trend-meta-row">置顶 ${pinData.pinnedOps.length} · 达标 ${c.qualified_pinned.length + c.qualified_unpinned.length} · 腰部 ${Object.keys(pinData.waistQualified).length}</div>
          <div id="pin-trend-svg-container" class="pin-trend-svg">${renderSurvivalSVG(survival.pinned, survival.qualified, survival.waist)}</div>
        </div>

        <!-- 两张告警卡片 -->
        <div class="pin-alerts">
          <div class="pin-alert-card pin-alert-red">
            <div class="pin-alert-header">
              <span class="pin-alert-icon">🔴</span>
              <span>置顶不在线 · 需替换 (${notOnline.length})</span>
            </div>
            <div class="pin-alert-body">${renderBrandListMini(notOnline)}</div>
          </div>
          <div class="pin-alert-card pin-alert-yellow">
            <div class="pin-alert-header">
              <span class="pin-alert-icon">🟡</span>
              <span>置顶不达标 · 需排查要素 (${notQualified.length})</span>
            </div>
            <div class="pin-alert-body">${renderBrandListMini(notQualified)}</div>
          </div>
        </div>
      </div>

      <!-- 第二部分：品牌流量分析 -->
      <div class="pin-section" style="margin-top:24px">
        <h3 class="pin-section-title">📌 品牌流量分析</h3>

        <div class="pin-effect-tabs">
          <button class="pin-effect-tab ${pinData.effectTab === 'alive' ? 'active' : ''}" onclick="switchPinEffectTab('alive')">
            ✅ 存活 <span id="pin-count-alive"></span>
          </button>
          <button class="pin-effect-tab ${pinData.effectTab === 'dead' ? 'active' : ''}" onclick="switchPinEffectTab('dead')">
            ❌ 不存活 <span id="pin-count-dead"></span>
          </button>
        </div>

        <div id="pin-cards-grid" class="pin-cards-grid"></div>
      </div>
    </div>

    <!-- 弹窗 -->
    <div id="pin-modal" class="pin-modal" style="display:none;" onclick="closePinModal()">
      <div class="pin-modal-content" onclick="event.stopPropagation()">
        <div id="pin-modal-body"></div>
      </div>
    </div>
  `;

  renderEffectGrid();
}

function switchSurvivalPeriod(period) {
  pinData.survivalPeriod = period;
  document.querySelectorAll('.pin-period-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.includes(period === '7d' ? '7' : '30'));
  });
  const survival = computeSurvivalTrend();
  pinData.survivalTrend = survival;
  document.getElementById('pin-trend-svg-container').innerHTML =
    renderSurvivalSVG(survival.pinned, survival.qualified, survival.waist);
}

// ============================================================
// 渲染置顶效果卡片网格
// ============================================================
function renderEffectGrid() {
  const grid = document.getElementById('pin-cards-grid');
  if (!grid) return;

  const pinnedBids = pinData.pinnedOps.map(p => String(p.brand_id));

  const alive = [];
  const dead = [];
  for (const bid of pinnedBids) {
    const info = computeBrandEffect(bid);
    if (info.is_alive) alive.push(info);
    else dead.push(info);
  }

  // 更新计数
  const elAlive = document.getElementById('pin-count-alive');
  const elDead = document.getElementById('pin-count-dead');
  if (elAlive) elAlive.textContent = alive.length;
  if (elDead) elDead.textContent = dead.length;

  const list = pinData.effectTab === 'alive' ? alive : dead;
  // 排序：存活在前已由 tab 保证，组内按流量涨幅降序
  list.sort((a, b) => (b.exposure_change || 0) - (a.exposure_change || 0));

  if (list.length === 0) {
    grid.innerHTML = '<div class="pin-empty">暂无品牌</div>';
    return;
  }

  grid.innerHTML = list.map(info => {
    const changePct = info.exposure_change != null ? (info.exposure_change * 100).toFixed(1) : null;
    const changeColor = changePct == null ? '#94A3B8' : (changePct >= 20 ? '#16A34A' : (changePct >= -20 ? '#D97706' : '#DC2626'));
    const changeLabel = changePct == null ? '无基线' : `${changePct >= 0 ? '+' : ''}${changePct}%`;
    return `<div class="pin-card" onclick="openPinModal('${info.brand_id}')">
      <div class="pin-card-head">
        <div class="pin-card-brand">${info.brand_name || info.brand_id}</div>
        <div class="pin-card-meta">周期${info.pin_period_days}天</div>
      </div>
      <div class="pin-card-metrics">
        <div class="pin-card-metric"><span>日均曝光</span><b>${fmtPinNum(info.daily_avg_exposure)}</b></div>
        <div class="pin-card-metric"><span>日均核销</span><b>${fmtPinNum(info.daily_avg_redeem)}</b></div>
      </div>
      <div class="pin-card-chart">${renderMiniExposureSVG(info.daily_series)}</div>
      <div class="pin-card-diag" style="color:${changeColor}">流量 ${changeLabel}</div>
    </div>`;
  }).join('');
}

function switchPinEffectTab(tab) {
  pinData.effectTab = tab;
  document.querySelectorAll('.pin-effect-tab').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${tab}'`));
  });
  renderEffectGrid();
}

// ============================================================
// 品牌效果计算（核心）
// 数据源：brandDailyAll（品牌日报全量含3月，有置顶前数据）
// ============================================================
function computeBrandEffect(bid) {
  const op = pinData.pinnedOps.find(p => String(p.brand_id) === bid);
  const w = pinData.waistQualified[bid] || {};
  const bd = pinData.brandDaily[bid] || {};

  const pinDate = op ? op.pin_date : null;
  const today = new Date();
  today.setHours(0,0,0,0);
  const pinDt = pinDate ? new Date(pinDate) : null;
  if (pinDt) pinDt.setHours(0,0,0,0);
  const pinPeriodDays = pinDt ? Math.max(1, Math.round((today - pinDt) / 86400000)) : 0;

  // 从 brandDailyAll 取该品牌全部日报数据
  const brandRows = pinData.brandDailyAll.filter(b => String(b.brand_id) === bid);
  const dailyMap = {};
  for (const b of brandRows) {
    const d = b.report_date;
    if (!d) continue;
    dailyMap[d] = {
      exposure: parseFloat(b.daily_exposure_pv) || 0,
      claim: parseFloat(b.daily_claim_pv) || 0,
      redeem: parseFloat(b.daily_redeem_pv) || 0,
      exp_redeem_rate: parseRate(b.daily_exposure_redeem_rate),
      store_rate: parseRate(b.w7_store_redeem_rate_uv),
      high_freq: parseRate(b.w7_high_freq_rate_uv),
      low_freq: parseRate(b.w7_low_freq_rate_uv),
    };
  }

  const dates = Object.keys(dailyMap).sort();
  const daily_series = dates.map(d => ({
    date: d,
    exposure: dailyMap[d].exposure,
    claim: dailyMap[d].claim,
    redeem: dailyMap[d].redeem,
    exp_redeem_rate: dailyMap[d].exp_redeem_rate,
    store_rate: dailyMap[d].store_rate,
    high_freq: dailyMap[d].high_freq,
    low_freq: dailyMap[d].low_freq,
  }));

  // 置顶周期累计 & 日均
  let total_exposure = 0, total_claim = 0, total_redeem = 0;
  let sum_exp_redeem_rate = 0, cnt_exp_redeem_rate = 0;
  let sum_store_rate = 0, cnt_store_rate = 0;
  let alive_days = 0, data_days = 0;
  for (const row of daily_series) {
    if (pinDt && new Date(row.date) < pinDt) continue;
    total_exposure += row.exposure;
    total_claim += row.claim;
    total_redeem += row.redeem;
    if (row.exp_redeem_rate != null) { sum_exp_redeem_rate += row.exp_redeem_rate; cnt_exp_redeem_rate++; }
    if (row.store_rate != null) { sum_store_rate += row.store_rate; cnt_store_rate++; }
    data_days++;
    if (row.exposure > 0 || row.redeem > 0) alive_days++;
  }
  const avg_exp_redeem_rate = cnt_exp_redeem_rate > 0 ? sum_exp_redeem_rate / cnt_exp_redeem_rate : null;
  const avg_store_rate = cnt_store_rate > 0 ? sum_store_rate / cnt_store_rate : null;

  // 置顶前后均值对比（曝光）
  const before = [], after = [];
  for (const row of daily_series) {
    if (!pinDt) continue;
    if (new Date(row.date) < pinDt) before.push(row.exposure);
    else after.push(row.exposure);
  }
  const avgBefore = before.length > 0 ? before.reduce((s,v)=>s+v,0) / before.length : 0;
  const avgAfter = after.length > 0 ? after.reduce((s,v)=>s+v,0) / after.length : 0;
  const exposureChange = avgBefore > 0 ? (avgAfter - avgBefore) / avgBefore : (avgAfter > 0 ? 1 : 0);

  // 诊断
  let diag_label = '-', diag_color = '#94A3B8';
  if (before.length === 0) {
    diag_label = '📊 数据不足（无基线）';
    diag_color = '#94A3B8';
  } else if (exposureChange >= 0.2) {
    diag_label = '💡 流量有效';
    diag_color = '#16A34A';
  } else if (exposureChange >= -0.2) {
    diag_label = '⚠️ 流量平稳';
    diag_color = '#D97706';
  } else {
    diag_label = '❌ 流量下降';
    diag_color = '#DC2626';
  }

  // 存活判断：最新 brand_daily 的 is_alive_w7
  const isAlive = String((bd.is_alive_w7 || '')).startsWith('1');

  return {
    brand_id: bid,
    brand_name: w.brand_name || bd.brand_name || op?.brand_name || bid,
    category: w.category || bd.category_l4 || '-',
    operating_sp: w.operating_sp || '-',
    pin_date: pinDate,
    pin_period_days: pinPeriodDays,
    is_effective: before.length > 0 && exposureChange >= 0.2,
    is_alive: isAlive,
    alive_days, data_days,
    total_exposure, total_claim, total_redeem,
    // 日均
    daily_avg_exposure: data_days > 0 ? total_exposure / data_days : 0,
    daily_avg_claim: data_days > 0 ? total_claim / data_days : 0,
    daily_avg_redeem: data_days > 0 ? total_redeem / data_days : 0,
    exposure_redeem_rate: avg_exp_redeem_rate,
    store_redeem_rate: avg_store_rate,
    w7_avg_txn_count: bd.w7_avg_txn_count || '-',
    avg_before: avgBefore, avg_after: avgAfter,
    exposure_change: exposureChange,
    diag_label, diag_color,
    daily_series,
  };
}

// ============================================================
// 弹窗
// ============================================================
function openPinModal(bid) {
  const info = computeBrandEffect(bid);
  pinCurrentModalBrand = bid;

  const modal = document.getElementById('pin-modal');
  const body = document.getElementById('pin-modal-body');

  const changePct = (info.exposure_change * 100).toFixed(1);
  const note = pinData.notes[bid] || '';

  body.innerHTML = `
    <div class="pin-modal-header">
      <div>
        <div class="pin-modal-title">${info.brand_name} <span class="pin-modal-cat">${info.category}</span></div>
        <div class="pin-modal-sub">置顶日 ${info.pin_date || '-'} · 周期 ${info.pin_period_days}天 · ${info.is_effective ? '✅ 流量有效' : '❌ 流量无效'}</div>
      </div>
      <button class="pin-modal-close" onclick="closePinModal()">✕</button>
    </div>

    <!-- 核心指标（日均） -->
    <div class="pin-modal-metrics">
      <div class="pin-m-item"><div class="pin-m-label">日均交易笔数</div><div class="pin-m-val">${fmtPinNum(parseFloat(info.w7_avg_txn_count)) || '-'}</div></div>
      <div class="pin-m-item"><div class="pin-m-label">日均曝光</div><div class="pin-m-val">${fmtPinNum(info.daily_avg_exposure)}</div></div>
      <div class="pin-m-item"><div class="pin-m-label">日均核销</div><div class="pin-m-val">${fmtPinNum(info.daily_avg_redeem)}</div></div>
      <div class="pin-m-item"><div class="pin-m-label">曝光核销率</div><div class="pin-m-val">${fmtPinPct(info.exposure_redeem_rate)}</div></div>
      <div class="pin-m-item"><div class="pin-m-label">到店核销率</div><div class="pin-m-val">${info.store_redeem_rate != null ? fmtPinPct(info.store_redeem_rate) : '-'}</div></div>
    </div>

    <!-- 诊断 -->
    <div class="pin-modal-diag" style="background:${info.diag_color}10;border-left:3px solid ${info.diag_color};color:${info.diag_color}">
      ${info.diag_label} · 置顶后曝光${info.exposure_change >= 0 ? '↑' : '↓'} ${Math.abs(changePct)}%
      ${info.avg_before > 0 ? `(置顶前均值 ${fmtPinNum(info.avg_before)} → 置顶后均值 ${fmtPinNum(info.avg_after)})` : ''}
    </div>

    <!-- 趋势图 -->
    <div class="pin-modal-chart">
      <div class="pin-chart-header">
        <span>📈 品牌趋势（最近30天）</span>
        <select id="pin-chart-metric" onchange="updatePinChart()">
          <option value="exposure">曝光PV</option>
          <option value="redeem">核销PV</option>
          <option value="claim">领取PV</option>
          <option value="store_rate">到店核销率</option>
          <option value="high_freq">高频应曝尽曝率</option>
          <option value="low_freq">低频应曝尽曝率</option>
        </select>
      </div>
      <div id="pin-chart-svg" class="pin-chart-svg"></div>
    </div>

    <!-- 人工备注 -->
    <div class="pin-modal-note">
      <div class="pin-note-header">📝 人工备注（待反馈）</div>
      <textarea id="pin-note-input" class="pin-note-input" placeholder="填写品牌存活情况的人工反馈...">${note}</textarea>
      <div class="pin-note-actions">
        <button class="pin-btn" onclick="savePinNote('${bid}')">保存备注</button>
        <span id="pin-note-status" class="pin-note-status"></span>
      </div>
    </div>

    <!-- 活动明细（折叠） -->
    <div class="pin-modal-acts">
      <div class="pin-acts-toggle" onclick="togglePinActs()">
        <span>📋 活动明细</span>
        <span id="pin-acts-arrow">展开 ▾</span>
      </div>
      <div id="pin-acts-body" style="display:none;margin-top:10px">${renderPinActivitiesTable(bid)}</div>
    </div>
  `;

  modal.style.display = 'flex';
  // 初次渲染chart
  setTimeout(() => updatePinChart(), 50);
}

function closePinModal() {
  document.getElementById('pin-modal').style.display = 'none';
  pinCurrentModalBrand = null;
}

function updatePinChart() {
  if (!pinCurrentModalBrand) return;
  const info = computeBrandEffect(pinCurrentModalBrand);
  const metric = document.getElementById('pin-chart-metric').value;
  const isRate = ['store_rate', 'high_freq', 'low_freq'].includes(metric);
  const series = info.daily_series.map(r => ({
    date: r.date,
    value: isRate ? (r[metric] != null ? parseFloat(r[metric]) : null) : (r[metric] || 0)
  }));
  document.getElementById('pin-chart-svg').innerHTML = renderBigChartSVG(series, info.pin_date, isRate);
}

function togglePinActs() {
  const body = document.getElementById('pin-acts-body');
  const arrow = document.getElementById('pin-acts-arrow');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    arrow.textContent = '收起 ▴';
  } else {
    body.style.display = 'none';
    arrow.textContent = '展开 ▾';
  }
}

function renderPinActivitiesTable(bid) {
  const acts = pinData.activityDaily[bid] || [];
  const op = pinData.pinnedOps.find(p => String(p.brand_id) === bid);
  const pinDate = op ? op.pin_date : null;
  const pinDt = pinDate ? new Date(pinDate) : null;

  // 按activity_id聚合置顶后的天数
  const actMap = {};
  for (const a of acts) {
    if (pinDt && new Date(a.report_date) < pinDt) continue;
    const aid = a.activity_id;
    if (!actMap[aid]) actMap[aid] = {
      activity_id: aid,
      activity_name: a.activity_name || aid,
      days: 0,
      exposure: 0, claim: 0, redeem: 0,
      store_rates: [],
    };
    actMap[aid].days++;
    actMap[aid].exposure += (a.exposure_uv || 0);
    actMap[aid].claim += (a.claim_uv || 0);
    actMap[aid].redeem += (a.redeem_uv || 0);
    if (a.store_redeem_rate_uv) actMap[aid].store_rates.push(parseFloat(a.store_redeem_rate_uv));
  }

  const rows = Object.values(actMap).sort((a, b) => b.exposure - a.exposure);
  if (rows.length === 0) return '<div style="padding:12px;color:#94A3B8">暂无活动数据</div>';

  let html = '<table class="pin-acts-table"><thead><tr>' +
    '<th>活动名称</th><th>日均曝光</th><th>日均核销</th><th>曝光核销率</th><th>到店核销率</th>' +
    '</tr></thead><tbody>';
  for (const r of rows) {
    const er = r.exposure > 0 ? r.redeem / r.exposure : 0;
    const srAvg = r.store_rates.length > 0 ? r.store_rates.reduce((s,v)=>s+v,0) / r.store_rates.length : null;
    html += `<tr>
      <td title="${r.activity_name}" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${r.activity_name}</td>
      <td>${fmtPinNum(r.exposure / Math.max(r.days,1))}</td>
      <td>${fmtPinNum(r.redeem / Math.max(r.days,1))}</td>
      <td>${fmtPinPct(er)}</td>
      <td>${srAvg != null ? fmtPinPct(srAvg) : '-'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

async function savePinNote(bid) {
  const input = document.getElementById('pin-note-input');
  const status = document.getElementById('pin-note-status');
  const note = input.value.trim();
  try {
    status.textContent = '保存中...';
    const { error } = await supabaseClient.from('tem_pinned_notes')
      .upsert({ brand_id: bid, note: note, updated_at: new Date().toISOString() },
              { onConflict: 'brand_id' });
    if (error) throw error;
    pinData.notes[bid] = note;
    status.textContent = '✅ 已保存';
    status.style.color = '#16A34A';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    status.textContent = '❌ 保存失败: ' + err.message;
    status.style.color = '#DC2626';
  }
}

// ============================================================
// SVG 渲染
// ============================================================
function renderBrandListMini(bids) {
  if (bids.length === 0) return '<div class="pin-empty-mini">暂无</div>';
  return bids.slice(0, 20).map(bid => {
    const w = pinData.waistQualified[bid] || {};
    const bd = pinData.brandDaily[bid] || {};
    const name = w.brand_name || bd.brand_name || bid;
    return `<div class="pin-alert-item" onclick="openPinModal('${bid}')">${name}</div>`;
  }).join('') + (bids.length > 20 ? `<div class="pin-alert-more">+${bids.length-20}</div>` : '');
}

function renderSurvivalSVG(pinnedSeries, qualifiedSeries, waistSeries) {
  const allSeries = [pinnedSeries, qualifiedSeries, waistSeries].filter(s => s && s.length > 0);
  if (allSeries.length === 0) {
    return '<div style="text-align:center;color:#94A3B8;padding:20px">暂无数据</div>';
  }
  const W = 720, H = 180, P = 36, TOP = 32;

  // 合并日期轴
  const dateSet = new Set();
  allSeries.forEach(s => s.forEach(p => dateSet.add(p.date)));
  const dates = [...dateSet].sort();
  const xStep = (W - P*2) / Math.max(dates.length - 1, 1);

  // 动态 Y 轴上限
  let maxRate = 0;
  allSeries.forEach(s => s.forEach(p => { if (p.rate > maxRate) maxRate = p.rate; }));
  maxRate = Math.min(1, Math.max(maxRate * 1.15, 0.1));

  const lines = [
    { series: pinnedSeries || [],    color: '#2563EB', label: '置顶商户' },
    { series: qualifiedSeries || [], color: '#16A34A', label: '达标商户' },
    { series: waistSeries || [],     color: '#EA580C', label: '全量腰部' },
  ];

  function toMap(s) { const m = {}; s.forEach(p => m[p.date] = p); return m; }

  let pathsHTML = '';
  let dotsHTML = '';
  for (const line of lines) {
    if (line.series.length === 0) continue;
    const map = toMap(line.series);
    let path = '';
    dates.forEach((d, i) => {
      const p = map[d];
      if (!p) return;
      const x = P + i * xStep;
      const y = H - P - (p.rate / maxRate) * (H - P - TOP);
      path += (path ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    pathsHTML += `<path d="${path}" fill="none" stroke="${line.color}" stroke-width="2"/>`;
    dates.forEach((d, i) => {
      const p = map[d];
      if (!p) return;
      const x = P + i * xStep;
      const y = H - P - (p.rate / maxRate) * (H - P - TOP);
      // 透明大圆作为 hover 区域 + 可见小圆 + tooltip
      dotsHTML += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="transparent" style="cursor:pointer">
        <title>${line.label} ${p.date}: 存活${p.alive}/${p.total}在线 (${(p.rate*100).toFixed(1)}%)</title>
      </circle>`;
      dotsHTML += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${line.color}" pointer-events="none"/>`;
    });
  }

  // Y轴grid
  const grids = [0.25, 0.5, 0.75, 1.0].filter(r => r <= 1).map(r => {
    const val = r * maxRate;
    const y = H - P - r * (H - P - TOP);
    return `<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="3,3"/>
            <text x="${P-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#94A3B8">${(val*100).toFixed(0)}%</text>`;
  }).join('');

  // X轴日期
  const xLabels = [];
  if (dates.length > 0) {
    const pts = [0, Math.floor(dates.length/2), dates.length - 1];
    pts.forEach(i => {
      const x = P + i * xStep;
      xLabels.push(`<text x="${x}" y="${H-P+16}" text-anchor="middle" font-size="10" fill="#64748B">${dates[i].slice(5)}</text>`);
    });
  }

  // 图例
  let legendX = W - P - 280;
  const legend = lines.filter(l => l.series.length > 0).map((l, i) => {
    const x = legendX + i * 90;
    return `<rect x="${x}" y="6" width="14" height="3" rx="1" fill="${l.color}"/>
            <text x="${x+18}" y="12" font-size="11" fill="${l.color}">${l.label}</text>`;
  }).join('');

  // 生成唯一ID
  const svgId = 'survival-svg-' + Date.now();

  // 构建数据点数组供 crosshair 用（所有线的所有点）
  const allPoints = [];
  for (const line of lines) {
    if (line.series.length === 0) continue;
    const map = toMap(line.series);
    dates.forEach((d, i) => {
      const p = map[d];
      if (!p) return;
      const x = P + i * xStep;
      const y = H - P - (p.rate / maxRate) * (H - P - TOP);
      allPoints.push({ x, y, date: p.date, rate: p.rate, alive: p.alive, total: p.total, label: line.label, color: line.color });
    });
  }

  return `<svg id="${svgId}" viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
    ${legend}
    ${grids}
    ${pathsHTML}
    ${dotsHTML}
    ${xLabels.join('')}
    <!-- crosshair elements -->
    <line id="${svgId}-vline" x1="0" y1="${TOP}" x2="0" y2="${H-P}" stroke="#64748B" stroke-width="1" stroke-dasharray="2,2" display="none"/>
    <line id="${svgId}-hline" x1="${P}" y1="0" x2="${W-P}" y2="0" stroke="#64748B" stroke-width="1" stroke-dasharray="2,2" display="none"/>
    <text id="${svgId}-xlabel" x="0" y="${H-P+14}" text-anchor="middle" font-size="10" fill="#1E293B" font-weight="600" display="none"></text>
    <text id="${svgId}-ylabel" x="${P-4}" y="0" text-anchor="end" font-size="10" fill="#1E293B" font-weight="600" display="none"></text>
    <circle id="${svgId}-dot" cx="0" cy="0" r="5" fill="none" stroke="#1E293B" stroke-width="2" display="none"/>
    <!-- invisible overlay for mouse -->
    <rect x="${P}" y="${TOP}" width="${W-P*2}" height="${H-P-TOP}" fill="transparent"
      onmousemove="pinSurvivalCrosshair(event,'${svgId}')"
      onmouseleave="pinSurvivalCrosshairHide('${svgId}')"/>
  </svg>
  <script>
    window._pinSurvivalPts_${svgId.replace(/-/g,'_')} = ${JSON.stringify(allPoints)};
  </script>`;
}

// Crosshair interaction for survival trend SVG
function pinSurvivalCrosshair(event, svgId) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const pts = window['_pinSurvivalPts_' + svgId.replace(/-/g, '_')];
  if (!pts || pts.length === 0) return;

  // Get mouse position in SVG coordinates
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const mouseX = ((event.clientX - rect.left) / rect.width) * viewBox.width;

  // Find nearest point by x
  let nearest = pts[0], minDist = Math.abs(pts[0].x - mouseX);
  for (const p of pts) {
    const dist = Math.abs(p.x - mouseX);
    if (dist < minDist) { minDist = dist; nearest = p; }
  }

  // Update crosshair elements
  const vline = document.getElementById(svgId + '-vline');
  const hline = document.getElementById(svgId + '-hline');
  const xlabel = document.getElementById(svgId + '-xlabel');
  const ylabel = document.getElementById(svgId + '-ylabel');
  const dot = document.getElementById(svgId + '-dot');

  vline.setAttribute('x1', nearest.x); vline.setAttribute('x2', nearest.x);
  vline.setAttribute('display', '');
  hline.setAttribute('y1', nearest.y); hline.setAttribute('y2', nearest.y);
  hline.setAttribute('display', '');
  xlabel.setAttribute('x', nearest.x);
  xlabel.textContent = nearest.date.slice(5);
  xlabel.setAttribute('display', '');
  ylabel.setAttribute('y', nearest.y + 4);
  ylabel.textContent = (nearest.rate * 100).toFixed(1) + '%';
  ylabel.setAttribute('display', '');
  dot.setAttribute('cx', nearest.x); dot.setAttribute('cy', nearest.y);
  dot.setAttribute('stroke', nearest.color);
  dot.setAttribute('display', '');
}

function pinSurvivalCrosshairHide(svgId) {
  ['vline','hline','xlabel','ylabel','dot'].forEach(suffix => {
    const el = document.getElementById(svgId + '-' + suffix);
    if (el) el.setAttribute('display', 'none');
  });
}

function renderMiniExposureSVG(series) {
  if (!series || series.length === 0) return '<div style="height:40px;color:#cbd5e1;font-size:10px;text-align:center;line-height:40px">无数据</div>';
  const W = 200, H = 40;
  const vals = series.map(s => s.exposure || 0);
  const max = Math.max(...vals, 1);
  const xStep = W / Math.max(vals.length - 1, 1);
  let path = '';
  vals.forEach((v, i) => {
    const x = i * xStep;
    const y = H - (v / max) * (H - 4) - 2;
    path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px">
    <path d="${path}" fill="none" stroke="#2563EB" stroke-width="1.5"/>
  </svg>`;
}

function renderBigChartSVG(series, pinDate, isRate) {
  const validSeries = series.filter(s => s.value != null);
  if (validSeries.length === 0) return '<div style="padding:40px;text-align:center;color:#94A3B8">该指标暂无数据</div>';

  const W = 820, H = 280, P = 50;
  const vals = validSeries.map(s => s.value);
  const max = Math.max(...vals, isRate ? 0.1 : 1);
  const min = 0;
  const xStep = (W - P*2) / Math.max(series.length - 1, 1);

  // 折线path
  let path = '';
  series.forEach((p, i) => {
    if (p.value == null) return;
    const x = P + i * xStep;
    const y = H - P - ((p.value - min) / (max - min)) * (H - P*2);
    path += (path ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  });

  // 置顶日竖线（日期可能不在序列里，找最近位置）
  let pinLine = '';
  if (pinDate) {
    let idx = series.findIndex(p => p.date === pinDate);
    if (idx < 0) {
      // 找第一个 >= pinDate 的位置
      idx = series.findIndex(p => p.date >= pinDate);
      if (idx < 0) idx = series.length - 1;
    }
    if (idx >= 0) {
      const x = P + idx * xStep;
      pinLine = `<line x1="${x}" y1="${P}" x2="${x}" y2="${H-P}" stroke="#DC2626" stroke-width="2" stroke-dasharray="4,3"/>
                 <text x="${x+4}" y="${P+14}" font-size="11" fill="#DC2626" font-weight="600">置顶 ${pinDate.slice(5)}</text>`;
    }
  }

  // Y轴grid（4档）
  const grids = [0.25, 0.5, 0.75, 1.0].map(r => {
    const v = max * r;
    const y = H - P - r * (H - P*2);
    return `<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="3,3"/>
            <text x="${P-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#94A3B8">${isRate ? (v*100).toFixed(1)+'%' : fmtPinNum(v)}</text>`;
  }).join('');

  // X轴labels（首中末 + 每隔N）
  const step = Math.max(1, Math.floor(series.length / 8));
  const xLabels = [];
  for (let i = 0; i < series.length; i += step) {
    const x = P + i * xStep;
    xLabels.push(`<text x="${x}" y="${H-P+16}" text-anchor="middle" font-size="10" fill="#64748B">${series[i].date.slice(5)}</text>`);
  }

  // 数据点
  const dots = series.map((p, i) => {
    if (p.value == null) return '';
    const x = P + i * xStep;
    const y = H - P - ((p.value - min) / (max - min)) * (H - P*2);
    const vStr = isRate ? (p.value*100).toFixed(1)+'%' : fmtPinNum(p.value);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#2563EB">
      <title>${p.date}: ${vStr}</title>
    </circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
    ${grids}
    ${pinLine}
    <path d="${path}" fill="none" stroke="#2563EB" stroke-width="2"/>
    ${dots}
    ${xLabels.join('')}
  </svg>`;
}

// ============================================================
// 格式化
// ============================================================
// 解析率值：'68.92%' → 0.6892, '0.0433' → 0.0433, '' → null
function parseRate(v) {
  if (v == null || v === '' || v === 'None' || v === 'NULL' || v === '<NA>') return null;
  const s = String(v).trim();
  if (s.endsWith('%')) {
    const n = parseFloat(s);
    return isNaN(n) ? null : n / 100;
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function fmtPinNum(v) {
  if (v == null || isNaN(v)) return '-';
  if (v >= 10000) return (v / 10000).toFixed(1) + 'w';
  return Math.round(v).toLocaleString('zh-CN');
}

function fmtPinPct(v) {
  if (v == null || isNaN(v)) return '-';
  return (v * 100).toFixed(1) + '%';
}
