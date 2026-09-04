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
- **全套工具** —— `feishu_setup`、`feishu_status`、`feishu_chats`、`feishu_track`、`feishu_sync_now`、`feishu_task_list`、`feishu_task_review`、`feishu_task_add`、`feishu_task_judge`、`feishu_task_done` 等

## 前置要求

- 已安装并完成**用户态**授权的 [`lark-cli`](https://www.npmjs.com/package/@larksuiteoapi/lark-cli) —— 插件复用它的飞书身份,自身不接触任何密钥
- 同一 profile 中安装任务看板插件以获得看板同步(可选,推荐)

## 安装

```sh
dsh plugin --profile web add dsh-feishu-task-recorder
```

或将它加入 profile 的 `package.json` dependencies,并列入 `dsh.profile.bundles`,然后重启 `dsh web`。

## 数据存储

任务状态保存在会话工作区根目录:`feishu-tasks.json`(数据)与 `feishu-tasks.md`(可读看板)。

## 许可证

[MIT](LICENSE)
