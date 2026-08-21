"""
pull_segments.py - 人群覆盖配置同步（需求二·数据接入，方案 B：直接拉 iwiki）

数据来源：iwiki「餐饮活动全字段数据（131列）」docid 4026097627
抽取字段：活动ID / 定向标签_频次正选 / 定向标签_频次排除
落库表：  act_segment_config(activity_id PK, freq_include, freq_exclude, updated_at)

流程：
  1. iwiki-cli get 4026097627 → 解析下载链接表 → 取最新日期的 attachmentid
  2. iwiki-cli download <attachmentid> → 下载当天 CSV（约 17~19MB / 131 列）
  3. 抽取 3 列，按 activity_id 去重（人群定向是活动级静态属性，取 first）
  4. upsert 进 act_segment_config（复用 supabase_writer）

判定逻辑（与前端 parseSegments 保持一致，详见 iwiki 4033860123）：
  - 正选非空 → 正向定向，覆盖 = 正选列出的层（不含新客）
  - 排除非空 → 负向排除，覆盖 = 五层 - 被排除层（含新客）
  - 两者皆空 → 通投，覆盖 = 全部五层

依赖：
  - iwiki-cli（需环境变量 IWIKI_TOKEN，PAT 从 https://tai.it.woa.com/user/pat 获取）
  - supabase_writer（需 SUPABASE_URL / SUPABASE_KEY 环境变量，与 sync_v2 一致）

用法：
  python3 pull_segments.py            # 拉最新一天并同步
  python3 pull_segments.py --dry-run  # 只抽取+打印统计，不写库（用于验证）
"""

import os
import re
import sys
import csv
import subprocess
import argparse

# 全字段表含超长字段（如 base64 推荐池信息），放宽 csv 字段上限
csv.field_size_limit(sys.maxsize)

# ── iwiki 文档 ──
IWIKI_DOC_ID = "4026097627"
SRC_COLS = {
    "活动ID": "activity_id",
    "定向标签_频次正选": "freq_include",
    "定向标签_频次排除": "freq_exclude",
}

SEGMENTS = ["高频", "低频", "沉默", "流失", "新客"]
FREQ_4 = ["高频", "低频", "沉默", "流失"]


# ============================================================
# 1. 取最新日期的 attachmentid
# ============================================================
def get_latest_attachment_id(token: str) -> str:
    """iwiki-cli get 文档 → 解析下载链接表 → 返回最新日期的 attachmentid"""
    out = subprocess.run(
        ["iwiki-cli", "get", IWIKI_DOC_ID],
        env={**os.environ, "IWIKI_TOKEN": token},
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"iwiki-cli get 失败: {out.stderr[:300]}")

    # 每行形如: | 2026-08-19 | ... | [...](...attachmentid=58021614) |
    pattern = re.compile(r"\|\s*(\d{4}-\d{2}-\d{2})\s*\|.*?attachmentid=(\d+)")
    found = []
    for m in pattern.finditer(out.stdout):
        found.append((m.group(1), m.group(2)))
    if not found:
        raise RuntimeError("未在文档中找到任何 attachmentid 下载链接")

    # 取日期最大者（文档按日期倒序，但保险起见排序）
    found.sort(key=lambda x: x[0], reverse=True)
    print(f"  → 找到 {len(found)} 个日期附件，最新: {found[0][0]} (attachmentid={found[0][1]})")
    return found[0][1]


def download_csv(attachment_id: str, token: str, out_path: str) -> str:
    print(f"  → 下载 CSV → {out_path}")
    r = subprocess.run(
        ["iwiki-cli", "download", attachment_id, "--output", out_path],
        env={**os.environ, "IWIKI_TOKEN": token},
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"iwiki-cli download 失败: {r.stderr[:300]}")
    return out_path


# ============================================================
# 2. 抽取 + 去重
# ============================================================
def extract_segments(csv_path: str) -> list:
    """
    读取全字段表 CSV，抽取 3 列，按 activity_id 去重（取首次出现）。
    返回 [{"activity_id","freq_include","freq_exclude"}, ...]
    """
    rows = []
    seen = set()
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            aid = (row.get("活动ID") or "").strip()
            if not aid:
                continue
            if aid in seen:
                continue
            seen.add(aid)
            rows.append({
                "activity_id": aid,
                "freq_include": (row.get("定向标签_频次正选") or "").strip(),
                "freq_exclude": (row.get("定向标签_频次排除") or "").strip(),
            })
    print(f"  → 抽取完成：去重后 {len(rows)} 个活动")
    return rows


# ============================================================
# 3. 判定逻辑（与前端保持一致，便于服务端校验/复用）
# ============================================================
def parse_segments(include_raw, exclude_raw):
    inc = [x.strip() for x in str(include_raw or "").split(",") if x.strip()]
    exc = [x.strip().replace("排除", "") for x in str(exclude_raw or "").split(",") if x.strip()]

    if inc:                                    # 正向定向
        segs = [s for s in FREQ_4 if s in inc]  # 不含新客
        return {"mode": "正向定向", "segments": segs}
    if exc:                                    # 负向排除
        segs = [s for s in FREQ_4 if s not in exc] + ["新客"]
        return {"mode": "负向排除", "segments": segs}
    return {"mode": "通投", "segments": list(SEGMENTS)}  # 全人群通投


# ============================================================
# 主流程
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="人群覆盖配置同步（iwiki 全字段表 → act_segment_config）")
    parser.add_argument("--dry-run", action="store_true", help="只抽取+打印统计，不写库")
    parser.add_argument("--csv", default="", help="直接指定已下载的 CSV 路径（跳过 iwiki 拉取）")
    args = parser.parse_args()

    token = os.getenv("IWIKI_TOKEN", "")
    if not args.csv and not token:
        print("✗ 缺少 IWIKI_TOKEN 环境变量（PAT 从 https://tai.it.woa.com/user/pat 获取）")
        sys.exit(1)

    # 1~2. 获取 CSV
    if args.csv:
        csv_path = args.csv
        print(f"使用本地 CSV: {csv_path}")
    else:
        att_id = get_latest_attachment_id(token)
        csv_path = "/tmp/quan_field_latest.csv"
        download_csv(att_id, token, csv_path)

    # 3. 抽取
    rows = extract_segments(csv_path)

    # 统计（验证用）
    inc_n = sum(1 for r in rows if r["freq_include"])
    exc_n = sum(1 for r in rows if r["freq_exclude"])
    print(f"  → 正向定向(正选非空): {inc_n} | 负向排除(排除非空): {exc_n} | 通投(皆空): {len(rows)-inc_n-exc_n}")

    if args.dry_run:
        print("  [dry-run] 跳过写库")
        # 打印几个样例
        for r in rows[:3]:
            print("   样例:", r["activity_id"], parse_segments(r["freq_include"], r["freq_exclude"]))
        return

    # 4. 写库（用子进程版规避 LibreSSL 下 in-process 客户端静默失败）
    from supabase_writer import upsert_batch_subproc
    upsert_batch_subproc(None, "act_segment_config", rows, conflict_columns=["activity_id"])
    print("✓ act_segment_config 同步完成")


if __name__ == "__main__":
    main()
