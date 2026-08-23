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
# 主 doc（旧，字段完整：27 列，含 category/threshold/amount/stock/limit 等）
IWIKI_DOC_ID = os.environ.get("IWIKI_ACTIVITY_DOC_ID", "4020417529")
# 兜底 doc（新，30 列但字段少）：仅当主 doc 缺某日期时使用
IWIKI_DOC_ID_FALLBACK = os.environ.get("IWIKI_ACTIVITY_DOC_ID_FALLBACK", "4020370034")

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
# 兼容两种命名格式：
#   新（doc 4020370034）：[YYYYMMDD_活动.csv](...attachmentid=NNN)
#   旧（doc 4020417529）：[MMDD_餐饮活动日报.csv](...attachmentid=NNN)
_ATTACHMENT_RE_NEW = re.compile(
    r"\[(\d{8})_活动\.csv\]\([^)]*attachmentid=(\d+)\)"
)
_ATTACHMENT_RE_OLD = re.compile(
    r"\[(\d{4})_餐饮活动日报\.csv\]\([^)]*attachmentid=(\d+)\)"
)


def load_iwiki_activity_attachments(docid: str = IWIKI_DOC_ID) -> Dict[str, int]:
    """
    解析 iWiki 页面附件列表。
    返回 { "2026-05-26": 45504071, ... }

    合并策略：主 doc（IWIKI_DOC_ID）优先；主 doc 缺失的日期由 fallback doc
    （IWIKI_DOC_ID_FALLBACK）回填。因为主 doc（旧）字段更完整，只有少数日期
    缺文件时才使用兜底 doc（新）。
    """
    def _parse(content: str, mapping: Dict[str, int], overwrite: bool) -> None:
        # 新格式：YYYYMMDD_活动.csv
        for m in _ATTACHMENT_RE_NEW.finditer(content):
            yyyymmdd = m.group(1)
            att_id = int(m.group(2))
            try:
                iso = f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:]}"
                datetime.strptime(iso, "%Y-%m-%d")
                if overwrite or iso not in mapping:
                    mapping[iso] = att_id
            except ValueError:
                continue
        # 旧格式：MMDD_餐饮活动日报.csv
        for m in _ATTACHMENT_RE_OLD.finditer(content):
            mmdd = m.group(1)
            att_id = int(m.group(2))
            try:
                month = int(mmdd[:2])
                day = int(mmdd[2:])
                year = datetime.now().year
                iso = f"{year:04d}-{month:02d}-{day:02d}"
                datetime.strptime(iso, "%Y-%m-%d")
                if overwrite or iso not in mapping:
                    mapping[iso] = att_id
            except ValueError:
                continue

    mapping: Dict[str, int] = {}

    # 主 doc
    content_main = _run_iwiki_cli(["get", docid])
    _parse(content_main, mapping, overwrite=True)
    n_main = len(mapping)

    # 兜底 doc（可选，环境变量 IWIKI_DOC_ID_FALLBACK；同 docid 时跳过）
    fallback = IWIKI_DOC_ID_FALLBACK
    if fallback and fallback != docid:
        try:
            content_fb = _run_iwiki_cli(["get", fallback])
            _parse(content_fb, mapping, overwrite=False)
            print(f"[iWiki·活动] 主 doc {docid}: {n_main} 天; "
                  f"兜底 doc {fallback} 补 {len(mapping) - n_main} 天")
        except Exception as e:
            print(f"[iWiki·活动] 兜底 doc {fallback} 加载失败（忽略）: {e}")

    if not mapping:
        raise RuntimeError(
            f"iWiki 页面 {docid} 未解析到活动 CSV 附件"
            f"（YYYYMMDD_活动.csv 或 MMDD_餐饮活动日报.csv）。"
            f" 页面内容前200字: {content_main[:200]}"
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
# iWiki CSV 字段名格式为 "前缀_随机数字"，每次导出后缀数字不同，
# 所以用前缀匹配（去掉末尾 _\d+ 后匹配）。

PREFIX_TO_CN = {
    "fbrandid":                          "品牌ID",
    "fbrandname":                        "品牌名称",
    "category_name":                     "品类名称",
    "factid":                            "活动ID",
    "factname":                          "活动名称",
    "str_stock_id":                      "券批次id",
    "stock_name":                        "批次名称",
    "act_price_comparison_avg":          "活动价格力（各渠道有值渠道的算术平均）",
    "act_start_date":                    "活动开始时间",
    "act_end_date":                      "活动结束时间",
    "fmaxcount":                         "发券总库存",
    "remain_inventory":                  "券剩余库存",
    "coupon_type_label":                 "券类型",
    "discount_threshold":                "优惠门槛",
    "discount_amount":                   "优惠金额",
    "fuserlimitperact":                  "单用户限领",
    "fdailylimitperact":                 "单日限领",
    "max_a0_cur_fexpose_cnt":            "曝光数(最大值)",
    "d7_fexpose_cnt":                    "曝光数(最大值)",
    "max_a0_cur_fsend_cnt":              "领取数(最大值)",
    "d7_fsend_cnt":                      "领取数(最大值)",
    "max_a0_cur_fconsume_cnt":           "核销数(最大值)",
    "d7_fconsume_cnt":                   "核销数(最大值)",
    "max_a0_cur_fexpose_uin_cnt":        "曝光uin数(最大值)",
    "cur_fexpose_uin_cnt":               "曝光uin数(最大值)",
    "max_a0_cur_fsend_uin_cnt":          "领取uin数(最大值)",
    "cur_fsend_uin_cnt":                 "领取uin数(最大值)",
    "max_a0_cur_fconsume_uin_cnt":       "核销uin数(最大值)",
    "cur_fconsume_uin_cnt":              "核销uin数(最大值)",
    "max_a1_claim_at_shop_rate_uv":      "领取到店率_uv\t(最大值)",
    "claim_at_shop_rate_uv":             "领取到店率_uv\t(最大值)",
    # 业务命名修正（2026-06-04）：底表英文字段名与业务中文名不直接对应
    # redeem_when_claim_rate（领后核销转化率，约 0.30~0.50）才是业务"到店核销率"
    # redeem_at_shop_rate（核销时是否在门店，约 0.94~0.99）才是业务"核销到店率"
    "max_a1_redeem_when_claim_rate_uv":  "到店核销率_uv\t(最大值)",
    "redeem_when_claim_rate_uv":         "到店核销率_uv\t(最大值)",
    "max_a1_redeem_at_shop_rate_uv":     "核销到店率_uv\t(最大值)",
    "redeem_at_shop_rate_uv":            "核销到店率_uv\t(最大值)",
    "max_a1_visit_below_threshold_percent": "到店未达门槛占比(最大值)",
    "visit_below_threshold_percent":     "到店未达门槛占比(最大值)",
}

# ── 2026-08-05 起主 doc 4020417529 正版日报改用「全中文业务命名」 ──
# 此前是英文列名带随机数字后缀（fbrandid_91 / str_stock_id_96 ...），
# 08-05 起整体换成中文（27 列顺序不变）。不加这批别名会让 sync_v2.FIELD_MAP
# 匹配不上 → 曝光/领取/核销等核心指标全部落库为 0。
CN_HEADER_ALIAS = {
    "品牌ID":            "品牌ID",
    "品牌名称":          "品牌名称",
    "品类":              "品类名称",
    "活动ID":            "活动ID",
    "活动名称":          "活动名称",
    "券批次ID":          "券批次id",
    "券名称":            "批次名称",
    "活动均价对比":      "活动价格力（各渠道有值渠道的算术平均）",
    "活动开始日期":      "活动开始时间",
    "活动结束日期":      "活动结束时间",
    "活动总库存":        "发券总库存",
    "剩余库存":          "券剩余库存",
    "券类型":            "券类型",
    "优惠门槛":          "优惠门槛",
    "优惠金额":          "优惠金额",
    "每人限领":          "单用户限领",
    "每日限领":          "单日限领",
    "曝光次数":          "曝光数(最大值)",
    "发放次数":          "领取数(最大值)",
    "核销次数":          "核销数(最大值)",
    "曝光人数":          "曝光uin数(最大值)",
    "发放人数":          "领取uin数(最大值)",
    "核销人数":          "核销uin数(最大值)",
    "领券到店率":        "领取到店率_uv\t(最大值)",
    "领取到店率":        "领取到店率_uv\t(最大值)",
    # 与英文侧一致：redeem_when_claim（核销时领券率）才是业务"到店核销率"
    "核销时领券率":      "到店核销率_uv\t(最大值)",
    "核销到店率":        "核销到店率_uv\t(最大值)",
    "到店未达门槛占比":  "到店未达门槛占比(最大值)",
}

# 预编译：去掉末尾 _数字 的正则
_SUFFIX_RE = re.compile(r"_\d+$")


def _match_prefix(col_name: str) -> str:
    """把 CSV 列名（如 fbrandid_37 / 曝光次数）转为中文标准列名，匹配不到则原样返回。"""
    stripped = _SUFFIX_RE.sub("", col_name)  # "fbrandid_37" → "fbrandid"
    cn = PREFIX_TO_CN.get(stripped)
    if cn:
        return cn
    # 2026-08-05 起的全中文表头
    cn = CN_HEADER_ALIAS.get(col_name)
    if cn:
        return cn
    # fallback: 原名
    return col_name


def parse_activity_csv(csv_path: str) -> List[Dict[str, str]]:
    """
    解析活动日报 CSV，把英文列名转中文（对齐 sync_v2.py FIELD_MAP）。
    使用前缀匹配，兼容每次导出后缀数字变化。
    编码兼容：先试 UTF-8，失败用 GBK（errors=replace 容忍少量脏字节）。
    """
    # 检测编码：UTF-8 能解开就用 UTF-8，否则用 GBK
    encoding = "utf-8-sig"
    with open(csv_path, "rb") as fb:
        raw = fb.read()
    try:
        raw.decode("utf-8")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        # 非 UTF-8，用 GBK（容忍少量脏字节）
        encoding = "gbk"

    rows: List[Dict[str, str]] = []
    with open(csv_path, "r", encoding=encoding, errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cleaned: Dict[str, str] = {}
            for k, v in row.items():
                key = (k or "").strip()
                cn_key = _match_prefix(key)
                cleaned[cn_key] = v
            rows.append(cleaned)

    # ── 护栏（2026-08-06 加）：数据源列名整体改版时，映射会静默失效，
    #    核心指标全部落库为 0，看板看不出异常。宁可炸也不能静默写脏数。
    if rows:
        n = len(rows)
        miss_batch = sum(1 for r in rows if not (r.get("券批次id") or "").strip())
        miss_exp = sum(1 for r in rows if not (r.get("曝光数(最大值)") or "").strip())
        if miss_batch > n * 0.5 or miss_exp > n * 0.9:
            raise RuntimeError(
                f"[iWiki·活动] {os.path.basename(csv_path)} 列名映射失效："
                f"券批次id 缺失 {miss_batch}/{n}，曝光数 缺失 {miss_exp}/{n}。"
                f"数据源表头很可能改版，请核对后补充 PREFIX_TO_CN / CN_HEADER_ALIAS 再重跑。"
            )
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
