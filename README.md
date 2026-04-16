# 活动运营数据看板

从腾讯文档底表采集数据 → Supabase 存储 → HTML 看板展示，部署到 Cloudflare Pages。

## 项目结构

```
├── sql/init.sql          # Supabase 建表 SQL
├── sync/                 # Python 数据同步脚本
│   ├── sync_all.py       # 主入口
│   ├── doc_reader.py     # 腾讯文档读取器
│   └── supabase_writer.py # Supabase 写入器
└── site/                 # 前端看板（部署目录）
    ├── index.html
    ├── css/custom.css
    └── js/
```

## 快速开始

### 1. 建表

复制 `sql/init.sql` 到 Supabase SQL Editor 执行。

### 2. 数据同步

```bash
cd sync
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 填入真实配置
python sync_all.py
```

### 3. 部署

Cloudflare Pages 配置 Build output directory 为 `site`。
