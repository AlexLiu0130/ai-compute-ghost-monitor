# Ghost Monitor 中国站数据同步交接

更新时间：2026-07-24
项目目录：`/Users/liuqiyu/Desktop/qveris/09_ai_compute_ghost_monitor/site`

## 目标

保持以下职责边界：

- `.com`：运行 QVeris、DeepSeek、D1 和 15 分钟定时采集。
- `.cn`：只接收主站推送，原子写入 JSON，并由 Nginx 提供只读新闻。
- `/api/capture`：在 `.cn` 继续禁用。

不在两边重复采集，不让国内服务器主动读取 `.com`。

## 已确认的故障

- `https://ghost.alexai-lab.cn/api/alerts`：294 条，最新为 2026-07-10。
- `.cn` 的 `/api/capture/status`：`503`，只读镜像。
- `https://ghost.alexai-lab.com/api/alerts`：1,785 条，最新为
  `20260724T010716`。
- 阿里云服务器主动请求 `.com/api/alerts` 会被 Cloudflare 返回 `403`。

因此禁止使用 Nginx 反向代理 `.com/api/alerts`。正确链路是 `.com` 主动向
`.cn` 推送。

## 已实现代码

### 主站

- `app/lib/cn-sync.ts`
  - HTTPS 推送
  - 独立 Bearer Token
  - 内容哈希作为幂等键
  - 12 秒超时、最多三次重试
- `app/lib/capture.ts`
  - D1 写入完成后推送本轮新增或更新记录
  - 国内同步失败只记录为 `cn_sync:*`，不回滚主站采集
- `worker/index.ts`、`cloudflare-env.d.ts`
  - 新增 `CN_SYNC_URL`、`CN_SYNC_TOKEN`
- `scripts/push-cn-snapshot.mjs`
  - 首次上线时推送完整 `.com` 快照，补齐 7 月 10 日后的缺口

### 中国站

- `deploy/cn-sync/server.mjs`
  - 仅监听 `127.0.0.1`
  - Token 使用定时安全比较
  - 限制 12 MB 请求体和 5,000 条记录
  - 按 URL 或“时间 + 标题”幂等 upsert
  - 兼容 ISO 和 `YYYYMMDDTHHMMSS` 时间排序
  - 同目录临时文件 + rename 原子替换
  - 同步状态单独落盘
  - 成功与失败输出结构化日志，不记录 Token 或正文

测试入口：

```bash
npm run test:cn-sync
```

## 一、部署阿里云同步服务

### 1. 确认实际 JSON 路径

先读取当前 Nginx 配置，找到 `.cn/api/alerts` 实际对应的文件路径：

```bash
sudo nginx -T
```

将其记为：

```text
ALERTS_FILE=/实际路径/alerts.json
```

不要凭文档猜测目录。

### 2. 部署服务文件

将仓库中的文件同步到服务器，例如：

```text
/opt/ghost-monitor/deploy/cn-sync/server.mjs
```

生成独立同步密钥：

```bash
openssl rand -hex 32
```

写入只允许 root 读取的 `/etc/ghost-cn-sync.env`：

```text
CN_SYNC_TOKEN=<独立随机密钥>
ALERTS_FILE=/实际路径/alerts.json
PORT=8788
```

```bash
sudo chmod 600 /etc/ghost-cn-sync.env
```

同步进程用户必须对 `ALERTS_FILE` 所在目录有写权限，Nginx 必须有读权限。

### 3. 配置 systemd

创建 `/etc/systemd/system/ghost-cn-sync.service`：

```ini
[Unit]
Description=Ghost Monitor CN alert sync
After=network.target

[Service]
Type=simple
User=www-data
EnvironmentFile=/etc/ghost-cn-sync.env
ExecStart=/usr/bin/node /opt/ghost-monitor/deploy/cn-sync/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

如果服务器 Node 路径或运行用户不同，使用服务器上的实际值。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ghost-cn-sync
curl -sS http://127.0.0.1:8788/health
```

### 4. 只暴露同步 POST

在 `ghost.alexai-lab.cn` 的 HTTPS `server` 块中增加：

```nginx
location = /internal/sync/alerts {
    limit_except POST { deny all; }
    client_max_body_size 12m;
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

保留 `/api/capture` 禁用，不要替换为 `.com` 反代。`/api/alerts` 改为同机
分页读取服务，禁止继续直接返回完整 `alerts.json`：

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types application/json;

location = /api/alerts {
    limit_except GET { deny all; }
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

分页接口每次最多返回 100 条，默认 50 条，并自行发送 ETag 和
`Cache-Control: public, max-age=30, stale-while-revalidate=300`。移除该路径
原有的静态文件 `alias` 和 `Cache-Control: no-store`。同步接口和
`/api/capture` 仍保持 `no-store`。

```bash
sudo nginx -t
sudo systemctl reload nginx
```

未带 Token 的请求必须返回 `401`：

```bash
curl -i -X POST https://ghost.alexai-lab.cn/internal/sync/alerts
```

分页读取验收：

```bash
curl --compressed -sS 'https://ghost.alexai-lab.cn/api/alerts?limit=2'
curl --compressed -sSI 'https://ghost.alexai-lab.cn/api/alerts?limit=50'
```

第一条应返回对象结构 `{version, revision, total, counts, rows, next_cursor}`，
且 `rows` 不超过 2 条。第二条应包含 `Content-Encoding: gzip`、`ETag` 和公共
短缓存响应头，不能再返回数 MB 的完整历史数组。

## 二、配置并发布 `.com` 主站

当前 Sites Project ID：

```text
appgprj_6a509de3199c8191b64b1abb153c02c0
```

已有 secret 不得读取、打印或重设：

- `CAPTURE_TOKEN`
- `DEEPSEEK_API_KEY`
- `QVERIS_API_KEY`

使用 Sites 增加：

```text
CN_SYNC_URL=https://ghost.alexai-lab.cn/internal/sync/alerts
CN_SYNC_TOKEN=<与阿里云相同的独立密钥，secret=true>
```

然后：

1. 审核全部 diff，确保没有密钥和个人数据。
2. 运行 `npm test`。
3. 经用户授权后 commit 并 push 准确源码。
4. 构建 Sites archive。
5. `save_site_version` 的 `commit_sha` 必须等于已 push 的 HEAD。
6. 当前站点是 public；取得用户明确发布批准后使用 `deploy_site_version`。
7. 非终态部署使用 `get_deployment_status` 跟踪。

不得调用 `create_site`，不得使用未 push 的 commit 或不匹配的 archive。

## 三、首次全量补齐

增量推送只包含本轮写入记录，因此上线后需要从一台可以同时访问两站的机器
执行一次全量补齐：

```bash
CN_SYNC_URL=https://ghost.alexai-lab.cn/internal/sync/alerts \
CN_SYNC_TOKEN='<同步密钥>' \
node scripts/push-cn-snapshot.mjs
```

脚本按 100 条一页遍历 `.com/api/alerts`，并分批通过鉴权接口写入 `.cn`；
历史规模增长不会形成单个超大请求。不要在阿里云服务器执行，因为该服务器
访问 `.com` 会收到 403。

重复执行相同快照是安全的：内容哈希和 upsert 会阻止重复记录。

## 四、验收

```bash
curl -sS 'https://ghost.alexai-lab.cn/api/alerts?limit=1' \
  | jq '{total,counts,latest:(.rows[0] | {published_at,title,source}),next_cursor}'

curl -sS http://127.0.0.1:8788/health
sudo journalctl -u ghost-cn-sync --since "30 minutes ago"
```

完成标准：

- `.cn` 最新 `published_at` 与 `.com` 一致。
- `.cn` 列表刷新后出现最新新闻；前端每 5 分钟刷新第一页。
- 重复推送不会增加重复记录。
- 错误 Token 返回 `401`。
- `/api/capture` 在 `.cn` 仍不可用。
- `.com` 采集在 `.cn` 同步失败时仍能正常完成。
- 日志不包含 Token、完整请求正文或 API Key。

## 五、失败处理

- 查看阿里云：`journalctl -u ghost-cn-sync`。
- 主站同步失败会写入 capture status 的 `errors`，前缀为 `cn_sync:`。
- 不要因同步失败删除 `.cn` 当前 JSON；原子写入保证旧数据继续可用。
- 回滚主站时删除 `CN_SYNC_URL` 和 `CN_SYNC_TOKEN` 后重新发布即可停用推送。
- 回滚中国站时停掉 `ghost-cn-sync` 服务并删除 Nginx 的内部同步 location；
  静态站与旧 JSON 仍可继续提供服务。

## 工作区保护

本地已有评分方向修复和同步实现的未提交改动。不得 `reset --hard`、覆盖或
force push。发布 Agent 必须先运行 `git status --short` 并审核所有 diff。
