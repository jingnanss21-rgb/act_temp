/**
 * supabase-config.js - Supabase 连接配置
 */
const SUPABASE_URL = 'https://wiyarxoivfmkneumfmbl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpeWFyeG9pdmZta25ldW1mbWJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTExMDYsImV4cCI6MjA5MDk2NzEwNn0.jo1GoR3ZuFv2HFZcVoOKpVb19SBUIHZL3EoR266njU4';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// V2 全局时间周期
// ============================================================
window.currentPeriod = '7d'; // 'today' | '7d' | '30d'
window.currentMetricType = 'uv'; // 'uv' | 'pv'

// 根据当前口径取曝光/领取/核销值
function getMetricVals(act) {
  const t = window.currentMetricType || 'uv';
  return {
    exposure: t === 'uv' ? (act.exposure_uv || 0) : (act.exposure_pv || 0),
    claim:    t === 'uv' ? (act.claim_uv || 0)    : (act.claim_pv || 0),
    redeem:   t === 'uv' ? (act.redeem_uv || 0)   : (act.redeem_pv || 0),
    label:    t === 'uv' ? '人数' : '次数',
    tag:      t.toUpperCase(),
  };
}

// 转化率基数：活动生命周期累计 pv/uv（与时间范围无关），按当前 UV/PV 口径返回。
// 说明：底表存每日增量，窗口内 Σredeem/Σclaim 因领取/核销跨窗口错配而虚高；
//       转化率一律用本函数（*_cum，视图内全历史累计），数量展示仍用窗口 getMetricVals。
function getRateBasis(act) {
  const t = window.currentMetricType || 'uv';
  if (t === 'uv') {
    return { exposure: act.exposure_uv_cum || 0, claim: act.claim_uv_cum || 0, redeem: act.redeem_uv_cum || 0 };
  }
  return { exposure: act.exposure_pv_cum || 0, claim: act.claim_pv_cum || 0, redeem: act.redeem_pv_cum || 0 };
}

function getViewName() {
  const p = window.currentPeriod || '7d';
  if (p === 'today') return 'v_activity_today';
  if (p === '30d') return 'v_activity_30d';
  return 'v_activity_7d';
}

// 判断是否为「冷缓存语句超时」类可重试错误
// 重活动视图(v_activity_*)含全历史 SUM，首次冷查询常超过 statement_timeout → PostgREST 返回 500 / 57014。
// 预热后 0.7~1s 即可成功，故对这类错误做指数退避重试，避免页面首次打开报错。
function isRetryableDbError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const status = error.status || error.statusCode;
  const msg = String(error.message || '').toLowerCase();
  return code === '57014' || status === 500 || status === 503 || status === 504 ||
    msg.includes('timeout') || msg.includes('canceling statement') || msg.includes('statement timeout');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllFromView(viewName, select) {
  let all = [], offset = 0, limit = 1000;
  const MAX_RETRY = 4;                 // 每页最多重试次数
  const BACKOFFS = [800, 1600, 2800, 4000]; // 退避毫秒
  while (true) {
    let data = null, lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      const res = await supabaseClient.from(viewName).select(select || '*').range(offset, offset + limit - 1);
      if (!res.error) { data = res.data; lastErr = null; break; }
      lastErr = res.error;
      if (attempt < MAX_RETRY && isRetryableDbError(res.error)) {
        console.warn(`[fetchAllFromView] ${viewName} 第${attempt + 1}次超时(可重试)，退避后重试…`, res.error.code || res.error.message);
        await sleep(BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)]);
        continue;
      }
      break; // 不可重试或重试用尽
    }
    if (lastErr) throw lastErr;
    all = all.concat(data || []);
    if (!data || data.length < limit) break;
    offset += limit;
  }
  return all;
}
