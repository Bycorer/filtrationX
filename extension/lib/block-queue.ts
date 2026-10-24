// Blacklist one-click block queue (二开: 支持黑名单一键拉黑，但操作不能太快).
//
// The user can bulk-block public-blacklist accounts with their own X session.
// Safety rails, in the order they matter:
//   1. PACING — the background pump waits PUMP_INTERVAL_MS + jitter between
//      requests, ON TOP of lib/x-action's own 1200ms+jitter slot pacing and
//      staged cooldowns. One block per ~3.7-5s wall-clock keeps a bulk run
//      far below X's automation heuristics.
//   2. DAILY CAP — hard ceiling per local calendar day; the queue parks
//      itself when reached.
//   3. RUN LIMIT — the options page starts a bounded run (100/300/500),
//      never "everything" — the list is 190k+ rows and blocking it all is
//      neither realistic nor safe.
//   4. FAIL-STREAK ABORT — 5 consecutive X errors (login expired, endpoint
//      gone) stop the run instead of hammering.
//
// Execution lives in an open x.com tab's content script (only a page holds
// the ct0 CSRF cookie performXAction needs); the background owns the queue,
// the pacing and the persisted progress, and dispatches one item at a time.
// Everything survives service-worker death: progress is checkpointed to
// storage after every item and a 1-minute watchdog alarm resumes the pump.

import type { LiteRow } from "./list-sync";

export interface BlockQueueItem {
  /** X numeric user id (may be empty when the artifact row has none). */
  u: string;
  /** X handle, lowercase-normalized by the list sync. */
  h: string;
}

export interface BlockQueueState {
  items: BlockQueueItem[];
  cursor: number;
  running: boolean;
  paused: boolean;
  /** Parked because no x.com tab answered; resumes on the next worker hello. */
  needTab: boolean;
  done: number;
  failed: number;
  failStreak: number;
  lastError: string | null;
  startedAt: number | null;
  updatedAt: number;
}

export const BLOCK_QUEUE_KEY = "xss:block-queue:v1";
/** Last x.com content script that said hello (tab id) — the pump's executor. */
export const BLOCK_QUEUE_WORKER_KEY = "xss:block-queue:worker";

export const PUMP_INTERVAL_MS = 2500;
export const PUMP_JITTER_MS = 1200;
// 2026-10 二开调整：按用户要求移除每日配额（DAILY_CAP）。防风控仍由
// 节奏限速（pump 间隔 + x-action 冷却）和失败熔断负责；单次运行数量
// 仍由 options 页的 RUN_LIMITS 限定。
export const MAX_FAIL_STREAK = 5;
export const MAX_QUEUE_ITEMS = 5000;
/** Run-size choices offered by the options page. */
export const RUN_LIMITS = [100, 300, 500] as const;

export function emptyBlockQueue(): BlockQueueState {
  return {
    items: [],
    cursor: 0,
    running: false,
    paused: false,
    needTab: false,
    done: 0,
    failed: 0,
    failStreak: 0,
    lastError: null,
    startedAt: null,
    updatedAt: 0,
  };
}

export async function getBlockQueue(): Promise<BlockQueueState> {
  try {
    const got = await chrome.storage.local.get(BLOCK_QUEUE_KEY);
    const v = got[BLOCK_QUEUE_KEY] as Partial<BlockQueueState> | undefined;
    if (!v || !Array.isArray(v.items)) return emptyBlockQueue();
    return { ...emptyBlockQueue(), ...v, items: v.items as BlockQueueItem[] };
  } catch {
    return emptyBlockQueue();
  }
}

export async function saveBlockQueue(q: BlockQueueState): Promise<void> {
  q.updatedAt = Date.now();
  await chrome.storage.local.set({ [BLOCK_QUEUE_KEY]: q });
}

/** Pick up to `limit` runnable items from the synced lite artifact, skipping
 *  anything already handled locally (processed records) or protected
 *  (whitelist entries, both uid and handle). */
export function buildBlockQueueItems(
  rows: LiteRow[],
  limit: number,
  skip: Set<string>,
): BlockQueueItem[] {
  const cap = Math.min(Math.max(1, Math.floor(limit) || 100), MAX_QUEUE_ITEMS);
  const items: BlockQueueItem[] = [];
  for (const row of rows) {
    if (items.length >= cap) break;
    if (!Array.isArray(row) || row.length < 2) continue;
    const uid = typeof row[0] === "string" ? row[0].trim() : "";
    const handle = typeof row[1] === "string" ? row[1].trim().replace(/^@+/, "").toLowerCase() : "";
    if (!uid && !handle) continue;
    if (skip.has(uid) || skip.has(handle)) continue;
    items.push({ u: uid, h: handle });
  }
  return items;
}

/** A response shape the content script returns per dispatched item. */
export interface BlockQueueExecResult {
  ok?: boolean;
  retryable?: boolean;
  status?: number;
  skipped?: boolean;
}
