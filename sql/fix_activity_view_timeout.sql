-- ============================================================
-- 修复：「行业最佳实践 / 品牌诊断」页首次打开偶发 500（语句超时 57014）
--
-- 现象：页面冷启动首次拉 v_activity_7d 报 500（Failed to load resource），
--   刷新几次预热后恢复。best-practice.js:190 catch 到并打印 error。
-- 根因：v_activity_* 视图的 cum 段对整张 tem_activity_daily 做
--   【全历史、无日期过滤】的 SUM 聚合，冷缓存下全表扫描耗时 > anon 角色
--   statement_timeout → PostgREST 返回 500。属文档 §4.2 记录的历史坑复发，
--   叠加近期 0720 大量删/重灌产生的死元组 + 过期统计信息而加剧。
--
-- 本迁移做三件事（幂等，可反复执行）：
--   1) 抬高 anon / authenticated 角色的 statement_timeout 到 20s，给冷查询留足空间；
--   2) 补齐支撑聚合的索引（若已存在则跳过）；
--   3) 刷新表统计信息，修正近期批量删改后的执行计划。
-- 在 Supabase (wiyarxoivfmkneumfmbl) SQL Editor 执行。
-- ============================================================

-- 1) 抬高角色语句超时（默认常为 3~8s，冷查询易触顶）
--    仅影响 REST 匿名/登录角色，不改全局。改后需等新连接生效（PostgREST 会重连）。
ALTER ROLE anon          SET statement_timeout = '20s';
ALTER ROLE authenticated SET statement_timeout = '20s';

-- 让 PostgREST 立即重载配置
NOTIFY pgrst, 'reload config';

-- 2) 支撑 cum 全历史聚合与 latest DISTINCT ON 的索引（幂等）
CREATE INDEX IF NOT EXISTS idx_activity_daily_actbrand
    ON tem_activity_daily (activity_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_activity_daily_actbrand_date
    ON tem_activity_daily (activity_id, brand_id, report_date DESC);

-- 3) 刷新统计信息（修正近期批量删/灌后的坏计划）
--    注意：VACUUM 不能在事务/迁移块里跑，如需彻底回收死元组，请单独执行：
--        VACUUM ANALYZE tem_activity_daily;
ANALYZE tem_activity_daily;

-- ============================================================
-- 验证：
--   -- 确认超时已抬高（新开一个 SQL 会话执行）
--   SHOW statement_timeout;
--   -- 视图可正常返回
--   SELECT COUNT(*) FROM v_activity_7d;      -- 预期 ≈2200+
--   -- 冷查询计时（首次执行应显著低于 20s）
--   EXPLAIN ANALYZE SELECT * FROM v_activity_7d;
-- ============================================================

-- ------------------------------------------------------------
-- 可选·进一步治本（若抬高超时后仍偶发慢）：把 cum 全历史累计物化，
-- 由同步任务每天 REFRESH，视图改 JOIN 物化表，彻底消除每次全表扫描。
-- ------------------------------------------------------------
-- CREATE MATERIALIZED VIEW IF NOT EXISTS mv_activity_cum AS
-- SELECT activity_id, brand_id,
--        SUM(exposure_pv) AS exposure_pv_cum, SUM(claim_pv) AS claim_pv_cum, SUM(redeem_pv) AS redeem_pv_cum,
--        SUM(exposure_uv) AS exposure_uv_cum, SUM(claim_uv) AS claim_uv_cum, SUM(redeem_uv) AS redeem_uv_cum
-- FROM tem_activity_daily GROUP BY activity_id, brand_id;
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_activity_cum ON mv_activity_cum (activity_id, brand_id);
-- GRANT SELECT ON mv_activity_cum TO anon, authenticated;
-- -- 同步任务末尾追加： REFRESH MATERIALIZED VIEW CONCURRENTLY mv_activity_cum;
-- -- 然后把三个视图里的 cum CTE 换成 SELECT ... FROM mv_activity_cum。
