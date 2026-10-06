import '@testing-library/jest-dom/vitest';
// 让 jsdom 环境具备 IndexedDB，用于测试缩略图缓存
import 'fake-indexeddb/auto';

// jsdom 的 Blob 是精简实现，只有 slice/size/type，缺少读取方法。
// 真浏览器上这些方法都在，所以这里只补测试环境，不改生产代码。
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.readAsArrayBuffer(this);
    });
  };
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.readAsText(this);
    });
  };
}

// jsdom 不做布局，没有 scrollIntoView
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

// jsdom 没有 ImageData，而 RAW 解码结果与离屏渲染读回的像素都要用它
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: PredefinedColorSpace = 'srgb';

    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / 4 / width;
    }
  }

  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}
