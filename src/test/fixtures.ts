import type { RawMetadata } from '../services/raw-decoder.worker';
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

/**
 * 造一份 RAW 拍摄信息。
 *
 * `RawMetadata` 的字段是给导出 EXIF 兜底用的，加一项就要改所有手写字面量，
 * 所以集中在这里；需要特定字段的测试只覆盖它关心的那几项。
 */
export function makeRawMetadata(overrides: Partial<RawMetadata> = {}): RawMetadata {
  return {
    width: 6000,
    height: 4000,
    make: 'Canon',
    model: 'EOS R5',
    software: '',
    artist: '',
    description: '',
    lensModel: '',
    lensMake: '',
    lensSerial: '',
    bodySerial: '',
    colors: 3,
    iso: 400,
    shutter: 0.005,
    aperture: 2.8,
    focalLength: 35,
    focalLength35mm: 0,
    timestamp: 0,
    ...overrides,
  };
}

/** 造一个测试用的浏览结果 */
export function makeBrowseResult(names: string[], folderName = 'Test Folder'): FolderBrowseResult {
  return {
    folderName,
    images: names.map((name) => makeFileEntry(name)),
    isFileSystemAccess: false,
  };
}
