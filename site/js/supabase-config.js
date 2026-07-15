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

async function fetchAllFromView(viewName, select) {
  let all = [], offset = 0, limit = 1000;
  while (true) {
    const { data, error } = await supabaseClient.from(viewName).select(select || '*').range(offset, offset + limit - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < limit) break;
    offset += limit;
  }
  return all;
}
