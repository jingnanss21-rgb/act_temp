# 活动运营数据看板 — 每日数据同步任务

## 任务定义

| 项目 | 说明 |
|------|------|
| **任务名称** | 活动运营看板日更数据同步 |
| **执行频率** | 每天 1 次（建议在底表更新后执行，通常为每天上午） |
| **执行角色** | WorkBuddy / 手动 |
| **工作目录** | `/Users/jingnanshe/WorkBuddy/20260416110818/sync` |
| **预计耗时** | 5-8 分钟 |
| **前置条件** | sync/.env 已配置、Python3 + 依赖已安装、腾讯文档底表已更新当天数据 |
| **线上地址** | https://act-temp.pages.dev |

---

## 执行流程

### Step 1：进入工作目录
```bash
cd /Users/jingnanshe/WorkBuddy/20260416110818/sync
```

### Step 2：执行旧表日更同步（活动日报 + 品牌日报）
```bash
./sync_task.sh daily
```

### Step 3：执行V2新表同步（每日活动快照）
```bash
python3 sync_v2.py --latest
```

### Step 4：验收检查（必须全部通过才算成功）

```bash
python3 -c "
from supabase_writer import get_client
from dotenv import load_dotenv
load_dotenv()
client = get_client()
errors = []

# === 品牌日报验收 ===
res3 = client.table('tem_brand_daily').select('report_date').order('report_date', desc=True).limit(1).execute()
bd_date = res3.data[0]['report_date'] if res3.data else None
print(f'[品牌日报] 最新日期: {bd_date}')
if not bd_date:
    errors.append('品牌日报为空')

res4 = client.table('tem_brand_daily').select('brand_id', count='exact').eq('report_date', bd_date).execute()
bd_count = res4.count or 0
print(f'[品牌日报] 最新日期行数: {bd_count}')
if bd_count < 100:
    errors.append(f'品牌日报数据量异常: {bd_count}行 (预期>100)')

res5 = client.table('tem_brand_daily').select('brand_id', count='exact').eq('report_date', bd_date).not_.is_('w7_store_redeem_rate_uv', 'null').neq('w7_store_redeem_rate_uv', '').execute()
store_count = res5.count or 0
print(f'[品牌日报] 有到店核销率的品牌数: {store_count}')
if store_count < 50:
    errors.append(f'品牌日报到店核销率异常: 仅{store_count}个品牌有值 (预期>50)')

# === V2新表验收（线上主表）===
v2r1 = client.table('tem_activity_daily').select('report_date').order('report_date', desc=True).limit(1).execute()
v2_date = v2r1.data[0]['report_date'] if v2r1.data else None
print(f'[V2-活动快照] 最新日期: {v2_date}')
if not v2_date:
    errors.append('V2活动数据为空')

v2r2 = client.table('tem_activity_daily').select('activity_id', count='exact').eq('report_date', v2_date).execute()
v2_count = v2r2.count or 0
print(f'[V2-活动快照] 最新日期行数: {v2_count}')
if v2_count < 100:
    errors.append(f'V2活动数据量异常: {v2_count}行 (预期>100)')

v2r3 = client.table('tem_activity_daily').select('activity_id', count='exact').eq('report_date', v2_date).not_.is_('claim_to_store_rate_uv', 'null').execute()
v2_cts = v2r3.count or 0
print(f'[V2-活动快照] 有领取到店率的活动数: {v2_cts}')
if v2_cts < 50:
    errors.append(f'V2领取到店率异常: 仅{v2_cts}条有值 (预期>50)')

v2r4 = client.table('tem_activity_daily').select('activity_id', count='exact').eq('report_date', v2_date).gt('exposure_pv', 0).execute()
v2_exp = v2r4.count or 0
print(f'[V2-活动快照] 有曝光的活动数: {v2_exp}')
if v2_exp < 50:
    errors.append(f'V2有曝光活动数异常: {v2_exp} (预期>50)')

print()
if errors:
    print('❌ 验收失败:')
    for e in errors:
        print(f'  - {e}')
    raise Exception('数据同步验收未通过')
else:
    print('✅ 验收通过！所有检查项正常')
    print(f'   品牌日报: {bd_date}/{bd_count}条, {store_count}条有到店核销率')
    print(f'   V2表: {v2_date}/{v2_count}条, {v2_cts}条有领取到店率, {v2_exp}条有曝光')
"
```

### Step 5：如果验收失败，停止执行，报告错误信息，不要push。

### Step 6：验收通过后，检查是否有代码变更需要push：
```bash
cd /Users/jingnanshe/WorkBuddy/20260416110818
git status
```
如果 site/ 目录下有改动（前端代码），执行以下前端安全检查后再push。

### Step 7：前端安全检查（push前必须通过）

**a. 语法检查——确认JS文件没有语法错误：**
```bash
node -e "try{require('fs').readFileSync('site/js/brand-diagnosis.js','utf8');new Function(require('fs').readFileSync('site/js/brand-diagnosis.js','utf8'));console.log('✅ brand-diagnosis.js 语法正常')}catch(e){console.log('❌ brand-diagnosis.js 语法错误:',e.message);process.exit(1)}"
node -e "try{require('fs').readFileSync('site/js/best-practice.js','utf8');new Function(require('fs').readFileSync('site/js/best-practice.js','utf8'));console.log('✅ best-practice.js 语法正常')}catch(e){console.log('❌ best-practice.js 语法错误:',e.message);process.exit(1)}"
node -e "try{require('fs').readFileSync('site/js/activity-detail.js','utf8');new Function(require('fs').readFileSync('site/js/activity-detail.js','utf8'));console.log('✅ activity-detail.js 语法正常')}catch(e){console.log('❌ activity-detail.js 语法错误:',e.message);process.exit(1)}"
node -e "try{require('fs').readFileSync('site/js/activity-alerts.js','utf8');new Function(require('fs').readFileSync('site/js/activity-alerts.js','utf8'));console.log('✅ activity-alerts.js 语法正常')}catch(e){console.log('❌ activity-alerts.js 语法错误:',e.message);process.exit(1)}"
```

**b. 关键函数存在性检查——确认核心函数没被误删：**
```bash
grep -q "function renderDiagResult" site/js/brand-diagnosis.js && echo "✅ renderDiagResult 存在" || echo "❌ renderDiagResult 缺失"
grep -q "function openLayer3" site/js/best-practice.js && echo "✅ openLayer3 存在" || echo "❌ openLayer3 缺失"
grep -q "function loadActivityDetail" site/js/activity-detail.js && echo "✅ loadActivityDetail 存在" || echo "❌ loadActivityDetail 缺失"
grep -q "function loadActivityAlerts" site/js/activity-alerts.js && echo "✅ loadActivityAlerts 存在" || echo "❌ loadActivityAlerts 缺失"
grep -q "function switchTab" site/index.html && echo "✅ switchTab 存在" || echo "❌ switchTab 缺失"
```

**c. 如果以上检查全部通过，执行push：**
```bash
git add -A
git commit -m "chore: 日更数据同步 $(date +%Y-%m-%d)"
git push origin main
```

**d. push后等待2分钟，检查线上页面：**
```bash
curl -s -o /dev/null -w "%{http_code}" https://act-temp.pages.dev
```
如果返回200，同步完成。如果非200，报告"线上页面异常，HTTP状态码：XXX"。

**e. 如果任何安全检查失败，不要push，报告具体哪项检查未通过。**

### Step 8：如果没有代码变更（只有数据同步），直接完成，不需要push。

---

## 验收标准

| # | 检查项 | 通过条件 | 失败处理 |
|---|--------|---------|---------|
| 1 | 品牌日报最新日期 | 和底表导览A2一致 | 检查品牌日报导览A2超链接 |
| 2 | 品牌日报数据量 | 最新日期 > 100 条 | 检查导出列数是否101列 |
| 3 | 品牌日报到店核销率 | > 50 个品牌有值 | 检查xlsx CS列是否读到 |
| 4 | V2活动快照最新日期 | 和导览表最新条目一致 | 检查导览表A1是否有新链接 |
| 5 | V2活动数据量 | 最新日期 > 100 条 | 检查sync_v2.py字段映射 |
| 6 | V2领取到店率 | > 50 条有值 | 检查底表"领取到店率_uv"字段 |
| 7 | V2有曝光数据 | > 50 条曝光PV > 0 | 确认底表已更新 |

---

## 异常处理

### 同步报错 "MCP error"
- 检查 .env 中 TENCENT_DOCS_TOKEN 是否有效
- 腾讯文档 MCP 服务可能临时不可用，等 5 分钟重试

### 同步报错 "ON CONFLICT"
- 同批次有重复主键，通常无害，部分行跳过但其余正常写入
- 如果大量失败，检查底表是否有重复活动ID

### V2同步0条数据
- 导览表可能没更新，检查导览表A1是否有最新日期的链接
- 如果导览表A1是新数据但sync_v2.py读不到，可能是MCP缓存，等5分钟重试

### 到店核销率/领取到店率全为空
- 品牌日报：xlsx dimension截断了稀疏列，确认代码用 `header_row=1, data_start_row=4`
- V2活动快照：检查底表是否有"领取到店率_uv"和"到店核销率_uv"字段

### 数据日期没更新
- 确认腾讯文档底表已更新
- 旧表：导览表A2是否新增了最新周期链接
- V2表：导览表A1是否是最新日期

---

## 数据源链接清单

| 数据表 | file_id | 在线链接 | 更新频率 |
|-------|---------|---------|---------|
| 活动日报导览 | DWWhYU3FrWXhuSHhu | https://docs.qq.com/sheet/DWWhYU3FrWXhuSHhu?tab=BB08J2 | 日更 |
| 品牌日报导览 | DWENVYUF5ekVPc1R3 | https://docs.qq.com/sheet/DWENVYUF5ekVPc1R3?tab=BB08J2 | 日更 |
| 商户跟进总表 | DWUxvdFNHQXpWd0ZO | https://docs.qq.com/sheet/DWUxvdFNHQXpWd0ZO?tab=BB08J2 | 低频 |
| 服务商分工 | DWVRiUGNCTUJhTHVv | https://docs.qq.com/sheet/DWVRiUGNCTUJhTHVv?tab=BB08J2 | 低频 |
| KA分工 | DWU9VWmZ0UWphWG9J | https://docs.qq.com/sheet/DWU9VWmZ0UWphWG9J?tab=BB08J2 | 低频 |

## 数据表说明

| Supabase 表 | 用途 | 同步脚本 | 主键 |
|------------|------|---------|------|
| tem_activities | 旧活动日报（7日累计） | sync_all.py | activity_id + report_date |
| tem_brand_daily | 品牌日报（类目/门店数等） | sync_all.py | brand_id + report_date |
| tem_activity_daily | **V2每日活动快照（线上主表）** | sync_v2.py | activity_id + report_date |
| tem_merchant_contacts | 商户跟进 | sync_all.py | brand_id |
| tem_sp_assignments | 服务商分工 | sync_all.py | sp_name |
| tem_ka_assignments | KA分工 | sync_all.py | brand_id |

## 环境配置

### .env 文件（sync/.env）
```
TENCENT_DOCS_TOKEN=<腾讯文档MCP授权token>
SUPABASE_URL=https://wiyarxoivfmkneumfmbl.supabase.co
SUPABASE_KEY=<Supabase anon key>
```

### Python 依赖
```bash
pip3 install openpyxl supabase python-dotenv requests
```

---

## 兜底机制

```
┌────────────┬─────────────────────────────┬────────────────────┐
│    阶段    │            检查             │      失败行为      │
├────────────┼─────────────────────────────┼────────────────────┤
│ 数据同步后 │ 品牌日报3项 + V2表4项验收    │ 停止，不push，报告 │
├────────────┼─────────────────────────────┼────────────────────┤
│ Push前     │ JS语法检查（4个文件）       │ 停止，不push，报告 │
├────────────┼─────────────────────────────┼────────────────────┤
│ Push前     │ 核心函数存在性（5项grep）   │ 停止，不push，报告 │
├────────────┼─────────────────────────────┼────────────────────┤
│ Push后     │ 线上HTTP 200检查            │ 报告异常状态码     │
└────────────┴─────────────────────────────┴────────────────────┘
```

## 注意事项

- .env 文件在 sync/.env，已配置好不需要修改
- 如果腾讯文档MCP报错，可能是服务临时不可用，等 5 分钟重试一次
- 最多重试 1 次，仍失败则报告
- **不要修改 sync/ 目录下的任何代码文件**
- 前端代码如果有改动，必须通过语法检查和函数存在性检查才能push
- 任何不确定的情况，停止执行并报告

---

## 已知踩坑记录

| 问题 | 根因 | 解法 |
|------|------|------|
| 品牌日报只导出94列，缺到店核销率 | xlsx dimension标签截断稀疏列 | 用ws.cell()按坐标读，不用iter_rows |
| 品牌日报字段名对不上 | Row 1是大标题（101列），Row 3才是字段名（68列） | 用header_row=1取最宽行做表头 |
| 活动report_date写成当天日期 | 原代码用datetime.now() | 从索引表文本提取（"0410-0416"→"2026-04-16"） |
| V2导览表A1被当作表头跳过 | read_index_table_with_links默认header_row=1 | sync_v2.py直接读xlsx cell，不依赖parse_xlsx_rows |
| V2活动日表字段名带"最大值"后缀 | 底表更新为25列版 | sync_v2.py兼容新旧字段名+模糊匹配 |
| 活动日表82条缺品类名称 | 底表数据源缺失 | 前端从品牌日报category_l4补充类目 |
| 品牌诊断只显示部分活动 | Supabase默认返回1000行 | 前端用分页fetchAllRows拉取全量 |
