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
