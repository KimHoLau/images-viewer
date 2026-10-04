import type { FileEntry, FolderBrowseResult } from '../types/image';
import { isRawExtension } from '../types/image';

/** 造一个测试用的文件条目 */
export function makeFileEntry(name: string, content = 'x'): FileEntry {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return {
    name,
    path: name,
    extension,
    isRaw: isRawExtension(extension),
    file: new File([content], name),
  };
}

/** 造一个测试用的浏览结果 */
export function makeBrowseResult(
  names: string[],
  folderName = 'Test Folder',
): FolderBrowseResult {
  return {
    folderName,
    images: names.map((name) => makeFileEntry(name)),
    isFileSystemAccess: false,
  };
}
