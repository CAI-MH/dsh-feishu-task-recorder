# dsh-feishu-task-recorder

[English](README.md) | 中文

轮询飞书会话、用大模型提取候选任务,并与任务看板插件双向同步,含浏览器悬浮面板。这是一个 [DeepSeek Harness](https://github.com/nicepkg/dsh)(DSH)bundle,包含 Host 与 Client 两半。

## 功能

- **会话监听** —— 选择要监听的飞书群聊/单聊;按会话维护拉取游标,已见消息自动去重
- **定时轮询** —— 轮询间隔可配(`feishu_poll_interval`);支持历史回溯窗口(`feishu_lookback`、`feishu_cursor_reset`)
- **任务提取** —— 新消息自动筛选为候选任务,进入待审核队列
- **审核工作流** —— `待审核 → AI 任务 / 人工任务 / 已丢弃 → 已完成`;可用聊天工具或面板逐条判定
- **看板同步** —— 与 [`@linxin666/dsh-client-ui-task-board`](https://www.npmjs.com/package/@linxin666/dsh-client-ui-task-board) 任务看板通过同一 webServer 上的 HTTP API 双向同步
- **悬浮面板** —— 在浏览器页面内直接审核、判定、完成任务
- **一键授权** —— 面板内点「授权飞书」按钮即可发起 device-flow 授权，展示链接与二维码，用户自行在浏览器/手机完成，无需让 agent 代跑命令
- **单聊支持** —— 会话列表同时列出群聊与个人私聊（`feishu_chats` 返回 `type` 字段），单聊消息同样可拉取并提取任务
- **全套工具** —— `feishu_setup`、`feishu_auth`、`feishu_status`、`feishu_chats`、`feishu_track`、`feishu_sync_now`、`feishu_task_list`、`feishu_task_review`、`feishu_task_add`、`feishu_task_judge`、`feishu_task_done` 等

## 前置要求

- 已安装并完成**用户态**授权的 [`lark-cli`](https://www.npmjs.com/package/@larksuiteoapi/lark-cli) —— 插件复用它的飞书身份,自身不接触任何密钥
- 同一 profile 中安装任务看板插件以获得看板同步(可选,推荐)

## 授权（一键）

插件复用 `lark-cli` 的飞书**用户态**身份，自身不接触任何密钥。发起授权有两种方式：

1. **面板按钮（推荐）**：打开页面右下角「飞书任务」面板 → 点「🔑 授权飞书」→ 面板展示授权链接与二维码 → 在浏览器点链接或手机扫码完成授权 → 回到面板点「✅ 我已完成授权」。
2. **对话工具**：让 agent 调用 `feishu_auth(action=start)` 拿到链接/二维码，完成后调用 `feishu_auth(action=complete)`。

授权采用 device flow，链接有效期约 10 分钟。授权范围 `--domain im`（读消息，含群聊与个人私聊）。

## 沙箱与 token 存储

DSH 以 `workspace-write` 沙箱运行插件的 shell 命令,默认只允许写 workspace 与 `/tmp`。lark-cli 刷新 user token 时要写 `~/Library/Application Support/lark-cli/*.enc`,该目录在可写根之外,会报 `keychain Set failed`。因此插件把其 lark-cli 调用的可写根指向该 token 目录,同时不改动 `HOME`,让 master key 继续留在 macOS 钥匙串——不复制凭据、不分裂 token。

## 安装

```sh
dsh plugin --profile web add dsh-feishu-task-recorder
```

或将它加入 profile 的 `package.json` dependencies,并列入 `dsh.profile.bundles`,然后重启 `dsh web`。

## 配置

所有字段都有安全默认值,可在 profile 的 `cordis.patch.yml` 中覆盖:

```yaml
- id: feishu-task-recorder
  config:
    workspace: /path/to/your/workspace   # feishu-tasks.json/.md 存放目录
    larkCli: /opt/homebrew/bin/lark-cli  # lark-cli 命令名或绝对路径
    fallbackOrigin: 'http://127.0.0.1:62658'  # 自动学习前的看板 API 兜底源
```

- `workspace` —— 任务存储文件目录。留空时依次尝试:环境变量 `DSH_FEISHU_WORKSPACE` → DSH 进程当前目录。
- `larkCli` —— DSH 进程 `PATH` 中的命令名,或绝对路径。macOS 桌面 app 的 `PATH` 通常不含 `/opt/homebrew/bin`,建议配置绝对路径。
- `fallbackOrigin` —— 仅在面板首次请求教会插件当前 webServer 源之前使用。

## 数据存储

任务状态保存在配置的工作区目录:`feishu-tasks.json`(数据)与 `feishu-tasks.md`(可读看板)。

## 许可证

[MIT](LICENSE)
