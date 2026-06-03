# 同步脚本文档中心

这个文件夹包含了腾讯文档→Supabase 同步系统的完整分析报告。

## 📚 文档清单

### 🎯 快速开始（按推荐顺序阅读）

1. **DOC_ID_CHEAT_SHEET.md** ⭐ 首先看这个
   - 7个关键文档ID 快速查询表
   - 脚本执行矩阵
   - 字段映射速查
   - 常见错误排查
   
2. **SYNC_QUICK_REF.txt** 
   - ASCII艺术风格的一张纸概览
   - 脚本功能说明
   - 文档→表映射表
   
3. **SYNC_MAPPING_REPORT.md**
   - 完整详细分析报告
   - 详细的流程图和字段映射说明
   - 实现细节解释

### 📖 原始文档

- **SYNC_TASK_PROMPT.md** - 同步任务详细执行指南
- **sync_all.py** - 主同步脚本
- **sync_v2.py** - V2每日快照同步脚本
- **sync_pinned.py** - V3策略分析同步脚本
- **doc_reader.py** - 文档读取核心库
- **supabase_writer.py** - Supabase写入库

---

## 🔍 快速查询指南

### "我要找某个文档ID的功能"
→ 查看 **DOC_ID_CHEAT_SHEET.md** 的快速查询表

### "我要了解某个脚本干什么"
→ 查看 **SYNC_QUICK_REF.txt** 的脚本功能块

### "我要看某个表的字段映射"
→ 查看 **SYNC_MAPPING_REPORT.md** 的字段映射章节

### "我遇到了一个错误"
→ 查看 **DOC_ID_CHEAT_SHEET.md** 的常见错误排查

---

## 📊 核心数据一览

| 维度 | 数值 | 说明 |
|------|------|------|
| 腾讯文档总数 | 11 个 | 2个导览表 + 5个固定数据表 + 多个动态表 |
| Supabase表 | 8 张 | 3个日更表 + 3个维度表 + 2个策略表 |
| 同步脚本 | 3 个 | sync_all.py, sync_v2.py, sync_pinned.py |
| 核心工具 | 2 个 | doc_reader.py, supabase_writer.py |
| 线上主表 | 1 张 | **tem_activity_daily** (sync_v2.py) |

---

## 🗂️ 文档ID 全景图

### 导览表（两跳流程源）
- **DWWhYU3FrWXhuSHhu** - 活动日报导览 → 多个活动日表
- **DWENVYUF5ekVPc1R3** - 品牌日报导览 → 品牌详情表

### 固定数据表（直接读取）
- **DWUxvdFNHQXpWd0ZO** - 商户跟进总表 → tem_merchant_contacts
- **DWVRiUGNCTUJhTHVv** - 服务商分工 → tem_sp_assignments
- **DWU9VWmZ0UWphWG9J** - KA分工 → tem_ka_assignments
- **DWW1oUktoeUVzUGx2** - 置顶操作记录 → tem_pinned_ops
- **DWXV0R3dNekVGS1hk** - 腰部达标标记 → tem_waist_qualified

---

## ⚡ 快速命令

```bash
# 查看某个脚本用法
python3 sync_all.py --help
python3 sync_v2.py --help
python3 sync_pinned.py --help

# 执行完整同步
python3 sync_all.py
python3 sync_v2.py --latest
python3 sync_pinned.py

# 执行单表同步
python3 sync_all.py --table brand_daily
python3 sync_v2.py --date 0420
python3 sync_pinned.py --table pinned_ops
```

---

## 🎯 常见需求速查

| 需求 | 查看文件 | 位置 |
|------|--------|------|
| 快速查找文档ID功能 | DOC_ID_CHEAT_SHEET.md | 快速查询 |
| 了解脚本流程 | SYNC_QUICK_REF.txt | 脚本功能块 |
| 查看详细字段 | SYNC_MAPPING_REPORT.md | 字段映射章节 |
| 排查同步错误 | DOC_ID_CHEAT_SHEET.md | 常见错误排查 |
| 执行同步任务 | SYNC_TASK_PROMPT.md | 执行流程 |

---

## 📝 关键概念

### 两跳流程
```
导览表 (索引) → 提取超链接 → 多张数据表 → 解析数据 → Supabase表
```
用于：活动日报、品牌日报（导览表会定期更新指向新的日期的表）

### 单表直读
```
数据表 → 直接导出 → 解析数据 → Supabase表
```
用于：商户、服务商、KA、置顶、腰部达标（表结构固定，无需导览）

---

## 🔧 故障排查

遇到问题？按这个顺序查看：
1. 检查 DOC_ID_CHEAT_SHEET.md 的"常见错误排查"章节
2. 检查 SYNC_TASK_PROMPT.md 的"异常处理"章节
3. 查看具体脚本源代码（sync_all.py 等）

---

**最后更新**: 2026-04-29
