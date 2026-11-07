# acloud：Agent 基础设施演示环境

这是《Agent 基础设施学习手册》的配套演示。手册用虚构公司「远帆软件」的客服场景，讲一个 Agent 从回答一张工单，到每周自动写周报、经人工批准后回复客户，需要哪些基础设施。本仓库把这条主线做成三个可以分别部署的 Worker。

所有工单、客户和回复都是虚构数据，不会发送真实邮件。

## 三个组件

| 组件 | 地址 | 做什么 | 手册章节 | 部署 |
|---|---|---|---|---|
| acloud-mcp-s | acloud-mcp-s.righttu.uk | 远帆工单系统和 MCP 服务器，数据存在 D1 | 第 4、11 章 | [![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/righttu/acloud/tree/main/acloud-mcp-s) |
| acloud-agent | acloud-agent.righttu.uk | 客服 Agent 和演示界面：动态代码执行、断点续做、模型切换、周报发布、定时任务、Code Mode、人工批准 | 第 1、3、5–11 章 | [![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/righttu/acloud/tree/main/acloud-agent) |
| acloud-sandbox（可选） | acloud-sandbox.righttu.uk | 容器沙箱，用 Python 复核统计结果，演示目录备份和恢复 | 第 5、6、9 章 | [![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/righttu/acloud/tree/main/acloud-sandbox) |
| acloud-mcp-p（控制台配置） | acloud-mcp-p.righttu.uk | MCP 门户，把 acloud-mcp-s 接入 Zero Trust | 第 4、11 章 | 手动配置，见下文 |

一个仓库里的多个 Worker 不会一起部署，所以每个组件有自己的按钮。

## 开始前

- 一个 Cloudflare 账号，域名 righttu.uk 已在这个账号里。自定义域名和 DNS 记录在部署时自动创建。如果用别的域名，要先改各组件配置里的域名。
- 准备两个随机密钥，每个至少 32 个字符，用密码管理器生成：
  - `ACLOUD_MCP_TOKEN`：acloud-agent 访问工单系统用。三个组件填同一个值（沙箱里可留空）。
  - `ACLOUD_SANDBOX_TOKEN`：acloud-agent 访问沙箱用。acloud-agent 和 acloud-sandbox 填同一个值。
- 不要把密钥贴进聊天、工单或代码。
- acloud-sandbox 使用 Containers，需要 Workers 付费计划。

## 部署顺序

1. **acloud-mcp-s**：点上表的按钮，登录 Cloudflare，按页面提示填写 `ACLOUD_MCP_TOKEN`，点「部署」。部署会自动创建 D1 数据库 `acloud-tickets` 和 KV `acloud-oauth-kv`，并导入 200 条模拟工单。完成后打开 https://acloud-mcp-s.righttu.uk 看到说明页即成功。
2. **AI Gateway**：在 Cloudflare 控制台进入 AI → AI Gateway，点「创建网关」，名称填 `acloud-gateway`。acloud-agent 调用模型时会经过它，用来演示调用记录和模型切换。
3. **acloud-agent**：点按钮，填写同一个 `ACLOUD_MCP_TOKEN`，以及 `ACLOUD_SANDBOX_TOKEN`（暂不部署沙箱也可以先填好）。部署会自动创建 R2 存储桶 `acloud-reports`。
4. **acloud-sandbox（可选）**：点按钮，填写同一个 `ACLOUD_SANDBOX_TOKEN`。首次部署需要构建容器镜像，耗时比其他组件长。没有部署沙箱时，Agent 的「用 Python 复核」会提示不可用，其余功能照常。
5. **保护演示界面**：acloud-agent 本身没有登录功能。在 Zero Trust → Access controls → Applications 里为 acloud-agent.righttu.uk 添加一个应用，策略只允许演示人员的邮箱。acloud-agent 的 workers.dev 备用地址已在配置里关闭，不能绕过登录。acloud-mcp-s 和 acloud-sandbox 不要对整个域名加 Access，否则 Agent 后台调用会被登录页挡住；它们的数据接口都要密钥。可以只给 acloud-mcp-s 的授权页加 Access：新建 Self-hosted 应用，域名 `acloud-mcp-s.righttu.uk`，路径 `authorize`。
6. **MCP 门户 acloud-mcp-p（可选）**：步骤见 acloud-mcp-s 目录的说明。这一步只能在控制台完成，需要先在 Zero Trust 里配置身份提供商。

## 演示主线

以下步骤都在 acloud-agent 界面里完成，每一步对应手册的一章。

| 顺序 | 你在界面上做什么 | 看什么 | 手册 |
|---|---|---|---|
| 1 | 问「1024 号工单怎么回事」 | Agent 通过 MCP 查到晨光制造的登录失败工单 | 第 4 章 |
| 2 | 让 Agent 分析第 45 周全部工单 | Agent 写一段分析代码，在无网络的隔离环境里运行，只把结论交回模型 | 第 5 章 |
| 3 | 点「模拟中断」后刷新页面 | 任务从记录接着做，已完成的步骤不重做 | 第 6 章 |
| 4 | 切换模型 | 同一任务换模型运行，调用记录出现在 AI Gateway | 第 7 章 |
| 5 | 发布周报 | 周报保存到 R2，Agent 用浏览器打开并截图自检 | 第 8 章 |
| 6 | 查看报告历史 | 每周一 9:00（北京时间）自动生成的周报会出现在历史里，不需要手动操作 | 第 9 章 |
| 7 | 用 Code Mode 做同样的查询 | 一次执行完成多步查询，界面显示 token 用量对比 | 第 10 章 |
| 8 | 批准一份回复草稿 | 人工批准后才调用写入工具，回复标记为模拟发送 | 第 11 章 |
| 9 | 用 Python 复核（可选） | 沙箱得出与第 2 步相同的数字 | 5.5 节 |

数据里预埋了三个发现，第 2 步应全部找到：

1. 周二 22:00 发布 v3.8.0 后，「登录失败」工单从周三起明显增多（周一至周日 2、2、12、11、9、6、5 条）。这只是时间上的重合，是否由发布引起还需要查证。
2. 恰好 3 张 VIP 工单超时未回复：1024 晨光制造、1074 海川零售、1091 北辰金融。
3. 星河物流一周提了 4 张工单，都和同一张发票有关。

## 功能阶段

部分功能处于实验或测试阶段，接口可能变化，各组件的说明里逐项标注了阶段和官方文档链接。演示前请在控制台核对模型目录和各功能的可用状态。

## 安全提示

- 这是演示环境，只放模拟数据。
- 工单系统的 OAuth 授权页允许访问者自选「客服专员」或「客服主管」角色，只用于演示权限差异，不是真实的身份认证。
- 回复记录里的「批准人」只是审计字段。真实系统需要签名的批准记录和身份校验。

## 开发者参考

规格说明见 `docs/SPEC.md`。每个组件目录可以独立运行 `npm install`、`npm run check`、`npm run dryrun`，GitHub Actions 会对三个目录逐一检查。部署按钮的说明见 [官方文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。
