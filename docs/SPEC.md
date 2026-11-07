# acloud 演示环境规格（所有子项目共同遵守）

本仓库是《Agent 基础设施学习手册》的配套演示环境。手册用一家虚构 SaaS 公司「远帆软件」的客服场景讲 Agent 基础设施，本仓库把它做成可以一键部署、可以现场演示的系统。

## 1. 仓库结构与命名

| 目录 | Worker 名 | 自定义域名 | 作用 | 手册章节 |
|---|---|---|---|---|
| `acloud-mcp-s/` | `acloud-mcp-s` | acloud-mcp-s.righttu.uk | 远帆工单系统 + MCP 服务器（工单数据存 D1） | 第 4 章 起点 |
| `acloud-agent/` | `acloud-agent` | acloud-agent.righttu.uk | 客服 Agent 主程序与演示界面 | 第 1、3、5–11 章 |
| `acloud-sandbox/` | `acloud-sandbox` | acloud-sandbox.righttu.uk | 容器沙箱（Python 分析、目录备份与恢复） | 第 5、6、9 章 |
| （控制台配置） | — | acloud-mcp-p.righttu.uk | MCP Server Portal，把 acloud-mcp-s 接入 Zero Trust | 第 4、11 章 |

命名规则：所有 Cloudflare 资源都以 `acloud-` 开头（Worker、D1、R2、KV、AI Gateway、容器镜像等）。不能含「-」的标识符（类名、绑定名除外的 JS 标识符）用 `Acloud` 开头的驼峰，例如 Durable Object 类 `AcloudSupportAgent`。绑定名用全大写下划线，例如 `TICKETS_DB`。

建议的资源名（子项目可以增加，但要保持前缀）：
- D1：`acloud-tickets`（绑定 `TICKETS_DB`，在 acloud-mcp-s）
- KV：`acloud-oauth-kv`（绑定 `OAUTH_KV`，在 acloud-mcp-s，OAuth 存储）
- R2：`acloud-reports`（绑定 `REPORTS`，在 acloud-agent，周报网页与截图）
- R2：`acloud-sandbox-backups`（绑定 `BACKUPS`，在 acloud-sandbox）
- AI Gateway：`acloud-gateway`（acloud-agent 调用 Workers AI 时经过它）

## 2. 一键部署约束（来自官方文档 developers.cloudflare.com/workers/platform/deploy-buttons/）

- 每个子目录必须完全自包含（自己的 package.json、wrangler.jsonc、依赖），按钮 URL 形如 `https://deploy.workers.cloudflare.com/?url=https://github.com/righttu/acloud/tree/main/acloud-agent`。
- 一个仓库里的多个 Worker 不会一起部署，每个子目录一个按钮。
- 自动创建的资源：KV、D1、R2、Durable Objects、Workers AI、Queues 等。wrangler 配置里要给每个绑定写好默认名字。
- 密钥用 `.dev.vars.example` 声明；在 package.json 的 `cloudflare.bindings` 里给每个密钥和变量写中文说明。
- D1 迁移放在 `deploy` 脚本里：`wrangler deploy && wrangler d1 migrations apply TICKETS_DB --remote`（先发布，首次部署时自动创建 D1；迁移命令用绑定名）。
- 自定义域名写在 wrangler 配置：`"routes": [{ "pattern": "acloud-xxx.righttu.uk", "custom_domain": true }]`，部署时自动创建 DNS 记录。前提是部署账号里有 righttu.uk。三个 Worker 都设为 `workers_dev: false`、`preview_urls: false`，只能通过自定义域名访问，避免绕过 Access。
- `compatibility_date` 用 `2026-11-06`，按需加 `nodejs_compat`。

## 3. 子项目之间的约定

- acloud-agent 通过标准 MCP（Streamable HTTP）连接 `MCP_URL`（变量，默认 `https://acloud-mcp-s.righttu.uk/mcp`；也可以改成 Portal 地址 `https://acloud-mcp-p.righttu.uk/mcp`）。
- 机器之间的认证：acloud-mcp-s 同时支持
  1. OAuth 2.1（workers-oauth-provider，带一个演示用登录/授权页），供 MCP Portal、Claude Desktop 等客户端使用；
  2. 静态 Bearer 令牌 `ACLOUD_MCP_TOKEN`（密钥），供 acloud-agent 程序侧使用。令牌只存在 Worker 密钥里，绝不出现在给模型的上下文中（手册 4.3）。
- 工具权限在每个工具的处理代码里检查（手册 4.4：`requiredScopes` 只声明不拦截）。权限：`tickets:read`、`replies:write`。
- acloud-agent 调用 acloud-sandbox：变量 `SANDBOX_URL`（默认 `https://acloud-sandbox.righttu.uk`）+ 密钥 `ACLOUD_SANDBOX_TOKEN`。沙箱不可用时 Agent 要优雅降级，不能报错崩溃。
- 所有界面文字用中文。代码注释可以中英混合，关键设计处注明对应的手册章节，例如 `// 手册 3.3：输入门`。

## 4. 模拟数据：远帆软件第 45 周工单（示意数据）

- 时间范围：2026-11-02（周一）00:00 到 2026-11-08（周日）23:59，时区 Asia/Shanghai。
- 200 条工单，编号 961–1160，按提交时间递增，用固定随机种子 20261102 生成，结果可复现。分析基准时间固定为 2026-11-08 23:59 +08:00。生成脚本放在 `acloud-mcp-s/scripts/`，产物是 D1 迁移 SQL，提交进仓库。
- 字段：编号 id、时间 created_at、客户名 customer、客户等级 level（VIP / 普通）、渠道 channel（电话 / 邮件 / 在线）、问题类别 category、标题 title、正文 body、状态 status（未回复 / 处理中 / 已解决）、首次回复时间 first_reply_at（可空）、承诺时限 sla_hours。
- 问题类别至少包括：登录失败、账单疑问、数据导出、性能慢、权限配置、功能建议、集成对接。
- 预埋的三条线索（分析程序必须能发现）：
  1. 「登录失败」类工单从周三（11-04）起明显增多，紧接在周二（11-03）22:00 的 v3.8.0 发布之后。周一至周日依次为 2、2、12、11、9、6、5 条。这只是时间上的重合，因果待查。（建议在数据里放一张 `releases` 表记录这次发布。）
  2. 恰好 3 张 VIP 工单超时未回复：1024 晨光制造、1074 海川零售、1091 北辰金融（VIP 时限 4 小时，普通 24 小时）。
  3. 普通客户「星河物流」一周 4 张工单，都和同一张发票有关；其余客户每周最多 2 张。
- 1024 号工单是手册的起点：晨光制造（VIP）周三 08:41 提交的「登录失败」工单。
- acloud-agent 调用沙箱时，`week` 可传 45 或 "2026-W45"。
- 另有客户表 customers（名称、等级、行业、客户经理）和回复表 replies（工单号、正文、批准人、发送时间）。

## 5. 演示主线（acloud-agent 界面要能按顺序演示）

1. 起点：问 Agent「1024 号工单怎么回事」，Agent 通过 MCP 查工单并回答（第 4 章）。
2. 加码一：「分析第 45 周全部工单，写周报」。Agent 写一段 JavaScript 分析程序，在 Dynamic Worker 里运行（`globalOutbound: null`，只通过绑定读取工单），只把结论交回模型（第 5 章）。
3. 加码二：长任务中途断开（界面提供「模拟中断」按钮，例如让对象抛错或重启），刷新后能从记录接着做，不重复做已完成的步骤；发送类动作不重放（第 6 章）。
4. 加码三：界面能切换模型（经 AI Gateway `acloud-gateway`），技能以 Markdown 文件提供（例如周报格式规范）（第 7 章）。
5. 加码四：周报网页存到 R2 并发布在 `/reports/:id`，Agent 用浏览器打开自检并截图（第 8 章）。
6. 加码五：每周一 9:00 自动生成周报（Agent 调度），对话记录和周报历史长期保留（第 9 章）。
7. 收尾一：Code Mode，把 MCP 工具包装成代码接口，一次执行完成多步查询，界面显示 token 对比（第 10 章）。
8. 收尾二：回复草稿必须人工批准才通过 MCP 的 replies:write 工具发送；界面显示调用过程（第 11 章）。
9. 可选：「用 Python 复核」调用 acloud-sandbox 运行同样的统计（第 5.5 节）。

## 6. 质量要求

- 只使用官方文档里存在的 API。写代码前先查 developers.cloudflare.com 对应页面和 npm 上的真实版本，不要凭记忆。实验性/测试中的功能在 README 中标注阶段。
- 每个子目录 package.json 必须提供脚本：`check`（TypeScript 类型检查，`tsc --noEmit`）和 `dryrun`（`wrangler deploy --dry-run --outdir .dryrun`，必要时加 build 步骤）。仓库的 GitHub Actions 会对每个子目录运行 `npm install`、`npm run check`、`npm run dryrun`，必须全部通过。
- 每个子目录有自己的 README.md（中文）：一键部署按钮、部署后要做的事（设置密钥等）、演示步骤、用到的组件和阶段、对应手册章节。
- 不提交任何真实密钥。
