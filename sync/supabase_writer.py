"""
supabase_writer.py - Supabase 写入器
封装 upsert 批量写入逻辑
"""
import os
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from supabase import create_client, Client


def get_client() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    if not url or not key:
        raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_KEY 环境变量")
    return create_client(url, key)


def upsert_batch(client: Client, table: str, rows: list[dict],
                  conflict_columns: list[str], batch_size: int = 100):
    """
    分批 upsert 写入
    - table: 表名
    - rows: 要写入的数据行
    - conflict_columns: 冲突判断列（主键）
    - batch_size: 每批条数
    """
    if not rows:
        print(f"  → {table}: 无数据，跳过")
        return

    total = len(rows)
    written = 0
    for i in range(0, total, batch_size):
        batch = rows[i : i + batch_size]
        try:
            result = (
                client.table(table)
                .upsert(batch, on_conflict=",".join(conflict_columns))
                .execute()
            )
            written += len(batch)
            print(f"  → {table}: 已写入 {written}/{total}")
        except Exception as e:
            print(f"  ✗ {table} 写入失败 (batch {i}-{i+len(batch)}): {e}")
            # 逐条重试
            for row in batch:
                try:
                    client.table(table).upsert(
                        row, on_conflict=",".join(conflict_columns)
                    ).execute()
                    written += 1
                except Exception as e2:
                    print(f"    ✗ 单条写入失败: {e2} | 数据: {list(row.values())[:3]}...")

    print(f"  ✓ {table}: 完成，共 {written}/{total} 条")


# ============================================================
# 子进程逐条 upsert —— 绕过 supabase-py + LibreSSL 静默失败
# ============================================================
_WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "brand_daily_worker.py")
_PY = "/usr/bin/python3"


def upsert_batch_subproc(client, table, rows, conflict_columns, max_workers=12):
    """逐行 spawn 独立子进程做单条 upsert。

    解决 supabase-py 在 LibreSSL 下『同进程首请求成功、后续静默失败』的退化：
    每个子进程仅执行一次 upsert（即子进程内的首请求），确保成功落库。
    client 参数保留以兼容 upsert_batch 调用形式，但子进程自建客户端（忽略传入 client）。

    返回 (成功数, 失败数)。
    """
    if not rows:
        print(f"  → {table}: 无数据，跳过")
        return 0, 0

    conflict = ",".join(conflict_columns)
    total = len(rows)
    done = 0
    failed = []

    def _one(row):
        payload = json.dumps(
            {"table": table, "conflict": conflict, "row": row},
            ensure_ascii=False,
        )
        try:
            p = subprocess.Popen(
                [_PY, _WORKER],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=os.environ.copy(),
            )
            out, err = p.communicate(payload + "\n", timeout=60)
            return p.returncode, out.strip(), err.strip()
        except subprocess.TimeoutExpired:
            try:
                p.kill()
            except Exception:
                pass
            return 1, "TIMEOUT", ""

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = [ex.submit(_one, r) for r in rows]
        for i, f in enumerate(futs, 1):
            rc, out, err = f.result()
            if rc == 0 and out == "OK":
                done += 1
            else:
                failed.append((i, out, err, rows[i - 1]))
            if i % 100 == 0 or i == total:
                print(f"  进度 {i}/{total} (成功 {done}, 失败 {len(failed)})")

    if failed:
        print(f"  ✗ {table}: {len(failed)} 条失败，示例:")
        for i, out, err, row in failed[:5]:
            bid = row.get("brand_id", "?")
            print(f"    #{i} brand_id={bid}: {out} {err}")

    print(f"  ✓ {table}: 完成，成功 {done}/{total}")
    return done, len(failed)
