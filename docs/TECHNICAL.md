# 活动运营数据看板 — 技术文档

> 最后更新：2026-04-17  
> 仓库：`jingnanss21-rgb/act_temp`  
> 线上地址：`https://act-temp.pages.dev`  
> 部署方式：Cloudflare Pages（Build output: `site`，Build command 留空）

---

## 一、项目结构

```
act_temp/
├── site/                          # 前端静态文件（部署目录）
│   ├── index.html                 # 入口页面（3个Tab + 全局布局）
│   ├── css/
│   │   └── custom.css             # 全局样式（变量 / 布局 / 组件）
│   └── js/
│       ├── supabase-config.js     # Supabase 连接配置（URL + anon key）
│       ├── best-practice.js       # Tab0: 行业最佳实践（三层交互）
│       ├── brand-diagnosis.js     # Tab1: 品牌诊断（漏斗 + 标杆 + 活动明细）
│       └── activity-detail.js     # Tab2: 品牌活动明细（表格 + 筛选 + 导出）
├── sql/
│   ├── init.sql                   # Supabase 建表 SQL（5表 + 1视图 + RLS）
│   └── add_write_policy.sql       # 补充写入权限的 RLS policy
├── sync/
│   ├── sync_all.py                # 数据同步主入口
│   ├── doc_reader.py              # 腾讯文档读取模块
│   ├── supabase_writer.py         # Supabase 写入模块
│   └── requirements.txt           # Python 依赖
├── docs/
│   └── field-mapping.md           # 前端字段 → 底表字段映射
└── README.md
```

---

## 二、数据层

### 2.1 Supabase 配置

| 配置项 | 值 |
|--------|---|
| Project URL | `https://wiyarxoivfmkneumfmbl.supabase.co` |
| anon key | `eyJhbGciOiJIUzI1NiIs...jo1GoR3ZuFv2HFZcVoOKpVb19SBUIHZL3EoR266njU4` |
| 表名前缀 | 所有表加 `tem_` 前缀 |

### 2.2 数据表结构

#### tem_activities（活动维度明细）
- **主键**：`activity_id + report_date`
- **来源**：日报活动导览 → 链接指向的普通 sheet
- **字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| activity_id | TEXT | 活动唯一ID |
| brand_id | TEXT | 归属品牌ID |
| brand_name | TEXT | 品牌名称 |
| activity_name | TEXT | 活动名称 |
| exposure_pv | BIGINT | 活动曝光次数（PV） |
| claim_pv | BIGINT | 领取次数（PV） |
| redeem_pv | BIGINT | 核销次数（PV） |
| exposure_uv | BIGINT | 曝光用户数（UV） |
| claim_uv | BIGINT | 领取用户数（UV） |
| redeem_uv | BIGINT | 核销用户数（UV） |
| start_date | TEXT | 投放开始时间（如20260311） |
| end_date | TEXT | 投放结束时间 |
| report_date | DATE | 日报日期 |

#### tem_brand_daily（品牌日报详情）
- **主键**：`brand_id + report_date`
- **来源**：品牌日报导览 → 链接指向的日报 sheet（100列）
- **关键字段**：

| 字段 | 底表列名 | 格式 |
|------|---------|------|
| category_l4 | 四级类目名称 | 文本 |
| store_count | 审核通过门店数 | 数字字符串 |
| w7_avg_txn_count | 近7日均_笔数(w) | 数字字符串 |
| w7_mini_program_ratio | 近7日_小程序交易占比 | 小数(0~1) |
| w7_store_redeem_rate_uv | 近7日_到店核销率UV | **百分比字符串**（如"52.86%"） |
| w7_avg_store_redeem | 近7日均_一店几核 | 数字字符串 |
| daily/w7 各渠道 PV/转化率 | ... | 小数(0~1)或数字 |

> ⚠️ **关键注意**：到店核销率存储为百分比字符串（如 "52.86%"），前端 `parseFloat` 后得到 52.86，**不是** 0.5286。异常阈值判定用 100 而不是 1.0。

#### tem_merchant_contacts（商户对接）
- **主键**：`brand_id`
- **来源**：商户对接普通sheet（DWUxvdFNHQXpWd0ZO）
- **字段**：brand_id, brand_name, operating_sp, coupon_sp, contact_assistant, brand_status, brand_tier, coupon_type, update_time

#### tem_sp_assignments（服务商分工）
- **主键**：`sp_name`
- **来源**：服务商分工 smartsheet
- **字段**：sp_name, category, target_merchants, owner, rebate_policy

#### tem_ka_assignments（KA分工）
- **主键**：`brand_id`
- **来源**：KA分工 smartsheet
- **字段**：brand_id, category, brand_name, owner, txn_25y, mini_txn_25y, ...

#### tem_v_activity_detail（视图）
- activities LEFT JOIN brand_daily（取最新日期），供 Tab2 活动明细查询

### 2.3 数据关联逻辑

```
活动(tem_activities)
  └─ brand_id → 品牌日报(tem_brand_daily) 取类目/门店数/到店核销率等
  └─ brand_id → 商户对接(tem_merchant_contacts) 取对接助理/服务商
  └─ brand_id → KA分工(tem_ka_assignments) 取负责人（优先）
  └─ operating_sp → 服务商分工(tem_sp_assignments) 取负责人（次选）
```

---

## 三、数据源（腾讯文档）

### 3.1 文档清单

| 表 | file_id | 在线链接 | 类型 | 更新频率 |
|---|---------|---------|------|---------|
| 活动日报导览 | DWWhYU3FrWXhuSHhu | [链接](https://docs.qq.com/sheet/DWWhYU3FrWXhuSHhu?tab=BB08J2) | 索引表（A列日期+B列超链接） | 日更 |
| 品牌日报导览 | DWENVYUF5ekVPc1R3 | [链接](https://docs.qq.com/sheet/DWENVYUF5ekVPc1R3?tab=BB08J2) | 索引表（A列超链接，A2最新） | 日更 |
| 商户跟进总表 | DWUxvdFNHQXpWd0ZO | [链接](https://docs.qq.com/sheet/DWUxvdFNHQXpWd0ZO?tab=BB08J2) | 普通sheet | 低频 |
| 服务商分工 | DWVRiUGNCTUJhTHVv | [链接](https://docs.qq.com/sheet/DWVRiUGNCTUJhTHVv?tab=BB08J2) | 普通sheet | 低频 |
| KA分工 | DWU9VWmZ0UWphWG9J | [链接](https://docs.qq.com/sheet/DWU9VWmZ0UWphWG9J?tab=BB08J2) | 普通sheet | 低频 |

### 3.2 MCP 配置
- **Authorization Token**：从环境变量 `TENCENT_DOCS_TOKEN` 获取（不要硬编码到代码或文档中）
- **MCP 服务器**：`tencent-docs`（腾讯文档 OpenAPI MCP）

### 3.3 数据采集链路

```
┌─────────────────────────────────────────────────────────┐
│  日更数据                                                │
│                                                         │
│  活动日报导览(DWWhYU3FrWXhuSHhu)                         │
│    → MCP export xlsx                                    │
│    → 提取 A列/B列 超链接（extract_hyperlinks 兼容AB列）  │
│    → 正则提取 file_id: /sheet/([A-Za-z0-9]+)/           │
│    → MCP 导出实际活动日表 xlsx                            │
│    → openpyxl 解析 12 列（header_row=1）                 │
│    → report_date 从索引表文本提取（如 0410-0416→2026-04-16）│
│    → Supabase REST API upsert(tem_activities)            │
│                                                         │
│  品牌日报导览(DWENVYUF5ekVPc1R3)                         │
│    → MCP export xlsx → 提取 A2 超链接（A2=最新日报）     │
│    → 只同步最新一天                                      │
│    → MCP 导出品牌日报 xlsx                               │
│    → openpyxl 按坐标读取（header_row=1, data_start_row=4）│
│      ⚠ 不能用 iter_rows，xlsx dimension 会截断稀疏列    │
│      ⚠ Row 1 是大标题行（101列），Row 2-3 是合并表头     │
│      ⚠ 数据从 Row 4 开始                                │
│    → 101 列，含"近7日_到店核销率UV"等关键字段            │
│    → Supabase REST API upsert(tem_brand_daily)           │
│                                                         │
│  低频数据（商户跟进 / 服务商分工 / KA分工）               │
│    → MCP export xlsx → openpyxl 解析 → Supabase upsert  │
└─────────────────────────────────────────────────────────┘
```

### 3.4 同步任务

```bash
# 日更同步（活动+品牌日报）
cd sync && ./sync_task.sh daily

# 全量同步（含商户/服务商/KA）
cd sync && ./sync_task.sh all

# 单表同步
python3 sync_all.py --table activities
python3 sync_all.py --table brand_daily
python3 sync_all.py --table merchant
python3 sync_all.py --table sp
python3 sync_all.py --table ka
```

### 3.5 踩坑经验
1. **品牌日报 xlsx dimension 截断**——0416起部分xlsx的 `<dimension>` 只标到94列，但CS列(97列)数据实际存在。必须用 `ws.cell(row, col)` 按坐标读取，不能用 `iter_rows()`
2. **品牌日报表头结构**——Row 1 是合并大标题（101列最宽），Row 2-3 是字段名（有合并只68列），Row 4+ 才是数据。用 `header_row=1, data_start_row=4`
3. **导览表超链接**可能在 A 列或 B 列，`extract_hyperlinks` 需兼容查找 A/B 两列
4. **活动 report_date**——不能用 `datetime.now()`，要从索引表文本提取（如"0410-0416"→"2026-04-16"）
5. **到店核销率是百分比字符串**（"52.86%"），`parseFloat` 得到 52.86，前端阈值判定用 100 不是 1.0
6. **Supabase anon key 默认只有 SELECT**——写入需要加 INSERT/UPDATE 的 RLS policy，删除需要额外加 DELETE policy
7. **KA分工表有重复 brand_id**——upsert 同批次内重复主键会报 ON CONFLICT 错误，需先去重
8. **smartsheet export xlsx 只导出视图里的列**——如果需要完整字段，用普通 sheet 版本

---

## 四、前端架构

### 4.1 页面结构（3个 Tab）

```
index.html
├── Header（标题 + 数据日期）
├── Tab Bar
│   ├── Tab0: 🏆 行业最佳实践  → best-practice.js
│   ├── Tab1: 🔍 品牌诊断      → brand-diagnosis.js
│   └── Tab2: 📋 品牌活动明细  → activity-detail.js
└── Tab Content Panels
```

### 4.2 CDN 依赖

| 库 | 用途 |
|---|------|
| @supabase/supabase-js@2 | 数据库查询 |
| html2canvas@1.4.1 | 导出诊断报告截图 |

### 4.3 Tab0: 行业最佳实践（best-practice.js）

**三层交互架构**：

| 层级 | 触发方式 | 内容 |
|------|---------|------|
| 第一层 | 默认视图 | 3×2 业态卡片矩阵 + 4指标Tab + Top1大字 + Top3柱状图 |
| 第二层 | 点击"查看详情" | 右侧滑出抽屉：🥇🥈🥉 Top3 卡片 + 4指标 + 渐变漏斗 |
| 第三层 | 点击活动 | 居中弹窗：4级转化漏斗 + 对比业态均值表 |

**6个固定业态**（顺序固定）：
茶饮咖啡 ☕ / 中式快餐 🍜 / 西式快餐 🍔 / 正餐 🍽️ / 小吃 🧆 / 甜品烘焙 🧁

**每业态专属配色**：
```javascript
const CATEGORY_COLOR = {
  '茶饮咖啡': '#2563EB', '中式快餐': '#EA580C', '西式快餐': '#DC2626',
  '正餐': '#1E40AF', '小吃': '#D97706', '甜品烘焙': '#DB2777'
};
```

**4个核心指标**（Tab 切换联动所有卡片）：
1. 曝光领取率 = claim_uv / exposure_uv
2. 领取核销率 = redeem_uv / claim_uv
3. 曝光核销率 = redeem_uv / exposure_uv
4. 到店核销率 = 品牌日报 w7_store_redeem_rate_uv

**异常阈值（转化率 cap）**：
```javascript
const RATE_CAPS = {
  exposure_claim: 0.40,   // 曝光领取率 > 40%
  claim_redeem: 0.80,     // 领取核销率 > 80%
  exposure_redeem: 0.10,  // 曝光核销率 > 10%
  store_redeem: 1.00      // 到店核销率 ≥ 100%
};
```
超阈值活动：Tab0 排名时剔除，Tab1 品牌诊断中也剔除（使用独立的 `DIAG_RATE_CAPS`），Tab2 明细中标"⚠ 数据异常"。

> **注意**：Tab2 活动明细中到店核销率的阈值是 `100`（因为底表存的是百分比数值如 52.86），而 Tab0/Tab1 中到店核销率的阈值是 `1.00`（小数形式）。两套阈值逻辑各自自洽，修改时需注意区分。

**到店人数（预估）**：
```
到店人数 = 核销UV / 到店核销率
```
标注 *预估，hover 显示 tooltip 说明倒推逻辑。

**数据过滤规则**：
- 曝光 = 0 的活动不展示
- 只展示跟进表（tem_merchant_contacts）里有的品牌

### 4.4 Tab1: 品牌诊断（brand-diagnosis.js）

**四区域结构**：

| 区域 | 内容 |
|------|------|
| A | 品牌概览头部：搜索框 + 品牌信息卡 + 健康评分环形图 |
| B | 品牌转化漏斗（左）+ 对比业态均值表（右）|
| C | 行业标杆参考：刻度尺 + Top3 卡片 + 标杆洞察 + 4指标Tab |
| D | 活动明细：可折叠，每活动4指标对比中位数 + 迷你漏斗 |

**健康评分算法**：
```
总分 = Σ(单项得分), 满分100
单项得分 = min(品牌值 / 同类目P75值, 1.0) × 25

评分区间：
  ≥ 80 → 绿色 #16A34A "优秀"
  60-79 → 橙色 #F59E0B "待优化"
  < 60 → 红色 #DC2626 "需关注"
```

P75 = 同类目下该指标排序后第75百分位数（中上水平，只有25%的活动超过此值）。变量名 `diagCatP75`。

**短板判定**：品牌值 < 同类目中位数 → 标红底 + 诊断提示条。

**标杆洞察（自动生成）**：
根据当前选中的指标类型，生成不同的文案。核心逻辑在 `generateInsights()` 函数。

**导出诊断报告**：
使用 html2canvas 对诊断结果区域截图，导出为 PNG。函数 `exportDiagnosis()`，按钮在搜索框旁（生成诊断后显示）。

### 4.5 Tab2: 品牌活动明细（activity-detail.js）

**数据来源**：`tem_v_activity_detail` 视图（activities JOIN brand_daily）+ 前端 JOIN merchant_contacts / sp_assignments / ka_assignments

**24列表格**：
基础信息(6) + 对接信息(3) + 活动信息(2) + UV数据(6) + PV数据(6) + 到店(1)

**筛选功能**：类目下拉 + 品牌搜索下拉 + 对接助理/服务商/负责人多选 + 导出CSV

**转化率格式化函数**：
```javascript
function fmtRate(r) { ... }          // 通用转化率（小数→百分比）
function fmtStoreRate(val) { ... }   // 到店核销率（百分比字符串原样返回）
function fmtRateWithAnomaly(...) { } // 超阈值标⚠
```

---

## 五、样式规范（custom.css）

### 5.1 CSS 变量
```css
--primary: #2563EB;      /* 品牌蓝 */
--success: #16A34A;      /* 高于中位 */
--warning: #F59E0B;      /* 接近中位 */
--danger: #DC2626;       /* 低于中位 */
--gold: #D97706;         /* 行业最佳 */
--bg-light: #F8FAFC;     /* 页面背景 */
--bg-white: #FFFFFF;     /* 卡片背景 */
--border: #E2E8F0;       /* 边框 */
--text-dark: #1E293B;    /* 主文字 */
--text-muted: #94A3B8;   /* 辅助文字 */
```

### 5.2 关键样式类
- `.cat-card` — 业态卡片
- `.bp-drawer` — 第二层抽屉
- `.bp-modal` — 第三层弹窗
- `.diag-*` — 品牌诊断相关
- `.filter-bar` — 筛选栏
- `.est-tag` — *预估标签（统一 class）

---

## 六、部署

### 6.1 Cloudflare Pages
- 仓库：`jingnanss21-rgb/act_temp`
- Branch：`main`
- Build command：留空
- Build output directory：`site`
- 每次 push 自动触发部署

### 6.2 GitHub
- Token：（从 MEMORY.md 或环境变量获取，不提交到仓库）
- 仓库地址：`https://github.com/jingnanss21-rgb/act_temp`

---

## 七、修改指南

### 7.1 改前端样式
→ 编辑 `site/css/custom.css`

### 7.2 改业态卡片/三层交互逻辑
→ 编辑 `site/js/best-practice.js`

### 7.3 改品牌诊断（漏斗/标杆/评分）
→ 编辑 `site/js/brand-diagnosis.js`

### 7.4 改活动明细表格
→ 编辑 `site/js/activity-detail.js`

### 7.5 加新字段
1. 确认底表有该字段 → 在 `sync_all.py` 的字段映射中添加
2. 如果是新表字段 → 在 `sql/init.sql` 加列（或 ALTER TABLE）
3. 前端查询时 Supabase select 加上该字段
4. 渲染逻辑中使用

### 7.6 更新数据
```bash
# 手动执行数据同步（当前方式）
# 1. MCP 导出腾讯文档 xlsx
# 2. 运行 /tmp/sync_data.py 写入 Supabase
# 或
# python3 sync/sync_all.py
```

### 7.7 重要约束
- 到店核销率是**百分比字符串**，不要乘100
- 异常阈值里到店核销率用 100（不是 1.0）
- 品牌明细只展示 merchant_contacts 里有的品牌
- 曝光=0 的活动不展示
- 到店人数是**预估值**（核销UV/到店核销率），必须标注
