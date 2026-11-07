# 远帆工单系统与 MCP 服务

[![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/righttu/acloud/tree/main/acloud-mcp-s)

本目录可独立部署。所有数据均为虚构。根路径有中文说明页，MCP 地址为 `https://acloud-mcp-s.righttu.uk/mcp`。

## 部署后需要做的事

1. 账号需要持有 `righttu.uk` 区域；否则先调整自定义域名配置。配置里关闭了 workers.dev 地址和版本地址，只能通过自定义域名访问；OAuth 的 canonical resource 和 issuer 使用自定义域名，若更换域名也要调整代码中的对应值及 Origin 白名单。
2. 按按钮创建 Worker、D1 `acloud-tickets`、KV `acloud-oauth-kv`。资源 ID 留空，由部署流程创建，不填假的 ID。部署命令先发布 Worker（首次部署时自动创建 D1 和 KV），再应用 D1 迁移灌入模拟数据。
3. 配置密钥 `ACLOUD_MCP_TOKEN`，使用至少32字符随机值；给 acloud-agent 设置同值，不要粘贴进聊天内容。命令行可用 `npx wrangler secret put ACLOUD_MCP_TOKEN`。
4. 验证根页面和 MCP 客户端连接。OAuth 的角色自选是演示用的，不构成真实身份认证。公开访问者可以选择主管，因此只可存放模拟数据；真实环境须替换为可信 IdP 登录和服务端角色映射。

开发环境建议 Node 24。运行 `npm install`、`npm run check`、`npm run dryrun`。本地初始化用 `npx wrangler d1 migrations apply TICKETS_DB --local`。正式部署用 `npm run deploy`，不要删除已经应用的迁移记录。

## 数据与核对数字

`npm run seed`（即 `node scripts/generate.mjs`）用固定种子重新生成 `migrations/0001_seed.sql`，不依赖第三方包；`npm run check` 会先运行 `scripts/verify.mjs` 逐条校验下面的数字。200 条工单编号 961–1160，按提交时间递增，时间为 2026-11-02 至 11-08，Asia/Shanghai。分析基准时间固定为 **2026-11-08 23:59 +08:00**，不要用演示当日替代。

- 线索一，登录失败：周一至周日分别 **2、2、12、11、9、6、5** 条。周二 11-03 22:00 发布了 v3.8.0（登录组件升级），周三起明显增多，而且发布后的工单描述变成了「跳回登录页」「会话已过期」这类现象。这只是时间重合，因果待查。
- 线索二，VIP 超时未回复恰好 **3 张：1024（晨光制造，周三）、1074（海川零售，周四）、1091（北辰金融，周五）**。VIP 承诺时限 4 小时，普通客户 24 小时；其余已回复的工单都在时限内，周日晚间有几张普通工单尚未回复但仍在时限内。写入模拟回复后这些数字会改变。
- 线索三，**星河物流一周 4 张工单**（周一、周二、周四、周六，都和同一张发票有关），其余客户每周最多 2 张。
- 1024 号是晨光制造（VIP）周三 11-04 08:41 提交的登录失败工单，是发布后的第二张工单。

工具读操作返回原始时间、SLA和状态，便于程序复核。`list_tickets` 返回 `tickets`、`total`、`next_offset`；读取周报数据要分页到 `next_offset=null`。

## 演示步骤

1. 用 MCP 客户端连接 /mcp，OAuth 中选客服专员，问“1024号工单怎么回事”。
2. 调用 list_tickets 分页读取第45周全部工单，按日期和类别分组，核对以上三条线索，再查 list_releases。客户信息可用 get_customer，关键词用 search_tickets。
3. 只读用户尝试 submit_reply 应被工具处理器拒绝。重新授权选择客服主管，然后在 acloud-agent 人工批准草稿后调用 submit_reply。填写批准人和稳定的 request_id，返回 simulated=true，不发真实邮件。
4. get_ticket 可见回复历史、处理中状态、首次回复时间。相同 request_id 重试不会新增回复；不同内容复用相同 ID 会报错。

批准人字段只是审计记录，不能替代批准凭证验证。真实系统还需要签名批准记录、身份校验和审计策略。不要让模型自行填写批准人冒充人工批准。

## 配置 MCP Portal acloud-mcp-p

依据[官方配置说明](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/)。这一步无法通过一键部署完成。

1. 前提：Cloudflare Zero Trust 已配置身份提供商，并持有活动域名 righttu.uk。
2. 控制台 Zero Trust → Access controls → MCP Portals → MCP servers → Add MCP server。
3. 名称和 Server ID 使用 `acloud-mcp-s`，HTTP URL 填 `https://acloud-mcp-s.righttu.uk/mcp`。添加 Allow Access 策略，OAuth credentials 选 Automatic（DCR）。保存并连接，完成本服务授权，等待 Ready。
4. DCR 会登记回调地址；若将来增加回调白名单，应包含控制台显示的 dashboard callback（含账号和Server ID），以及 `https://acloud-mcp-p.righttu.uk/servers-callback`。使用共享回调时按官方文档加入对应地址。
5. Add server portal，名称 `acloud-mcp-p`，自定义域名 `acloud-mcp-p.righttu.uk`。添加上一步服务器，选择工具，保持 Require user auth 开启以体现每个用户权限差异。
6. 给 Portal 配置 Allow Access 策略，只允许演示人员。保存。可选开启 Code Mode，按控制台选择 optional/on by default/required 等模式。
7. 客户端连接 `https://acloud-mcp-p.righttu.uk/mcp`，先登录 Access，再授权上游服务。Portal 支持2026-07-28无状态协议及2025 Streamable HTTP兼容，不必手动选择版本。

Portal 策略不阻止绕过 Portal 直接连接此演示服务器。生产环境需增加可信身份认证，并按需要将上游认证交由 Access 管理。不要把静态机器密钥公开给 Portal 用户。

## 组件、阶段与手册对照

|组件|实现与阶段|手册|
|---|---|---|
|Workers、D1、KV|常规平台服务，D1 batch 原子写入|4.1–4.4|
|Agents createMcpHandler + MCP SDK v2|当前官方无状态推荐路径，2026-07-28；保留2025兼容。不使用已弃用 McpAgent|4|
|workers-oauth-provider|单Worker OAuthProvider，OAuth 2.1、PKCE、DCR、CIMD；DCR为兼容功能，新协议倾向CIMD|4.3–4.4|
|人工批准、模拟回复|调用方先批准，服务端 scope 检查，幂等 request_id；无邮件发送|11|
|MCP Portal Code Mode|可选控制台功能，阶段和账户可用性以控制台及官方文档为准|10、11|

未使用 experimental tasks、采样或会话恢复。MCP工具调用无状态，业务数据持久化在D1。依赖版本用npm registry核实后以 ^ 声明；升级后应重新运行CI。

官方参考：[MCP handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)、[OAuth](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[部署按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。
