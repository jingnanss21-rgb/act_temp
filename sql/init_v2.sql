-- ============================================================
-- V2 数据层：每日活动快照表 + 聚合视图
-- 执行方式：在 Supabase SQL Editor 中运行
-- ============================================================

-- 1. 新建每日活动快照表
CREATE TABLE IF NOT EXISTS tem_activity_daily (
    activity_id          TEXT        NOT NULL,
    brand_id             TEXT        NOT NULL,
    brand_name           TEXT,
    category_name        TEXT,
    activity_name        TEXT,
    batch_name           TEXT,
    price_power          NUMERIC,
    start_date           TEXT,
    end_date             TEXT,
    total_stock          BIGINT      DEFAULT 0,
    remain_stock         BIGINT      DEFAULT 0,
    exposure_pv          BIGINT      DEFAULT 0,
    claim_pv             BIGINT      DEFAULT 0,
    redeem_pv            BIGINT      DEFAULT 0,
    exposure_uv          BIGINT      DEFAULT 0,
    claim_uv             BIGINT      DEFAULT 0,
    redeem_uv            BIGINT      DEFAULT 0,
    store_redeem_rate_uv NUMERIC,
    store_below_threshold NUMERIC,
    report_date          DATE        NOT NULL,
    created_at           TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (activity_id, report_date)
);

-- 2. RLS policies
ALTER TABLE tem_activity_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select" ON tem_activity_daily FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON tem_activity_daily FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON tem_activity_daily FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete" ON tem_activity_daily FOR DELETE TO anon USING (true);

-- 3. 索引（加速按日期查询）
CREATE INDEX IF NOT EXISTS idx_activity_daily_date ON tem_activity_daily (report_date);
CREATE INDEX IF NOT EXISTS idx_activity_daily_brand ON tem_activity_daily (brand_id, report_date);

-- 4. 聚合视图：当日
CREATE OR REPLACE VIEW v_activity_today AS
SELECT *
FROM tem_activity_daily
WHERE report_date = (SELECT MAX(report_date) FROM tem_activity_daily);

-- 5. 聚合视图：近7日
CREATE OR REPLACE VIEW v_activity_7d AS
SELECT
    activity_id,
    brand_id,
    (ARRAY_AGG(brand_name ORDER BY report_date DESC))[1]     AS brand_name,
    (ARRAY_AGG(category_name ORDER BY report_date DESC))[1]  AS category_name,
    (ARRAY_AGG(activity_name ORDER BY report_date DESC))[1]  AS activity_name,
    (ARRAY_AGG(batch_name ORDER BY report_date DESC))[1]     AS batch_name,
    (ARRAY_AGG(price_power ORDER BY report_date DESC))[1]    AS price_power,
    (ARRAY_AGG(start_date ORDER BY report_date DESC))[1]     AS start_date,
    (ARRAY_AGG(end_date ORDER BY report_date DESC))[1]       AS end_date,
    (ARRAY_AGG(total_stock ORDER BY report_date DESC))[1]    AS total_stock,
    (ARRAY_AGG(remain_stock ORDER BY report_date DESC))[1]   AS remain_stock,
    SUM(exposure_pv)  AS exposure_pv,
    SUM(claim_pv)     AS claim_pv,
    SUM(redeem_pv)    AS redeem_pv,
    SUM(exposure_uv)  AS exposure_uv,
    SUM(claim_uv)     AS claim_uv,
    SUM(redeem_uv)    AS redeem_uv,
    (ARRAY_AGG(store_redeem_rate_uv ORDER BY report_date DESC))[1]  AS store_redeem_rate_uv,
    (ARRAY_AGG(store_below_threshold ORDER BY report_date DESC))[1] AS store_below_threshold,
    MAX(report_date)  AS latest_date,
    COUNT(*)          AS day_count
FROM tem_activity_daily
WHERE report_date >= (SELECT MAX(report_date) FROM tem_activity_daily) - INTERVAL '6 days'
GROUP BY activity_id, brand_id;

-- 6. 聚合视图：近30日
CREATE OR REPLACE VIEW v_activity_30d AS
SELECT
    activity_id,
    brand_id,
    (ARRAY_AGG(brand_name ORDER BY report_date DESC))[1]     AS brand_name,
    (ARRAY_AGG(category_name ORDER BY report_date DESC))[1]  AS category_name,
    (ARRAY_AGG(activity_name ORDER BY report_date DESC))[1]  AS activity_name,
    (ARRAY_AGG(batch_name ORDER BY report_date DESC))[1]     AS batch_name,
    (ARRAY_AGG(price_power ORDER BY report_date DESC))[1]    AS price_power,
    (ARRAY_AGG(start_date ORDER BY report_date DESC))[1]     AS start_date,
    (ARRAY_AGG(end_date ORDER BY report_date DESC))[1]       AS end_date,
    (ARRAY_AGG(total_stock ORDER BY report_date DESC))[1]    AS total_stock,
    (ARRAY_AGG(remain_stock ORDER BY report_date DESC))[1]   AS remain_stock,
    SUM(exposure_pv)  AS exposure_pv,
    SUM(claim_pv)     AS claim_pv,
    SUM(redeem_pv)    AS redeem_pv,
    SUM(exposure_uv)  AS exposure_uv,
    SUM(claim_uv)     AS claim_uv,
    SUM(redeem_uv)    AS redeem_uv,
    (ARRAY_AGG(store_redeem_rate_uv ORDER BY report_date DESC))[1]  AS store_redeem_rate_uv,
    (ARRAY_AGG(store_below_threshold ORDER BY report_date DESC))[1] AS store_below_threshold,
    MAX(report_date)  AS latest_date,
    COUNT(*)          AS day_count
FROM tem_activity_daily
WHERE report_date >= (SELECT MAX(report_date) FROM tem_activity_daily) - INTERVAL '29 days'
GROUP BY activity_id, brand_id;
