/**
 * File System Access API 中尚未进入 TypeScript 标准库的部分。
 * 标准库已有 FileSystemFileHandle / FileSystemDirectoryHandle，只缺 showDirectoryPicker。
 */

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | string;
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}

/** 标准库只声明了 OPFS 用到的子集，目录遍历的 values() 需要补上 */
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}
