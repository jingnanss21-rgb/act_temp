# 腾讯文档同步脚本分析报告

## 📋 文档ID清单 & 数据映射

### sync_all.py（主同步脚本）
| 文档ID | 文档名称 | 读取数据 | 写入表 | 说明 |
|--------|--------|--------|--------|------|
| DWWhYU3FrWXhuSHhu | 活动日报导览 | 导览索引 → 超链接指向多张日表 | 无直接写入 | 第一跳表，获取目标文档链接 |
| 多个file_id（来自导览） | 活动日表（多张） | 活动ID、品牌ID、曝光/领取/核销数据 | **tem_activities** | 第二跳，实际数据表 |
| DWENVYUF5ekVPc1R3 | 品牌日报导览 | 导览索引 → 超链接指向品牌详情表 | 无直接写入 | 第一跳表，只同步最新一条 |
| 多个file_id（来自导览） | 品牌详情表（多张） | 品牌ID、分类、在线状态、PV/UV、核销率等 | **tem_brand_daily** | 第二跳，包含100+字段 |
| DWUxvdFNHQXpWd0ZO | 商户跟进总表 | 品牌ID、品牌名、服务商、状态分层 | **tem_merchant_contacts** | 单表直读，无导览 |
| DWVRiUGNCTUJhTHVv | 服务商分工 | 服务商名称、分类、商户引入目标 | **tem_sp_assignments** | 单表直读，无导览 |
| DWU9VWmZ0UWphWG9J | KA分工 | 品牌ID、品牌名、类目、负责人、交易目标 | **tem_ka_assignments** | 单表直读，无导览 |

---

### sync_pinned.py（V3策略分析脚本）
| 文档ID | 文档名称 | 读取数据 | 写入表 | 说明 |
|--------|--------|--------|--------|------|
| DWW1oUktoeUVzUGx2 | 置顶操作记录 | 品牌ID、创建时间、修改时间（置顶时间） | **tem_pinned_ops** | 单表直读，一品牌一条记录 |
| DWXV0R3dNekVGS1hk | 腰部达标标记 | 品牌ID、名称、SP、类目、达标标记、反馈 | **tem_waist_qualified** | 单表直读，去重后按品牌一条 |

---

### sync_v2.py（V2每日活动快照脚本）
| 文档ID | 文档名称 | 读取数据 | 写入表 | 说明 |
|--------|--------|--------|--------|------|
| DWWhYU3FrWXhuSHhu | 活动日报导览（共用） | 导览索引 → 超链接指向多张日表 | 无直接写入 | 第一跳表 |
| 多个file_id（来自导览） | 每日活动快照（多张） | 活动ID、品牌、类目、批次、价格力、PV/UV、到店核销率等 | **tem_activity_daily** | 第二跳，**线上主表** |

---

## 🔗 流程图

### sync_all.py（两跳模式）
```
活动数据流:
  活动日报导览(DWWhYU3FrWXhuSHhu)
    ↓ [读取超链接]
  多个活动日表 (file_id来自超链接)
    ↓ [解析数据]
  tem_activities ✓

品牌数据流:
  品牌日报导览(DWENVYUF5ekVPc1R3)
    ↓ [只取最新一条超链接]
  品牌详情表 (file_id来自超链接)
    ↓ [解析数据，header_row=1, data_start_row=4]
  tem_brand_daily ✓

维度表:
  商户跟进总表(DWUxvdFNHQXpWd0ZO) → tem_merchant_contacts ✓
  服务商分工(DWVRiUGNCTUJhTHVv) → tem_sp_assignments ✓
  KA分工(DWU9VWmZ0UWphWG9J) → tem_ka_assignments ✓
```

### sync_v2.py（两跳模式，线上主表）
```
  活动日报导览(DWWhYU3FrWXhuSHhu) [共用]
    ↓ [读取所有超链接]
  多个日表 (file_id来自超链接)
    ↓ [解析数据，字段智能匹配]
  tem_activity_daily ✓（**线上展示主表**）
```

### sync_pinned.py（单表模式）
```
  置顶操作记录(DWW1oUktoeUVzUGx2) → tem_pinned_ops ✓
  腰部达标标记(DWXV0R3dNekVGS1hk) → tem_waist_qualified ✓
```

---

## 📊 Supabase表对应关系

| 表名 | 数据来源 | 同步脚本 | 主键 | 更新频率 | 用途 |
|------|--------|--------|------|--------|------|
| **tem_activities** | sync_all.py | 活动数据 | activity_id + report_date | 日更 | 旧活动日报（7日累计） |
| **tem_brand_daily** | sync_all.py | 品牌数据 | brand_id + report_date | 日更 | 品牌日报（类目/门店等细项） |
| **tem_activity_daily** | sync_v2.py | 活动快照 | activity_id + report_date | 日更 | **V2每日快照（线上主表）** |
| tem_merchant_contacts | sync_all.py | 商户维度 | brand_id | 低频 | 商户跟进对接信息 |
| tem_sp_assignments | sync_all.py | 服务商维度 | sp_name | 低频 | 服务商分工 |
| tem_ka_assignments | sync_all.py | KA维度 | brand_id | 低频 | KA分工目标 |
| tem_pinned_ops | sync_pinned.py | 置顶记录 | brand_id | 不定期 | 品牌置顶时间 |
| tem_waist_qualified | sync_pinned.py | 腰部标记 | brand_id | 不定期 | 腰部商户达标标记 |

---

## 🔍 关键实现细节

### 文档导出方式
- **MCP API** (`export_file`): 腾讯文档→xlsx格式
- **超链接提取** (`extract_hyperlinks`): 从xlsx rel关系中获取下级文档链接
- **智能解析** (`parse_xlsx_rows`): 按坐标读取（避免dimension截断稀疏列）

### 字段映射策略
- **sync_all.py**: 明确的字段对应 (e.g., "活动ID" → "activity_id")
- **sync_v2.py**: 三层匹配 = 精确匹配 + 别名补充 + 模糊包含匹配
  - 处理字段名变动（"最大值"后缀、tab/空格等）

### 数据去重
- **置顶操作**: 按 brand_id 保留最新 pin_date
- **腰部达标**: 按 brand_id 去重（同一品牌可能有重复）

---

## ⚡ 执行流程

```bash
# 完整同步
python3 sync_all.py                    # 同步 5 张表（维度表优先）
python3 sync_v2.py --latest            # 同步最新一天活动快照
python3 sync_pinned.py                 # 同步置顶+腰部达标

# 单表同步
python3 sync_all.py --table brand_daily
python3 sync_v2.py --date 0420
python3 sync_pinned.py --table pinned_ops
```

---

## 🎯 总结

| 维度 | 数值 |
|------|------|
| 📄 **腾讯文档** | 11 个 |
| 🎯 **导览表** | 2 个 (活动日报导览、品牌日报导览) |
| 📊 **Supabase表** | 8 张 |
| 🔄 **两跳流程** | 3 个 (活动、品牌、V2活动快照) |
| 🎯 **线上主表** | **tem_activity_daily** (sync_v2.py) |

