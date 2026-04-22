"""
sync_v2.py - V2 每日活动快照同步脚本
独立于 sync_all.py，复用 doc_reader.py 和 supabase_writer.py

用法:
  python3 sync_v2.py              # 同步所有日期（导览表中的全部链接）
  python3 sync_v2.py --latest     # 只同步最新一天
  python3 sync_v2.py --date 0420  # 只同步指定日期（匹配导览文本）

数据源: 导览表 DWWtkT0Rrd2pCSnV1 → A列超链接 → 逐张日表
目标表: tem_activity_daily (activity_id + report_date 为主键)
"""
import os
import re
import argparse
from dotenv import load_dotenv

load_dotenv()

from doc_reader import (
    read_index_table_with_links,
    read_target_sheet,
)
from supabase_writer import get_client, upsert_batch


# 导览表 file_id
NAV_FILE_ID = "DWWtkT0Rrd2pCSnV1"

# 底表字段 → DB 列名（兼容新旧两版字段名）
FIELD_MAP = {
    "品牌ID":       "brand_id",
    "品牌名称":     "brand_name",
    "品类名称":     "category_name",
    "活动ID":       "activity_id",
    "活动名称":     "activity_name",
    "批次名称":     "batch_name",
    "券批次id":     "batch_id",
    "活动价格力（各渠道有值渠道的算术平均）": "price_power",
    "活动开始时间": "start_date",
    "活动结束时间": "end_date",
    "发券总库存":   "total_stock",
    "券剩余库存":   "remain_stock",
    # 新版字段名（25列版，带"最大值"后缀）
    "曝光数(最大值)":      "exposure_pv",
    "领取数(最大值)":      "claim_pv",
    "核销数(最大值)":      "redeem_pv",
    "曝光uin数(最大值)":   "exposure_uv",
    "领取uin数(最大值)":   "claim_uv",
    "核销uin数(最大值)":   "redeem_uv",
    "领取到店率_uv\t(最大值)":  "claim_to_store_rate_uv",
    "到店核销率_uv\t(最大值)":  "store_redeem_rate_uv",
    "核销到店率_uv\t(最大值)":  "redeem_to_store_rate_uv",
    "到店未达门槛占比(最大值)":  "store_below_threshold",
    # 旧版字段名（19列版，无后缀）
    "当日曝光次数": "exposure_pv",
    "当日领取次数": "claim_pv",
    "当日核销次数": "redeem_pv",
    "当日曝光用户数": "exposure_uv",
    "当日领取用户数": "claim_uv",
    "当日核销用户数": "redeem_uv",
    "近7日均_到店核销率_uv":    "store_redeem_rate_uv",
    "近7日均_到店未达门槛占比": "store_below_threshold",
    # 新增券信息
    "优惠门槛":     "threshold_amount",
    "优惠金额":     "discount_amount",
}

# 备选字段名（底表可能有不同的列名格式）
FIELD_ALIASES = {
    "品牌id": "brand_id",
    "活动id": "activity_id",
    "活动价格力": "price_power",
    "近7日均_到店核销率UV": "store_redeem_rate_uv",
    "近7日均_到店核销率_UV": "store_redeem_rate_uv",
    "近7日均_到店未达门槛占比_uv": "store_below_threshold",
    "领取到店率_uv(最大值)": "claim_to_store_rate_uv",
    "到店核销率_uv(最大值)": "store_redeem_rate_uv",
    "核销到店率_uv(最大值)": "redeem_to_store_rate_uv",
}


def _safe_str(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _safe_int(val) -> int:
    if val is None:
        return 0
    try:
        return int(float(str(val).replace(",", "").replace(" ", "")))
    except (ValueError, TypeError):
        return 0


def _safe_numeric(val):
    """安全转数值，保留小数"""
    if val is None:
        return None
    s = str(val).replace(",", "").replace(" ", "").replace("%", "")
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _extract_report_date(text: str) -> str:
    """
    从导览表文本提取 report_date
    格式1: "0420" → "2026-04-20"
    格式2: "20260420" → "2026-04-20"
    格式3: "0414-0420" → "2026-04-20" (取结束日期)
    格式4: "20260414_xxx" → "2026-04-14"
    """
    text = text.strip()

    # 格式3: "0414-0420" 取结束日期
    m = re.search(r'(\d{2})(\d{2})-(\d{2})(\d{2})', text)
    if m:
        month, day = m.group(3), m.group(4)
        return f"2026-{month}-{day}"

    # 格式2/4: "20260420..." 完整8位日期
    m = re.match(r'(\d{4})(\d{2})(\d{2})', text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # 格式1: "0420" or "0420_xxx" 开头4位日期
    m = re.match(r'^(\d{2})(\d{2})', text)
    if m:
        return f"2026-{m.group(1)}-{m.group(2)}"

    return ""


def _map_row(row: dict, report_date: str):
    """将底表一行映射为 DB record"""
    record = {"report_date": report_date}

    # 先用主字段映射（精确匹配）
    for src, db_col in FIELD_MAP.items():
        if src in row:
            record[db_col] = row[src]

    # 再用别名补充缺失字段
    for src, db_col in FIELD_ALIASES.items():
        if db_col not in record or record[db_col] is None:
            if src in row:
                record[db_col] = row[src]

    # 模糊匹配：底表字段名可能带tab或空格，做 contains 匹配
    for row_key, row_val in row.items():
        if row_val is None:
            continue
        rk = row_key.replace('\t', '').replace(' ', '').strip()
        if '领取到店率' in rk and 'claim_to_store_rate_uv' not in record:
            record['claim_to_store_rate_uv'] = row_val
        elif '到店核销率' in rk and rk.startswith('到店') and 'store_redeem_rate_uv' not in record:
            record['store_redeem_rate_uv'] = row_val
        elif '核销到店率' in rk and 'redeem_to_store_rate_uv' not in record:
            record['redeem_to_store_rate_uv'] = row_val
        elif '到店未达门槛' in rk and 'store_below_threshold' not in record:
            record['store_below_threshold'] = row_val
        elif '券类型' in rk and 'coupon_type' not in record:
            record['coupon_type'] = row_val

    # 必须有 activity_id
    activity_id = _safe_str(record.get("activity_id", ""))
    if not activity_id:
        return None

    # 类型转换
    record["activity_id"] = activity_id
    record["brand_id"] = _safe_str(record.get("brand_id", ""))
    record["brand_name"] = _safe_str(record.get("brand_name", ""))
    record["category_name"] = _safe_str(record.get("category_name", ""))
    record["activity_name"] = _safe_str(record.get("activity_name", ""))
    record["batch_name"] = _safe_str(record.get("batch_name", ""))
    record["batch_id"] = _safe_str(record.get("batch_id", ""))
    record["coupon_type"] = _safe_str(record.get("coupon_type", ""))
    record["start_date"] = _safe_str(record.get("start_date", ""))
    record["end_date"] = _safe_str(record.get("end_date", ""))

    record["price_power"] = _safe_numeric(record.get("price_power"))
    record["threshold_amount"] = _safe_numeric(record.get("threshold_amount"))
    record["discount_amount"] = _safe_numeric(record.get("discount_amount"))
    record["total_stock"] = _safe_int(record.get("total_stock", 0))
    record["remain_stock"] = _safe_int(record.get("remain_stock", 0))

    record["exposure_pv"] = _safe_int(record.get("exposure_pv", 0))
    record["claim_pv"] = _safe_int(record.get("claim_pv", 0))
    record["redeem_pv"] = _safe_int(record.get("redeem_pv", 0))
    record["exposure_uv"] = _safe_int(record.get("exposure_uv", 0))
    record["claim_uv"] = _safe_int(record.get("claim_uv", 0))
    record["redeem_uv"] = _safe_int(record.get("redeem_uv", 0))

    record["store_redeem_rate_uv"] = _safe_numeric(record.get("store_redeem_rate_uv"))
    record["claim_to_store_rate_uv"] = _safe_numeric(record.get("claim_to_store_rate_uv"))
    record["redeem_to_store_rate_uv"] = _safe_numeric(record.get("redeem_to_store_rate_uv"))
    record["store_below_threshold"] = _safe_numeric(record.get("store_below_threshold"))

    return record


def sync_v2(latest_only: bool = False, date_filter: str = ""):
    """
    V2 同步主流程
    1. 读导览表拿到所有日表链接
    2. 逐张导出解析
    3. upsert 到 tem_activity_daily
    """
    print("\n" + "=" * 60)
    print("V2 同步 tem_activity_daily（每日活动快照）")
    print("=" * 60)

    # 第一跳：读导览表
    nav_entries = read_index_table_with_links(NAV_FILE_ID)
    valid = [e for e in nav_entries if e["file_id"] and e["url"]]
    print(f"  导览表共 {len(nav_entries)} 条，有效 {len(valid)} 条")

    if not valid:
        print("  ⚠ 无有效条目，退出")
        return

    # 过滤
    if latest_only:
        valid = [valid[0]]
        print(f"  → 只同步最新: {valid[0]['text']}")
    elif date_filter:
        filtered = [e for e in valid if date_filter in e["text"]]
        if not filtered:
            print(f"  ⚠ 未找到包含 '{date_filter}' 的条目")
            return
        valid = filtered
        print(f"  → 匹配到 {len(valid)} 条含 '{date_filter}' 的条目")

    client = get_client()
    total_written = 0

    for entry in valid:
        text = entry["text"]
        file_id = entry["file_id"]
        report_date = _extract_report_date(text)

        print(f"\n  处理: {text} → date={report_date} (file_id={file_id})")

        if not report_date:
            print("    ⚠ 无法提取日期，跳过")
            continue

        try:
            # 第二跳：导出并解析日表
            rows = read_target_sheet(file_id, header_row=1, data_start_row=2)
            print(f"    获取到 {len(rows)} 行, {len(rows[0]) if rows else 0} 列")

            if rows:
                # 打印前几个字段名方便调试
                sample_keys = list(rows[0].keys())[:8]
                print(f"    字段预览: {sample_keys}")

            records = []
            for row in rows:
                rec = _map_row(row, report_date)
                if rec:
                    records.append(rec)

            print(f"    有效记录: {len(records)} 条")

            if records:
                upsert_batch(client, "tem_activity_daily", records,
                             conflict_columns=["activity_id", "report_date"])
                total_written += len(records)

        except Exception as e:
            print(f"    ✗ 处理失败: {e}")
            import traceback
            traceback.print_exc()

    print(f"\n{'=' * 60}")
    print(f"V2 同步完成！共写入 {total_written} 条记录")
    print(f"{'=' * 60}")


def main():
    parser = argparse.ArgumentParser(description="V2 每日活动快照同步")
    parser.add_argument("--latest", action="store_true",
                        help="只同步最新一天")
    parser.add_argument("--date", type=str, default="",
                        help="只同步指定日期（匹配导览文本，如 '0420'）")
    args = parser.parse_args()

    sync_v2(latest_only=args.latest, date_filter=args.date)


if __name__ == "__main__":
    main()
