import { IMAGE_EXTENSIONS, isRawExtension, type FileEntry, type FolderBrowseResult } from '../types/image';

/** 检测是否支持 File System Access API */
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

/** 从文件名提取扩展名（小写，不含点） */
function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

/** 判断是否为支持的图片格式 */
function isSupportedImage(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getExtension(filename) as (typeof IMAGE_EXTENSIONS)[number]);
}

/** 由文件名与 File 对象组装条目；两条打开路径共用 */
function toFileEntry(file: File, path = file.name): FileEntry {
  const extension = getExtension(file.name);
  return {
    name: file.name,
    path,
    extension,
    isRaw: isRawExtension(extension),
    file,
  };
}

/** 将 File 列表转换为 FileEntry 列表（按文件名排序） */
function filesToFileEntries(files: File[]): FileEntry[] {
  return files
    .filter((file) => isSupportedImage(file.name))
    .map((file) => toFileEntry(file))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 使用 File System Access API 打开文件夹
 * 需要用户手势触发（click 事件）
 */
export async function openFolderWithFileSystemAccess(): Promise<FolderBrowseResult> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser');
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  const images: FileEntry[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && isSupportedImage(entry.name)) {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      images.push({ ...toFileEntry(file, `${dirHandle.name}/${entry.name}`), handle: fileHandle });
    }
  }

  images.sort((a, b) => a.name.localeCompare(b.name));

  return {
    folderName: dirHandle.name,
    images,
    isFileSystemAccess: true,
  };
}

/**
 * 降级方案：使用 <input type="file" webkitdirectory> 打开文件夹
 * 兼容性更好，但无法获取文件句柄
 */
export function openFolderWithInput(): Promise<FolderBrowseResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.multiple = true;

    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        reject(new Error('No files selected'));
        return;
      }

      const images = filesToFileEntries(files);
      const folderName = files[0].webkitRelativePath?.split('/')[0] || 'Selected Folder';

      resolve({
        folderName,
        images,
        isFileSystemAccess: false,
      });
    };

    input.onerror = () => {
      reject(new Error('Failed to open folder'));
    };

    input.click();
  });
}

/**
 * 打开文件夹（自动选择最佳方案）
 * 优先使用 File System Access API，不支持时降级到 input
 */
export async function openFolder(): Promise<FolderBrowseResult> {
  if (isFileSystemAccessSupported()) {
    try {
      return await openFolderWithFileSystemAccess();
    } catch (error) {
      // 用户取消选择时不降级
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      // 其他错误降级到 input
      return openFolderWithInput();
    }
  }
  return openFolderWithInput();
}

/**
 * 打开单个或多个文件（用于拖拽或文件选择）
 */
export function openFiles(fileList: FileList | File[]): FolderBrowseResult {
  const files = Array.from(fileList);
  const images = filesToFileEntries(files);

  return {
    folderName: 'Selected Files',
    images,
    isFileSystemAccess: false,
  };
}
