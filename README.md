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

## Configuration

All fields have safe defaults; override them from your profile's `cordis.patch.yml`:

```yaml
- id: feishu-task-recorder
  config:
    workspace: /path/to/your/workspace   # where feishu-tasks.json/.md live
    larkCli: /opt/homebrew/bin/lark-cli  # lark-cli command name or absolute path
    fallbackOrigin: 'http://127.0.0.1:62658'  # board API origin until auto-learned
```

- `workspace` — directory for the task store files. Empty means: `$DSH_FEISHU_WORKSPACE` → the DSH process cwd.
- `larkCli` — a command name found on the DSH process `PATH`, or an absolute path. macOS desktop apps often lack `/opt/homebrew/bin` on `PATH`; use an absolute path there.
- `fallbackOrigin` — used only before the panel's first request teaches the plugin the live web-server origin.

## Data storage

Task state is stored as `feishu-tasks.json` (plus a readable `feishu-tasks.md` board) in the configured workspace.

## License

[MIT](LICENSE)
