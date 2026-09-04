// dsh-feishu-task-recorder — Host 半部分
// 复用本机 lark-cli 的飞书用户态授权，定时轮询被监听会话并提取候选任务；
// 与 @linxin666/dsh-client-ui-task-board 任务看板双向同步（HTTP API）；
// 通过 /api/feishu-tasks/* 路由向浏览器面板提供数据与操作；并注册全套模型工具。
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'feishu-task-recorder'
export const inject = ['timer', 'tools', 'webServer']

// 默认配置：全部可通过 cordis.patch.yml 中本插件行的 config: 覆盖
const DEFAULT_CONFIG = {
  // 任务文件（feishu-tasks.json / feishu-tasks.md）存放目录，通常是会话工作区根目录。
  // 留空时依次尝试：环境变量 DSH_FEISHU_WORKSPACE → DSH 进程当前目录。
  workspace: '',
  // lark-cli 可执行文件：PATH 中的命令名，或绝对路径（macOS 桌面 app 的 PATH 可能
  // 不含 /opt/homebrew/bin，此时建议配置绝对路径，如 /opt/homebrew/bin/lark-cli）。
  larkCli: 'lark-cli',
  // 看板 API 兜底源：任务看板插件与本插件在同一进程的同一 webServer 上，DSH 监听端口
  // 每次启动都会变，所以从面板请求的 Host 头动态学习当前源；学习前使用该兜底值。
  fallbackOrigin: 'http://127.0.0.1:62658',
}

function resolveWorkspace(cfg) {
  if (typeof cfg.workspace === 'string' && cfg.workspace.trim() !== '') return cfg.workspace.trim()
  const env = typeof process !== 'undefined' && process.env ? process.env.DSH_FEISHU_WORKSPACE : ''
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.'
}

const STORE_FILE = 'feishu-tasks.json'
const BOARD_FILE = 'feishu-tasks.md'
const SEEN_CAP = 5000

// 任务状态：pending(待审核) -> ai(AI实现) / manual(人工实现) / rejected(非任务) -> done(完成)
const STATUS = ['pending', 'ai', 'manual', 'rejected', 'done']

const render = (_args, value) => [
  { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
]
const OUT_SCHEMA = { type: 'object', additionalProperties: true }

export function apply(ctx, config) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, config)
  // 任务文件落在配置的工作区根目录；lark-cli 路径与看板兜底源同样来自配置
  const WORKSPACE = resolveWorkspace(cfg)
  const SANDBOX = { mode: 'workspace-write', workspaceRoot: WORKSPACE }
  const LARK = cfg.larkCli || DEFAULT_CONFIG.larkCli
  const FALLBACK_ORIGIN = cfg.fallbackOrigin || DEFAULT_CONFIG.fallbackOrigin

  const shell = ctx.get('shell')
  const fs = ctx.get('fs')

  const state = {
    tasks: [],
    seenIds: [],
    cursors: {},
    trackedChats: [],
    pollHours: 3,
    lookbackHours: 24,
    seq: 1,
    polls: 0,
    newMessagesTotal: 0,
    lastPollAt: null,
    lastError: null,
    lastSaveError: null,
    polling: false,
    storePath: null,
    boardPath: null,
    boardLastSyncAt: null,
    boardLastError: null,
    serverOrigin: null,
  }

  function boardOrigin() { return state.serverOrigin || FALLBACK_ORIGIN }
  function boardApi() { return boardOrigin() + '/api/task-board' }

  // 从进入的本机请求里学习当前 webServer 源（Host 头），面板每次加载都会刷新它
  function captureOrigin(req) {
    const host = req.headers && req.headers.host
    if (typeof host === 'string' && host !== '' && host.indexOf('/') === -1) {
      const origin = 'http://' + host
      if (state.serverOrigin !== origin) {
        state.serverOrigin = origin
        console.log('[feishu-task-recorder] 学习到当前服务源：' + origin)
      }
    }
  }

  function normalizeTask(t) {
    if (typeof t.status !== 'string' || STATUS.indexOf(t.status) === -1) {
      t.status = t.done === true ? 'done' : 'pending'
    }
    return t
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16)
      const v = c === 'x' ? r : (r % 4) + 8
      return v.toString(16)
    })
  }

  // ---------- lark-cli 调用 ----------
  function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }

  async function runLark(args, timeoutMs) {
    if (shell === undefined) throw new Error('shell 服务不可用')
    const spec = shell.resolve({ command: LARK + ' ' + args.map(q).join(' '), timeoutMs: timeoutMs || 45000 })
    const res = await shell.run(spec)
    const text = (res.stdout && res.stdout.text) || ''
    let json
    try { json = JSON.parse(text) } catch (e) {
      throw new Error('lark-cli 返回非 JSON（exit=' + res.exitCode + ' stderr=' + ((res.stderr && res.stderr.text) || '').slice(0, 120) + '）：' + text.slice(0, 200))
    }
    return json
  }

  // 调用飞书 OpenAPI（用户态身份）；返回飞书响应里的 data 段
  async function api(method, path, params) {
    const args = ['api', method, path, '--as', 'user', '--format', 'json']
    if (params !== undefined) args.push('--params', JSON.stringify(params))
    const json = await runLark(args)
    if (json.ok !== true) {
      const err = json.error || {}
      const e = new Error('飞书接口错误 [' + (err.subtype || err.type || 'unknown') + '] ' + (err.message || ''))
      e.subtype = err.subtype || ''
      throw e
    }
    return json.data || {}
  }

  async function authStatus() {
    try {
      const json = await runLark(['auth', 'status', '--json'])
      const ids = json.identities || {}
      return {
        ok: true,
        appId: json.appId || null,
        userReady: !!(ids.user && ids.user.available === true),
        botReady: !!(ids.bot && ids.bot.available === true),
        userMessage: (ids.user && ids.user.message) || '',
      }
    } catch (e) {
      return { ok: false, appId: null, userReady: false, botReady: false, userMessage: String((e && e.message) || e) }
    }
  }

  // ---------- 任务看板插件（task-board）HTTP 桥接 ----------
  async function boardCurl(args, timeoutMs) {
    if (shell === undefined) throw new Error('shell 服务不可用')
    const spec = shell.resolve({ command: 'curl -s -m ' + Math.round((timeoutMs || 15000) / 1000) + ' ' + args.map(q).join(' '), timeoutMs: (timeoutMs || 15000) + 5000 })
    const res = await shell.run(spec)
    const text = (res.stdout && res.stdout.text) || ''
    try { return JSON.parse(text) } catch (e) {
      throw new Error('看板 API 返回非 JSON（HTTP 可能未挂载）：' + text.slice(0, 120))
    }
  }

  async function boardGetState() {
    return await boardCurl(['-H', 'Origin: ' + boardOrigin(), boardApi() + '/state'], 10000)
  }

  async function boardAction(action) {
    const body = JSON.stringify({ requestId: uuid(), action: action, initiator: 'feishu-task-recorder' })
    const res = await boardCurl([
      '-X', 'POST',
      '-H', 'Origin: ' + boardOrigin(),
      '-H', 'Content-Type: application/json',
      '--data', body,
      boardApi() + '/action',
    ], 15000)
    if (res && res.ok === false) throw new Error('看板动作失败：' + (res.error || 'unknown'))
    return res
  }

  function boardCardDesc(task) {
    return '来自飞书「' + task.chatName + '」 · ' + task.time +
      '\n\n' + task.text +
      '\n\n—— 由飞书任务记录器同步。判定方式：把卡片移出「待规划」列=接受任务；删除卡片=非真实任务；需要 AI 执行时编辑卡片填入 prompt。'
  }

  // 把未同步的任务（待审核/AI/人工）推上看板，并把看板侧的判定同步回来
  async function syncBoard() {
    let snap
    try {
      snap = await boardGetState()
    } catch (e) {
      state.boardLastError = String((e && e.message) || e)
      return { ok: false, error: state.boardLastError }
    }
    const cards = Array.isArray(snap.tasks) ? snap.tasks : []
    const byId = {}
    for (const c of cards) if (typeof c.id === 'string') byId[c.id] = c
    let pushed = 0, pulled = 0
    try {
      for (const task of state.tasks) {
        const s = normalizeTask(task).status
        // 1) 未上看板的非终结任务：按当前状态创建卡片
        //    pending -> 待规划列；ai -> 待办列+prompt（可运行）；manual -> 待办列
        if ((s === 'pending' || s === 'ai' || s === 'manual') && typeof task.boardId !== 'string') {
          const id = uuid()
          await boardAction({ kind: 'create', id: id, input: {
            title: ('[飞书] ' + task.text).slice(0, 80),
            description: boardCardDesc(task),
            prompt: s === 'ai' ? task.text : '',
          } })
          task.boardId = id
          pushed++
          if (s === 'pending') {
            try { await boardAction({ kind: 'move', taskId: id, status: 'backlog' }) } catch (e) {}
          }
          continue
        }
        // 2) 已链接：看板列是真相，回同步判定
        if (typeof task.boardId === 'string') {
          const card = byId[task.boardId]
          if (card === undefined) {
            // 卡片被删除/归档 = 用户判为非任务
            if (s === 'pending' || s === 'ai' || s === 'manual') {
              task.status = 'rejected'
              task.judgedAt = new Date().toISOString()
              pulled++
            }
            continue
          }
          if (card.status === 'backlog') {
            if (s !== 'pending' && s !== 'done' && s !== 'rejected') { task.status = 'pending'; delete task.judgedAt; pulled++ }
          } else if (card.status === 'todo') {
            if (s === 'pending') {
              task.status = (typeof card.prompt === 'string' && card.prompt.trim() !== '') ? 'ai' : 'manual'
              task.judgedAt = new Date().toISOString()
              pulled++
            }
          } else if (card.status === 'running' || card.status === 'done' || card.status === 'failed') {
            if (s !== 'done') { task.status = 'done'; task.doneAt = new Date().toISOString(); pulled++ }
          }
        }
      }
      state.boardLastSyncAt = new Date().toISOString()
      state.boardLastError = null
      return { ok: true, pushed: pushed, pulled: pulled }
    } catch (e) {
      state.boardLastError = String((e && e.message) || e)
      return { ok: false, error: state.boardLastError, pushed: pushed, pulled: pulled }
    }
  }

  // 工具/面板动作后，把判定结果推到看板（尽力而为，不阻塞主流程）
  async function pushJudgment(task) {
    if (typeof task.boardId !== 'string') return
    try {
      if (task.status === 'ai') {
        await boardAction({ kind: 'update', taskId: task.boardId, patch: { prompt: task.text } })
        await boardAction({ kind: 'move', taskId: task.boardId, status: 'todo' })
      } else if (task.status === 'manual') {
        await boardAction({ kind: 'move', taskId: task.boardId, status: 'todo' })
      } else if (task.status === 'rejected') {
        await boardAction({ kind: 'delete', taskId: task.boardId })
      }
      state.boardLastError = null
    } catch (e) {
      state.boardLastError = String((e && e.message) || e)
    }
  }

  // ---------- persistence (workspace files, best effort) ----------
  async function resolveFile(name) {
    if (fs === undefined) return null
    try {
      return await fs.resolve(name, { cwd: WORKSPACE })
    } catch (e) {
      state.lastSaveError = 'resolve ' + name + ': ' + String(e)
      console.log('[feishu-task-recorder] resolve failed:', name, String(e))
      return null
    }
  }

  function renderGroup(lines, title, list, withSource) {
    lines.push('## ' + title + '（' + list.length + '）', '')
    for (const t of list) {
      const mark = t.status === 'done' ? '[x]' : '[ ]'
      lines.push('- ' + mark + ' **#' + t.id + '** ' + t.text)
      if (withSource) lines.push('  - 来源：' + t.chatName + ' · ' + t.senderId + ' · ' + t.time)
      if (t.status === 'done' && t.doneAt) lines.push('  - 完成于 ' + t.doneAt)
      if (t.status === 'rejected' && t.judgedAt) lines.push('  - 判定非任务于 ' + t.judgedAt)
    }
    lines.push('')
  }

  function renderBoard() {
    const groups = { pending: [], ai: [], manual: [], done: [], rejected: [] }
    for (const t of state.tasks) groups[normalizeTask(t).status].push(t)
    const lines = [
      '# 飞书任务看板',
      '',
      '> 由 dsh-feishu-task-recorder 插件自动维护，请勿手改；最后更新：' + new Date().toISOString(),
      '> 流程：新任务进「待审核」→ 人工判定（非任务 / AI 实现 / 人工实现）→ 完成后归档',
      '> 轮询间隔：' + state.pollHours + ' 小时（可用 feishu_poll_interval 或看板面板调整）',
      '',
    ]
    renderGroup(lines, '🔍 待审核（新加入，待判定）', groups.pending, true)
    renderGroup(lines, '🤖 AI 任务（由 AI 实现）', groups.ai, true)
    renderGroup(lines, '👤 人工任务（由人实现）', groups.manual, true)
    renderGroup(lines, '✅ 已完成', groups.done.slice(-50), false)
    renderGroup(lines, '🗑 已判定非任务', groups.rejected.slice(-20), false)
    return lines.join('\n')
  }

  async function saveAll() {
    if (fs === undefined) { state.lastSaveError = 'fs service undefined'; return }
    try {
      const store = await resolveFile(STORE_FILE)
      if (store !== null) {
        state.storePath = store.displayPath
        await fs.writeText(store, JSON.stringify({
          seq: state.seq,
          tasks: state.tasks,
          seenIds: state.seenIds.slice(-SEEN_CAP),
          cursors: state.cursors,
          trackedChats: state.trackedChats,
          pollHours: state.pollHours,
          lookbackHours: state.lookbackHours,
          serverOrigin: state.serverOrigin,
        }, null, 2), undefined, undefined, SANDBOX)
      }
      const board = await resolveFile(BOARD_FILE)
      if (board !== null) {
        state.boardPath = board.displayPath
        await fs.writeText(board, renderBoard(), undefined, undefined, SANDBOX)
      }
      state.lastSaveError = null
    } catch (e) {
      state.lastSaveError = String((e && e.message) || e)
      console.log('[feishu-task-recorder] save failed:', state.lastSaveError)
    }
  }

  async function loadAll() {
    if (fs === undefined) return
    try {
      const store = await resolveFile(STORE_FILE)
      if (store === null) return
      state.storePath = store.displayPath
      const data = JSON.parse(await fs.readText(store))
      if (Array.isArray(data.tasks)) state.tasks = data.tasks.map(normalizeTask)
      if (Array.isArray(data.seenIds)) state.seenIds = data.seenIds
      if (data.cursors !== null && typeof data.cursors === 'object') state.cursors = data.cursors
      if (Array.isArray(data.trackedChats)) state.trackedChats = data.trackedChats
      if (typeof data.pollHours === 'number' && data.pollHours > 0) state.pollHours = data.pollHours
      if (typeof data.lookbackHours === 'number' && data.lookbackHours > 0) state.lookbackHours = data.lookbackHours
      if (typeof data.serverOrigin === 'string' && data.serverOrigin.startsWith('http://')) state.serverOrigin = data.serverOrigin
      if (typeof data.seq === 'number') state.seq = data.seq
    } catch (e) {
      // 文件不存在或损坏：保持全新状态
    }
  }

  // ---------- task extraction ----------
  function extractTasks(text) {
    const found = []
    const patterns = [
      /(?:待办|任务|TODO|todo)\s*[:：]\s*([^\n]+)/g,
      /^!\s*([^\n]+)/gm,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(text)) !== null) {
        const t = m[1].trim()
        if (t.length >= 2 && t.length <= 200) found.push(t)
      }
    }
    return found
  }

  // ---------- polling ----------
  async function pollOnce() {
    if (state.polling) return { skipped: 'poll-in-flight' }
    if (state.trackedChats.length === 0) return { skipped: 'no-tracked-chats', hint: '先用 feishu_chats 列出会话，再用 feishu_track 添加要监听的群/单聊' }
    state.polling = true
    const out = { chats: 0, newMessages: 0, newTasks: 0, errors: [] }
    try {
      const nowSec = Math.floor(Date.now() / 1000)
      for (const tracked of state.trackedChats) {
        const chatId = tracked.chatId
        const chatName = tracked.name || chatId
        out.chats++
        const since = state.cursors[chatId] || String(nowSec - Math.round(state.lookbackHours * 3600))
        let pageToken = ''
        for (let page = 0; page < 3; page++) {
          const params = {
            container_id_type: 'chat',
            container_id: chatId,
            start_time: since,
            sort_type: 'ByCreateTimeAsc',
            page_size: 50,
          }
          if (pageToken !== '') params.page_token = pageToken
          const data = await api('GET', '/open-apis/im/v1/messages', params)
          const items = data.items || []
          for (const msg of items) {
            if (typeof msg.message_id !== 'string' || state.seenIds.indexOf(msg.message_id) !== -1) continue
            state.seenIds.push(msg.message_id)
            out.newMessages++
            if (msg.msg_type === 'text' && msg.body && typeof msg.body.content === 'string') {
              let text = ''
              try { text = JSON.parse(msg.body.content).text || '' } catch (e) {}
              text = text.replace(/@_user_\d+/g, '').trim()
              const senderId = (msg.sender && typeof msg.sender.id === 'string') ? msg.sender.id : 'unknown'
              const time = new Date(Number(msg.create_time) || Date.now()).toISOString()
              for (const taskText of extractTasks(text)) {
                state.tasks.push({
                  id: state.seq++,
                  text: taskText,
                  status: 'pending',
                  chatName: chatName,
                  senderId: senderId,
                  messageId: msg.message_id,
                  time: time,
                })
                out.newTasks++
              }
            }
            const ct = Math.floor(Number(msg.create_time || 0) / 1000)
            if (ct > 0 && (state.cursors[chatId] === undefined || ct >= Number(state.cursors[chatId]))) {
              state.cursors[chatId] = String(ct)
            }
          }
          if (data.has_more === true && typeof data.page_token === 'string' && data.page_token !== '') {
            pageToken = data.page_token
          } else {
            break
          }
        }
      }
      if (state.seenIds.length > SEEN_CAP) state.seenIds = state.seenIds.slice(-SEEN_CAP)
      state.polls++
      state.newMessagesTotal += out.newMessages
      state.lastPollAt = new Date().toISOString()
      state.lastError = null
      out.boardSync = await syncBoard()
      await saveAll()
    } catch (e) {
      state.lastError = String((e && e.message) || e)
      out.errors.push(state.lastError)
    } finally {
      state.polling = false
    }
    return out
  }

  // ---------- shared actions ----------
  async function judgeTask(id, verdict) {
    if (verdict !== 'ai' && verdict !== 'manual' && verdict !== 'reject') {
      throw new Error('verdict 必须是 ai / manual / reject')
    }
    const task = state.tasks.find((t) => t.id === id)
    if (task === undefined) throw new Error('没有找到 id=' + id + ' 的任务')
    const s = normalizeTask(task).status
    if (s !== 'pending') throw new Error('任务 #' + id + ' 当前状态是 ' + s + '，只有待审核任务可以判定')
    task.status = verdict === 'reject' ? 'rejected' : verdict
    task.judgedAt = new Date().toISOString()
    await pushJudgment(task)
    // 判定前还没上看板的任务：立即补建卡片（AI 带 prompt 落在待办列可直接运行）
    if (typeof task.boardId !== 'string' && task.status !== 'rejected') {
      await syncBoard()
    }
    return task
  }

  function completeTask(id) {
    const task = state.tasks.find((t) => t.id === id)
    if (task === undefined) throw new Error('没有找到 id=' + id + ' 的任务')
    task.status = 'done'
    task.doneAt = new Date().toISOString()
    return task
  }

  // ---------- interval management ----------
  let intervalDisposer = null
  function startInterval() {
    if (intervalDisposer !== null) { intervalDisposer(); intervalDisposer = null }
    intervalDisposer = ctx.interval(() => { pollOnce() }, Math.round(state.pollHours * 3600 * 1000))
  }

  async function setIntervalHours(hours) {
    const n = Number(hours)
    if (!isFinite(n) || n < 0.25 || n > 24) throw new Error('轮询间隔必须在 0.25 ~ 24 小时之间')
    state.pollHours = n
    startInterval()
    await saveAll()
    return state.pollHours
  }

  // ---------- panel data ----------
  function statusCounts() {
    const c = { pending: 0, ai: 0, manual: 0, rejected: 0, done: 0 }
    for (const t of state.tasks) c[normalizeTask(t).status]++
    return c
  }
  function slim(t) {
    return { id: t.id, text: t.text, chatName: t.chatName, time: t.time, doneAt: t.doneAt || null, linked: typeof t.boardId === 'string' }
  }
  async function boardData() {
    const auth = await authStatus()
    const groups = { pending: [], ai: [], manual: [], done: [], rejected: [] }
    let linked = 0
    for (const t of state.tasks) {
      groups[normalizeTask(t).status].push(t)
      if (typeof t.boardId === 'string') linked++
    }
    return {
      auth: { userReady: auth.userReady },
      intervalHours: state.pollHours,
      lastPollAt: state.lastPollAt,
      lastError: state.lastError,
      counts: statusCounts(),
      board: { linked: linked, lastSyncAt: state.boardLastSyncAt, lastError: state.boardLastError },
      trackedChats: state.trackedChats.map((t) => ({ chatId: t.chatId, name: t.name })),
      groups: {
        pending: groups.pending.slice(-50).map(slim),
        ai: groups.ai.slice(-50).map(slim),
        manual: groups.manual.slice(-50).map(slim),
        done: groups.done.slice(-10).map(slim),
      },
    }
  }

  // ---------- HTTP routes（浏览器面板用；仅接受本机回环 + 浏览器同源标记） ----------
  function writeJson(res, status, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  function trustedRequest(req) {
    const addr = (req.socket && req.socket.remoteAddress) || ''
    const loopback = addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.')
    if (!loopback) return false
    return typeof req.headers.origin === 'string' || typeof req.headers['sec-fetch-site'] === 'string'
  }

  async function readBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 256 * 1024) throw new Error('body-too-large')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  const routes = [
    {
      kind: 'exact',
      path: '/api/feishu-tasks/state',
      handler: async (req, res) => {
        captureOrigin(req)
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!trustedRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden' })
        try {
          writeJson(res, 200, await boardData())
        } catch (e) {
          writeJson(res, 500, { ok: false, error: String((e && e.message) || e) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/feishu-tasks/action',
      handler: async (req, res) => {
        captureOrigin(req)
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!trustedRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden' })
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          return writeJson(res, 415, { ok: false, error: 'json-required' })
        }
        try {
          const body = await readBody(req)
          const kind = body && body.kind
          if (kind === 'judge') {
            await judgeTask(body.id, body.verdict)
          } else if (kind === 'done') {
            completeTask(body.id)
          } else if (kind === 'interval') {
            await setIntervalHours(body.hours)
          } else if (kind === 'sync') {
            await pollOnce()
          } else {
            return writeJson(res, 400, { ok: false, error: 'unknown-kind' })
          }
          await saveAll()
          writeJson(res, 200, await boardData())
        } catch (e) {
          writeJson(res, 400, { ok: false, error: String((e && e.message) || e) })
        }
      },
    },
  ]

  // ---------- tools ----------
  function defTool(name, description, parameters, execute) {
    return defineTool({
      name: name,
      description: description,
      parameters: parameters,
      output: { schema: OUT_SCHEMA, render: render },
      execute: execute,
    })
  }

  const tools = [
    defTool('feishu_setup',
      '检查飞书授权状态（身份由本机 lark-cli 托管，插件不接触任何密钥）。用户态未授权时会返回操作指引；已授权则立即做一次轮询。',
      {},
      async () => {
        const auth = await authStatus()
        if (!auth.userReady) {
          return {
            ok: false,
            auth: auth,
            guidance: '用户态未授权。请告诉 agent「发起飞书授权」，它会运行 lark-cli auth login 给你生成授权链接；在浏览器确认后即可。',
          }
        }
        const first = await pollOnce()
        return { ok: true, auth: auth, firstPoll: first }
      }),

    defTool('feishu_chats',
      '列出你飞书账号可见的会话（群聊/单聊），用于挑选要监听的会话。返回 chat_id 供 feishu_track 使用。',
      {},
      async () => {
        const out = []
        let pageToken = ''
        for (let p = 0; p < 3; p++) {
          const params = { page_size: 100 }
          if (pageToken !== '') params.page_token = pageToken
          const data = await api('GET', '/open-apis/im/v1/chats', params)
          for (const c of (data.items || [])) {
            if (typeof c.chat_id !== 'string') continue
            out.push({
              chatId: c.chat_id,
              name: typeof c.name === 'string' && c.name !== '' ? c.name : '(未命名单聊)',
              tracked: state.trackedChats.some((t) => t.chatId === c.chat_id),
            })
          }
          if (data.has_more === true && typeof data.page_token === 'string' && data.page_token !== '') {
            pageToken = data.page_token
          } else {
            break
          }
        }
        return { count: out.length, chats: out, hint: '用 feishu_track(action=add, chat_id=...) 把要监听的会话加进来' }
      }),

    defTool('feishu_track',
      '管理要监听拉取任务的飞书会话：action=add 加监听（需 chat_id，可选 name 备注）、action=remove 取消监听、action=list 查看当前监听列表。',
      {
        action: { type: 'string', required: true, description: 'add / remove / list' },
        chat_id: { type: 'string', description: '会话 chat_id（add/remove 时必填）' },
        name: { type: 'string', description: '会话名称备注（add 时可选）' },
      },
      async (args) => {
        const a = args || {}
        if (a.action === 'list') return { count: state.trackedChats.length, trackedChats: state.trackedChats }
        if (typeof a.chat_id !== 'string' || a.chat_id.trim() === '') throw new Error('action=' + a.action + ' 需要 chat_id')
        const chatId = a.chat_id.trim()
        if (a.action === 'add') {
          if (state.trackedChats.some((t) => t.chatId === chatId)) return { ok: true, already: true, trackedChats: state.trackedChats }
          state.trackedChats.push({ chatId: chatId, name: (typeof a.name === 'string' && a.name.trim() !== '') ? a.name.trim() : chatId })
          await saveAll()
          const r = await pollOnce()
          return { ok: true, trackedChats: state.trackedChats, firstPoll: r }
        }
        if (a.action === 'remove') {
          const before = state.trackedChats.length
          state.trackedChats = state.trackedChats.filter((t) => t.chatId !== chatId)
          await saveAll()
          return { ok: true, removed: before - state.trackedChats.length, trackedChats: state.trackedChats }
        }
        throw new Error('action 必须是 add / remove / list')
      }),

    defTool('feishu_sync_now',
      '立即轮询一次被监听会话的飞书消息并与任务看板插件双向同步（自动轮询间隔可用 feishu_poll_interval 调整）。返回本次新消息数与新提取任务数。',
      {},
      async () => await pollOnce()),

    defTool('feishu_poll_interval',
      '查看或修改自动轮询间隔（小时，0.25~24）。不传 hours 查看当前值；传 hours 立即生效并持久化。',
      {
        hours: { type: 'number', description: '新的轮询间隔（小时），如 0.5、1、3、6' },
      },
      async (args) => {
        const a = args || {}
        if (a.hours === undefined || a.hours === null) return { intervalHours: state.pollHours }
        const v = await setIntervalHours(a.hours)
        return { ok: true, intervalHours: v }
      }),

    defTool('feishu_lookback',
      '查看或修改「新会话首次拉取的历史回溯窗口」（小时，1~720，默认 24）。影响新加入监听会话的首拉范围；已跟踪会话想补拉历史请用 feishu_cursor_reset。',
      {
        hours: { type: 'number', description: '回溯窗口（小时），如 24、72、168' },
      },
      async (args) => {
        const a = args || {}
        if (a.hours === undefined || a.hours === null) return { lookbackHours: state.lookbackHours }
        const n = Number(a.hours)
        if (!isFinite(n) || n < 1 || n > 720) throw new Error('回溯窗口必须在 1 ~ 720 小时之间')
        state.lookbackHours = n
        await saveAll()
        return { ok: true, lookbackHours: state.lookbackHours }
      }),

    defTool('feishu_cursor_reset',
      '把某个（或全部）被监听会话的拉取游标回拨 hours 小时并立即轮询，用于补拉历史消息（已见消息自动去重，不会重复提取任务）。',
      {
        hours: { type: 'number', required: true, description: '回拨多少小时，如 24、72、168' },
        chat_id: { type: 'string', description: '会话 chat_id；不传则回拨全部监听会话' },
      },
      async (args) => {
        const a = args || {}
        const n = Number(a.hours)
        if (!isFinite(n) || n < 1 || n > 720) throw new Error('hours 必须在 1 ~ 720 之间')
        const since = String(Math.floor(Date.now() / 1000) - Math.round(n * 3600))
        let targets = state.trackedChats
        if (typeof a.chat_id === 'string' && a.chat_id.trim() !== '') {
          targets = state.trackedChats.filter((t) => t.chatId === a.chat_id.trim())
          if (targets.length === 0) throw new Error('该 chat_id 不在监听列表里')
        }
        for (const t of targets) state.cursors[t.chatId] = since
        const r = await pollOnce()
        return { ok: true, resetChats: targets.map((t) => t.name), sinceHours: n, poll: r }
      }),

    defTool('feishu_status',
      '查看飞书任务记录器状态：授权、监听会话、轮询间隔与次数、最近错误、看板同步状态、各状态任务统计与存储文件位置。',
      {},
      async () => {
        const auth = await authStatus()
        let linked = 0
        for (const t of state.tasks) if (typeof t.boardId === 'string') linked++
        return {
          auth: auth,
          pollIntervalHours: state.pollHours,
          polls: state.polls,
          lastPollAt: state.lastPollAt,
          lastError: state.lastError,
          lastSaveError: state.lastSaveError,
          board: { api: boardApi(), linked: linked, lastSyncAt: state.boardLastSyncAt, lastError: state.boardLastError },
          newMessagesTotal: state.newMessagesTotal,
          lookbackHours: state.lookbackHours,
          trackedChats: state.trackedChats,
          tasks: statusCounts(),
          seenIdsCached: state.seenIds.length,
          storePath: state.storePath,
          boardPath: state.boardPath,
        }
      }),

    defTool('feishu_task_list',
      '列出任务。status=pending 待审核（默认）、ai AI 任务、manual 人工任务、done 已完成、rejected 已判定非任务、active 所有未完成（pending+ai+manual）、all 全部。',
      {
        status: { type: 'string', description: 'pending/ai/manual/done/rejected/active/all，默认 pending' },
      },
      async (args) => {
        const status = (args && args.status) || 'pending'
        const list = state.tasks.filter((t) => {
          const s = normalizeTask(t).status
          if (status === 'all') return true
          if (status === 'active') return s === 'pending' || s === 'ai' || s === 'manual'
          return s === status
        })
        return { count: list.length, filter: status, tasks: list.slice(-100) }
      }),

    defTool('feishu_task_review',
      '审核工作台：列出所有「待审核」任务，供逐条判定。返回 id、内容、来源会话、时间。',
      {},
      async () => {
        const pending = state.tasks.filter((t) => normalizeTask(t).status === 'pending')
        return {
          count: pending.length,
          tasks: pending.slice(-50).map((t) => ({ id: t.id, text: t.text, chatName: t.chatName, senderId: t.senderId, time: t.time })),
          hint: '判定入口任选：①界面右下角「飞书任务」面板的按钮；②你的任务看板插件（卡片移出「待规划」=接受，删除=非任务）；③让我调用 feishu_task_judge',
        }
      }),

    defTool('feishu_task_judge',
      '判定一条待审核任务：verdict=ai 真实任务且由 AI 实现；manual 真实任务由人实现；reject 非真实任务（移入已丢弃）。判定会同步到你的任务看板插件。',
      {
        id: { type: 'number', required: true, description: '任务编号' },
        verdict: { type: 'string', required: true, description: 'ai / manual / reject' },
      },
      async (args) => {
        const a = args || {}
        const task = await judgeTask(a.id, a.verdict)
        await saveAll()
        return { ok: true, task: task, boardSyncError: state.boardLastError }
      }),

    defTool('feishu_task_add',
      '手动添加一条任务到看板（进入待审核，等待判定）。',
      {
        text: { type: 'string', required: true, description: '任务内容' },
      },
      async (args) => {
        const a = args || {}
        if (typeof a.text !== 'string' || a.text.trim().length < 2) throw new Error('任务内容至少 2 个字符')
        const task = {
          id: state.seq++,
          text: a.text.trim(),
          status: 'pending',
          chatName: '手动添加',
          senderId: 'local',
          messageId: null,
          time: new Date().toISOString(),
        }
        state.tasks.push(task)
        await saveAll()
        return { ok: true, task: task, saved: state.lastSaveError === null, saveError: state.lastSaveError }
      }),

    defTool('feishu_task_done',
      '把一条任务标记为完成（任意状态均可归档）。',
      {
        id: { type: 'number', required: true, description: '任务编号（feishu_task_list 里的 id）' },
      },
      async (args) => {
        const a = args || {}
        const task = completeTask(a.id)
        await saveAll()
        return { ok: true, task: task }
      }),
  ]

  // ---------- lifecycle ----------
  ctx.effect(() => {
    const disposers = []
    for (const t of tools) disposers.push(ctx.tools.register(t))
    for (const route of routes) disposers.push(ctx.webServer.register(route))

    ;(async () => {
      await loadAll()
      const auth = await authStatus()
      if (auth.userReady && state.trackedChats.length > 0) {
        console.log('[feishu-task-recorder] 已授权且有监听会话，开始轮询（每 ' + state.pollHours + ' 小时），并与任务看板插件同步')
        await pollOnce()
      } else {
        console.log('[feishu-task-recorder] 等待授权或监听会话（feishu_setup / feishu_track）')
      }
    })()
    startInterval()

    return () => {
      if (intervalDisposer !== null) { intervalDisposer(); intervalDisposer = null }
      for (const d of disposers.splice(0)) d()
    }
  }, 'feishu-task-recorder')
}

export default { name, inject, apply }
