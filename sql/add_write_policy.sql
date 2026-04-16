-- 给 anon 角色添加 INSERT/UPDATE 权限（数据同步用）
-- 在 Supabase SQL Editor 执行

-- tem_activities
CREATE POLICY "anon_write_tem_activities" ON tem_activities FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tem_activities" ON tem_activities FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- tem_brand_daily
CREATE POLICY "anon_write_tem_brand_daily" ON tem_brand_daily FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tem_brand_daily" ON tem_brand_daily FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- tem_merchant_contacts
CREATE POLICY "anon_write_tem_merchant_contacts" ON tem_merchant_contacts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tem_merchant_contacts" ON tem_merchant_contacts FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- tem_sp_assignments
CREATE POLICY "anon_write_tem_sp_assignments" ON tem_sp_assignments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tem_sp_assignments" ON tem_sp_assignments FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- tem_ka_assignments
CREATE POLICY "anon_write_tem_ka_assignments" ON tem_ka_assignments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tem_ka_assignments" ON tem_ka_assignments FOR UPDATE TO anon USING (true) WITH CHECK (true);
