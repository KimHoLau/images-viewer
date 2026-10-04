import { describe, expect, it } from 'vitest';
import { isFileSystemAccessSupported, openFiles } from './file-browser';
import { isRawExtension } from '../types/image';

describe('file-browser', () => {
  describe('isFileSystemAccessSupported', () => {
    it('should return boolean', () => {
      expect(typeof isFileSystemAccessSupported()).toBe('boolean');
    });
  });

  describe('isRawExtension', () => {
    it('should identify RAW formats', () => {
      expect(isRawExtension('cr2')).toBe(true);
      expect(isRawExtension('CR3')).toBe(true);
      expect(isRawExtension('nef')).toBe(true);
      expect(isRawExtension('arw')).toBe(true);
      expect(isRawExtension('raf')).toBe(true);
      expect(isRawExtension('dng')).toBe(true);
    });

    it('should return false for non-RAW formats', () => {
      expect(isRawExtension('jpg')).toBe(false);
      expect(isRawExtension('png')).toBe(false);
      expect(isRawExtension('webp')).toBe(false);
    });
  });

  describe('openFiles', () => {
    it('should filter and sort image files', () => {
      const files = [
        new File([''], 'zebra.jpg'),
        new File([''], 'alpha.png'),
        new File([''], 'document.pdf'),
        new File([''], 'photo.cr2'),
      ];

      const result = openFiles(files);

      expect(result.images).toHaveLength(3);
      expect(result.images[0].name).toBe('alpha.png');
      expect(result.images[1].name).toBe('photo.cr2');
      expect(result.images[2].name).toBe('zebra.jpg');
    });

    it('should mark RAW files correctly', () => {
      const files = [new File([''], 'test.cr2')];
      const result = openFiles(files);

      expect(result.images[0].isRaw).toBe(true);
      expect(result.images[0].extension).toBe('cr2');
    });

    it('should handle empty file list', () => {
      const result = openFiles([]);
      expect(result.images).toHaveLength(0);
    });
  });
});
