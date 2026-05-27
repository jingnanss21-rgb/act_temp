-- ============================================================
-- 在 tem_activity_daily 增加单用户限领、单日限领两个字段
-- 并更新 v_activity_today / v_activity_7d / v_activity_30d 视图
-- 在 Supabase SQL Editor 执行（一次性）
--
-- 注意：Postgres 的 CREATE OR REPLACE VIEW 不允许在中间插列/改列顺序，
-- 只能在末尾追加。所以新字段加在视图最末，且 7d/30d 视图先 DROP 再 CREATE。
-- ============================================================

-- 1. 加列（IF NOT EXISTS 保证幂等）
ALTER TABLE tem_activity_daily
    ADD COLUMN IF NOT EXISTS single_user_limit BIGINT,
    ADD COLUMN IF NOT EXISTS daily_limit       BIGINT;

-- 2. v_activity_today 用 SELECT *，自动包含新列。可直接 OR REPLACE。
CREATE OR REPLACE VIEW v_activity_today AS
SELECT *
FROM tem_activity_daily
WHERE report_date = (SELECT MAX(report_date) FROM tem_activity_daily);

-- 3. v_activity_7d：先 DROP 再重建（因为要加列到末尾）
DROP VIEW IF EXISTS v_activity_7d;

CREATE VIEW v_activity_7d AS
SELECT
    activity_id,
    brand_id,
    (ARRAY_AGG(brand_name        ORDER BY report_date DESC))[1] AS brand_name,
    (ARRAY_AGG(category_name     ORDER BY report_date DESC))[1] AS category_name,
    (ARRAY_AGG(activity_name     ORDER BY report_date DESC))[1] AS activity_name,
    (ARRAY_AGG(batch_name        ORDER BY report_date DESC))[1] AS batch_name,
    (ARRAY_AGG(price_power       ORDER BY report_date DESC))[1] AS price_power,
    (ARRAY_AGG(start_date        ORDER BY report_date DESC))[1] AS start_date,
    (ARRAY_AGG(end_date          ORDER BY report_date DESC))[1] AS end_date,
    (ARRAY_AGG(total_stock       ORDER BY report_date DESC))[1] AS total_stock,
    (ARRAY_AGG(remain_stock      ORDER BY report_date DESC))[1] AS remain_stock,
    SUM(exposure_pv) AS exposure_pv,
    SUM(claim_pv)    AS claim_pv,
    SUM(redeem_pv)   AS redeem_pv,
    SUM(exposure_uv) AS exposure_uv,
    SUM(claim_uv)    AS claim_uv,
    SUM(redeem_uv)   AS redeem_uv,
    (ARRAY_AGG(store_redeem_rate_uv  ORDER BY report_date DESC))[1] AS store_redeem_rate_uv,
    (ARRAY_AGG(store_below_threshold ORDER BY report_date DESC))[1] AS store_below_threshold,
    MAX(report_date) AS latest_date,
    COUNT(*)         AS day_count,
    -- 末尾追加新列
    (ARRAY_AGG(single_user_limit ORDER BY report_date DESC))[1] AS single_user_limit,
    (ARRAY_AGG(daily_limit       ORDER BY report_date DESC))[1] AS daily_limit
FROM tem_activity_daily
WHERE report_date >= (SELECT MAX(report_date) FROM tem_activity_daily) - INTERVAL '6 days'
GROUP BY activity_id, brand_id;

-- 4. v_activity_30d：同样先 DROP 再重建
DROP VIEW IF EXISTS v_activity_30d;

CREATE VIEW v_activity_30d AS
SELECT
    activity_id,
    brand_id,
    (ARRAY_AGG(brand_name        ORDER BY report_date DESC))[1] AS brand_name,
    (ARRAY_AGG(category_name     ORDER BY report_date DESC))[1] AS category_name,
    (ARRAY_AGG(activity_name     ORDER BY report_date DESC))[1] AS activity_name,
    (ARRAY_AGG(batch_name        ORDER BY report_date DESC))[1] AS batch_name,
    (ARRAY_AGG(price_power       ORDER BY report_date DESC))[1] AS price_power,
    (ARRAY_AGG(start_date        ORDER BY report_date DESC))[1] AS start_date,
    (ARRAY_AGG(end_date          ORDER BY report_date DESC))[1] AS end_date,
    (ARRAY_AGG(total_stock       ORDER BY report_date DESC))[1] AS total_stock,
    (ARRAY_AGG(remain_stock      ORDER BY report_date DESC))[1] AS remain_stock,
    SUM(exposure_pv) AS exposure_pv,
    SUM(claim_pv)    AS claim_pv,
    SUM(redeem_pv)   AS redeem_pv,
    SUM(exposure_uv) AS exposure_uv,
    SUM(claim_uv)    AS claim_uv,
    SUM(redeem_uv)   AS redeem_uv,
    (ARRAY_AGG(store_redeem_rate_uv  ORDER BY report_date DESC))[1] AS store_redeem_rate_uv,
    (ARRAY_AGG(store_below_threshold ORDER BY report_date DESC))[1] AS store_below_threshold,
    MAX(report_date) AS latest_date,
    COUNT(*)         AS day_count,
    -- 末尾追加新列
    (ARRAY_AGG(single_user_limit ORDER BY report_date DESC))[1] AS single_user_limit,
    (ARRAY_AGG(daily_limit       ORDER BY report_date DESC))[1] AS daily_limit
FROM tem_activity_daily
WHERE report_date >= (SELECT MAX(report_date) FROM tem_activity_daily) - INTERVAL '29 days'
GROUP BY activity_id, brand_id;

-- ============================================================
-- 验证（执行完后跑一下确认无误）
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'tem_activity_daily' AND column_name IN ('single_user_limit','daily_limit');
--
-- SELECT activity_id, brand_name, single_user_limit, daily_limit
-- FROM v_activity_7d LIMIT 5;
