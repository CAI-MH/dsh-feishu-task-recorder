# dsh-feishu-task-recorder

English | [中文](README.zh.md)

Poll Feishu (Lark) chats, extract candidate tasks with the model, and sync them two-ways with the task-board plugin — with a floating browser panel. A [DeepSeek Harness](https://github.com/nicepkg/dsh) (DSH) bundle with host + client halves.

## Features

- **Chat tracking** — choose which Feishu group/DM chats to watch; per-chat cursors with dedupe
- **Scheduled polling** — configurable interval (`feishu_poll_interval`), history look-back window (`feishu_lookback`, `feishu_cursor_reset`)
- **Task extraction** — new messages are screened into candidate tasks for review
- **Review workflow** — `pending → ai / manual / rejected → done`; judge tasks from chat tools or the panel
- **Task-board sync** — two-way sync with [`@linxin666/dsh-client-ui-task-board`](https://www.npmjs.com/package/@linxin666/dsh-client-ui-task-board) over its HTTP API on the same web server
- **Floating panel** — browser UI to review, judge and complete tasks without leaving the page
- **Full tool set** — `feishu_setup`, `feishu_status`, `feishu_chats`, `feishu_track`, `feishu_sync_now`, `feishu_task_list`, `feishu_task_review`, `feishu_task_add`, `feishu_task_judge`, `feishu_task_done`, and more

## Requirements

- [`lark-cli`](https://www.npmjs.com/package/@larksuiteoapi/lark-cli) installed and authorized at the **user** level — the plugin reuses its Feishu identity and never touches any token itself
- The task-board plugin installed in the same profile for board sync (optional but recommended)

## Install

```sh
dsh plugin --profile web add dsh-feishu-task-recorder
```

Or add it to your profile's `package.json` dependencies and list it under `dsh.profile.bundles`, then restart `dsh web`.

## Data storage

Task state is stored as `feishu-tasks.json` (plus a readable `feishu-tasks.md` board) in the session workspace root.

## License

[MIT](LICENSE)
