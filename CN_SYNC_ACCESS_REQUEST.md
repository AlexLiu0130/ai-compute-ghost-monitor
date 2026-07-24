# Ghost Monitor 中国站同步上线请求

请将本页交给负责 `ghost.alexai-lab.cn` 阿里云服务器的执行人。完整部署步骤见
`CN_DOMAIN_DEPLOYMENT_HANDOFF.md`。

## 需要执行人完成

1. 确认 `.cn/api/alerts` 当前 JSON 文件的真实绝对路径。
2. 确认服务器已安装 Node.js 22 或更高版本。
3. 将 `deploy/cn-sync/server.mjs` 部署为仅监听 `127.0.0.1:8788` 的
   systemd 服务。
4. 在 Nginx 中只开放：
   `POST /internal/sync/alerts`，并保留 `/api/capture` 禁用。
5. 使用 `openssl rand -hex 32` 生成独立同步密钥，写入服务器 root-only
   环境文件。不要复用 QVeris、DeepSeek、Sites 或其他业务密钥。
6. 完成 Nginx 配置检查和服务启动，并验证：
   - `GET http://127.0.0.1:8788/health` 返回成功；
   - 未带 Token 的外网同步请求返回 `401`；
   - `/api/capture` 仍不可用。

## 请回传

- 同步接口已上线的确认：
  `https://ghost.alexai-lab.cn/internal/sync/alerts`
- 独立同步密钥，通过安全渠道单独提供，不发到 GitHub、聊天截图或公开文档。
- `.cn/api/alerts` 实际 JSON 路径。
- systemd 服务名、Node.js 版本以及 Nginx `-t` 通过的结果。
- 执行人的首次全量补齐授权。

收到接口上线确认和密钥后，主站侧还需完成：

1. 在 Sites 中以 secret 环境变量配置 `CN_SYNC_URL` 和 `CN_SYNC_TOKEN`。
2. 重新发布 `.com`。
3. 从非阿里云机器执行一次全量快照补齐。
4. 核对 `.cn` 与 `.com` 的最新新闻时间和记录数，并验证重复推送不产生重复记录。

在以上步骤完成前，`.cn` 会继续提供旧快照，但不会自动获得主站新增新闻。
