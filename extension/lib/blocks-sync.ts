// X-native block list sync (二开: 识别到 X 账号已拉黑的账号数量与详细列表).
//
// The overview card shows the accounts the user's OWN X account has already
// blocked natively. That truth lives on X, not in this extension, so a fresh
// install shows 0 until the user hits 「同步拉黑列表」 — a manual, paged pull
// of X's 1.1 blocks/list endpoint executed in an open x.com tab (same ct0
// cookie constraint as performXAction), relayed through the background.
//
// Safety: read-only GETs, one page at a time with a short delay (no burst),
// hard cap on stored users, everything stays in local storage.

export interface XBlockedUser {
  /** X numeric user id. */
  u: string;
  /** X handle (screen_name), lowercase. */
  h: string;
  /** X display name (blocks/list user objects carry it). */
  n?: string;
  /** X CDN avatar. */
  a?: string;
}

export interface XBlocksData {
  syncedAt: number | null;
  count: number;
  users: XBlockedUser[];
}

export interface XBlocksSyncState {
  running: boolean;
  pages: number;
  fetched: number;
  nextCursor: string | null;
  lastError: string | null;
  finishedAt: number | null;
}

export const X_BLOCKS_KEY = "xss:x-blocks:v1";
export const X_BLOCKS_SYNC_KEY = "xss:x-blocks:sync";
export const X_BLOCKS_PAGE_SIZE = 200;
export const X_BLOCKS_MAX_USERS = 50_000;
/** Inter-page delay for the paged pull (read-only, but stay polite). */
export const X_BLOCKS_PAGE_DELAY_MS = 800;
export const X_BLOCKS_PAGE_JITTER_MS = 400;

export function emptyXBlocksData(): XBlocksData {
  return { syncedAt: null, count: 0, users: [] };
}

export function emptyXBlocksSyncState(): XBlocksSyncState {
  return {
    running: false,
    pages: 0,
    fetched: 0,
    nextCursor: null,
    lastError: null,
    finishedAt: null,
  };
}

export async function getXBlocksData(): Promise<XBlocksData> {
  try {
    const got = await chrome.storage.local.get(X_BLOCKS_KEY);
    const v = got[X_BLOCKS_KEY] as Partial<XBlocksData> | undefined;
    if (!v || !Array.isArray(v.users)) return emptyXBlocksData();
    return { syncedAt: v.syncedAt ?? null, count: v.count ?? v.users.length, users: v.users };
  } catch {
    return emptyXBlocksData();
  }
}

export async function saveXBlocksData(d: XBlocksData): Promise<void> {
  d.count = d.users.length;
  await chrome.storage.local.set({ [X_BLOCKS_KEY]: d });
}

export async function getXBlocksSyncState(): Promise<XBlocksSyncState> {
  try {
    const got = await chrome.storage.local.get(X_BLOCKS_SYNC_KEY);
    const v = got[X_BLOCKS_SYNC_KEY] as Partial<XBlocksSyncState> | undefined;
    if (!v) return emptyXBlocksSyncState();
    return { ...emptyXBlocksSyncState(), ...v };
  } catch {
    return emptyXBlocksSyncState();
  }
}

export async function saveXBlocksSyncState(s: XBlocksSyncState): Promise<void> {
  await chrome.storage.local.set({ [X_BLOCKS_SYNC_KEY]: s });
}

/** Human-readable reason for a failed page pull (content script reports). */
export function blocksSyncErrorText(error: string | null): string {
  switch (error) {
    case "not_logged_in":
      return "x.com 未登录或登录态已失效——请在浏览器里登录 X 后重试";
    case "rate_limited":
      return "X 限流中，请几分钟后再试";
    case "network":
      return "网络错误，x.com 标签页可能已关闭";
    case null:
    case "":
      return "";
    default:
      return `同步失败（${error}）`;
  }
}

/** 误操作恢复：解除拉黑成功后从本地同步列表移除该账号。 */
export async function removeXBlockedUser(u: string, h: string): Promise<boolean> {
  const d = await getXBlocksData();
  const before = d.users.length;
  d.users = d.users.filter((x) => !((!!u && x.u === u) || (!!h && x.h === h)));
  if (d.users.length === before) return false;
  await saveXBlocksData(d);
  return true;
}
