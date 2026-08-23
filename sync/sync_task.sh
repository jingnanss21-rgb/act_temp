#!/bin/bash
# ============================================================
# 数据同步定时任务
# 用法：
#   ./sync_task.sh           # 默认 daily 模式
#   ./sync_task.sh daily     # 日更数据（活动+品牌日报+商户跟进）
#   ./sync_task.sh all       # 同步全部（再补服务商+KA）
# ============================================================

set -e
cd "$(dirname "$0")"

echo "============================================"
echo "数据同步开始: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

MODE="${1:-daily}"

# 日更数据：活动日报 + 品牌日报 + 商户跟进
echo ""
echo "▶ 同步活动日报..."
python3 sync_all.py --table activities

echo ""
echo "▶ 同步活动每日快照（线上主表 tem_activity_daily）..."
python3 sync_v2.py --latest

echo ""
echo "▶ 同步品牌日报..."
python3 sync_all.py --table brand_daily

echo ""
echo "▶ 同步商户跟进表..."
python3 sync_all.py --table merchant

echo ""
echo "▶ 同步人群覆盖配置（act_segment_config，源自 iwiki 餐饮活动全字段表）..."
export IWIKI_TOKEN="${IWIKI_TOKEN:-$(grep '^IWIKI_TOKEN=' .env 2>/dev/null | cut -d= -f2-)}"
python3 pull_segments.py

# 低频数据：服务商 + KA（仅 all 模式）
if [ "$MODE" = "all" ]; then
    echo ""
    echo "▶ 同步服务商分工..."
    python3 sync_all.py --table sp

    echo ""
    echo "▶ 同步KA分工..."
    python3 sync_all.py --table ka
fi

echo ""
echo "============================================"
echo "数据同步完成: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
