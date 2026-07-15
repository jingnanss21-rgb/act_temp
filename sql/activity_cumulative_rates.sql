-- ============================================================
-- 活动转化率口径修正：为 v_activity_7d / v_activity_30d / v_activity_today
-- 增加“生命周期累计” pv/uv 列（*_cum），供前端计算与时间范围无关的转化率。
--
-- 背景：底表 tem_activity_daily 存“每日增量”。窗口内 SUM(redeem)/SUM(claim)
--   因领取/核销跨窗口边界错配而虚高（达美乐 50037: 30d=72.8% vs 生命周期 18.6%），
--   甚至 Σclaim=0、Σredeem>0 时出现无穷大。
-- 口径决定：转化率 = 全历史累计 redeem/claim（周期无关）；
--   数量（曝光/领取/核销）仍按窗口 SUM。
--
-- 实现：新增 cum CTE，对每个 (activity_id, brand_id) 在【全历史、无日期过滤】上
--   SUM 得累计值，LEFT JOIN 到既有窗口聚合；既有列/顺序/语义不变，仅末尾追加 6 列。
-- 注意：源数据无真正的“生命周期”字段（max_a0_cur_* 实为每日值），故累计=全历史每日增量求和。
--   活动若开始于最早快照(2026-04-14)之前，累计会低估领取、率偏高，源数据无法根治。
-- 幂等：三视图 DROP 后重建，并重新授权 anon / authenticated。
-- 在 Supabase (wiyarxoivfmkneumfmbl) SQL Editor 执行。
-- ============================================================

-- 支撑全历史累计聚合（幂等）
CREATE INDEX IF NOT EXISTS idx_activity_daily_actbrand
    ON tem_activity_daily (activity_id, brand_id);

-- ---------------- v_activity_7d ----------------
DROP VIEW IF EXISTS v_activity_7d;

CREATE VIEW v_activity_7d AS
WITH win AS (
    SELECT *
    FROM tem_activity_daily
    WHERE report_date >= (SELECT MAX(report_date) FROM tem_activity_daily) - INTERVAL '6 days'
),
agg AS (
    SELECT
        activity_id, brand_id,
        SUM(exposure_pv) AS exposure_pv,
        SUM(claim_pv)    AS claim_pv,
        SUM(redeem_pv)   AS redeem_pv,
        SUM(exposure_uv) AS exposure_uv,
        SUM(claim_uv)    AS claim_uv,
        SUM(redeem_uv)   AS redeem_uv,
        MAX(report_date) AS latest_date,
        COUNT(*)         AS day_count
    FROM win
    GROUP BY activity_id, brand_id
),
latest AS (
    SELECT DISTINCT ON (activity_id, brand_id)
        activity_id, brand_id, brand_name, category_name, activity_name,
        batch_name, price_power, start_date, end_date, total_stock, remain_stock,
        store_redeem_rate_uv, store_below_threshold, single_user_limit, daily_limit
    FROM win
    ORDER BY activity_id, brand_id, report_date DESC
),
cum AS (   -- 全历史累计，无日期过滤 = 生命周期总量
    SELECT
        activity_id, brand_id,
        SUM(exposure_pv) AS exposure_pv_cum,
        SUM(claim_pv)    AS claim_pv_cum,
        SUM(redeem_pv)   AS redeem_pv_cum,
        SUM(exposure_uv) AS exposure_uv_cum,
        SUM(claim_uv)    AS claim_uv_cum,
        SUM(redeem_uv)   AS redeem_uv_cum
    FROM tem_activity_daily
    GROUP BY activity_id, brand_id
)
SELECT
    a.activity_id, a.brand_id,
    l.brand_name, l.category_name, l.activity_name, l.batch_name, l.price_power,
    l.start_date, l.end_date, l.total_stock, l.remain_stock,
    a.exposure_pv, a.claim_pv, a.redeem_pv,
    a.exposure_uv, a.claim_uv, a.redeem_uv,
    l.store_redeem_rate_uv, l.store_below_threshold,
    a.latest_date, a.day_count,
    l.single_user_limit, l.daily_limit,
    c.exposure_pv_cum, c.claim_pv_cum, c.redeem_pv_cum,
    c.exposure_uv_cum, c.claim_uv_cum, c.redeem_uv_cum
FROM agg a
JOIN latest l USING (activity_id, brand_id)
LEFT JOIN cum c USING (activity_id, brand_id);

-- ---------------- v_activity_30d ----------------
DROP VIEW IF EXISTS v_activity_30d;

CREATE VIEW v_activity_30d AS
WITH win AS (
    SELECT *
    FROM tem_activity_daily
    WHERE report_date >= (SELECT MAX(report_date) FROM tem_activity_daily) - INTERVAL '29 days'
),
agg AS (
    SELECT
        activity_id, brand_id,
        SUM(exposure_pv) AS exposure_pv,
        SUM(claim_pv)    AS claim_pv,
        SUM(redeem_pv)   AS redeem_pv,
        SUM(exposure_uv) AS exposure_uv,
        SUM(claim_uv)    AS claim_uv,
        SUM(redeem_uv)   AS redeem_uv,
        MAX(report_date) AS latest_date,
        COUNT(*)         AS day_count
    FROM win
    GROUP BY activity_id, brand_id
),
latest AS (
    SELECT DISTINCT ON (activity_id, brand_id)
        activity_id, brand_id, brand_name, category_name, activity_name,
        batch_name, price_power, start_date, end_date, total_stock, remain_stock,
        store_redeem_rate_uv, store_below_threshold, single_user_limit, daily_limit
    FROM win
    ORDER BY activity_id, brand_id, report_date DESC
),
cum AS (
    SELECT
        activity_id, brand_id,
        SUM(exposure_pv) AS exposure_pv_cum,
        SUM(claim_pv)    AS claim_pv_cum,
        SUM(redeem_pv)   AS redeem_pv_cum,
        SUM(exposure_uv) AS exposure_uv_cum,
        SUM(claim_uv)    AS claim_uv_cum,
        SUM(redeem_uv)   AS redeem_uv_cum
    FROM tem_activity_daily
    GROUP BY activity_id, brand_id
)
SELECT
    a.activity_id, a.brand_id,
    l.brand_name, l.category_name, l.activity_name, l.batch_name, l.price_power,
    l.start_date, l.end_date, l.total_stock, l.remain_stock,
    a.exposure_pv, a.claim_pv, a.redeem_pv,
    a.exposure_uv, a.claim_uv, a.redeem_uv,
    l.store_redeem_rate_uv, l.store_below_threshold,
    a.latest_date, a.day_count,
    l.single_user_limit, l.daily_limit,
    c.exposure_pv_cum, c.claim_pv_cum, c.redeem_pv_cum,
    c.exposure_uv_cum, c.claim_uv_cum, c.redeem_uv_cum
FROM agg a
JOIN latest l USING (activity_id, brand_id)
LEFT JOIN cum c USING (activity_id, brand_id);

-- ---------------- v_activity_today ----------------
DROP VIEW IF EXISTS v_activity_today;

CREATE VIEW v_activity_today AS
WITH cum AS (
    SELECT
        activity_id, brand_id,
        SUM(exposure_pv) AS exposure_pv_cum,
        SUM(claim_pv)    AS claim_pv_cum,
        SUM(redeem_pv)   AS redeem_pv_cum,
        SUM(exposure_uv) AS exposure_uv_cum,
        SUM(claim_uv)    AS claim_uv_cum,
        SUM(redeem_uv)   AS redeem_uv_cum
    FROM tem_activity_daily
    GROUP BY activity_id, brand_id
)
SELECT
    t.*,
    c.exposure_pv_cum, c.claim_pv_cum, c.redeem_pv_cum,
    c.exposure_uv_cum, c.claim_uv_cum, c.redeem_uv_cum
FROM tem_activity_daily t
LEFT JOIN cum c USING (activity_id, brand_id)
WHERE t.report_date = (SELECT MAX(report_date) FROM tem_activity_daily);

-- 重新授权（视图重建后必须显式授权，防止前端 401）
GRANT SELECT ON v_activity_7d    TO anon, authenticated;
GRANT SELECT ON v_activity_30d   TO anon, authenticated;
GRANT SELECT ON v_activity_today TO anon, authenticated;

-- ============================================================
-- 验证：
--   SELECT COUNT(*) FROM v_activity_7d;   -- 行数应与改前一致（≈1023）
--   SELECT activity_id, claim_pv_cum, redeem_pv_cum,
--          ROUND(redeem_pv_cum::numeric / NULLIF(claim_pv_cum,0), 4) AS cum_rate
--   FROM v_activity_30d WHERE activity_id = '50037';   -- 期望 ≈ 0.186
-- ============================================================
