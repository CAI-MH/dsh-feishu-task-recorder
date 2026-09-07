// dsh-feishu-task-recorder — 浏览器端：右下角悬浮「飞书任务」看板面板
// 数据通过同源 HTTP（/api/feishu-tasks/*）与 Host 半部分通信。
window.__ModuleLoader__.load({
  id: 'dsh-feishu-task-recorder',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    const CSS =
      '.ftb-fab{position:fixed;right:20px;bottom:20px;z-index:9999;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:999px;padding:10px 14px;font-size:13px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)}' +
      '.ftb-badge{background:var(--dsw-alias-state-error-primary);border-radius:999px;min-width:18px;height:18px;padding:0 4px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;color:#fff}' +
      '.ftb-panel{position:fixed;right:20px;bottom:72px;width:420px;max-height:72vh;z-index:9999;pointer-events:auto;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}' +
      '.ftb-head{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}' +
      '.ftb-head .spacer{flex:1}' +
      '.ftb-body{overflow-y:auto;padding:4px 12px 12px}' +
      '.ftb-sec{margin-top:12px;font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}' +
      '.ftb-task{padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-top:6px;font-size:13px;line-height:1.55;background:var(--dsw-alias-bg-layer-1)}' +
      '.ftb-task.done{opacity:.55}' +
      '.ftb-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px}' +
      '.ftb-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}' +
      '.ftb-btn{font-size:12px;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}' +
      '.ftb-btn:hover{filter:brightness(1.12)}' +
      '.ftb-btn:disabled{opacity:.5;cursor:default}' +
      '.ftb-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}' +
      '.ftb-btn-icon{padding:3px 8px}' +
      '.ftb-select{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:12px;padding:2px 4px}' +
      '.ftb-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:6px 0}' +
      '.ftb-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 0;word-break:break-all}' +
      '.ftb-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}' +
      '.ftb-sc{margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}' +
      '.ftb-sc-head{padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600}' +
      '.ftb-sc-body{padding:8px 10px;font-size:12px}' +
      '.ftb-sc-issue{padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}' +
      '.ftb-sc-issue .t{font-weight:600}' +
      '.ftb-sc-advice{margin-top:8px;padding:8px;background:rgba(245,166,35,.12);border-radius:6px}' +
      '.ftb-sc-pre{white-space:pre-wrap;word-break:break-all;font-size:10px;max-height:160px;overflow:auto;background:var(--dsw-alias-bg-layer-2);padding:6px;border-radius:6px;margin-top:6px}'

    const INTERVAL_OPTIONS = [0.5, 1, 2, 3, 6, 12, 24]

    async function rpc(path, body) {
      const init = body === undefined
        ? { headers: { Accept: 'application/json' } }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          }
      const res = await fetch(path, init)
      const data = await res.json()
      if (!res.ok || (data && data.ok === false)) {
        throw new Error((data && data.error) || ('HTTP ' + res.status))
      }
      return data
    }

    function TaskRow(props) {
      const t = props.task
      const busy = props.busy
      const children = [
        h('div', { key: 'text' }, t.text),
        h('div', { className: 'ftb-meta', key: 'meta' },
          '来源：' + t.chatName + ' · ' + (t.time || '').slice(0, 16).replace('T', ' ') + (t.linked ? ' · 🔗已上看板' : '')),
      ]
      if (props.mode === 'pending') {
        children.push(h('div', { className: 'ftb-actions', key: 'act' }, [
          h('button', { key: 'ai', className: 'ftb-btn ftb-btn-primary', disabled: busy, onClick: () => props.onJudge(t.id, 'ai') }, '🤖 AI 实现'),
          h('button', { key: 'manual', className: 'ftb-btn', disabled: busy, onClick: () => props.onJudge(t.id, 'manual') }, '👤 人工'),
          h('button', { key: 'reject', className: 'ftb-btn', disabled: busy, onClick: () => props.onJudge(t.id, 'reject') }, '🗑 非任务'),
        ]))
      } else if (props.mode === 'active') {
        children.push(h('div', { className: 'ftb-actions', key: 'act' }, [
          h('button', { key: 'done', className: 'ftb-btn', disabled: busy, onClick: () => props.onDone(t.id) }, '✓ 完成'),
        ]))
      }
      return h('div', { className: 'ftb-task' + (props.mode === 'done' ? ' done' : '') }, children)
    }

    function SelfCheckPanel(props) {
      const d = props.data || {}
      const items = []
      if (d.time) items.push(h('div', { className: 'ftb-meta', key: 'time' }, '检查时间：' + String(d.time).slice(0, 16).replace('T', ' ')))
      if (d.error) items.push(h('div', { className: 'ftb-err', key: 'err' }, '自查失败：' + d.error))
      for (const it of (d.issues || [])) {
        const icon = it.level === 'error' ? '❌ ' : it.level === 'warn' ? '⚠️ ' : it.level === 'ok' ? '✅ ' : ''
        items.push(h('div', { className: 'ftb-sc-issue', key: 'i' + items.length }, [
          h('div', { className: 't', key: 't' }, icon + it.title),
          h('div', { className: 'ftb-meta', key: 'd' }, it.detail),
        ]))
      }
      if (d.advice && d.advice.length) {
        items.push(h('div', { className: 'ftb-sc-advice', key: 'adv' }, d.advice.map((a, i) => h('div', { className: 'ftb-meta', key: i }, a))))
      }
      if (d.doctor || d.whoami) {
        const raw = (d.doctor ? '=== lark-cli doctor ===\n' + ((d.doctor.stdout || '') + (d.doctor.stderr || '')) : '') +
          (d.whoami ? '\n=== lark-cli whoami ===\n' + ((d.whoami.stdout || '') + (d.whoami.stderr || '')) : '')
        items.push(h('details', { key: 'det' }, [
          h('summary', { className: 'ftb-meta', style: { cursor: 'pointer' } }, '查看原始诊断输出'),
          h('pre', { className: 'ftb-sc-pre' }, raw),
        ]))
      }
      return h('div', { className: 'ftb-sc' }, [
        h('div', { className: 'ftb-sc-head', key: 'head' }, [
          h('span', { key: 't' }, '🩺 飞书插件自查'),
          h('span', { className: 'spacer', key: 'sp' }),
          h('button', { key: 'retry', className: 'ftb-btn ftb-btn-icon', onClick: props.onRetry, title: '重新诊断' }, '↻'),
          h('button', { key: 'x', className: 'ftb-btn ftb-btn-icon', onClick: props.onClose, title: '关闭' }, '✕'),
        ]),
        h('div', { className: 'ftb-sc-body', key: 'body' }, items),
      ])
    }

    function Board() {
      const stateArr = React.useState(false)
      const open = stateArr[0]; const setOpen = stateArr[1]
      const dataArr = React.useState(null)
      const data = dataArr[0]; const setData = dataArr[1]
      const busyArr = React.useState(false)
      const busy = busyArr[0]; const setBusy = busyArr[1]
      const scArr = React.useState(null)
      const sc = scArr[0]; const setSc = scArr[1]
      const scBusyArr = React.useState(false)
      const scBusy = scBusyArr[0]; const setScBusy = scBusyArr[1]

      const refresh = async () => {
        try {
          const d = await rpc('/api/feishu-tasks/state')
          setData(d)
        } catch (e) { console.error('[feishu-task-recorder] state 获取失败', e) }
      }
      React.useEffect(() => { refresh() }, [])
      React.useEffect(() => { if (open) refresh() }, [open])

      const act = async (body) => {
        setBusy(true)
        try {
          const d = await rpc('/api/feishu-tasks/action', body)
          if (d && typeof d === 'object' && d.groups) setData(d)
          else await refresh()
        } catch (e) { console.error('[feishu-task-recorder] action 失败', e) }
        finally { setBusy(false) }
      }
      const onJudge = (id, verdict) => act({ kind: 'judge', id: id, verdict: verdict })
      const onDone = (id) => act({ kind: 'done', id: id })
      const onSync = () => act({ kind: 'sync' })
      const onInterval = (ev) => act({ kind: 'interval', hours: Number(ev.target.value) })
      const runSelfCheck = async () => {
        setScBusy(true)
        setSc(null)
        try { setSc(await rpc('/api/feishu-tasks/selfcheck')) }
        catch (e) { setSc({ error: String((e && e.message) || e) }) }
        finally { setScBusy(false) }
      }

      const pendingCount = data && data.counts ? data.counts.pending : 0

      const fab = h('button', { className: 'ftb-fab', onClick: () => setOpen(!open) }, [
        h('span', { key: 'i' }, '📋'),
        h('span', { key: 't' }, '飞书任务'),
        pendingCount > 0 ? h('span', { className: 'ftb-badge', key: 'b' }, String(pendingCount)) : null,
      ])

      if (!open) return fab

      const groups = (data && data.groups) || { pending: [], ai: [], manual: [], done: [] }
      const body = []

      if (data && data.lastError) body.push(h('div', { className: 'ftb-err', key: 'err' }, '轮询错误：' + data.lastError))
      if (data && data.board && data.board.lastError) body.push(h('div', { className: 'ftb-err', key: 'berr' }, '看板同步：' + data.board.lastError))
      if (data && data.auth && data.auth.userReady === false) body.push(h('div', { className: 'ftb-err', key: 'auth' }, '飞书用户态未授权，请在会话里让 agent 发起授权'))
      if (sc) body.push(h(SelfCheckPanel, { key: 'scpanel', data: sc, onClose: () => setSc(null), onRetry: runSelfCheck }))
      if (!data) body.push(h('div', { className: 'ftb-empty', key: 'loading' }, '加载中…'))

      function section(title, list, mode) {
        const rows = [h('div', { className: 'ftb-sec', key: 't' }, title + '（' + list.length + '）')]
        if (list.length === 0) rows.push(h('div', { className: 'ftb-empty', key: 'e' }, '暂无'))
        for (const t of list) rows.push(h(TaskRow, { key: t.id, task: t, mode: mode, busy: busy, onJudge: onJudge, onDone: onDone }))
        return rows
      }

      body.push(h('div', { key: 'pending' }, section('🔍 待审核', groups.pending, 'pending')))
      body.push(h('div', { key: 'ai' }, section('🤖 AI 任务', groups.ai, 'active')))
      body.push(h('div', { key: 'manual' }, section('👤 人工任务', groups.manual, 'active')))
      body.push(h('div', { key: 'done' }, section('✅ 已完成（最近 10 条）', groups.done, 'done')))
      const hints = []
      if (data && data.lastPollAt) hints.push('上次轮询：' + String(data.lastPollAt).slice(0, 16).replace('T', ' '))
      if (data && data.board && data.board.lastSyncAt) hints.push('看板同步：' + String(data.board.lastSyncAt).slice(0, 16).replace('T', ' ') + '（🔗' + data.board.linked + '）')
      hints.push('判定也可以在你的任务看板插件里做：卡片移出「待规划」=接受，删除=非任务')
      body.push(h('div', { className: 'ftb-hint', key: 'lp' }, hints.join(' · ')))

      const panel = h('div', { className: 'ftb-panel' }, [
        h('div', { className: 'ftb-head', key: 'head' }, [
          h('span', { key: 't' }, '📋 飞书任务看板'),
          h('span', { className: 'spacer', key: 'sp' }),
          h('span', { key: 'il', className: 'ftb-hint' }, '轮询'),
          h('select', {
            key: 'sel', className: 'ftb-select', disabled: busy,
            value: String(data && data.intervalHours ? data.intervalHours : 3),
            onChange: onInterval,
          }, INTERVAL_OPTIONS.map((v) => h('option', { key: v, value: String(v) }, v + ' 小时'))),
          h('button', { key: 'sync', className: 'ftb-btn ftb-btn-icon', disabled: busy, onClick: onSync, title: '立即轮询' }, '🔄'),
          h('button', { key: 'refresh', className: 'ftb-btn ftb-btn-icon', disabled: busy, onClick: refresh, title: '刷新' }, '↻'),
          h('button', { key: 'sc', className: 'ftb-btn ftb-btn-icon', disabled: scBusy, onClick: runSelfCheck, title: '飞书插件自查' }, '🩺'),
          h('button', { key: 'x', className: 'ftb-btn ftb-btn-icon', onClick: () => setOpen(false), title: '关闭' }, '✕'),
        ]),
        h('div', { className: 'ftb-body', key: 'body' }, body),
      ])

      return h('div', null, [panel, fab])
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) {
        console.log('[feishu-task-recorder] slots 服务不可用，看板面板未注册')
        return
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'feishu-task-recorder-styles')
      } else {
        const style = document.createElement('style')
        style.textContent = CSS
        document.head.appendChild(style)
      }
      // 关键：shell.overlay 由 shell 稍后声明，直接 register 会在启动时抛错并拖垮渲染进程。
      // slots.inject 等声明就绪后再注册；任何异常都只记录日志，绝不上抛。
      try {
        slots.inject('shell.overlay', () => {
          try {
            slots.register({ name: 'shell.overlay', id: 'feishu-task-board', order: 10, label: '飞书任务看板' }, Board)
          } catch (e) {
            console.error('[feishu-task-recorder] 面板注册失败（不影响启动）', e)
          }
        })
      } catch (e) {
        console.error('[feishu-task-recorder] slots.inject 失败（不影响启动）', e)
      }
    }

    exports.apply = apply
    return module.exports
  },
})
