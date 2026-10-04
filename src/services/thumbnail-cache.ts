export interface ThumbnailRecord {
  /** 缓存键，见 thumbnailCacheKey */
  key: string;
  /** 缩略图数据 */
  blob: Blob;
  width: number;
  height: number;
  /** 写入时间 */
  createdAt: number;
  /** 最后访问时间，用于 LRU 淘汰 */
  lastAccessed: number;
}

/**
 * 落库的形状：存 ArrayBuffer 而不是 Blob。
 * Blob 在各浏览器写进 IndexedDB 一直有兼容问题（Safari 上尤其），
 * ArrayBuffer 的 structured clone 行为则到处一致。
 */
interface StoredThumbnail {
  key: string;
  data: ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
  lastAccessed: number;
}

const DB_NAME = 'images-viewer';
const DB_VERSION = 1;
const STORE_NAME = 'thumbnails';
const DEFAULT_MIME = 'image/webp';

/** 缓存条目上限，超出后按 LRU 淘汰 */
export const MAX_CACHE_ENTRIES = 2000;

let dbPromise: Promise<IDBDatabase> | null = null;

/** 当前环境是否有 IndexedDB */
export function isThumbnailCacheAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** 打开（必要时创建）缩略图数据库；连接会缓存复用 */
export function openThumbnailDatabase(): Promise<IDBDatabase> {
  if (!isThumbnailCacheAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('Failed to open thumbnail database'));
      };
    });
  }
  return dbPromise;
}

/** 关闭并重置缓存的数据库连接（测试与页面卸载时用） */
export async function closeThumbnailDatabase(): Promise<void> {
  if (!dbPromise) return;
  const pending = dbPromise;
  dbPromise = null;
  try {
    const db = await pending;
    db.close();
  } catch {
    // 打开失败时没有连接需要关闭
  }
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openThumbnailDatabase();
  const tx = db.transaction(STORE_NAME, mode);
  // 先挂上完成回调再发请求：否则事务可能在回调挂上之前就结束，导致永久等待
  const done = transactionDone(tx);
  const result = await run(tx.objectStore(STORE_NAME));
  await done;
  return result;
}

function toRecord(stored: StoredThumbnail): ThumbnailRecord {
  return {
    key: stored.key,
    blob: new Blob([stored.data], { type: stored.mimeType || DEFAULT_MIME }),
    width: stored.width,
    height: stored.height,
    createdAt: stored.createdAt,
    lastAccessed: stored.lastAccessed,
  };
}

export interface PutThumbnailInput {
  key: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt?: number;
  lastAccessed?: number;
}

/** 读取缩略图；命中时顺带刷新 lastAccessed 以便 LRU 淘汰 */
export async function getThumbnail(key: string): Promise<ThumbnailRecord | null> {
  return withStore('readwrite', async (store) => {
    const stored = await requestToPromise<StoredThumbnail | undefined>(store.get(key));
    if (!stored) return null;

    const touched: StoredThumbnail = { ...stored, lastAccessed: Date.now() };
    store.put(touched);
    return toRecord(touched);
  });
}

/** 写入缩略图 */
export async function putThumbnail(input: PutThumbnailInput): Promise<void> {
  const now = Date.now();
  const stored: StoredThumbnail = {
    key: input.key,
    data: await input.blob.arrayBuffer(),
    mimeType: input.blob.type || DEFAULT_MIME,
    width: input.width,
    height: input.height,
    createdAt: input.createdAt ?? now,
    lastAccessed: input.lastAccessed ?? now,
  };
  await withStore('readwrite', (store) => requestToPromise(store.put(stored)));
}

/** 删除单条缩略图 */
export async function deleteThumbnail(key: string): Promise<void> {
  await withStore('readwrite', (store) => requestToPromise(store.delete(key)));
}

/** 清空整个缩略图缓存 */
export async function clearThumbnails(): Promise<void> {
  await withStore('readwrite', (store) => requestToPromise(store.clear()));
}

/** 当前缓存条目数 */
export async function countThumbnails(): Promise<number> {
  return withStore('readonly', (store) => requestToPromise(store.count()));
}

/**
 * 按 LRU 淘汰，把条目数压到 maxEntries 以内。
 * 返回被删掉的条目数。
 */
export async function pruneThumbnails(maxEntries = MAX_CACHE_ENTRIES): Promise<number> {
  if (maxEntries < 0) {
    throw new Error(`maxEntries must be >= 0, got ${maxEntries}`);
  }

  return withStore('readwrite', async (store) => {
    const total = await requestToPromise(store.count());
    let excess = total - maxEntries;
    if (excess <= 0) return 0;

    let removed = 0;
    await new Promise<void>((resolve, reject) => {
      // 按 lastAccessed 升序游标，从小到大删
      const cursorRequest = store.index('lastAccessed').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || excess <= 0) {
          resolve();
          return;
        }
        cursor.delete();
        removed++;
        excess--;
        cursor.continue();
      };
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error('Failed to iterate thumbnail cache'));
    });

    return removed;
  });
}
