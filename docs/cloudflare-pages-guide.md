# Cloudflare Pages 部署指引（act_temp 项目）

## 第一步：删除现有的 Worker

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **Workers & Pages**
3. 找到 **acttemp**，点进去
4. 顶部菜单 → **Settings**
5. 页面最底部 → **Delete** → 确认删除

---

## 第二步：创建 Pages 项目

1. 回到 **Workers & Pages** 页面
2. 点右上角 **Create**
3. 这次选 **Pages** 标签页（不是 Workers！）
4. 选 **Connect to Git**
5. 选择 GitHub → 授权 → 找到 **jingnanss21-rgb/act_temp** 仓库
6. 填写配置：

| 配置项 | 填写内容 |
|--------|----------|
| Project name | `act-temp`（或你喜欢的名字） |
| Production branch | `main` |
| Build command | **留空**（不填！） |
| Build output directory | `site` |

7. 点 **Save and Deploy**

---

## 第三步：等待部署完成

- 部署大约 1-2 分钟
- 完成后会给你一个链接，格式类似：`https://act-temp.pages.dev`
- 以后每次 push 到 main 分支，会自动触发重新部署

---

## 常见问题

**Q: Build output directory 在哪填？**
A: 在 "Build settings" 区域，展开后就能看到

**Q: 为什么之前 Worker 不行？**
A: Worker 是运行 JS 代码的，不能直接托管静态 HTML 文件。Pages 才是静态网站托管服务

**Q: 部署后域名是什么？**
A: `https://<project-name>.pages.dev`，你也可以后续绑定自定义域名
