/** 支持的图片格式（含 RAW） */
export const IMAGE_EXTENSIONS = [
  // 常规格式
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'avif',
  // RAW 格式
  'cr2',
  'cr3',
  'nef',
  'arw',
  'raf',
  'dng',
  'orf',
  'rw2',
  'pef',
  'srw',
  'x3f',
] as const;

/** 是否为 RAW 格式 */
export function isRawExtension(ext: string): boolean {
  return ['cr2', 'cr3', 'nef', 'arw', 'raf', 'dng', 'orf', 'rw2', 'pef', 'srw', 'x3f'].includes(
    ext.toLowerCase(),
  );
}

/** 文件条目（来自 File System Access API 或降级方案） */
export interface FileEntry {
  /** 文件名 */
  name: string;
  /** 文件路径（File System Access API 下有值，降级方案下为文件名） */
  path: string;
  /** 文件扩展名（小写，不含点） */
  extension: string;
  /** 是否为 RAW 格式 */
  isRaw: boolean;
  /** 底层 File 对象（用于读取内容） */
  file: File;
  /** File System Access API 的句柄（仅 File System Access API 下有值） */
  handle?: FileSystemFileHandle;
}

/** 文件夹浏览结果 */
export interface FolderBrowseResult {
  /** 文件夹名 */
  folderName: string;
  /** 图片文件列表（按文件名排序） */
  images: FileEntry[];
  /** 是否为 File System Access API 模式 */
  isFileSystemAccess: boolean;
}
