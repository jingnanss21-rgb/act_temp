# 活动运营数据看板 — 技术文档

> 最后更新：2026-04-22
> 仓库：`jingnanss21-rgb/act_temp`
> 线上地址：`https://act-temp.pages.dev`
> 密码：`act2026`（SHA-256验证，7天有效期）
> 部署方式：Cloudflare Pages（Build output: `site`，Build command 留空）

---

## 一、项目结构

```
act_temp/
├── site/                              # 前端静态文件（部署目录）
│   ├── index.html                     # 入口页面（4个Tab + 时间/口径选择器 + 密码验证）
│   ├── css/
│   │   └── custom.css                 # 全局样式
│   └── js/
│       ├── supabase-config.js         # Supabase连接 + 全局变量(period/metricType) + 工具函数
│       ├── best-practice.js           # Tab0: 行业最佳实践（三层交互）
│       ├── brand-diagnosis.js         # Tab1: 品牌诊断（漏斗+标杆+活动明细）
│       ├── activity-detail.js         # Tab2: 品牌活动明细（表格+筛选+导出）
│       └── activity-alerts.js         # Tab3: 活动预警（到期+库存）
├── sql/
│   ├── init.sql                       # 旧表建表SQL
│   └── init_v2.sql                    # V2建表+视图SQL
├── sync/
│   ├── sync_all.py                    # 旧表同步脚本（活动日报+品牌日报+商户+SP+KA）
│   ├── sync_v2.py                     # V2同步脚本（每日活动快照）
│   ├── sync_task.sh                   # 旧表同步shell入口
│   ├── doc_reader.py                  # 腾讯文档读取模块（MCP export + xlsx解析）
│   ├── supabase_writer.py             # Supabase批量upsert模块
│   ├── SYNC_TASK_PROMPT.md            # 定时任务执行说明
│   ├── .env                           # 环境变量（token/key，不提交）
│   └── requirements.txt               # Python依赖
├── sync_backup/                       # sync/的备份（V2开发前快照）
└── docs/
    ├── TECHNICAL.md                   # 本文档
    ├── PRODUCT-GUIDE.md               # 产品功能手册
    └── field-mapping.md               # 字段映射参考
```

---

## 二、数据层

### 2.1 Supabase 配置

| 配置项 | 值 |
|--------|---|
| Project URL | `https://wiyarxoivfmkneumfmbl.supabase.co` |
| anon key | 见 `sync/.env` 和 `site/js/supabase-config.js` |
| 表名前缀 | 所有表加 `tem_` 前缀 |

### 2.2 数据表总览

| 表 | 主键 | 同步脚本 | 线上是否使用 | 说明 |
|----|------|---------|-------------|------|
| **tem_activity_daily** | activity_id + report_date | sync_v2.py | **主表** | V2每日活动快照（25列） |
| tem_activities | activity_id + report_date | sync_all.py | 旧表保留 | 旧7日累计活动数据 |
| tem_brand_daily | brand_id + report_date | sync_all.py | 辅助（类目/门店数） | 品牌日报（101列） |
| tem_merchant_contacts | brand_id | sync_all.py | 筛选+关联 | 商户跟进表 |
| tem_sp_assignments | sp_name | sync_all.py | 关联 | 服务商分工 |
| tem_ka_assignments | brand_id | sync_all.py | 关联 | KA分工 |

### 2.3 V2主表 tem_activity_daily

| 字段 | 类型 | 底表列名 | 说明 |
|------|------|---------|------|
| activity_id | TEXT | 活动ID | |
| brand_id | TEXT | 品牌ID | |
| brand_name | TEXT | 品牌名称 | |
| category_name | TEXT | 品类名称 | ⚠️ 底表82条为空，前端从brand_daily补充 |
| activity_name | TEXT | 活动名称 | |
| batch_name | TEXT | 批次名称 | |
| batch_id | TEXT | 券批次id | |
| coupon_type | TEXT | 券类型 | 全场折扣券/次卡/兑换券等 |
| price_power | NUMERIC | 活动价格力 | 值316=实际3.16%，前端÷100展示 |
| threshold_amount | NUMERIC | 优惠门槛 | |
| discount_amount | NUMERIC | 优惠金额 | |
| start_date | TEXT | 活动开始时间 | 格式20260302 |
| end_date | TEXT | 活动结束时间 | 格式20260429 |
| total_stock | BIGINT | 发券总库存 | ≥1亿视为无限库存 |
| remain_stock | BIGINT | 券剩余库存 | |
| exposure_pv | BIGINT | 曝光数(最大值) | PV |
| claim_pv | BIGINT | 领取数(最大值) | PV |
| redeem_pv | BIGINT | 核销数(最大值) | PV |
| exposure_uv | BIGINT | 曝光uin数(最大值) | UV |
| claim_uv | BIGINT | 领取uin数(最大值) | UV |
| redeem_uv | BIGINT | 核销uin数(最大值) | UV |
| claim_to_store_rate_uv | NUMERIC | 领取到店率_uv | 小数，如0.163=16.3%，**真实值** |
| store_redeem_rate_uv | NUMERIC | 到店核销率_uv | 小数，如0.405=40.5%，**真实值** |
| redeem_to_store_rate_uv | NUMERIC | 核销到店率_uv | 小数 |
| store_below_threshold | NUMERIC | 到店未达门槛占比 | 小数 |
| report_date | DATE | - | 从导览文本提取（"0421"→"2026-04-21"） |

### 2.4 聚合视图

| 视图 | 时间范围 | 聚合方式 | 前端对应 |
|------|---------|---------|---------|
| v_activity_today | 最新一天 | 原始行 | 时间选择器"当日" |
| v_activity_7d | 最近7天 | SUM(pv/uv), 率取最新一天 | 时间选择器"近7日"（默认） |
| v_activity_30d | 最近30天 | 同上 | 时间选择器"近30日" |

聚合逻辑：
- `exposure_pv/uv, claim_pv/uv, redeem_pv/uv` → **SUM**（多天累加）
- `price_power, store_redeem_rate_uv, claim_to_store_rate_uv` 等率值 → **取最新一天**（ARRAY_AGG ORDER BY report_date DESC [1]）
- `total_stock, remain_stock` → **取最新一天**
- `day_count` → 该活动出现的天数

### 2.5 数据关联逻辑

```
V2活动快照(tem_activity_daily) ← 线上主数据源
  └─ brand_id → 品牌日报(tem_brand_daily) 取类目(category_l4)/门店数/交易笔数/小程序占比
  └─ brand_id → 商户对接(tem_merchant_contacts) 取对接助理/服务商
  └─ brand_id → KA分工(tem_ka_assignments) 取负责人（优先）
  └─ operating_sp → 服务商分工(tem_sp_assignments) 取负责人（次选）
```

**类目取值优先级**：品牌日报 `category_l4`（四级类目）> 活动表 `category_name`

---

## 三、数据源（腾讯文档）

### 3.1 文档清单

| 表 | file_id | 更新频率 | 同步脚本 |
|---|---------|---------|---------|
| 活动日报导览 | DWWhYU3FrWXhuSHhu | 日更 | sync_v2.py + sync_all.py |
| 品牌日报导览 | DWENVYUF5ekVPc1R3 | 日更 | sync_all.py |
| 商户跟进总表 | DWUxvdFNHQXpWd0ZO | 低频 | sync_all.py |
| 服务商分工 | DWVRiUGNCTUJhTHVv | 低频 | sync_all.py |
| KA分工 | DWU9VWmZ0UWphWG9J | 低频 | sync_all.py |

### 3.2 数据采集链路

```
V2采集链路（sync_v2.py）：

活动日报导览 (DWWhYU3FrWXhuSHhu)
  → MCP export xlsx
  → 直接读 A列 cell + A列超链接（无表头，A1即数据行）
  → 提取 file_id + 从文本提取 report_date（"0421"→2026-04-21）
  → 只同步最新一天（--latest）或全部
  → MCP 导出目标日表 xlsx
  → openpyxl 解析（header_row=1, data_start_row=2，25列）
  → 字段映射（兼容新旧两版列名 + 模糊匹配tab字符）
  → Supabase upsert (tem_activity_daily)
```

### 3.3 踩坑经验

| 问题 | 根因 | 解法 |
|------|------|------|
| 品牌日报只导出94列 | xlsx dimension标签截断稀疏列 | ws.cell()按坐标读，不用iter_rows |
| 品牌日报表头对不上 | Row1是大标题(101列)，Row3是字段名(68列) | header_row=1取最宽行 |
| V2导览表A1被当表头跳过 | read_index_table_with_links默认header_row=1 | sync_v2.py直接读xlsx cell |
| V2底表字段名带"最大值"后缀+tab字符 | 底表更新为25列版 | 精确+模糊匹配双重映射 |
| 活动日表82条缺品类名称 | 数据源缺失 | 前端从品牌日报category_l4补充 |
| report_date写成当天日期 | 原代码用datetime.now() | 从导览文本提取日期 |
| Supabase默认返回1000行 | REST API默认limit | 前端fetchAllFromView分页拉取 |

---

## 四、前端架构

### 4.1 全局控件

```
Header:
[当日] [近7日] [近30日]    [UV] [PV]    数据日期: 2026-04-21
```

| 控件 | 全局变量 | 影响 |
|------|---------|------|
| 时间选择器 | `window.currentPeriod` = 'today'/'7d'/'30d' | 切换Supabase视图，重新请求数据 |
| UV/PV切换 | `window.currentMetricType` = 'uv'/'pv' | 纯前端重渲染，不请求API |
| 密码验证 | localStorage，7天有效 | SHA-256对比，hash见index.html |

**关键工具函数**（supabase-config.js）：
- `getViewName()` — 根据period返回视图名
- `fetchAllFromView(viewName, select)` — 分页拉取全量数据
- `getMetricVals(act)` — 根据UV/PV返回曝光/领取/核销值

### 4.2 Tab0: 行业最佳实践（best-practice.js）

**三层交互**：

| 层级 | 触发 | 内容 |
|------|------|------|
| Layer1 | 默认 | 3×2业态卡片 + 4指标Tab + Top3柱状图 |
| Layer2 | 点击卡片 | 右侧抽屉：Top3卡片 + 渐变漏斗 |
| Layer3 | 点击活动 | 弹窗：4级转化漏斗 + 对比均值表 |

**UV/PV切换逻辑**：
- `recomputeBestPractice()` — 按当前口径重算所有转化率和Top3排名
- 到店相关始终UV口径，PV模式下"到店次数 = 领取次数 × UV领取到店率（预估）"

**6个固定业态**：茶饮咖啡/中式快餐/西式快餐/正餐/小吃/甜品烘焙

**类目来源**：从品牌日报`category_l4`映射（`brandCatMap`），fallback活动表`category_name`

**异常阈值**：
```javascript
const RATE_CAPS = { exposure_claim: 0.40, claim_redeem: 0.80, exposure_redeem: 0.10, store_redeem: 1.00 };
```

### 4.3 Tab1: 品牌诊断（brand-diagnosis.js）

**四区域**：

| 区域 | 内容 |
|------|------|
| A | 品牌概览：活动数+价格力+曝光+领取+核销 + 健康评分环形图 |
| B | 水平漏斗（曝光→领取→到店→核销）+ 过程指标卡片（含价格力） |
| C | 行业标杆参考：刻度尺 + Top3卡片 + 4指标Tab |
| D | 活动明细卡片：价格力+各转化率对比中位数 |

**健康评分**：
```
4维度 × 25分 = 满分100
维度：价格力 + 曝光领取率 + 领取核销率 + 到店核销率
基准：同类目P85（前15%水平线）
单项得分 = min(品牌值 / P85值, 1.0) × 25
```

**到店核销率（品牌级）**：按核销UV加权平均各活动的真实值
```
品牌到店核销率 = Σ(活动i的store_redeem_rate_uv × 活动i的redeem_uv) / Σ(redeem_uv)
```

**领取到店率（品牌级）**：按领取UV加权平均
```
品牌领取到店率 = Σ(活动i的claim_to_store_rate_uv × 活动i的claim_uv) / Σ(claim_uv)
```

**到店人数**：= 领取人数 × 领取到店率（预估），PV模式下 = 领取次数 × UV领取到店率

**两个模式**：完整版(`full`) / 对外版(`external`，隐藏曝光相关指标)

**导出**：`window.print()` PDF导出，`.printing-diagnosis` CSS类

**不查品牌日报**：类目从活动数据的`_category`字段取（加载时已从brand_daily补充）

### 4.4 Tab2: 品牌活动明细（activity-detail.js）

**28列表格**：
- 基础信息(6): 类目/品牌ID/品牌名称/门店数/日均交易笔数/小程序占比
- 对接信息(3): 对接助理/服务商/负责人
- 活动信息(5): 活动ID/活动名称/批次名称/价格力/库存
- UV数据(6): 曝光/领取/核销 + 3个转化率
- PV数据(6): 同上
- 到店(1): 到店核销率
- 门槛(1): 未达门槛占比

**数据来源**：
- 活动数据：`getViewName()` 视图（V2主表）
- 品牌补充：`tem_brand_daily`（仅 category_l4/store_count/w7_avg_txn_count/w7_mini_program_ratio）
- 关联：merchant_contacts + sp_assignments + ka_assignments

**UV/PV切换不影响此Tab**（两组列始终展示）

### 4.5 Tab3: 活动预警（activity-alerts.js）

**两类预警**：

| 类型 | 条件 | 分级 |
|------|------|------|
| 到期预警 | end_date距今≤7天 | 红≤3天，黄4-7天 |
| 库存预警 | 按日均消耗预计≤7天耗尽 | 同上 |

**库存计算**：
```
日均消耗 = (total_stock - remain_stock) / day_count
预计耗尽天数 = remain_stock / 日均消耗
```
- `total_stock ≥ 1亿`排除（无限库存）
- 数据源：固定用 `v_activity_7d`（需要day_count）

**筛选**：支持按对接助理/服务商多选筛选（关联merchant_contacts）

---

## 五、口径说明

### 5.1 转化率

| 指标 | UV口径 | PV口径 |
|------|--------|--------|
| 曝光领取率 | claim_uv / exposure_uv | claim_pv / exposure_pv |
| 领取核销率 | redeem_uv / claim_uv | redeem_pv / claim_pv |
| 曝光核销率 | redeem_uv / exposure_uv | redeem_pv / exposure_pv |
| 领取到店率 | **DB真实值**（claim_to_store_rate_uv），始终UV口径 | 同UV |
| 到店核销率 | **DB真实值**（store_redeem_rate_uv），始终UV口径 | 同UV |

### 5.2 到店人数（预估）

| 模式 | 公式 | 标注 |
|------|------|------|
| UV | 领取人数 × 领取到店率 | *预估 |
| PV | 领取次数 × UV领取到店率 | *预估 |

### 5.3 价格力

- DB存原值（如316），前端展示÷100（如3.16%）
- 品牌级 = 按曝光PV加权平均各活动价格力
- 评分用类目P85为基准

---

## 六、部署与运维

### 6.1 Cloudflare Pages
- 仓库：`jingnanss21-rgb/act_temp`，Branch: `main`
- Build output: `site`，Build command: 留空
- push main自动部署，分支自动预览（如 `v2-frontend.act-temp.pages.dev`）

### 6.2 定时任务
见 `sync/SYNC_TASK_PROMPT.md`，核心流程：
1. `./sync_task.sh daily`（旧表）
2. `python3 sync_v2.py --latest`（V2新表）
3. 验收（旧表6项 + V2表4项）
4. 有代码变更时：语法检查 + 函数存在性检查 → push

### 6.3 环境配置
```bash
# sync/.env
TENCENT_DOCS_TOKEN=<腾讯文档MCP授权token>
SUPABASE_URL=https://wiyarxoivfmkneumfmbl.supabase.co
SUPABASE_KEY=<Supabase anon key>

# Python依赖
pip3 install openpyxl supabase python-dotenv requests
```

---

## 七、修改指南

### 7.1 改前端样式
→ `site/css/custom.css`

### 7.2 改行业最佳实践（Tab0）
→ `site/js/best-practice.js`
- 数据加载：`loadBestPracticeData()`
- UV/PV重算：`recomputeBestPractice()`
- 三层渲染：`renderLayer1()` / `openLayer2()` / `openLayer3()`

### 7.3 改品牌诊断（Tab1）
→ `site/js/brand-diagnosis.js`
- 数据加载：`initDiagnosis()`
- 统计计算：`computeCategoryStats()`
- 诊断运行：`runDiagnosis()` → `renderDiagResult()`
- 活动卡片：`renderDiagActivities()`
- 标杆参考：`renderBenchmark()`

### 7.4 改活动明细（Tab2）
→ `site/js/activity-detail.js`
- 数据加载：`loadActivityDetail()`
- 表格渲染：`renderDetailTable()`

### 7.5 改活动预警（Tab3）
→ `site/js/activity-alerts.js`
- 数据加载：`loadActivityAlerts()`
- 渲染：`renderAlerts()`

### 7.6 加新字段到V2表
1. Supabase SQL Editor 执行 `ALTER TABLE tem_activity_daily ADD COLUMN ...`
2. 重建3个视图（DROP + CREATE，注意加新列）
3. `sync/sync_v2.py` 的 `FIELD_MAP` 加映射
4. 重新同步数据
5. 前端使用新字段

### 7.7 重要约束
- **类目**优先品牌日报`category_l4`，不要只依赖活动表`category_name`
- **到店相关指标**始终UV口径，PV模式下标注
- **到店人数**是预估值，必须标注`*预估`
- **价格力**DB存原值÷100为实际百分比
- **stock ≥ 1亿**视为无限库存，预警排除
- **Supabase 1000行限制**必须用分页拉取
- 品牌明细只展示 merchant_contacts 里有的品牌
- 曝光=0 的活动不展示
