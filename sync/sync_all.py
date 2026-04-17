"""
sync_all.py - 数据同步主入口
从腾讯文档同步数据到 Supabase

用法:
  python sync_all.py                  # 同步所有表
  python sync_all.py --table activities   # 只同步活动表
  python sync_all.py --table brand_daily  # 只同步品牌日报
  python sync_all.py --table merchant     # 只同步商户对接
  python sync_all.py --table sp           # 只同步服务商分工
  python sync_all.py --table ka           # 只同步KA分工
"""
import os
import sys
import argparse
import re
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

from doc_reader import (
    read_index_table_with_links,
    read_target_sheet,
    export_file,
    download_xlsx,
    parse_xlsx_rows,
    extract_hyperlinks,
    extract_file_id_from_url,
)
from supabase_writer import get_client, upsert_batch

# ============================================================
# 文档 ID 配置
# ============================================================
DOC_IDS = {
    "activity_nav": "DWWhYU3FrWXhuSHhu",   # 表1: 日报活动导览（新链接）
    "merchant":     "DWUxvdFNHQXpWd0ZO",    # 表2: 商户对接（普通sheet，完整9列）
    "sp":           "DWU1oR0JHRUhqZ1l3",    # 表3: 服务商分工
    "ka":           "DWXp3ZGt1VFdPTHZ4",    # 表4: KA分工
    "brand_nav":    "DWEd3TmNnRmpvdFpm",    # 表5: 日报品牌详情
}


def _safe_str(val) -> str:
    """安全转字符串，None 返回空串"""
    if val is None:
        return ""
    return str(val).strip()


def _safe_int(val) -> int:
    """安全转整数"""
    if val is None:
        return 0
    try:
        return int(float(str(val).replace(",", "")))
    except (ValueError, TypeError):
        return 0


def _extract_date_from_text(text: str) -> str:
    """从文本中提取日期，如 '20260303_品牌' → '2026-03-03'"""
    m = re.match(r"(\d{4})(\d{2})(\d{2})", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return ""


# ============================================================
# 同步函数
# ============================================================

def sync_activities(client):
    """
    同步活动数据
    表1 日报活动导览 → 两跳 → 活动日表
    """
    print("\n" + "=" * 60)
    print("同步 tem_activities（活动维度明细）")
    print("=" * 60)

    # 第一跳：读索引表，拿到链接
    nav_entries = read_index_table_with_links(DOC_IDS["activity_nav"])
    print(f"  索引表共 {len(nav_entries)} 条记录")

    all_rows = []
    for entry in nav_entries:
        if not entry["file_id"] or not entry["url"]:
            continue
        text = entry["text"]
        file_id = entry["file_id"]
        print(f"\n  处理: {text} (file_id={file_id})")

        # 从链接文本提取周期信息（如 "0409-0415"）
        report_label = text

        try:
            # 第二跳：导出目标 sheet
            rows = read_target_sheet(file_id)
            print(f"    获取到 {len(rows)} 行活动数据")

            for row in rows:
                activity_id = _safe_str(row.get("活动ID", row.get("活动id", "")))
                if not activity_id:
                    continue
                record = {
                    "activity_id": activity_id,
                    "brand_id": _safe_str(row.get("品牌ID", row.get("品牌id", ""))),
                    "brand_name": _safe_str(row.get("品牌名称", "")),
                    "activity_name": _safe_str(row.get("活动名称", "")),
                    "exposure_pv": _safe_int(row.get("活动曝光次数(加和)", row.get("活动曝光次数", 0))),
                    "claim_pv": _safe_int(row.get("领取次数(加和)", row.get("领取次数", 0))),
                    "redeem_pv": _safe_int(row.get("核销次数(加和)", row.get("核销次数", 0))),
                    "exposure_uv": _safe_int(row.get("曝光用户数(加和)", row.get("曝光用户数", 0))),
                    "claim_uv": _safe_int(row.get("领取用户数(加和)", row.get("领取用户数", 0))),
                    "redeem_uv": _safe_int(row.get("核销用户数(加和)", row.get("核销用户数", 0))),
                    "start_date": _safe_str(row.get("投放开始时间", "")),
                    "end_date": _safe_str(row.get("投放结束时间", "")),
                    "report_date": datetime.now().strftime("%Y-%m-%d"),
                }
                all_rows.append(record)

        except Exception as e:
            print(f"    ✗ 处理失败: {e}")

    upsert_batch(client, "tem_activities", all_rows,
                  conflict_columns=["activity_id", "report_date"])


def sync_brand_daily(client):
    """
    同步品牌日报
    表5 日报品牌详情 → 两跳 → 品牌日报 smartsheet
    """
    print("\n" + "=" * 60)
    print("同步 tem_brand_daily（品牌日报详情）")
    print("=" * 60)

    nav_entries = read_index_table_with_links(DOC_IDS["brand_nav"])
    print(f"  索引表共 {len(nav_entries)} 条记录")

    # 品牌日报字段映射：底表字段名 → DB 列名
    FIELD_MAP = {
        "品牌ID": "brand_id",
        "品牌名称": "brand_name",
        "一级类目名称": "category_l1",
        "二级类目名称": "category_l2",
        "四级类目ID": "category_l4_id",
        "四级类目名称": "category_l4",
        "品牌分层": "brand_tier",
        "当日是否在线": "is_online_today",
        "审核通过门店数": "store_count",
        "近7日_在线天数": "online_days_w7",
        "近7日_活动数": "activity_count_w7",
        "近7日_是否存活": "is_alive_w7",
        "近7日_存活率": "survival_rate_w7",
        "近7日_价格力": "price_power_w7",
        "近7日均_笔数(w)": "w7_avg_txn_count",
        "近7日均_笔数(w)_小程序": "w7_avg_txn_count_mini",
        "近7日_小程序交易占比": "w7_mini_program_ratio",
        "近7日均_一店几笔": "w7_avg_store_txn",
        "近7日均_一店几核": "w7_avg_store_redeem",
        "近7日均_模型预测交易笔数": "w7_avg_model_predict",
        "当日_曝光PV(w)": "daily_exposure_pv",
        "当日_领取PV(w)": "daily_claim_pv",
        "当日_核销PV": "daily_redeem_pv",
        "当日_曝光PV(w)_固定入口": "daily_exposure_pv_fixed",
        "当日_曝光PV(w)_商业支付": "daily_exposure_pv_commercial",
        "当日_曝光PV(w)_周边": "daily_exposure_pv_nearby",
        "当日_曝光PV(w)_面对面": "daily_exposure_pv_f2f",
        "当日_曝光PV(w)_支付有礼": "daily_exposure_pv_reward",
        "当日_曝光PV(w)_其他": "daily_exposure_pv_other",
        "当日_领取PV(w)_固定入口": "daily_claim_pv_fixed",
        "当日_领取PV(w)_商业支付": "daily_claim_pv_commercial",
        "当日_领取PV(w)_周边": "daily_claim_pv_nearby",
        "当日_领取PV(w)_面对面": "daily_claim_pv_f2f",
        "当日_领取PV(w)_支付有礼": "daily_claim_pv_reward",
        "当日_领取PV(w)_其他": "daily_claim_pv_other",
        "当日_核销PV_固定入口": "daily_redeem_pv_fixed",
        "当日_核销PV_商业支付": "daily_redeem_pv_commercial",
        "当日_核销PV_周边": "daily_redeem_pv_nearby",
        "当日_核销PV_面对面": "daily_redeem_pv_f2f",
        "当日_核销PV_支付有礼": "daily_redeem_pv_reward",
        "当日_核销PV_其他": "daily_redeem_pv_other",
        "当日_曝光领取率": "daily_exposure_claim_rate",
        "当日_领取核销率": "daily_claim_redeem_rate",
        "当日_曝光核销率": "daily_exposure_redeem_rate",
        "当日_曝光核销率_固定入口": "daily_exp_redeem_fixed",
        "当日_曝光核销率_商业支付": "daily_exp_redeem_commercial",
        "当日_曝光核销率_周边": "daily_exp_redeem_nearby",
        "当日_曝光核销率_面对面": "daily_exp_redeem_f2f",
        "当日_曝光核销率_支付有礼": "daily_exp_redeem_reward",
        "当日_曝光核销率_其他": "daily_exp_redeem_other",
        "近7日均_曝光PV(w)": "w7_avg_exposure_pv",
        "近7日均_领取PV(w)": "w7_avg_claim_pv",
        "近7日均_核销PV": "w7_avg_redeem_pv",
        "近7日均_曝光PV(w)_固定入口": "w7_avg_exposure_pv_fixed",
        "近7日均_曝光PV(w)_商业支付": "w7_avg_exposure_pv_commercial",
        "近7日均_曝光PV(w)_周边": "w7_avg_exposure_pv_nearby",
        "近7日均_曝光PV(w)_面对面": "w7_avg_exposure_pv_f2f",
        "近7日均_曝光PV(w)_支付有礼": "w7_avg_exposure_pv_reward",
        "近7日均_曝光PV(w)_其他": "w7_avg_exposure_pv_other",
        "近7日均_领取PV(w)_固定入口": "w7_avg_claim_pv_fixed",
        "近7日均_领取PV(w)_商业支付": "w7_avg_claim_pv_commercial",
        "近7日均_领取PV(w)_周边": "w7_avg_claim_pv_nearby",
        "近7日均_领取PV(w)_面对面": "w7_avg_claim_pv_f2f",
        "近7日均_领取PV(w)_支付有礼": "w7_avg_claim_pv_reward",
        "近7日均_领取PV(w)_其他": "w7_avg_claim_pv_other",
        "近7日均_核销PV_固定入口": "w7_avg_redeem_pv_fixed",
        "近7日均_核销PV_商业支付": "w7_avg_redeem_pv_commercial",
        "近7日均_核销PV_周边": "w7_avg_redeem_pv_nearby",
        "近7日均_核销PV_面对面": "w7_avg_redeem_pv_f2f",
        "近7日均_核销PV_支付有礼": "w7_avg_redeem_pv_reward",
        "近7日均_核销PV_其他": "w7_avg_redeem_pv_other",
        "近7日_曝光领取率": "w7_exposure_claim_rate",
        "近7日_领取核销率": "w7_claim_redeem_rate",
        "近7日_曝光核销率": "w7_exposure_redeem_rate",
        "近7日_曝光核销率_固定入口": "w7_exp_redeem_fixed",
        "近7日_曝光核销率_商业支付": "w7_exp_redeem_commercial",
        "近7日_曝光核销率_周边": "w7_exp_redeem_nearby",
        "近7日_曝光核销率_面对面": "w7_exp_redeem_f2f",
        "近7日_曝光核销率_支付有礼": "w7_exp_redeem_reward",
        "近7日_曝光核销率_其他": "w7_exp_redeem_other",
        "近7日_到店核销率UV": "w7_store_redeem_rate_uv",
        "近7日_到店核销率UV_小程序": "w7_store_redeem_rate_uv_mini",
        "近7日_领取到店率UV": "w7_claim_to_store_rate_uv",
        "近7日_领取到店UV": "w7_claim_to_store_uv",
        "近7日_领取到店UV_小程序": "w7_claim_to_store_uv_mini",
        "近7日_到店领取率UV": "w7_store_claim_rate_uv",
        "近7日_核销到店率PV": "w7_redeem_to_store_rate_pv",
        "近7日_高频尽曝UV": "w7_high_freq_exposure_uv",
        "近7日_高频应曝UV": "w7_high_freq_should_uv",
        "近7日_高频应曝尽曝率_UV": "w7_high_freq_rate_uv",
        "近7日_高频应曝尽曝率UV_二选一": "w7_high_freq_rate_uv_dual",
        "近7日_高频应曝UV_二选一渠道": "w7_high_freq_should_uv_dual",
        "近7日_高频尽曝UV_二选一渠道": "w7_high_freq_exposure_uv_dual",
        "近7日_低频尽曝UV": "w7_low_freq_exposure_uv",
        "近7日_低频应曝UV": "w7_low_freq_should_uv",
        "近7日_低频应曝尽曝率_UV": "w7_low_freq_rate_uv",
        "近7日_低频应曝尽曝率UV_二选一": "w7_low_freq_rate_uv_dual",
        "近7日_低频应曝UV_二选一渠道": "w7_low_freq_should_uv_dual",
        "近7日_低频尽曝UV_二选一渠道": "w7_low_freq_exposure_uv_dual",
        "序号": "seq_no",
        "日期": "report_date",
    }

    all_rows = []
    for entry in nav_entries:
        if not entry["file_id"] or not entry["url"]:
            continue
        text = entry["text"]
        file_id = entry["file_id"]
        report_date = _extract_date_from_text(text)
        print(f"\n  处理: {text} → 日期={report_date} (file_id={file_id})")

        if not report_date:
            print("    ⚠ 无法提取日期，跳过")
            continue

        try:
            rows = read_target_sheet(file_id)
            print(f"    获取到 {len(rows)} 行品牌数据")

            for row in rows:
                brand_id = _safe_str(row.get("品牌ID", ""))
                if not brand_id:
                    continue
                record = {"report_date": report_date}
                for src_field, db_col in FIELD_MAP.items():
                    if src_field in row:
                        record[db_col] = _safe_str(row[src_field])
                # 确保 brand_id 在
                record["brand_id"] = brand_id
                all_rows.append(record)

        except Exception as e:
            print(f"    ✗ 处理失败: {e}")

    upsert_batch(client, "tem_brand_daily", all_rows,
                  conflict_columns=["brand_id", "report_date"])


def sync_merchant(client):
    """同步商户对接（表2）"""
    print("\n" + "=" * 60)
    print("同步 tem_merchant_contacts（商户对接）")
    print("=" * 60)

    rows = read_target_sheet(DOC_IDS["merchant"])
    print(f"  获取到 {len(rows)} 行")

    records = []
    for row in rows:
        brand_id = _safe_str(row.get("品牌id", row.get("品牌ID", "")))
        if not brand_id:
            continue
        records.append({
            "brand_id": brand_id,
            "brand_name": _safe_str(row.get("品牌名称", "")),
            "operating_sp": _safe_str(row.get("经营服务商", "")),
            "coupon_sp": _safe_str(row.get("制券服务商", "")),
            "contact_assistant": _safe_str(row.get("对接助理", "")),
            "brand_status": _safe_str(row.get("品牌状态", "")),
            "brand_tier": _safe_str(row.get("分层", "")),
            "coupon_type": _safe_str(row.get("券类型", "")),
            "update_time": _safe_str(row.get("更新时间", "")),
        })

    upsert_batch(client, "tem_merchant_contacts", records,
                  conflict_columns=["brand_id"])


def sync_sp(client):
    """同步服务商分工（表3）"""
    print("\n" + "=" * 60)
    print("同步 tem_sp_assignments（服务商分工）")
    print("=" * 60)

    rows = read_target_sheet(DOC_IDS["sp"])
    print(f"  获取到 {len(rows)} 行")

    records = []
    for row in rows:
        sp_name = _safe_str(row.get("服务商名称", ""))
        if not sp_name:
            continue
        records.append({
            "sp_name": sp_name,
            "category": _safe_str(row.get("分类", "")),
            "target_merchants": _safe_str(row.get("目标引入腰部商户数量", "")),
            "owner": _safe_str(row.get("负责人", "")),
            "rebate_policy": _safe_str(row.get("是否报名返佣政策", "")),
        })

    upsert_batch(client, "tem_sp_assignments", records,
                  conflict_columns=["sp_name"])


def sync_ka(client):
    """同步KA分工（表4）"""
    print("\n" + "=" * 60)
    print("同步 tem_ka_assignments（KA分工）")
    print("=" * 60)

    rows = read_target_sheet(DOC_IDS["ka"])
    print(f"  获取到 {len(rows)} 行")

    records = []
    for row in rows:
        brand_id = _safe_str(row.get("品牌id", row.get("品牌ID", "")))
        if not brand_id:
            continue
        records.append({
            "brand_id": brand_id,
            "category": _safe_str(row.get("品类", "")),
            "brand_name": _safe_str(row.get("品牌", row.get("品牌名称", ""))),
            "owner": _safe_str(row.get("负责人", "")),
            "txn_25y": _safe_str(row.get("25年交易(w笔)", "")),
            "mini_txn_25y": _safe_str(row.get("25年小程序(w笔)", "")),
            "order_penetration_25y": _safe_str(row.get("25年点餐渗透率(%)", "")),
            "market_penetration_target": _safe_str(row.get("大盘渗透目标(%)", "")),
            "redeem_target": _safe_str(row.get("核销目标", "")),
            "conversion_target": _safe_str(row.get("转化率目标(%)", "")),
            "exposure_target": _safe_str(row.get("曝光目标(w)", "")),
            "surprise_target": _safe_str(row.get("惊喜货盘目标", "")),
            "online_surprise": _safe_str(row.get("在线惊喜货盘", "")),
            "goods_content": _safe_str(row.get("货盘内容", "")),
        })

    upsert_batch(client, "tem_ka_assignments", records,
                  conflict_columns=["brand_id"])


# ============================================================
# 主入口
# ============================================================

SYNC_MAP = {
    "activities": sync_activities,
    "brand_daily": sync_brand_daily,
    "merchant": sync_merchant,
    "sp": sync_sp,
    "ka": sync_ka,
}


def main():
    parser = argparse.ArgumentParser(description="活动运营看板 - 数据同步")
    parser.add_argument("--table", type=str, default="all",
                        choices=["all"] + list(SYNC_MAP.keys()),
                        help="指定要同步的表（默认 all）")
    args = parser.parse_args()

    client = get_client()
    print(f"Supabase 连接成功: {os.getenv('SUPABASE_URL')}")

    if args.table == "all":
        # 先同步维度表（2/3/4），再同步事实表（1/5）
        for name in ["merchant", "sp", "ka", "activities", "brand_daily"]:
            SYNC_MAP[name](client)
    else:
        SYNC_MAP[args.table](client)

    print("\n✓ 同步完成!")


if __name__ == "__main__":
    main()
