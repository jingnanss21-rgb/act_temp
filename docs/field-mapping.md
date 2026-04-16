# 前端字段 → 底表字段 完整映射

## Tab0 - 分类目最佳实践

### Top3 卡片

| 前端展示 | 计算方式 | 底表来源 |
|---|---|---|
| 品牌名 | 直接取 | tem_activities.brand_name |
| 活动名 | 直接取 | tem_activities.activity_name |
| 曝光核销率 | 核销UV / 曝光UV | tem_activities.redeem_uv / tem_activities.exposure_uv |
| 曝光领取率 | 领取UV / 曝光UV | tem_activities.claim_uv / tem_activities.exposure_uv |
| 领取核销率 | 核销UV / 领取UV | tem_activities.redeem_uv / tem_activities.claim_uv |
| 到店核销率 | 直接取品牌日报 | tem_brand_daily.w7_store_redeem_rate_uv（百分比字符串如"52.86%"） |
| 四级类目 | 按品牌ID关联 | tem_brand_daily.category_l4 |

**注意**：到店核销率是品牌级别的（不是活动级别），所以同品牌下所有活动共享一个到店核销率。在Top3排序时，按品牌的到店核销率排。

### 品牌诊断卡片（当前版本）

| 前端展示 | Supabase字段 | 底表原始列名 | 存储格式 |
|---|---|---|---|
| 近7日曝光PV | tem_brand_daily.w7_avg_exposure_pv | 近7日均_曝光PV(w) | 数字字符串 |
| 近7日领取PV | tem_brand_daily.w7_avg_claim_pv | 近7日均_领取PV(w) | 数字字符串 |
| 近7日核销PV | tem_brand_daily.w7_avg_redeem_pv | 近7日均_核销PV | 数字字符串 |
| 曝光领取率 | tem_brand_daily.w7_exposure_claim_rate | 近7日_曝光领取率 | 小数(0~1) |
| 领取核销率 | tem_brand_daily.w7_claim_redeem_rate | 近7日_领取核销率 | 小数(0~1) |
| 曝光核销率 | tem_brand_daily.w7_exposure_redeem_rate | 近7日_曝光核销率 | 小数(0~1) |
| 到店核销率 | tem_brand_daily.w7_store_redeem_rate_uv | 近7日_到店核销率UV (CS列) | 百分比字符串("52.86%") |

---

## Tab1 - 品牌活动明细

### 基础信息（6列）

| 前端列名 | Supabase字段 | 底表原始列名 | 关联方式 |
|---|---|---|---|
| 类目 | tem_brand_daily.category_l4 | 四级类目名称 | 按 brand_id 关联品牌日报最新记录 |
| 品牌ID | tem_activities.brand_id | 品牌ID | 活动表直取 |
| 品牌名称 | tem_activities.brand_name | 品牌名称 | 活动表直取 |
| 门店数 | tem_brand_daily.store_count | 审核通过门店数 | 按 brand_id 关联品牌日报 |
| 日均交易笔数 | tem_brand_daily.w7_avg_txn_count | 近7日均_笔数(w) | 按 brand_id 关联品牌日报 |
| 小程序占比 | tem_brand_daily.w7_mini_program_ratio | 近7日_小程序交易占比 | 按 brand_id 关联品牌日报 |

### 对接信息（3列）

| 前端列名 | Supabase字段 | 关联方式 |
|---|---|---|
| 对接助理 | tem_merchant_contacts.contact_assistant | 按 brand_id 关联商户对接表 |
| 服务商 | tem_merchant_contacts.operating_sp | 按 brand_id 关联商户对接表 |
| 负责人 | 优先 tem_ka_assignments.owner，其次 tem_sp_assignments.owner | ① 按 brand_id 查 KA分工表 → 有则用 KA 负责人；② 无则按 brand_id → 商户对接表.经营服务商 → 服务商分工表.负责人 |

### 活动信息（2列）

| 前端列名 | Supabase字段 | 底表原始列名 |
|---|---|---|
| 活动ID | tem_activities.activity_id | 活动ID |
| 活动名称 | tem_activities.activity_name | 活动名称 |

### UV 数据（6列）

| 前端列名 | Supabase字段 | 底表原始列名 | 计算方式 |
|---|---|---|---|
| 曝光UV | tem_activities.exposure_uv | 曝光用户数(加和) | 直取 |
| 领取UV | tem_activities.claim_uv | 领取用户数(加和) | 直取 |
| 核销UV | tem_activities.redeem_uv | 核销用户数(加和) | 直取 |
| UV曝光领取率 | 前端计算 | - | claim_uv / exposure_uv |
| UV领取核销率 | 前端计算 | - | redeem_uv / claim_uv |
| UV曝光核销率 | 前端计算 | - | redeem_uv / exposure_uv |

### PV 数据（6列）

| 前端列名 | Supabase字段 | 底表原始列名 | 计算方式 |
|---|---|---|---|
| 曝光PV | tem_activities.exposure_pv | 活动曝光次数(加和) | 直取 |
| 领取PV | tem_activities.claim_pv | 领取次数(加和) | 直取 |
| 核销PV | tem_activities.redeem_pv | 核销次数(加和) | 直取 |
| PV曝光领取率 | 前端计算 | - | claim_pv / exposure_pv |
| PV领取核销率 | 前端计算 | - | redeem_pv / claim_pv |
| PV曝光核销率 | 前端计算 | - | redeem_pv / exposure_pv |

### 到店（1列）

| 前端列名 | Supabase字段 | 底表原始列名 | 格式 |
|---|---|---|---|
| 到店核销率 | tem_brand_daily.w7_store_redeem_rate_uv | 近7日_到店核销率UV (CS列, 第97列) | 百分比字符串("52.86%")，品牌级 |

---

## 转化率异常阈值 (cap)

| 指标 | 阈值 | 处理方式 |
|---|---|---|
| 曝光领取率 | > 40% | Tab1 标⚠红色，Tab0 Top3 统计时剔除 |
| 领取核销率 | > 40% | Tab1 标⚠红色，Tab0 Top3 统计时剔除 |
| 曝光核销率 | > 10% | Tab1 标⚠红色，Tab0 Top3 统计时剔除 |
| 到店核销率 | > 100% | Tab1 标⚠红色，Tab0 Top3 统计时剔除 |

---

## 数据过滤规则

| 规则 | 说明 |
|---|---|
| 跟进表过滤 | Tab1 品牌活动明细只展示 tem_merchant_contacts 里有的品牌 |
| Tab0 品牌诊断 | 搜索下拉只展示 tem_merchant_contacts 里有的品牌 |
| Tab0 行业类目 | 只展示：茶饮咖啡、中式快餐、西式快餐、正餐、小吃、甜品烘焙 |

---

## 底表数据格式说明

### tem_brand_daily 字段格式
- **转化率字段**（曝光领取率/领取核销率/曝光核销率）：小数格式（0~1），如 0.176394
- **到店核销率**：百分比字符串，如 "52.86%"
- **PV 数据**：数字字符串，单位为万(w)，如 "1569.8734"
- **门店数/笔数等**：数字字符串

### tem_activities 字段格式
- **UV/PV 数据**：整数（BIGINT），如 15242701
- **活动ID/品牌ID**：字符串

### tem_merchant_contacts 字段格式
- 所有字段为纯文本
