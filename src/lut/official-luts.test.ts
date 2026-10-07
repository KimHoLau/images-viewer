import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogSpaceId } from '../color/log-spaces';
import sourceTable from './official-lut-sources.json';
import {
  clearOfficialLutCache,
  loadOfficialLut,
  matchesOfficialFilter,
  officialLutEntries,
  selectOfficialLutEntries,
  type OfficialLutEntry,
} from './official-luts';

/** 一张假的「路径 → URL」表：结构与 import.meta.glob 给的一样 */
const URLS: Record<string, string> = {
  '/3DLUT/ARRI_LogC4_LUT/65/ARRI_LogC4-to-Gamma24_Rec709-D65_v1_65.cube.gz': '/arri-709',
  '/3DLUT/ARRI_LogC4_LUT/65/ARRI_LogC4-to-St2084_1K_Rec2020-D65_DW100_v1_65.cube.gz': '/arri-hdr',
  '/3DLUT/ARRI_LogC4_LUT/65/ARRI_LogC4-to-Gamma26_P3-D65_v1_65.cube.gz': '/arri-p3',
  '/3DLUT/GFX_ETERNA_LUT/65Grid/F-Log/FLog_to_ETERNA_65grid_V.1.00.cube.gz': '/flog',
  '/3DLUT/GFX_ETERNA_LUT/65Grid/F-Log2/FLog2_to_Velvia_65grid_V.1.00.cube.gz': '/flog2-velvia',
  '/3DLUT/GFX_ETERNA_LUT/65Grid/F-Log2/FLog2_to_ACROS_65grid_V.1.00.cube.gz': '/flog2-acros',
  '/3DLUT/NIKON_NLOG_LUT/N-Log_BT2020_to_REC709_BT1886_size_33.cube.gz': '/nikon',
  // 没被映射的目录：换色彩空间时不该混进来
  '/3DLUT/OTHER/oops.cube.gz': '/oops',
};

const CUBE = `TITLE "Fixture"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

function entryByKey(key: string): OfficialLutEntry {
  return { key, name: key, url: `/url/${key}` };
}

/** 只提供 loadOfficialLut 需要的那点接口 */
function fakeResponse(body: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  } as unknown as Response;
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 用 Node 的 zlib 造一份真 gzip，验「魔数分流」那条路 */
async function gzipOf(text: string): Promise<Uint8Array> {
  const { gzipSync } = await import('node:zlib');
  return new Uint8Array(gzipSync(Buffer.from(text, 'utf8')));
}

afterEach(() => {
  clearOfficialLutCache();
  vi.unstubAllGlobals();
});

describe('matchesOfficialFilter', () => {
  it('only 为空表示不筛', () => {
    expect(matchesOfficialFilter('anything.cube')).toBe(true);
    expect(matchesOfficialFilter('anything.cube', [])).toBe(true);
  });

  it('要求文件名包含 only 里的每一个子串', () => {
    expect(matchesOfficialFilter('ARRI_LogC4-to-Gamma24_Rec709-D65.cube', ['Gamma24_Rec709'])).toBe(
      true,
    );
    expect(
      matchesOfficialFilter('ARRI_LogC4-to-HLG_1K_P3-D65_DW100_v1_65.cube', ['Gamma24_Rec709']),
    ).toBe(false);
    expect(matchesOfficialFilter('a-b-c.cube', ['a', 'c'])).toBe(true);
    expect(matchesOfficialFilter('a-b-c.cube', ['a', 'z'])).toBe(false);
  });
});

describe('selectOfficialLutEntries', () => {
  it('只列当前色彩空间那个目录里的条目', () => {
    const names = selectOfficialLutEntries(URLS, 'f-log2').map((entry) => entry.name);

    expect(names).toEqual(['FLog2_to_ACROS_65grid_V.1.00', 'FLog2_to_Velvia_65grid_V.1.00']);
  });

  it('键是相对 3DLUT/ 的路径，URL 原样带出来', () => {
    const [entry] = selectOfficialLutEntries(URLS, 'n-log');

    expect(entry.key).toBe('NIKON_NLOG_LUT/N-Log_BT2020_to_REC709_BT1886_size_33.cube.gz');
    expect(entry.name).toBe('N-Log_BT2020_to_REC709_BT1886_size_33');
    expect(entry.url).toBe('/nikon');
  });

  it('按 only 筛掉工程没有对应显示管线的输出', () => {
    const names = selectOfficialLutEntries(URLS, 'arri-logc4').map((entry) => entry.name);

    expect(names).toEqual(['ARRI_LogC4-to-Gamma24_Rec709-D65_v1_65']);
  });

  it('没有映射的色彩空间、以及关闭时，都是空数组', () => {
    expect(selectOfficialLutEntries(URLS, 'v-log')).toEqual([]);
    expect(selectOfficialLutEntries(URLS, null)).toEqual([]);
  });

  it('按展示名排序，与文件名顺序无关', () => {
    const shuffled: Record<string, string> = {
      '/3DLUT/GFX_ETERNA_LUT/65Grid/F-Log2/B.cube.gz': '/b',
      '/3DLUT/GFX_ETERNA_LUT/65Grid/F-Log2/a.cube.gz': '/a',
    };

    expect(selectOfficialLutEntries(shuffled, 'f-log2').map((entry) => entry.name)).toEqual([
      'a',
      'B',
    ]);
  });
});

describe('真实清单（构建期 glob 扫出来的那一份）', () => {
  it('五个色彩空间都能列出条目，说明 glob 的根目录与 JSON 的 root 一致、.cube.gz 也在了', () => {
    for (const source of sourceTable.sources) {
      const entries = officialLutEntries(source.logSpaceId as LogSpaceId);

      expect(entries.length, `${source.logSpaceId} 的清单不该为空`).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.key.startsWith(`${source.dir}/`)).toBe(true);
        expect(entry.url.length).toBeGreaterThan(0);
      }
    }
  });

  it('ARRI 目录里 P3 / HLG / St2084 的输出没有混进清单', () => {
    const names = officialLutEntries('arri-logc4').map((entry) => entry.name);

    expect(names.some((name) => /P3|HLG|St2084/.test(name))).toBe(false);
  });
});

describe('loadOfficialLut', () => {
  it('明文响应直接解析（服务器可能已经替我们解过压）', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(bytesOf(CUBE)));
    vi.stubGlobal('fetch', fetchMock);

    const lut = await loadOfficialLut(entryByKey('plain'));

    expect(lut.size).toBe(2);
    expect(lut.data).toHaveLength(24);
    expect(lut.title).toBe('Fixture');
    expect(fetchMock).toHaveBeenCalledWith('/url/plain');
  });

  it('gzip 响应按魔数认出来并解压', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(await gzipOf(CUBE))));

    const lut = await loadOfficialLut(entryByKey('gzipped'));

    expect(lut.size).toBe(2);
    expect(lut.title).toBe('Fixture');
  });

  it('同一个键只取一次，之后走缓存', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(bytesOf(CUBE)));
    vi.stubGlobal('fetch', fetchMock);

    const first = await loadOfficialLut(entryByKey('cached'));
    const second = await loadOfficialLut(entryByKey('cached'));

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 不是 2xx 时报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(new Uint8Array(), 404)));

    await expect(loadOfficialLut(entryByKey('missing'))).rejects.toThrow('HTTP 404');
  });
});
