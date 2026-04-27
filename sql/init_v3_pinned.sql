-- ============================================================
-- V3 置顶分析 数据层
-- 执行方式：Supabase SQL Editor
-- ============================================================

-- 1. 置顶操作记录
CREATE TABLE IF NOT EXISTS tem_pinned_ops (
    brand_id        TEXT        PRIMARY KEY,
    brand_name      TEXT,
    pin_date        DATE        NOT NULL,
    row_creator     TEXT,
    strategy_id     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tem_pinned_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON tem_pinned_ops FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON tem_pinned_ops FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON tem_pinned_ops FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete" ON tem_pinned_ops FOR DELETE TO anon USING (true);

-- 2. 腰部品牌达标标记
CREATE TABLE IF NOT EXISTS tem_waist_qualified (
    brand_id          TEXT        PRIMARY KEY,
    brand_name        TEXT,
    operating_sp      TEXT,
    category          TEXT,
    is_qualified      TEXT,  -- "达标" / "未达标"
    qualified_type    TEXT,  -- 达标分类
    manual_feedback   TEXT,  -- 人工打标反馈
    is_alive          TEXT,  -- "存活" / "未存活"
    old_user_should_uv_w7  BIGINT,
    updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tem_waist_qualified ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON tem_waist_qualified FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON tem_waist_qualified FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON tem_waist_qualified FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete" ON tem_waist_qualified FOR DELETE TO anon USING (true);

-- 3. 人工备注
CREATE TABLE IF NOT EXISTS tem_pinned_notes (
    brand_id     TEXT        PRIMARY KEY,
    note         TEXT,
    updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tem_pinned_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON tem_pinned_notes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON tem_pinned_notes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON tem_pinned_notes FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete" ON tem_pinned_notes FOR DELETE TO anon USING (true);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pinned_ops_date ON tem_pinned_ops (pin_date);
CREATE INDEX IF NOT EXISTS idx_waist_qualified ON tem_waist_qualified (is_qualified, is_alive);
