#!/usr/bin/env python3
"""
iwiki_brand_loader.py - 从 iWiki 页面下载品牌日报 CSV 附件

替代原 sync_all.py 中 sync_brand_daily() 的腾讯文档两跳读取链路。
iWiki 页面 docid=4019899005，每天一个 CSV 附件（YYYYMMDD_品牌.csv）。

用法（模块导入）:
    from iwiki_brand_loader import load_iwiki_attachments, load_brand_daily_from_iwiki

用法（独立测试）:
    python iwiki_brand_loader.py                    # 列出所有可用日期
    python iwiki_brand_loader.py --date 2026-05-11  # 下载并查看指定日期 CSV 列名
"""
from __future__ import annotations

import csv
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ── 常量 ──

IWIKI_CLI = str(Path.home() / ".iwiki" / "iwiki-cli")
IWIKI_DOC_ID = os.environ.get("IWIKI_DOC_ID", "4019899005")

# subprocess 超时（秒）
CLI_TIMEOUT = 60

# 下载重试参数（iwiki-cli 下载 COS 时偶发 context deadline exceeded，
# 且失败时 exit code 仍为 0，仅在 stdout 输出错误。需要外层做重试 + 校验。）
DOWNLOAD_MAX_ATTEMPTS = int(os.environ.get("IWIKI_DOWNLOAD_RETRY", "5"))
DOWNLOAD_RETRY_BACKOFF = (5, 15, 30, 60, 120)  # 各次重试前等待秒数
# CSV 至少应该这么大，否则视为下载失败（品牌日报正常 ~500KB）
DOWNLOAD_MIN_BYTES = int(os.environ.get("IWIKI_DOWNLOAD_MIN_BYTES", "10240"))

# 同步目录下的缓存子目录
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_iwiki_cache")


def _read_token_from_config() -> Optional[str]:
    """从 ~/.iwiki/config.toml 读取 auth.token。"""
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
    """构造 iwiki-cli 运行环境。"""
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
    """执行 iwiki-cli 子命令，返回 stdout 文本。"""
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

# 匹配格式：[20260510_品牌.csv](/tencent/api/attachments/s3/url?attachmentid=44672209)
_ATTACHMENT_RE = re.compile(
    r"\[(\d{8})_品牌\.csv\]\([^)]*attachmentid=(\d+)\)"
)


def load_iwiki_attachments(docid: str = IWIKI_DOC_ID) -> Dict[str, int]:
    """
    从 iWiki 页面解析品牌日报附件列表。
    返回 { "2026-05-10": 44672209, ... }
    """
    content = _run_iwiki_cli(["get", docid])
    mapping: Dict[str, int] = {}
    for m in _ATTACHMENT_RE.finditer(content):
        raw_date = m.group(1)  # "20260510"
        att_id = int(m.group(2))
        try:
            dt = datetime.strptime(raw_date, "%Y%m%d").date()
            mapping[dt.isoformat()] = att_id
        except ValueError:
            continue
    if not mapping:
        raise RuntimeError(
            f"iWiki 页面 {docid} 未解析到品牌日报 CSV 附件。"
            f" 页面内容前200字: {content[:200]}"
        )
    print(f"[iWiki] 附件列表: {len(mapping)} 个日期 "
          f"({min(mapping.keys())} ~ {max(mapping.keys())})")
    return mapping


# ── CSV 下载与解析 ──

def _cache_path(date_str: str) -> str:
    return os.path.join(CACHE_DIR, f"iwiki_brand_{date_str}.csv")


def _download_attempt(attachment_id: int, tmp_path: str) -> Tuple[bool, str]:
    """
    单次下载尝试。返回 (是否成功, 错误描述)。
    iwiki-cli 的坑：下载失败时 exit=0，错误信息在 stdout，需要解析判断。
    """
    # 清理上次残留
    if os.path.isfile(tmp_path):
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    cmd = [IWIKI_CLI, "download", str(attachment_id), "--output", tmp_path]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT,
            env=_iwiki_env(),
        )
    except subprocess.TimeoutExpired:
        return False, f"subprocess 超时 ({CLI_TIMEOUT}s)"

    output = (result.stdout or "") + (result.stderr or "")

    # 1) cli exit 非 0
    if result.returncode != 0:
        return False, f"exit={result.returncode}: {output.strip()[:200]}"

    # 2) cli 自报错误（exit=0 但 stdout 含"错误"/"failed"/"超时")
    lower = output.lower()
    if "错误" in output or "failed" in lower or "deadline exceeded" in lower or "timeout" in lower:
        return False, f"cli 报错: {output.strip()[:200]}"

    # 3) 文件未生成
    if not os.path.isfile(tmp_path):
        return False, "下载完成但文件不存在"

    # 4) 文件过小（很可能是空文件或错误页）
    size = os.path.getsize(tmp_path)
    if size < DOWNLOAD_MIN_BYTES:
        return False, f"文件过小 ({size} bytes < {DOWNLOAD_MIN_BYTES})"

    # 5) 简单校验内容是 CSV（首行包含逗号且能 utf-8 解码）
    try:
        with open(tmp_path, "r", encoding="utf-8-sig", errors="strict") as f:
            first_line = f.readline()
        if "," not in first_line:
            return False, f"首行不像 CSV: {first_line[:80]!r}"
    except UnicodeDecodeError as e:
        return False, f"文件编码异常: {e}"

    return True, ""


def download_brand_csv(
    attachment_id: int,
    date_str: str,
) -> str:
    """
    下载 iWiki 品牌日报 CSV 到缓存目录，返回文件路径。
    本地已有缓存则直接返回。
    iwiki-cli 下载偶发 COS 超时（且失败不返回错误码），内置重试 + 内容校验。
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    cached = _cache_path(date_str)
    if os.path.isfile(cached):
        print(f"[iWiki] 缓存命中: {cached}")
        return cached

    tmp_path = cached + ".tmp"
    last_err = ""

    for attempt in range(1, DOWNLOAD_MAX_ATTEMPTS + 1):
        ok, err = _download_attempt(attachment_id, tmp_path)
        if ok:
            os.rename(tmp_path, cached)
            size_kb = os.path.getsize(cached) / 1024
            print(f"[iWiki] 已下载: {date_str} → {cached} "
                  f"({size_kb:.1f} KB, 第{attempt}次尝试)")
            return cached

        last_err = err
        if attempt < DOWNLOAD_MAX_ATTEMPTS:
            wait = DOWNLOAD_RETRY_BACKOFF[min(attempt - 1, len(DOWNLOAD_RETRY_BACKOFF) - 1)]
            print(f"[iWiki] 下载失败 (第{attempt}/{DOWNLOAD_MAX_ATTEMPTS}次): {err}；"
                  f"{wait}s 后重试...")
            time.sleep(wait)
        else:
            print(f"[iWiki] 下载失败 (第{attempt}/{DOWNLOAD_MAX_ATTEMPTS}次): {err}")

    # 清理失败残留
    if os.path.isfile(tmp_path):
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    raise RuntimeError(
        f"iwiki-cli download {attachment_id} 重试 {DOWNLOAD_MAX_ATTEMPTS} 次均失败。"
        f" 最后一次错误: {last_err}"
    )


def parse_brand_csv(csv_path: str) -> List[Dict[str, str]]:
    """
    解析品牌日报 CSV，返回行字典列表。
    处理 BOM 编码，列名自动去空白。
    """
    rows = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # 清理列名前后空白
            cleaned = {k.strip(): v for k, v in row.items()}
            rows.append(cleaned)
    return rows


def load_brand_daily_from_iwiki(
    report_date: str,
    attachments: Optional[Dict[str, int]] = None,
) -> List[Dict[str, str]]:
    """
    下载并解析指定日期的品牌日报 CSV。
    返回 [{中文列名: 值, ...}, ...]
    """
    if attachments is None:
        attachments = load_iwiki_attachments()

    att_id = attachments.get(report_date)
    if att_id is None:
        raise RuntimeError(
            f"iWiki 附件列表中没有 {report_date} 的品牌日报 CSV。"
            f" 可用日期: {sorted(attachments.keys())}"
        )

    csv_path = download_brand_csv(att_id, report_date)
    rows = parse_brand_csv(csv_path)
    print(f"[iWiki] 加载 {report_date}: {len(rows)} 行品牌数据")
    return rows


def find_latest_date(attachments: Dict[str, int]) -> str:
    """返回 iWiki 附件列表中最新的日期。"""
    return max(attachments.keys())


# ── CLI 测试入口 ──

if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="iWiki 品牌日报 CSV 加载器")
    ap.add_argument("--date", help="指定日期 YYYY-MM-DD")
    ap.add_argument("--list", action="store_true", help="列出所有可用日期")
    args = ap.parse_args()

    att = load_iwiki_attachments()

    if args.list or not args.date:
        print(f"\n可用日期 ({len(att)} 个):")
        for d in sorted(att.keys()):
            print(f"  {d}  (attachment_id={att[d]})")
        if not args.date:
            sys.exit(0)

    if args.date:
        rows = load_brand_daily_from_iwiki(args.date, att)
        if rows:
            print(f"\n列名 ({len(rows[0])} 列):")
            for i, col in enumerate(rows[0].keys()):
                print(f"  [{i}] {col}")
            print(f"\n前3行预览:")
            for r in rows[:3]:
                brand = r.get("品牌名称", "?")
                bid = r.get("品牌ID", "?")
                print(f"  {bid} {brand}")
