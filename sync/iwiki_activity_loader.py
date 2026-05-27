#!/usr/bin/env python3
"""
iwiki_activity_loader.py - 从 iWiki 页面下载餐饮活动日报 CSV 附件

iWiki 页面 docid=4020417529，每天一个 CSV 附件（MMDD_餐饮活动日报.csv）。
对照旧腾讯文档底表，CSV 用的是英文字段名（fbrandid_1 / factid_99 / ...），
本模块负责下载 + 解析 + 字段名转中文（与 sync_v2.py 现有 FIELD_MAP 对齐）。

用法（模块导入）:
    from iwiki_activity_loader import (
        load_iwiki_activity_attachments,
        load_activity_daily_from_iwiki,
    )

用法（独立测试）:
    python iwiki_activity_loader.py                    # 列出所有可用日期
    python iwiki_activity_loader.py --date 2026-05-26  # 下载并预览
"""
from __future__ import annotations

import csv
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ── 常量 ──

IWIKI_CLI = str(Path.home() / ".iwiki" / "iwiki-cli")
IWIKI_DOC_ID = os.environ.get("IWIKI_ACTIVITY_DOC_ID", "4020417529")

CLI_TIMEOUT = 60
DOWNLOAD_MAX_ATTEMPTS = int(os.environ.get("IWIKI_DOWNLOAD_RETRY", "5"))
DOWNLOAD_RETRY_BACKOFF = (5, 15, 30, 60, 120)
# 餐饮活动日报正常 ~150KB，宽松设个 5KB 下限
DOWNLOAD_MIN_BYTES = int(os.environ.get("IWIKI_ACTIVITY_MIN_BYTES", "5120"))

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_iwiki_cache")


# ── 辅助：iwiki-cli 调用 ──

def _read_token_from_config() -> Optional[str]:
    config_path = Path.home() / ".iwiki" / "config.toml"
    if not config_path.is_file():
        return None
    try:
        text = config_path.read_text(encoding="utf-8")
        m = re.search(r'token\s*=\s*"([^"]+)"', text)
        return m.group(1) if m else None
    except Exception:
        return None


def _iwiki_env() -> Dict[str, str]:
    env = os.environ.copy()
    iwiki_dir = str(Path.home() / ".iwiki")
    path = env.get("PATH", "")
    if iwiki_dir not in path:
        env["PATH"] = f"{iwiki_dir}:{path}"
    if not env.get("IWIKI_TOKEN"):
        token = _read_token_from_config()
        if token:
            env["IWIKI_TOKEN"] = token
    return env


def _run_iwiki_cli(args: List[str], timeout: int = CLI_TIMEOUT) -> str:
    cmd = [IWIKI_CLI] + args
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=_iwiki_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"iwiki-cli {' '.join(args)} 失败 (exit={result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout


# ── 附件列表解析 ──
# 匹配格式：[0526_餐饮活动日报.csv](/tencent/api/attachments/s3/url?attachmentid=45504071)
_ATTACHMENT_RE = re.compile(
    r"\[(\d{4})_餐饮活动日报\.csv\]\([^)]*attachmentid=(\d+)\)"
)


def load_iwiki_activity_attachments(docid: str = IWIKI_DOC_ID) -> Dict[str, int]:
    """
    解析 iWiki 页面附件列表。
    返回 { "2026-05-26": 45504071, ... }
    """
    content = _run_iwiki_cli(["get", docid])
    mapping: Dict[str, int] = {}
    for m in _ATTACHMENT_RE.finditer(content):
        mmdd = m.group(1)  # "0526"
        att_id = int(m.group(2))
        try:
            month = int(mmdd[:2])
            day = int(mmdd[2:])
            # 文件命名只有 MMDD，年份默认当前年
            year = datetime.now().year
            iso = f"{year:04d}-{month:02d}-{day:02d}"
            # 校验
            datetime.strptime(iso, "%Y-%m-%d")
            mapping[iso] = att_id
        except ValueError:
            continue
    if not mapping:
        raise RuntimeError(
            f"iWiki 页面 {docid} 未解析到 MMDD_餐饮活动日报.csv 附件。"
            f" 页面内容前200字: {content[:200]}"
        )
    print(f"[iWiki·活动] 附件列表: {len(mapping)} 个日期 "
          f"({min(mapping.keys())} ~ {max(mapping.keys())})")
    return mapping


# ── CSV 下载 ──

def _cache_path(date_str: str) -> str:
    return os.path.join(CACHE_DIR, f"iwiki_activity_{date_str}.csv")


def _download_attempt(attachment_id: int, tmp_path: str) -> Tuple[bool, str]:
    if os.path.isfile(tmp_path):
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    cmd = [IWIKI_CLI, "download", str(attachment_id), "--output", tmp_path]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=CLI_TIMEOUT, env=_iwiki_env(),
        )
    except subprocess.TimeoutExpired:
        return False, f"subprocess 超时 ({CLI_TIMEOUT}s)"

    output = (result.stdout or "") + (result.stderr or "")

    if result.returncode != 0:
        return False, f"exit={result.returncode}: {output.strip()[:200]}"

    lower = output.lower()
    if "错误" in output or "failed" in lower or "deadline exceeded" in lower or "timeout" in lower:
        return False, f"cli 报错: {output.strip()[:200]}"

    if not os.path.isfile(tmp_path):
        return False, "下载完成但文件不存在"

    size = os.path.getsize(tmp_path)
    if size < DOWNLOAD_MIN_BYTES:
        return False, f"文件过小 ({size} bytes < {DOWNLOAD_MIN_BYTES})"

    try:
        with open(tmp_path, "r", encoding="utf-8-sig", errors="strict") as f:
            first_line = f.readline()
        if "," not in first_line:
            return False, f"首行不像 CSV: {first_line[:80]!r}"
    except UnicodeDecodeError as e:
        return False, f"文件编码异常: {e}"

    return True, ""


def download_activity_csv(attachment_id: int, date_str: str) -> str:
    """下载并缓存 CSV，返回本地路径。"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cached = _cache_path(date_str)
    if os.path.isfile(cached):
        print(f"[iWiki·活动] 缓存命中: {cached}")
        return cached

    tmp_path = cached + ".tmp"
    last_err = ""
    for attempt in range(1, DOWNLOAD_MAX_ATTEMPTS + 1):
        ok, err = _download_attempt(attachment_id, tmp_path)
        if ok:
            os.rename(tmp_path, cached)
            size_kb = os.path.getsize(cached) / 1024
            print(f"[iWiki·活动] 已下载: {date_str} → {cached} "
                  f"({size_kb:.1f} KB, 第{attempt}次尝试)")
            return cached

        last_err = err
        if attempt < DOWNLOAD_MAX_ATTEMPTS:
            wait = DOWNLOAD_RETRY_BACKOFF[min(attempt - 1, len(DOWNLOAD_RETRY_BACKOFF) - 1)]
            print(f"[iWiki·活动] 下载失败 (第{attempt}/{DOWNLOAD_MAX_ATTEMPTS}次): {err}；"
                  f"{wait}s 后重试...")
            time.sleep(wait)
        else:
            print(f"[iWiki·活动] 下载失败 (第{attempt}/{DOWNLOAD_MAX_ATTEMPTS}次): {err}")

    if os.path.isfile(tmp_path):
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    raise RuntimeError(
        f"iwiki-cli download {attachment_id} 重试 {DOWNLOAD_MAX_ATTEMPTS} 次均失败。"
        f" 最后一次错误: {last_err}"
    )


# ── CSV 字段名 → 中文映射 ──
# iWiki CSV 用英文字段名，这里转成 sync_v2.py FIELD_MAP 已经认识的中文字段名，
# 这样下游 _map_row() 完全不用改，省一大堆兼容代码。

ENG_TO_CN = {
    "fbrandid_1":                          "品牌ID",
    "fbrandname_15":                       "品牌名称",
    "category_name_48":                    "品类名称",
    "factid_99":                           "活动ID",
    "factname_75":                         "活动名称",
    "str_stock_id_26":                     "券批次id",
    "stock_name_37":                       "批次名称",
    "act_price_comparison_avg_11":         "活动价格力（各渠道有值渠道的算术平均）",
    "act_start_date_62":                   "活动开始时间",
    "act_end_date_86":                     "活动结束时间",
    "fmaxcount_64":                        "发券总库存",
    "remain_inventory_94":                 "券剩余库存",
    "coupon_type_label_73":                "券类型",
    "discount_threshold_4":                "优惠门槛",
    "discount_amount_42":                  "优惠金额",
    # 新增的两个限领字段
    "fuserlimitperact_84":                 "单用户限领",
    "fdailylimitperact_86":                "单日限领",
    # 数据指标
    "max_a0_cur_fexpose_cnt_72":           "曝光数(最大值)",
    "max_a0_cur_fsend_cnt_43":             "领取数(最大值)",
    "max_a0_cur_fconsume_cnt_81":          "核销数(最大值)",
    "max_a0_cur_fexpose_uin_cnt_67":       "曝光uin数(最大值)",
    "max_a0_cur_fsend_uin_cnt_57":         "领取uin数(最大值)",
    "max_a0_cur_fconsume_uin_cnt_46":      "核销uin数(最大值)",
    "max_a1_claim_at_shop_rate_uv_13":     "领取到店率_uv\t(最大值)",
    "max_a1_redeem_when_claim_rate_uv_75": "领取核销率_uv\t(最大值)",
    "max_a1_redeem_at_shop_rate_uv_56":    "到店核销率_uv\t(最大值)",
    "max_a1_visit_below_threshold_percent_70": "到店未达门槛占比(最大值)",
}


def parse_activity_csv(csv_path: str) -> List[Dict[str, str]]:
    """
    解析活动日报 CSV，把英文列名转中文（对齐 sync_v2.py FIELD_MAP）。
    """
    rows: List[Dict[str, str]] = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cleaned: Dict[str, str] = {}
            for k, v in row.items():
                key = (k or "").strip()
                cn_key = ENG_TO_CN.get(key, key)  # 没在映射表里的保留原名
                cleaned[cn_key] = v
            rows.append(cleaned)
    return rows


def load_activity_daily_from_iwiki(
    report_date: str,
    attachments: Optional[Dict[str, int]] = None,
) -> List[Dict[str, str]]:
    """
    主入口：下载并解析指定日期的活动 CSV。
    返回 [{中文列名: 值, ...}, ...]，可直接喂给 sync_v2._map_row()。
    """
    if attachments is None:
        attachments = load_iwiki_activity_attachments()

    att_id = attachments.get(report_date)
    if att_id is None:
        raise RuntimeError(
            f"iWiki 附件列表中没有 {report_date} 的活动日报 CSV。"
            f" 可用日期: {sorted(attachments.keys())}"
        )

    csv_path = download_activity_csv(att_id, report_date)
    rows = parse_activity_csv(csv_path)
    print(f"[iWiki·活动] 加载 {report_date}: {len(rows)} 行活动数据")
    return rows


# ── 独立测试入口 ──

if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="iWiki 餐饮活动日报 CSV 加载器")
    ap.add_argument("--date", help="指定日期 YYYY-MM-DD")
    ap.add_argument("--list", action="store_true", help="列出所有可用日期")
    args = ap.parse_args()

    att = load_iwiki_activity_attachments()

    if args.list or not args.date:
        print(f"\n可用日期 ({len(att)} 个):")
        for d in sorted(att.keys()):
            print(f"  {d}  (attachment_id={att[d]})")
        if not args.date:
            sys.exit(0)

    rows = load_activity_daily_from_iwiki(args.date, att)
    if rows:
        print(f"\n列名 ({len(rows[0])} 列):")
        for i, col in enumerate(rows[0].keys()):
            print(f"  [{i}] {col}")
        print(f"\n前2行预览:")
        for r in rows[:2]:
            print(f"  {r.get('品牌ID','?')} {r.get('品牌名称','?')} - "
                  f"{r.get('活动名称','?')[:40]} | "
                  f"单用户限领={r.get('单用户限领','?')} 单日限领={r.get('单日限领','?')}")
