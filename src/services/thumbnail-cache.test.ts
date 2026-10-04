import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearThumbnails,
  closeThumbnailDatabase,
  countThumbnails,
  deleteThumbnail,
  getThumbnail,
  isThumbnailCacheAvailable,
  pruneThumbnails,
  putThumbnail,
  type PutThumbnailInput,
} from './thumbnail-cache';

function makeBlob(content = 'thumb', type = 'image/webp'): Blob {
  return new Blob([content], { type });
}

function makeInput(key: string, overrides: Partial<PutThumbnailInput> = {}): PutThumbnailInput {
  return {
    key,
    blob: makeBlob(key),
    width: 256,
    height: 128,
    ...overrides,
  };
}

async function readBlobText(blob: Blob): Promise<string> {
  return blob.text();
}

describe('thumbnail-cache', () => {
  beforeEach(async () => {
    await clearThumbnails();
  });

  afterEach(async () => {
    await clearThumbnails();
  });

  it('reports availability in the jsdom + fake-indexeddb environment', () => {
    expect(isThumbnailCacheAvailable()).toBe(true);
  });

  it('returns null for a missing key', async () => {
    await expect(getThumbnail('nope')).resolves.toBeNull();
  });

  it('stores and reads back a thumbnail', async () => {
    await putThumbnail(makeInput('a.jpg::1::2'));

    const found = await getThumbnail('a.jpg::1::2');

    expect(found).not.toBeNull();
    expect(found!.key).toBe('a.jpg::1::2');
    expect(found!.width).toBe(256);
    expect(found!.height).toBe(128);
    expect(found!.blob.type).toBe('image/webp');
    expect(found!.createdAt).toBeGreaterThan(0);
  });

  it('round-trips the thumbnail bytes and mime type', async () => {
    await putThumbnail(makeInput('a.jpg::1::2', { blob: makeBlob('hello-bytes', 'image/jpeg') }));

    const found = await getThumbnail('a.jpg::1::2');

    await expect(readBlobText(found!.blob)).resolves.toBe('hello-bytes');
    expect(found!.blob.type).toBe('image/jpeg');
  });

  it('falls back to the default mime type when the blob has none', async () => {
    await putThumbnail(makeInput('a.jpg::1::2', { blob: makeBlob('x', '') }));

    const found = await getThumbnail('a.jpg::1::2');

    expect(found!.blob.type).toBe('image/webp');
  });

  it('overwrites an existing entry with the same key', async () => {
    await putThumbnail(makeInput('a.jpg::1::2', { width: 64 }));
    await putThumbnail(makeInput('a.jpg::1::2', { width: 128 }));

    await expect(countThumbnails()).resolves.toBe(1);
    await expect(getThumbnail('a.jpg::1::2')).resolves.toMatchObject({ width: 128 });
  });

  it('refreshes lastAccessed on read', async () => {
    await putThumbnail(makeInput('a.jpg::1::2', { lastAccessed: 1000 }));

    const found = await getThumbnail('a.jpg::1::2');

    expect(found!.lastAccessed).toBeGreaterThan(1000);
  });

  it('deletes a single entry', async () => {
    await putThumbnail(makeInput('a.jpg::1::2'));
    await putThumbnail(makeInput('b.jpg::1::2'));

    await deleteThumbnail('a.jpg::1::2');

    await expect(getThumbnail('a.jpg::1::2')).resolves.toBeNull();
    await expect(countThumbnails()).resolves.toBe(1);
  });

  it('clears everything', async () => {
    await putThumbnail(makeInput('a.jpg::1::2'));
    await putThumbnail(makeInput('b.jpg::1::2'));

    await clearThumbnails();

    await expect(countThumbnails()).resolves.toBe(0);
  });

  it('counts entries', async () => {
    await expect(countThumbnails()).resolves.toBe(0);
    await putThumbnail(makeInput('a.jpg::1::2'));
    await expect(countThumbnails()).resolves.toBe(1);
  });

  describe('pruneThumbnails', () => {
    it('does nothing when under the limit', async () => {
      await putThumbnail(makeInput('a.jpg::1::2', { lastAccessed: 1 }));
      await putThumbnail(makeInput('b.jpg::1::2', { lastAccessed: 2 }));

      await expect(pruneThumbnails(10)).resolves.toBe(0);
      await expect(countThumbnails()).resolves.toBe(2);
    });

    it('evicts the least recently accessed entries first', async () => {
      await putThumbnail(makeInput('old.jpg::1::2', { lastAccessed: 1 }));
      await putThumbnail(makeInput('mid.jpg::1::2', { lastAccessed: 2 }));
      await putThumbnail(makeInput('new.jpg::1::2', { lastAccessed: 3 }));

      const removed = await pruneThumbnails(2);

      expect(removed).toBe(1);
      await expect(countThumbnails()).resolves.toBe(2);
      await expect(getThumbnail('old.jpg::1::2')).resolves.toBeNull();
      await expect(getThumbnail('mid.jpg::1::2')).resolves.not.toBeNull();
      await expect(getThumbnail('new.jpg::1::2')).resolves.not.toBeNull();
    });

    it('can empty the cache with maxEntries 0', async () => {
      await putThumbnail(makeInput('a.jpg::1::2', { lastAccessed: 1 }));
      await putThumbnail(makeInput('b.jpg::1::2', { lastAccessed: 2 }));

      await expect(pruneThumbnails(0)).resolves.toBe(2);
      await expect(countThumbnails()).resolves.toBe(0);
    });

    it('rejects a negative limit', async () => {
      await expect(pruneThumbnails(-1)).rejects.toThrow();
    });
  });

  describe('closeThumbnailDatabase', () => {
    it('closes the connection and can reopen afterwards', async () => {
      await putThumbnail(makeInput('a.jpg::1::2'));
      await closeThumbnailDatabase();

      await expect(getThumbnail('a.jpg::1::2')).resolves.toMatchObject({ key: 'a.jpg::1::2' });
    });
  });
});
