-- ============================================================
-- 活动运营看板 - Supabase 建表 SQL
-- 所有表名加 tem_ 前缀
-- 执行方式：复制到 Supabase SQL Editor 运行
-- ============================================================

-- 1. tem_activities：活动维度明细（以 activity_id + report_date 为联合主键）
CREATE TABLE IF NOT EXISTS tem_activities (
    activity_id     TEXT        NOT NULL,
    brand_id        TEXT        NOT NULL,
    brand_name      TEXT,
    activity_name   TEXT,
    exposure_pv     BIGINT      DEFAULT 0,   -- 活动曝光次数(加和)
    claim_pv        BIGINT      DEFAULT 0,   -- 领取次数(加和)
    redeem_pv       BIGINT      DEFAULT 0,   -- 核销次数(加和)
    exposure_uv     BIGINT      DEFAULT 0,   -- 曝光用户数(加和)
    claim_uv        BIGINT      DEFAULT 0,   -- 领取用户数(加和)
    redeem_uv       BIGINT      DEFAULT 0,   -- 核销用户数(加和)
    start_date      TEXT,                     -- 投放开始时间
    end_date        TEXT,                     -- 投放结束时间
    report_date     DATE        NOT NULL,     -- 日报日期
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (activity_id, report_date)
);

COMMENT ON TABLE tem_activities IS '活动维度明细，来源：日报活动导览链接的普通sheet';

-- 2. tem_brand_daily：品牌日报详情（brand_id + report_date 联合主键）
CREATE TABLE IF NOT EXISTS tem_brand_daily (
    brand_id                        TEXT    NOT NULL,
    report_date                     DATE    NOT NULL,
    brand_name                      TEXT,
    category_l1                     TEXT,    -- 一级类目名称
    category_l2                     TEXT,    -- 二级类目名称
    category_l4_id                  TEXT,    -- 四级类目ID
    category_l4                     TEXT,    -- 四级类目名称
    brand_tier                      TEXT,    -- 品牌分层
    is_online_today                 TEXT,    -- 当日是否在线
    store_count                     TEXT,    -- 审核通过门店数
    online_days_w7                  TEXT,    -- 近7日_在线天数
    activity_count_w7               TEXT,    -- 近7日_活动数
    is_alive_w7                     TEXT,    -- 近7日_是否存活
    survival_rate_w7                TEXT,    -- 近7日_存活率
    price_power_w7                  TEXT,    -- 近7日_价格力

    -- 门店数/交易/小程序
    w7_avg_txn_count                TEXT,    -- 近7日均_笔数(w)
    w7_avg_txn_count_mini           TEXT,    -- 近7日均_笔数(w)_小程序
    w7_mini_program_ratio           TEXT,    -- 近7日_小程序交易占比
    w7_avg_store_txn                TEXT,    -- 近7日均_一店几笔
    w7_avg_store_redeem             TEXT,    -- 近7日均_一店几核
    w7_avg_model_predict            TEXT,    -- 近7日均_模型预测交易笔数

    -- 当日 PV 数据
    daily_exposure_pv               TEXT,    -- 当日_曝光PV(w)
    daily_claim_pv                  TEXT,    -- 当日_领取PV(w)
    daily_redeem_pv                 TEXT,    -- 当日_核销PV

    -- 当日各渠道 曝光PV
    daily_exposure_pv_fixed         TEXT,    -- 当日_曝光PV(w)_固定入口
    daily_exposure_pv_commercial    TEXT,    -- 当日_曝光PV(w)_商业支付
    daily_exposure_pv_nearby        TEXT,    -- 当日_曝光PV(w)_周边
    daily_exposure_pv_f2f           TEXT,    -- 当日_曝光PV(w)_面对面
    daily_exposure_pv_reward        TEXT,    -- 当日_曝光PV(w)_支付有礼
    daily_exposure_pv_other         TEXT,    -- 当日_曝光PV(w)_其他

    -- 当日各渠道 领取PV
    daily_claim_pv_fixed            TEXT,    -- 当日_领取PV(w)_固定入口
    daily_claim_pv_commercial       TEXT,    -- 当日_领取PV(w)_商业支付
    daily_claim_pv_nearby           TEXT,    -- 当日_领取PV(w)_周边
    daily_claim_pv_f2f              TEXT,    -- 当日_领取PV(w)_面对面
    daily_claim_pv_reward           TEXT,    -- 当日_领取PV(w)_支付有礼
    daily_claim_pv_other            TEXT,    -- 当日_领取PV(w)_其他

    -- 当日各渠道 核销PV
    daily_redeem_pv_fixed           TEXT,    -- 当日_核销PV_固定入口
    daily_redeem_pv_commercial      TEXT,    -- 当日_核销PV_商业支付
    daily_redeem_pv_nearby          TEXT,    -- 当日_核销PV_周边
    daily_redeem_pv_f2f             TEXT,    -- 当日_核销PV_面对面
    daily_redeem_pv_reward          TEXT,    -- 当日_核销PV_支付有礼
    daily_redeem_pv_other           TEXT,    -- 当日_核销PV_其他

    -- 当日转化率
    daily_exposure_claim_rate       TEXT,    -- 当日_曝光领取率
    daily_claim_redeem_rate         TEXT,    -- 当日_领取核销率
    daily_exposure_redeem_rate      TEXT,    -- 当日_曝光核销率

    -- 当日各渠道 曝光核销率
    daily_exp_redeem_fixed          TEXT,    -- 当日_曝光核销率_固定入口
    daily_exp_redeem_commercial     TEXT,    -- 当日_曝光核销率_商业支付
    daily_exp_redeem_nearby         TEXT,    -- 当日_曝光核销率_周边
    daily_exp_redeem_f2f            TEXT,    -- 当日_曝光核销率_面对面
    daily_exp_redeem_reward         TEXT,    -- 当日_曝光核销率_支付有礼
    daily_exp_redeem_other          TEXT,    -- 当日_曝光核销率_其他

    -- 近7日均 PV 数据
    w7_avg_exposure_pv              TEXT,    -- 近7日均_曝光PV(w)
    w7_avg_claim_pv                 TEXT,    -- 近7日均_领取PV(w)
    w7_avg_redeem_pv                TEXT,    -- 近7日均_核销PV

    -- 近7日均各渠道 曝光PV
    w7_avg_exposure_pv_fixed        TEXT,    -- 近7日均_曝光PV(w)_固定入口
    w7_avg_exposure_pv_commercial   TEXT,    -- 近7日均_曝光PV(w)_商业支付
    w7_avg_exposure_pv_nearby       TEXT,    -- 近7日均_曝光PV(w)_周边
    w7_avg_exposure_pv_f2f          TEXT,    -- 近7日均_曝光PV(w)_面对面
    w7_avg_exposure_pv_reward       TEXT,    -- 近7日均_曝光PV(w)_支付有礼
    w7_avg_exposure_pv_other        TEXT,    -- 近7日均_曝光PV(w)_其他

    -- 近7日均各渠道 领取PV
    w7_avg_claim_pv_fixed           TEXT,    -- 近7日均_领取PV(w)_固定入口
    w7_avg_claim_pv_commercial      TEXT,    -- 近7日均_领取PV(w)_商业支付
    w7_avg_claim_pv_nearby          TEXT,    -- 近7日均_领取PV(w)_周边
    w7_avg_claim_pv_f2f             TEXT,    -- 近7日均_领取PV(w)_面对面
    w7_avg_claim_pv_reward          TEXT,    -- 近7日均_领取PV(w)_支付有礼
    w7_avg_claim_pv_other           TEXT,    -- 近7日均_领取PV(w)_其他

    -- 近7日均各渠道 核销PV
    w7_avg_redeem_pv_fixed          TEXT,    -- 近7日均_核销PV_固定入口
    w7_avg_redeem_pv_commercial     TEXT,    -- 近7日均_核销PV_商业支付
    w7_avg_redeem_pv_nearby         TEXT,    -- 近7日均_核销PV_周边
    w7_avg_redeem_pv_f2f            TEXT,    -- 近7日均_核销PV_面对面
    w7_avg_redeem_pv_reward         TEXT,    -- 近7日均_核销PV_支付有礼
    w7_avg_redeem_pv_other          TEXT,    -- 近7日均_核销PV_其他

    -- 近7日转化率
    w7_exposure_claim_rate          TEXT,    -- 近7日_曝光领取率
    w7_claim_redeem_rate            TEXT,    -- 近7日_领取核销率
    w7_exposure_redeem_rate         TEXT,    -- 近7日_曝光核销率

    -- 近7日各渠道 曝光核销率
    w7_exp_redeem_fixed             TEXT,    -- 近7日_曝光核销率_固定入口
    w7_exp_redeem_commercial        TEXT,    -- 近7日_曝光核销率_商业支付
    w7_exp_redeem_nearby            TEXT,    -- 近7日_曝光核销率_周边
    w7_exp_redeem_f2f               TEXT,    -- 近7日_曝光核销率_面对面
    w7_exp_redeem_reward            TEXT,    -- 近7日_曝光核销率_支付有礼
    w7_exp_redeem_other             TEXT,    -- 近7日_曝光核销率_其他

    -- 到店相关
    w7_store_redeem_rate_uv         TEXT,    -- 近7日_到店核销率UV
    w7_store_redeem_rate_uv_mini    TEXT,    -- 近7日_到店核销率UV_小程序
    w7_claim_to_store_rate_uv       TEXT,    -- 近7日_领取到店率UV
    w7_claim_to_store_uv            TEXT,    -- 近7日_领取到店UV
    w7_claim_to_store_uv_mini       TEXT,    -- 近7日_领取到店UV_小程序
    w7_store_claim_rate_uv          TEXT,    -- 近7日_到店领取率UV
    w7_redeem_to_store_rate_pv      TEXT,    -- 近7日_核销到店率PV

    -- 尽曝相关
    w7_high_freq_exposure_uv        TEXT,    -- 近7日_高频尽曝UV
    w7_high_freq_should_uv          TEXT,    -- 近7日_高频应曝UV
    w7_high_freq_rate_uv            TEXT,    -- 近7日_高频应曝尽曝率_UV
    w7_high_freq_rate_uv_dual       TEXT,    -- 近7日_高频应曝尽曝率UV_二选一
    w7_high_freq_should_uv_dual     TEXT,    -- 近7日_高频应曝UV_二选一渠道
    w7_high_freq_exposure_uv_dual   TEXT,    -- 近7日_高频尽曝UV_二选一渠道
    w7_low_freq_exposure_uv         TEXT,    -- 近7日_低频尽曝UV
    w7_low_freq_should_uv           TEXT,    -- 近7日_低频应曝UV
    w7_low_freq_rate_uv             TEXT,    -- 近7日_低频应曝尽曝率_UV
    w7_low_freq_rate_uv_dual        TEXT,    -- 近7日_低频应曝尽曝率UV_二选一
    w7_low_freq_should_uv_dual      TEXT,    -- 近7日_低频应曝UV_二选一渠道
    w7_low_freq_exposure_uv_dual    TEXT,    -- 近7日_低频尽曝UV_二选一渠道

    -- 序号
    seq_no                          TEXT,    -- 序号

    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (brand_id, report_date)
);

COMMENT ON TABLE tem_brand_daily IS '品牌日报详情，来源：日报品牌详情链接的品牌日报smartsheet';

-- 3. tem_merchant_contacts：商户对接信息
CREATE TABLE IF NOT EXISTS tem_merchant_contacts (
    brand_id            TEXT        PRIMARY KEY,
    brand_name          TEXT,
    operating_sp        TEXT,        -- 经营服务商
    coupon_sp           TEXT,        -- 制券服务商
    contact_assistant   TEXT,        -- 对接助理
    brand_status        TEXT,        -- 品牌状态(在线/流失/筹备中)
    brand_tier          TEXT,        -- 分层
    coupon_type         TEXT,        -- 券类型
    update_time         TEXT,        -- 更新时间
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE tem_merchant_contacts IS '商户对接信息，来源：商户对接smartsheet';

-- 4. tem_sp_assignments：服务商分工
CREATE TABLE IF NOT EXISTS tem_sp_assignments (
    sp_name             TEXT        PRIMARY KEY,
    category            TEXT,        -- 分类(SaaS服务商/经营服务商)
    target_merchants    TEXT,        -- 目标引入腰部商户数量
    owner               TEXT,        -- 负责人
    rebate_policy       TEXT,        -- 是否报名返佣政策
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE tem_sp_assignments IS '服务商分工，来源：服务商分工smartsheet';

-- 5. tem_ka_assignments：KA分工
CREATE TABLE IF NOT EXISTS tem_ka_assignments (
    brand_id                TEXT    PRIMARY KEY,
    category                TEXT,    -- 品类
    brand_name              TEXT,    -- 品牌
    owner                   TEXT,    -- 负责人
    txn_25y                 TEXT,    -- 25年交易(w笔)
    mini_txn_25y            TEXT,    -- 25年小程序(w笔)
    order_penetration_25y   TEXT,    -- 25年点餐渗透率(%)
    market_penetration_target TEXT,  -- 大盘渗透目标(%)
    redeem_target           TEXT,    -- 核销目标
    conversion_target       TEXT,    -- 转化率目标(%)
    exposure_target         TEXT,    -- 曝光目标(w)
    surprise_target         TEXT,    -- 惊喜货盘目标
    online_surprise         TEXT,    -- 在线惊喜货盘
    goods_content           TEXT,    -- 货盘内容
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE tem_ka_assignments IS 'KA分工，来源：KA分工smartsheet';

-- ============================================================
-- 视图：tem_v_activity_detail
-- 活动明细 LEFT JOIN 品牌日报，取最新日期的品牌日报数据
-- ============================================================
CREATE OR REPLACE VIEW tem_v_activity_detail AS
SELECT
    a.activity_id,
    a.brand_id,
    a.brand_name,
    a.activity_name,
    a.exposure_pv,
    a.claim_pv,
    a.redeem_pv,
    a.exposure_uv,
    a.claim_uv,
    a.redeem_uv,
    a.start_date,
    a.end_date,
    a.report_date,
    b.category_l1,
    b.category_l2,
    b.store_count,
    b.w7_avg_txn_count,
    b.w7_mini_program_ratio,
    b.w7_store_redeem_rate_uv,
    b.w7_exposure_claim_rate,
    b.w7_claim_redeem_rate,
    b.w7_exposure_redeem_rate
FROM tem_activities a
LEFT JOIN LATERAL (
    SELECT *
    FROM tem_brand_daily bd
    WHERE bd.brand_id = a.brand_id
    ORDER BY bd.report_date DESC
    LIMIT 1
) b ON true;

COMMENT ON VIEW tem_v_activity_detail IS '活动明细视图，关联品牌日报最新数据，供看板模块2查询';

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tem_activities_brand     ON tem_activities(brand_id);
CREATE INDEX IF NOT EXISTS idx_tem_activities_date      ON tem_activities(report_date);
CREATE INDEX IF NOT EXISTS idx_tem_brand_daily_brand    ON tem_brand_daily(brand_id);
CREATE INDEX IF NOT EXISTS idx_tem_brand_daily_date     ON tem_brand_daily(report_date);
CREATE INDEX IF NOT EXISTS idx_tem_brand_daily_cat      ON tem_brand_daily(category_l1);
CREATE INDEX IF NOT EXISTS idx_tem_merchant_brand       ON tem_merchant_contacts(brand_id);
CREATE INDEX IF NOT EXISTS idx_tem_ka_brand             ON tem_ka_assignments(brand_id);

-- ============================================================
-- RLS：启用行级安全并允许 anon 角色 SELECT
-- ============================================================
ALTER TABLE tem_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_tem_activities" ON tem_activities FOR SELECT TO anon USING (true);

ALTER TABLE tem_brand_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_tem_brand_daily" ON tem_brand_daily FOR SELECT TO anon USING (true);

ALTER TABLE tem_merchant_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_tem_merchant_contacts" ON tem_merchant_contacts FOR SELECT TO anon USING (true);

ALTER TABLE tem_sp_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_tem_sp_assignments" ON tem_sp_assignments FOR SELECT TO anon USING (true);

ALTER TABLE tem_ka_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_tem_ka_assignments" ON tem_ka_assignments FOR SELECT TO anon USING (true);

-- ============================================================
-- 完成
-- ============================================================
-- 执行完毕后，在 Supabase Table Editor 可以看到 5 张 tem_ 开头的表
-- 视图 tem_v_activity_detail 可在 SQL Editor 中用 SELECT * FROM tem_v_activity_detail LIMIT 10 验证
