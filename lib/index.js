/** Host half of dsh-automation-log.
 *
 * The panel itself is browser-only: the client reads `schedule.catalog` through
 * the existing Remote namespace and renders the recent automation runs.
 *
 * This host half adds one small read-only route for the *watchers* — local
 * PowerShell processes (TV, photo pipeline, release check) that are not DSH
 * schedules. They append NDJSON lines to ~/.dsh/watch-events.ndjson; the client
 * fetches them through /automation-log/watch-events and shows them in the same
 * left-side feed, so "Автоматизации" answers both questions: what did the
 * schedule run, and what did the watcher do.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Loader display name. */
export const name = 'automation-log'

/** Shared watcher journal written by watch-events-lib.ps1. */
const EVENTS_FILE = join(process.env.USERPROFILE ?? homedir(), '.dsh', 'watch-events.ndjson')

/** How many recent watcher events the panel may show. */
const MAX_EVENTS = 80

/**
 * Parse the NDJSON journal into plain objects.
 * @param text - whole journal file.
 * @returns valid events, oldest first, at most MAX_EVENTS.
 */
function watchEventsFrom(text) {
  const rows = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.replace(/^\uFEFF/, '').trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed)
      if (!event || typeof event !== 'object' || !event.ts || !event.title) continue
      rows.push({
        ts: String(event.ts),
        watcher: typeof event.watcher === 'string' ? event.watcher : '',
        action: typeof event.action === 'string' ? event.action : '',
        title: String(event.title),
        detail: typeof event.detail === 'string' ? event.detail : '',
        status: typeof event.status === 'string' ? event.status : 'ok'
      })
    } catch {
      // A broken line must not hide the rest of the journal.
    }
  }
  return rows.slice(-MAX_EVENTS)
}

/** Read the journal; a missing file is simply an empty feed. */
async function readEvents() {
  try {
    return watchEventsFrom(await readFile(EVENTS_FILE, 'utf8'))
  } catch {
    return []
  }
}

/**
 * Register the read-only route once the web server is available.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  try {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/automation-log/watch-events',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end()
          return
        }
        const events = await readEvents()
        const body = JSON.stringify({ ok: true, events })
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body)
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      }
    }), 'dsh-automation-log: watch events route')
  })
  } catch (error) {
    console.warn('[automation-log] watch events route unavailable', error)
  }
}
