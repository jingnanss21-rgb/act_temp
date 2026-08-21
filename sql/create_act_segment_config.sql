-- ============================================================
-- 人群覆盖配置表（活动级静态属性）
-- 数据来源：iwiki「餐饮活动全字段数据（131列）」docid 4026097627
-- 抽取字段：定向标签_频次正选 / 定向标签_频次排除
-- 同步脚本：sync/pull_segments.py（iwiki-cli 拉最新CSV → 抽取 → upsert）
-- 执行方式：Supabase SQL Editor（部署时执行，本文件不自动跑）
-- ============================================================

CREATE TABLE IF NOT EXISTS act_segment_config (
    activity_id   TEXT        PRIMARY KEY,
    freq_include  TEXT,       -- 定向标签_频次正选（逗号分隔：高频,低频,沉默,流失）
    freq_exclude  TEXT,       -- 定向标签_频次排除（逗号分隔：排除高频,排除低频...）
    updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE act_segment_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON act_segment_config FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON act_segment_config FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON act_segment_config FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete" ON act_segment_config FOR DELETE TO anon USING (true);

CREATE INDEX IF NOT EXISTS idx_act_segment_config_updated ON act_segment_config (updated_at);
