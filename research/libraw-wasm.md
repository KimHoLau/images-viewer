# LibRaw WASM Research Report

> **Project:** images-viewer (React + Vite + TypeScript)
> **Goal:** Decode RAW camera files (CR2/CR3, NEF, ARW, RAF, DNG) in the browser via WebAssembly
> **Date:** 2026-10-04
> **Researcher:** AI Agent

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Existing Libraries & Tools](#existing-libraries--tools)
3. [Compilation Approach](#compilation-approach)
4. [API Design for Decoding Module](#api-design-for-decoding-module)
5. [Performance Benchmarks & Estimates](#performance-benchmarks--estimates)
6. [Browser Compatibility & Memory Constraints](#browser-compatibility--memory-constraints)
7. [Recommended Integration Approach with Vite](#recommended-integration-approach-with-vite)
8. [Code Examples](#code-examples)
9. [Risks & Mitigations](#risks--mitigations)
10. [References](#references)

---

## Executive Summary

LibRaw can be compiled to WebAssembly using Emscripten. There are **three existing npm packages** that provide pre-built WASM builds with JavaScript/TypeScript wrappers, eliminating the need for custom compilation in most cases.

**Key findings:**

- **Best option:** `@colorhythm/libraw-wasm` (v1.1.1) — actively maintained, TypeScript-first, exposes raw sensor data (not just rendered RGB), supports all target formats
- **Alternative:** `rawconvert-wasm` (v0.1.1) — higher-level API, includes Web Worker support, no COOP/COEP required
- **Performance:** Native LibRaw unpacks a 24MP RAW in ~1.3s; WASM typically runs at 60-80% of native speed, so expect ~2-4s for unpack + ~2-4s for dcraw_process
- **Memory:** A 24MP RAW file requires ~50-100MB WASM memory; browsers support up to 4GB (with `ALLOW_MEMORY_GROWTH`)
- **Browser support:** Chrome 57+, Firefox 52+, Safari 11+, Edge 16+ (no COOP/COEP needed for single-threaded builds)
- **Threading:** Multi-threaded WASM (pthreads) requires `SharedArrayBuffer` + COOP/COEP headers; single-threaded builds work everywhere

---

## Existing Libraries & Tools

### 1. `@colorhythm/libraw-wasm` (Recommended)

| Attribute | Value |
|-----------|-------|
| **npm** | `@colorhythm/libraw-wasm@1.1.1` |
| **GitHub** | [colorhythm/libraw-wasm](https://github.com/colorhythm/libraw-wasm) |
| **License** | MIT (wrapper), LGPL-2.1/CDDL-1.0 (LibRaw) |
| **LibRaw version** | 0.22.x |
| **Formats** | CR2, CR3, NEF, ARW, RAF, DNG, X3F, and 1200+ cameras |
| **COOP/COEP** | Not required (single-threaded) |
| **Worker support** | Manual (create LibRaw instance inside Worker) |
| **Bundle size** | ~1.3MB unpacked (includes .wasm) |

**Key features:**
- Exposes raw sensor buffers (`getRawImage()`, `getColor3Image()`, `getColor4Image()`) as `Uint16Array`
- Full geometry, CFA pattern, black levels, white balance multipliers
- Typed `LibRawError` with stable numeric error codes
- `dcrawProcess()` + `dcrawMakeMemImage()` for processed output
- `unpackThumb()` + `dcrawMakeMemThumb()` for embedded thumbnails
- X3F decoder compiled in

**API surface (key methods):**
```ts
class LibRaw {
  static initialize(response?: Response | ArrayBuffer): Promise<void>;
  static version(): string;
  static cameraCount(): number;
  static cameraList(): string[];

  open(buffer: ArrayBuffer): void;
  unpack(): void;
  unpackThumb(): void;
  dcrawProcess(): void;
  dcrawMakeMemImage(): { data: Uint8Array | Uint16Array; width: number; height: number; colors: number; bits: number };
  dcrawMakeMemThumb(): { data: Uint8Array; width: number; height: number; type: 'jpeg' | 'bitmap' };

  getRawImage(): Uint16Array | null;
  getColor3Image(): Uint16Array | null;
  getColor4Image(): Uint16Array | null;

  getRawWidth(): number;
  getRawHeight(): number;
  getActiveWidth(): number;
  getActiveHeight(): number;
  getLeftMargin(): number;
  getTopMargin(): number;
  getColors(): number;
  getCdesc(): string;
  getFilters(): number;
  getBlackLevel(index: number): number;
  getCamMul(index: number): number;
  getPreMul(index: number): number;

  setHalfSize(value: number): void;
  setUseCameraWb(value: number): void;
  setOutputColor(value: number): void;

  recycle(): void;
  dispose(): void;
}
```

### 2. `rawconvert-wasm`

| Attribute | Value |
|-----------|-------|
| **npm** | `rawconvert-wasm@0.1.1` |
| **GitHub** | [anthonygreco/rawconvert-wasm](https://github.com/anthonygreco/rawconvert-wasm) |
| **License** | MIT (wrapper), LGPL-2.1/CDDL-1.0 (LibRaw) |
| **LibRaw version** | 0.22.1 |
| **Formats** | CR2, CR3, NEF, NRW, ARW, SRF, SR2, DNG, RAF, ORF, RW2, PEF, SRW, ERF, KDC, DCR, MOS, 3FR, IIQ, RWL, MEF, MRW, X3F |
| **COOP/COEP** | Not required |
| **Worker support** | Built-in `RawConvertWorker` class |
| **Bundle size** | ~1.2MB unpacked |

**Key features:**
- Higher-level API: `load()`, `process()`, `getThumbnail()`, `getMetadata()`
- Built-in Web Worker support (`RawConvertWorker`)
- Configurable demosaic, white balance, color space, highlight recovery
- Returns processed RGB pixels (not raw sensor data)
- Zero dependencies

**API surface:**
```ts
class RawConvert {
  static init(options?: { coreUrl?: string; wasmUrl?: string }): Promise<RawConvert>;
  load(data: ArrayBuffer, filename?: string): ImageInfo;
  getMetadata(): ImageInfo;
  getThumbnail(): { data: Uint8Array; width: number; height: number };
  process(options?: {
    colorSpace?: 'raw' | 'srgb' | 'adobe' | 'wide-gamut' | 'prophoto' | 'xyz';
    interpolation?: 'linear' | 'vng' | 'ppg' | 'ahd' | 'dcb' | 'dht' | 'aahd';
    outputBps?: 8 | 16;
    halfSize?: boolean;
    autoWhiteBalance?: boolean;
    cameraWhiteBalance?: boolean;
    brightness?: number;
    highlightMode?: number;
    noiseReduction?: number;
    medianPasses?: number;
  }): { data: Uint8Array; width: number; height: number; colors: number; bits: number };
  convert(data: ArrayBuffer, options?: ProcessOptions): ProcessedImage;
  reset(): void;
  dispose(): void;
}

class RawConvertWorker {
  static init(options?: { workerUrl?: string; coreUrl?: string; wasmUrl?: string }): Promise<RawConvertWorker>;
  // Same API as RawConvert but all methods return Promises
}
```

### 3. `dcraw-wasm`

| Attribute | Value |
|-----------|-------|
| **npm** | `dcraw-wasm@0.0.4` |
| **GitHub** | [nhebling/dcraw-wasm](https://github.com/nhebling/dcraw-wasm) |
| **License** | See LICENSE |
| **LibRaw version** | N/A (uses dcraw.c, not LibRaw) |
| **Formats** | All dcraw-supported formats |
| **COOP/COEP** | Not required |
| **Worker support** | No |
| **Bundle size** | ~570KB unpacked |

**Key features:**
- Compiles `dcraw.c` (not LibRaw) to WASM
- Metadata extraction + thumbnail extraction
- Does NOT do full demosaic/processing (metadata + thumbnails only)
- Browser convenience API (`analyzeBrowserFiles`, `analyzeDroppedFiles`)
- Node.js batch processing API

**Limitation:** Does not decode raw pixel data — only metadata and thumbnails. Not suitable for this project's needs.

### 4. `wasm-vips` (Alternative Approach)

| Attribute | Value |
|-----------|-------|
| **npm** | `wasm-vips` |
| **GitHub** | [kleisauke/wasm-vips](https://github.com/kleisauke/wasm-vips) |
| **License** | MIT |
| **Engine** | libvips (not LibRaw) |
| **COOP/COEP** | **Required** (SharedArrayBuffer for pthreads) |
| **Browser support** | Chrome 95+, Firefox 100+, Safari 16.4+ |

**Note:** wasm-vips uses libvips which has its own RAW loader (via libraw or built-in). It requires COOP/COEP headers and is under early development. Not recommended as primary approach but worth monitoring.

### 5. `michelerenzullo/LibRaw` (Source Fork)

| Attribute | Value |
|-----------|-------|
| **GitHub** | [michelerenzullo/LibRaw](https://github.com/michelerenzullo/LibRaw) |
| **Purpose** | LibRaw fork with Emscripten/WASM build support |
| **LibRaw version** | 0.22.0 Devel202502 |

This is the source fork that adds WASM compilation support to LibRaw. It includes:
- Modified `Makefile.devel` for Emscripten builds
- X3F decoder support
- All standard LibRaw decoders (CR2/CR3, NEF, ARW, RAF, DNG, etc.)

---

## Compilation Approach

### Option A: Use Pre-built npm Package (Recommended)

```bash
npm install @colorhythm/libraw-wasm
```

No compilation needed. The package ships with `libraw.wasm` and TypeScript bindings.

### Option B: Build from Source with Emscripten

If you need custom modifications to LibRaw or want to control the build:

#### Step 1: Install Emscripten

```bash
# Clone emsdk
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk

# Install and activate latest
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

#### Step 2: Clone LibRaw with WASM Support

```bash
git clone --recurse-submodules https://github.com/michelerenzullo/LibRaw.git
cd LibRaw
```

#### Step 3: Build LibRaw Library

```bash
# Build the static library with Emscripten
emmake make -f Makefile.devel lib/libraw.a
```

#### Step 4: Create Emscripten Wrapper

Create a C++ file that exports the functions you need:

```cpp
// wasm_wrapper.cpp
#include <emscripten/bind.h>
#include "libraw/libraw.h"

using namespace emscripten;

// ... (see Code Examples section for full wrapper)
```

#### Step 5: Compile to WASM

```bash
emcc wasm_wrapper.cpp \
  -I. \
  -L./lib -lraw \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=67108864 \
  -s MAXIMUM_MEMORY=2147483648 \
  -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue'] \
  -s EXPORTED_FUNCTIONS=['_malloc','_free'] \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='createLibRaw' \
  -s ENVIRONMENT='web,worker' \
  -O3 \
  -o libraw.js
```

#### Key Emscripten Flags

| Flag | Purpose |
|------|---------|
| `-s WASM=1` | Output WASM (default) |
| `-s ALLOW_MEMORY_GROWTH=1` | Allow WASM memory to grow at runtime |
| `-s INITIAL_MEMORY=67108864` | 64MB initial memory |
| `-s MAXIMUM_MEMORY=2147483648` | 2GB max memory (4GB on 64-bit) |
| `-s EXPORTED_RUNTIME_METHODS` | Runtime methods to expose |
| `-s MODULARIZE=1` | Wrap in module factory function |
| `-s EXPORT_NAME` | Global name for the module |
| `-s ENVIRONMENT='web,worker'` | Target web and web worker |
| `-O3` | Optimization level |
| `-s SINGLE_FILE=1` | Embed WASM in JS (not recommended for large files) |

#### Step 6: Generate TypeScript Bindings

Use `embind` or write manual TypeScript declarations. The `@colorhythm/libraw-wasm` package already provides these.

---

## API Design for Decoding Module

### Recommended Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React App                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ File Upload │  │  WebGL View  │  │  Metadata  │ │
│  │  Component  │  │  Component   │  │  Panel     │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                │                │        │
│         └────────────────┼────────────────┘        │
│                          │                          │
│                   ┌──────┴──────┐                   │
│                   │  RawDecoder │                   │
│                   │   Service   │                   │
│                   └──────┬──────┘                   │
│                          │                          │
│                   ┌──────┴──────┐                   │
│                   │  Web Worker │                   │
│                   │  (libraw)   │                   │
│                   └─────────────┘                   │
└─────────────────────────────────────────────────────┘
```

### TypeScript Interface Design

```typescript
// src/services/raw-decoder.ts

export interface RawImageInfo {
  width: number;
  height: number;
  colors: number;
  bits: number;
  cameraMake: string;
  cameraModel: string;
  cfaPattern: string;
  blackLevels: [number, number, number, number];
  whiteBalance: [number, number, number, number];
}

export interface DecodedRawImage {
  info: RawImageInfo;
  /** Raw sensor data (Bayer pattern, 16-bit) */
  rawData: Uint16Array;
  /** Processed RGB image (if dcrawProcess was called) */
  rgbData?: Uint8Array | Uint16Array;
  rgbWidth?: number;
  rgbHeight?: number;
}

export interface RawDecoderOptions {
  /** Use half resolution (2x faster) */
  halfSize?: boolean;
  /** Use camera white balance */
  useCameraWb?: boolean;
  /** Output color space: 0=raw, 1=sRGB, 2=Adobe, 3=Wide, 4=ProPhoto, 5=XYZ */
  outputColor?: number;
  /** Demosaic algorithm */
  demosaic?: 'linear' | 'vng' | 'ppg' | 'ahd' | 'dcb' | 'dht' | 'aahd';
}

export interface IRawDecoder {
  initialize(): Promise<void>;
  decode(buffer: ArrayBuffer, options?: RawDecoderOptions): Promise<DecodedRawImage>;
  dispose(): Promise<void>;
}
```

### Web Worker Implementation

```typescript
// src/workers/raw-decoder.worker.ts
import { LibRaw } from '@colorhythm/libraw-wasm';

let libraw: InstanceType<typeof LibRaw> | null = null;

async function getLibRaw() {
  if (!libraw) {
    await LibRaw.initialize();
    libraw = new LibRaw();
    await (libraw as any).waitUntilReady?.();
  }
  return libraw;
}

self.onmessage = async (event: MessageEvent) => {
  const { id, buffer, options } = event.data;

  try {
    const decoder = await getLibRaw();

    // Open the file
    decoder.open(buffer);

    // Unpack raw data
    decoder.unpack();

    // Get raw sensor data
    const rawImage = decoder.getRawImage();
    if (!rawImage) {
      throw new Error('No raw image data available');
    }

    // Get metadata
    const params = decoder.getIParams();
    const blackLevels = [0, 1, 2, 3].map(i => decoder.getBlackLevel(i));
    const camMul = [0, 1, 2, 3].map(i => decoder.getCamMul(i));

    // Optionally process to RGB
    let rgbData: Uint8Array | Uint16Array | undefined;
    if (options?.outputColor !== undefined) {
      decoder.setOutputColor(options.outputColor);
      if (options?.halfSize) decoder.setHalfSize(1);
      if (options?.useCameraWb) decoder.setUseCameraWb(1);

      decoder.dcrawProcess();
      const memImage = decoder.dcrawMakeMemImage();
      if (memImage) {
        rgbData = memImage.data;
      }
    }

    // Transfer data back to main thread
    const result = {
      id,
      info: {
        width: decoder.getActiveWidth(),
        height: decoder.getActiveHeight(),
        colors: decoder.getColors(),
        bits: 16,
        cameraMake: params.normalized_make,
        cameraModel: params.normalized_model,
        cfaPattern: decoder.getCdesc(),
        blackLevels,
        whiteBalance: camMul,
      },
      rawData,
      rgbData,
    };

    self.postMessage(result, [rawImage.buffer, rgbData?.buffer].filter(Boolean));
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
```

### Main Thread Service

```typescript
// src/services/raw-decoder-service.ts
import type { IRawDecoder, DecodedRawImage, RawDecoderOptions } from './raw-decoder';

export class RawDecoderService implements IRawDecoder {
  private worker: Worker;
  private pending = new Map<string, {
    resolve: (value: DecodedRawImage) => void;
    reject: (reason: Error) => void;
  }>();
  private idCounter = 0;

  constructor() {
    this.worker = new Worker(
      new URL('../workers/raw-decoder.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event) => {
      const { id, info, rawData, rgbData, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve({ info, rawData, rgbData });
      }
      this.pending.delete(id);
    };
  }

  async initialize(): Promise<void> {
    // Worker initializes LibRaw on first use
  }

  async decode(buffer: ArrayBuffer, options?: RawDecoderOptions): Promise<DecodedRawImage> {
    const id = `decode-${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, buffer, options }, [buffer]);
    });
  }

  async dispose(): Promise<void> {
    this.worker.terminate();
  }
}
```

---

## Performance Benchmarks & Estimates

### Native LibRaw Performance (Reference)

From [LibRaw forum](https://www.libraw.org/comment/5488):

| Operation | 24MP RAW (Canon 6D II CR2) | Hardware |
|-----------|---------------------------|----------|
| `unpack()` | ~1.3s | Intel i3-7100U @ 2.40GHz |
| `dcraw_process()` | ~1.3s | Same |
| **Total** | **~2.6s** | Same |

### WASM Performance Estimates

WASM typically runs at **60-80% of native speed** for CPU-bound tasks like RAW decoding:

| Operation | Native | WASM (est.) | Notes |
|-----------|--------|-------------|-------|
| `unpack()` | 1.3s | 1.7-2.2s | Memory-bound decompression |
| `dcraw_process()` | 1.3s | 1.7-2.2s | CPU-bound demosaic |
| **Total** | **2.6s** | **3.4-4.4s** | |

### Optimization Strategies

| Strategy | Speedup | Tradeoff |
|----------|---------|----------|
| `half_size = 1` | ~2x faster | Half resolution output |
| `use_camera_wb = 1` | Minimal | Uses camera WB (no auto WB calc) |
| Embedded thumbnail | ~100x faster | Lower resolution (typically 1920x1280) |
| Multi-threaded (pthreads) | ~2-4x faster | Requires COOP/COEP headers |
| `unpackThumb()` only | ~50x faster | Thumbnail only, no full decode |

### Memory Usage Estimates

| File Type | Raw Size | WASM Memory Peak |
|-----------|----------|------------------|
| 24MP CR2 (compressed) | ~25MB file | ~80-120MB |
| 24MP DNG (uncompressed) | ~48MB file | ~100-150MB |
| 45MP CR3 | ~50MB file | ~150-200MB |
| 100MP medium format | ~150MB file | ~300-400MB |

---

## Browser Compatibility & Memory Constraints

### Browser Support Matrix

| Browser | Minimum Version | WASM | SIMD | Notes |
|---------|----------------|------|------|-------|
| Chrome | 57+ | ✅ | ✅ 95+ | Full support |
| Edge | 16+ | ✅ | ✅ 95+ | Full support |
| Firefox | 52+ | ✅ | ✅ 100+ | Full support |
| Safari | 11+ | ✅ | ✅ 16.4+ | Full support |
| Opera | 44+ | ✅ | ✅ 95+ | Full support |
| Samsung Internet | 7.0+ | ✅ | ✅ | Full support |

### Memory Constraints

| Platform | Max WASM Memory | Notes |
|----------|-----------------|-------|
| Chrome (64-bit) | 4GB | `MAXIMUM_MEMORY=4294967296` |
| Chrome (32-bit) | 2GB | Limited by address space |
| Firefox (64-bit) | 4GB | Same as Chrome |
| Safari | 4GB | Same as Chrome |
| Mobile browsers | 2-4GB | Device dependent |

**Important:** Use `ALLOW_MEMORY_GROWTH=1` to allow memory to grow beyond `INITIAL_MEMORY`. Without this, allocation failures will occur for large files.

### COOP/COEP Requirements

| Build Type | COOP/COEP Required | SharedArrayBuffer | Performance |
|------------|-------------------|-------------------|-------------|
| Single-threaded | No | No | Baseline |
| Multi-threaded (pthreads) | **Yes** | **Yes** | 2-4x faster |

**If you need multi-threaded WASM**, the server must send:
```http
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

**Recommendation:** Start with single-threaded build. Use `half_size` for preview, full resolution only when needed. Consider multi-threaded only if performance is insufficient.

### Vite Configuration for COOP/COEP (if needed)

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
```

---

## Recommended Integration Approach with Vite

### Step 1: Install Dependencies

```bash
npm install @colorhythm/libraw-wasm
```

### Step 2: Configure Vite for WASM

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@colorhythm/libraw-wasm'],
  },
  build: {
    target: 'esnext',
  },
});
```

### Step 3: Copy WASM Assets (if needed)

```typescript
// vite.config.ts (alternative with public dir)
export default defineConfig({
  // ...
  publicDir: 'public',
});
```

Copy `node_modules/@colorhythm/libraw-wasm/dist/libraw.wasm` to `public/libraw.wasm` and initialize with:

```typescript
import { LibRaw } from '@colorhythm/libraw-wasm';

const response = await fetch('/libraw.wasm');
await LibRaw.initialize(response);
```

### Step 4: Create React Hook

```typescript
// src/hooks/useRawDecoder.ts
import { useEffect, useRef, useCallback } from 'react';
import { RawDecoderService } from '../services/raw-decoder-service';
import type { DecodedRawImage, RawDecoderOptions } from '../services/raw-decoder';

export function useRawDecoder() {
  const decoderRef = useRef<RawDecoderService | null>(null);

  useEffect(() => {
    decoderRef.current = new RawDecoderService();
    return () => {
      decoderRef.current?.dispose();
    };
  }, []);

  const decode = useCallback(async (
    file: File,
    options?: RawDecoderOptions
  ): Promise<DecodedRawImage> => {
    if (!decoderRef.current) throw new Error('Decoder not initialized');
    const buffer = await file.arrayBuffer();
    return decoderRef.current.decode(buffer, options);
  }, []);

  const decodeThumbnail = useCallback(async (
    file: File
  ): Promise<{ data: Uint8Array; width: number; height: number }> => {
    // Use half_size + unpackThumb for fast preview
    const result = await decode(file, { halfSize: true, useCameraWb: true });
    // ... extract thumbnail from result
    return { data: new Uint8Array(), width: 0, height: 0 };
  }, [decode]);

  return { decode, decodeThumbnail };
}
```

### Step 5: WebGL Rendering

```typescript
// src/components/RawWebGLRenderer.tsx
import { useEffect, useRef } from 'react';
import type { DecodedRawImage } from '../services/raw-decoder';

interface Props {
  image: DecodedRawImage;
}

export function RawWebGLRenderer({ image }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2');
    if (!gl) return;

    // Upload raw data as texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R16UI,
      image.info.width, image.info.height, 0,
      gl.RED_INTEGER, gl.UNSIGNED_SHORT,
      image.rawData
    );

    // Render with demosaic shader
    // ... (shader code for Bayer demosaicing)
  }, [image]);

  return <canvas ref={canvasRef} width={image.info.width} height={image.info.height} />;
}
```

---

## Code Examples

### Full Emscripten Wrapper (if building from source)

```cpp
// wasm_wrapper.cpp
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "libraw/libraw.h"
#include <vector>
#include <cstring>

using namespace emscripten;

class LibRawWrapper {
private:
    LibRaw RawProcessor;

public:
    LibRawWrapper() {}

    void open_buffer(val buffer) {
        // Copy JS ArrayBuffer to C++ vector
        size_t length = buffer["length"].as<size_t>();
        std::vector<uint8_t> data(length);
        val memory = val::module_property("HEAPU8")["buffer"];
        // ... copy data
        RawProcessor.open_buffer(data.data(), length);
    }

    void unpack() {
        RawProcessor.unpack();
    }

    void dcraw_process() {
        RawProcessor.dcraw_process();
    }

    val get_raw_image() {
        libraw_data_t* data = &RawProcessor.imgdata;
        if (data->rawdata.raw_image) {
            size_t len = data->sizes.raw_width * data->sizes.raw_height;
            return val(typed_memory_view(len, data->rawdata.raw_image));
        }
        return val::null();
    }

    val dcraw_make_mem_image() {
        int err;
        libraw_processed_image_t* img = RawProcessor.dcraw_make_mem_image(&err);
        if (img) {
            // Copy to JS
            val result = val::object();
            result.set("width", img->width);
            result.set("height", img->height);
            result.set("colors", img->colors);
            result.set("bits", img->bits);
            // ... copy data
            LibRaw::dcraw_clear_mem(img);
            return result;
        }
        return val::null();
    }

    // Getters
    int get_raw_width() { return RawProcessor.imgdata.sizes.raw_width; }
    int get_raw_height() { return RawProcessor.imgdata.sizes.raw_height; }
    int get_iwidth() { return RawProcessor.imgdata.sizes.iwidth; }
    int get_iheight() { return RawProcessor.imgdata.sizes.iheight; }
    int get_colors() { return RawProcessor.imgdata.idata.colors; }
    int get_filters() { return RawProcessor.imgdata.idata.filters; }

    // Setters
    void set_half_size(int v) { RawProcessor.imgdata.params.half_size = v; }
    void set_use_camera_wb(int v) { RawProcessor.imgdata.params.use_camera_wb = v; }
    void set_output_color(int v) { RawProcessor.imgdata.params.output_color = v; }

    void recycle() { RawProcessor.recycle(); }
};

EMSCRIPTEN_BINDINGS(libraw_module) {
    class_<LibRawWrapper>("LibRawWrapper")
        .constructor()
        .function("open_buffer", &LibRawWrapper::open_buffer)
        .function("unpack", &LibRawWrapper::unpack)
        .function("dcraw_process", &LibRawWrapper::dcraw_process)
        .function("get_raw_image", &LibRawWrapper::get_raw_image)
        .function("dcraw_make_mem_image", &LibRawWrapper::dcraw_make_mem_image)
        .function("get_raw_width", &LibRawWrapper::get_raw_width)
        .function("get_raw_height", &LibRawWrapper::get_raw_height)
        .function("get_iwidth", &LibRawWrapper::get_iwidth)
        .function("get_iheight", &LibRawWrapper::get_iheight)
        .function("get_colors", &LibRawWrapper::get_colors)
        .function("get_filters", &LibRawWrapper::get_filters)
        .function("set_half_size", &LibRawWrapper::set_half_size)
        .function("set_use_camera_wb", &LibRawWrapper::set_use_camera_wb)
        .function("set_output_color", &LibRawWrapper::set_output_color)
        .function("recycle", &LibRawWrapper::recycle);
}
```

### React Component for RAW File Upload

```tsx
// src/components/RawFileUploader.tsx
import { useState, useCallback } from 'react';
import { useRawDecoder } from '../hooks/useRawDecoder';
import { RawWebGLRenderer } from './RawWebGLRenderer';

export function RawFileUploader() {
  const { decode } = useRawDecoder();
  const [image, setImage] = useState<DecodedRawImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const result = await decode(file, {
        halfSize: true,
        useCameraWb: true,
        outputColor: 1, // sRGB
      });
      setImage(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [decode]);

  return (
    <div>
      <input
        type="file"
        accept=".cr2,.cr3,.nef,.arw,.raf,.dng,.orf,.rw2,.pef"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {loading && <p>Decoding...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {image && <RawWebGLRenderer image={image} />}
    </div>
  );
}
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large file OOM | App crash | Use `ALLOW_MEMORY_GROWTH`, limit file size, use `half_size` for preview |
| Slow decode on low-end devices | Poor UX | Show progress, use thumbnail first, offer `half_size` option |
| WASM loading failure | Feature unavailable | Fallback to multi-file input or server-side processing |
| Browser incompatibility | Feature unavailable | Feature-detect WASM support, show error message |
| Memory leaks | App slowdown over time | Call `recycle()`/`dispose()` after each decode, reuse decoder instance |
| COOP/COEP not configured | Multi-threaded WASM fails | Use single-threaded build (default), document requirement if switching |

---

## References

### npm Packages
- [@colorhythm/libraw-wasm](https://www.npmjs.com/package/@colorhythm/libraw-wasm) — Recommended LibRaw WASM bindings
- [rawconvert-wasm](https://www.npmjs.com/package/rawconvert-wasm) — Higher-level RAW processing
- [dcraw-wasm](https://www.npmjs.com/package/dcraw-wasm) — dcraw WASM (metadata + thumbnails only)
- [wasm-vips](https://www.npmjs.com/package/wasm-vips) — libvips WASM (alternative)

### GitHub Repositories
- [michelerenzullo/LibRaw](https://github.com/michelerenzullo/LibRaw) — LibRaw fork with WASM support
- [colorhythm/libraw-wasm](https://github.com/colorhythm/libraw-wasm) — TypeScript bindings
- [anthonygreco/rawconvert-wasm](https://github.com/anthonygreco/rawconvert-wasm) — Browser RAW processing
- [nhebling/dcraw-wasm](https://github.com/nhebling/dcraw-wasm) — dcraw WASM
- [kleisauke/wasm-vips](https://github.com/kleisauke/wasm-vips) — libvips WASM

### Documentation
- [LibRaw Official Site](https://www.libraw.org/) — Main documentation
- [LibRaw API Notes](https://manpage.me/docs/sharedocs/libraw/API-notes.html) — API reference
- [Emscripten Documentation](https://emscripten.org/docs/compiling/WebAssembly.html) — WASM compilation
- [Emscripten emcc Reference](https://emscripten.org/docs/tools_reference/emcc.html) — Compiler flags
- [LibRaw Forum: Compiling with Emscripten](https://www.libraw.org/node/2389) — Original compilation question
- [LibRaw Forum: unpack() performance](https://www.libraw.org/comment/5488) — Performance reference
- [Vite WASM Guide](https://vitejs.dev/guide/features.html#webassembly) — Vite WASM integration
- [web.dev: COOP/COEP](https://web.dev/coop-coep/) — Cross-origin isolation

### CDN
- [libraw-wasm CDN files](https://cdn.jsdelivr.net/npm/libraw-wasm/) — Pre-built CDN assets

---

## Summary & Recommendation

**For the images-viewer project, the recommended approach is:**

1. **Use `@colorhythm/libraw-wasm`** as the primary library — it provides the best balance of low-level control (raw sensor data access) and TypeScript ergonomics
2. **Implement a Web Worker** for decoding to avoid blocking the UI
3. **Use `half_size` for preview** and full resolution only when needed
4. **Start with single-threaded WASM** (no COOP/COEP required) and only consider multi-threaded if performance is insufficient
5. **Render via WebGL** by uploading the raw Bayer data as a texture and performing demosaicing in a shader
6. **Provide fallback** to multi-file input for browsers without WASM support or for very large files

This approach provides:
- ✅ Full format support (CR2/CR3, NEF, ARW, RAF, DNG, and 1200+ more)
- ✅ Raw sensor data access for custom WebGL processing
- ✅ No server-side processing required
- ✅ Works in all modern browsers
- ✅ Reasonable performance (~3-4s for 24MP RAW)
- ✅ TypeScript-first API
