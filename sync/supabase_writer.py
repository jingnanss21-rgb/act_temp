"""
supabase_writer.py - Supabase 写入器
封装 upsert 批量写入逻辑
"""
import os
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
