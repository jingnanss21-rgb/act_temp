# 腾讯文档ID 速查表

## 快速查询

| 用途 | 文档ID | 字段/内容 | 脚本 | 目标表 |
|------|--------|--------|------|--------|
| 活动导览(两跳源) | `DWWhYU3FrWXhuSHhu` | A列:导览索引, B列:超链接 | sync_all.py<br/>sync_v2.py | tem_activities<br/>tem_activity_daily |
| 品牌导览(两跳源) | `DWENVYUF5ekVPc1R3` | A列:导览索引, B列:超链接 | sync_all.py | tem_brand_daily |
| 商户跟进 | `DWUxvdFNHQXpWd0ZO` | 品牌ID/名/SP/对接人/分层 | sync_all.py | tem_merchant_contacts |
| 服务商分工 | `DWVRiUGNCTUJhTHVv` | 服务商/分类/目标数量 | sync_all.py | tem_sp_assignments |
| KA分工 | `DWU9VWmZ0UWphWG9J` | 品牌/KA/负责人/交易目标 | sync_all.py | tem_ka_assignments |
| 置顶操作 | `DWW1oUktoeUVzUGx2` | 品牌ID/置顶时间(G列) | sync_pinned.py | tem_pinned_ops |
| 腰部达标 | `DWXV0R3dNekVGS1hk` | 品牌/达标状态/反馈 | sync_pinned.py | tem_waist_qualified |

---

## 核心概念

### 两跳流程（导览表 → 数据表）
```
DWWhYU3FrWXhuSHhu (导览索引表)
  ↓ [MCP export_file导出xlsx]
  ↓ [extract_hyperlinks提取超链接]
  ↓ [提取file_id]
多个数据表 (来自导览超链接)
  ↓ [MCP export_file逐张导出]
  ↓ [parse_xlsx_rows解析]
tem_activities / tem_activity_daily
```

### 单表直读（无导览）
```
DWUxvdFNHQXpWd0ZO (直接是数据表)
  ↓ [MCP export_file导出]
  ↓ [parse_xlsx_rows解析]
tem_merchant_contacts
```

---

## 脚本执行矩阵

```
sync_all.py
  ├─ 读 DWWhYU3FrWXhuSHhu → 提取导览
  ├─ 逐张导出导览指向的表 → 解析 → 写 tem_activities
  ├─ 读 DWENVYUF5ekVPc1R3 → 提取最新一条导览
  ├─ 导出品牌详情表 → 解析 → 写 tem_brand_daily
  ├─ 读 DWUxvdFNHQXpWd0ZO → tem_merchant_contacts
  ├─ 读 DWVRiUGNCTUJhTHVv → tem_sp_assignments
  └─ 读 DWU9VWmZ0UWphWG9J → tem_ka_assignments

sync_v2.py
  ├─ 读 DWWhYU3FrWXhuSHhu (同上)
  ├─ 逐张导出全部导览指向的表 (不只最新)
  └─ 解析 → 写 tem_activity_daily (线上主表)

sync_pinned.py
  ├─ 读 DWW1oUktoeUVzUGx2 (G列置顶时间)
  ├─ 去重 → 写 tem_pinned_ops
  ├─ 读 DWXV0R3dNekVGS1hk
  └─ 去重 → 写 tem_waist_qualified
```

---

## 字段映射（关键字段）

### tem_activities
- 来源: 多个活动日表
- 字段: activity_id, brand_id, brand_name, activity_name, exposure_pv, claim_pv, redeem_pv, ...
- 主键: activity_id + report_date

### tem_brand_daily
- 来源: 品牌详情表 (header_row=1, data_start_row=4)
- 字段: brand_id, brand_name, category_l1~l4, is_online_today, store_count, exposure_pv, claim_pv, redeem_pv, w7_store_redeem_rate_uv, ... (100+ 字段)
- 主键: brand_id + report_date

### tem_activity_daily (线上主表)
- 来源: 多个日表 (全部导览条目)
- 字段: activity_id, brand_id, category_name, batch_name, price_power, exposure_pv, claim_pv, redeem_pv, store_redeem_rate_uv, ...
- 特点: 字段映射使用三层策略 (精确 + 别名 + 模糊)
- 主键: activity_id + report_date

### tem_merchant_contacts
- 来源: DWUxvdFNHQXpWd0ZO
- 字段: brand_id, brand_name, operating_sp, coupon_sp, contact_assistant, brand_status, brand_tier, coupon_type
- 主键: brand_id

### tem_sp_assignments
- 来源: DWVRiUGNCTUJhTHVv
- 字段: sp_name, category, target_merchants, owner, rebate_policy
- 主键: sp_name

### tem_ka_assignments
- 来源: DWU9VWmZ0UWphWG9J
- 字段: brand_id, brand_name, category, owner, txn_25y, mini_txn_25y, order_penetration_25y, ...
- 主键: brand_id

### tem_pinned_ops
- 来源: DWW1oUktoeUVzUGx2 (C列:品牌ID, G列:置顶时间)
- 字段: brand_id, brand_name (空), pin_date, row_creator, strategy_id
- 主键: brand_id
- 特点: 同一品牌取最新 pin_date

### tem_waist_qualified
- 来源: DWXV0R3dNekVGS1hk
- 字段: brand_id, brand_name, operating_sp, category, is_qualified, qualified_type, manual_feedback, is_alive, old_user_should_uv_w7
- 主键: brand_id
- 特点: 按 brand_id 去重

---

## 常见错误排查

| 错误 | 原因 | 解法 |
|------|------|------|
| 品牌日报缺字段 | xlsx被dimension截断 | 用 header_row=1, data_start_row=4, ws.cell()按坐标读 |
| V2活动为0条 | 导览表没更新 | 检查 DWWhYU3FrWXhuSHhu A1 是否最新 |
| 置顶时间为空 | G列读取错误 | 检查 DWW1oUktoeUVzUGx2 第2行G列是否有日期 |
| MCP export_file报错 | token过期或服务不可用 | 检查 .env TENCENT_DOCS_TOKEN, 等5分钟重试 |
| 字段名对不上 | 版本更新、tab/空格 | sync_v2.py有三层模糊匹配, sync_all.py需要维护 FIELD_MAP |

