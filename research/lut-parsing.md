# LUT File Format Parsing Research Report

## Table of Contents

1. [Overview](#overview)
2. [.cube Format Specification](#cube-format-specification)
3. [.3dl Format Specification](#3dl-format-specification)
4. [WebGL Texture Generation from LUT Data](#webgl-texture-generation-from-lut-data)
5. [Shader-Side LUT Application with Interpolation](#shader-side-lut-application-with-interpolation)
6. [Existing Libraries (npm packages)](#existing-libraries-npm-packages)
7. [Code Examples for Parsers](#code-examples-for-parsers)
8. [Edge Cases and Error Handling](#edge-cases-and-error-handling)
9. [Recommendations for images-viewer](#recommendations-for-images-viewer)
10. [Sources](#sources)

---

## Overview

This report covers the research needed to implement LUT (Look-Up Table) file parsing and WebGL-based application for the images-viewer project. The project uses React + Vite + TypeScript and needs to support:

- Loading external `.cube` and `.3dl` files
- Built-in preset LUTs (film emulation, etc.)
- WebGL shader-based LUT application

---

## .cube Format Specification

### Source
[Cube LUT Format Specification — Blackmagic Design / DaVinci Resolve Developer Docs](https://raw.githubusercontent.com/CommandPost/ResolveCafe/bfe8073eb3572963463a80e7a00e933b56bd75cf/docs/developers/luts.md)

### File Structure

A `.cube` file is a text file with two parts: **header** and **content**. The header defines LUT properties; the content holds the lookup table data. The content section starts on a new line directly after the last header definition.

### 1D LUT

**Header keywords:**
```
LUT_1D_SIZE N
LUT_1D_INPUT_RANGE MIN_VAL MAX_VAL
```

- `N` — number of entries, up to a maximum of **65536**
- `MIN_VAL` — floating point input value for the first entry
- `MAX_VAL` — floating point input value for the last entry

**Data format:** Each line contains 3 space-separated floating point values (R, G, B output values). The first line corresponds to `MIN_VAL`, the last to `MAX_VAL`. Intermediate lines are linearly spaced.

**Example:**
```
TITLE "Example 1D LUT"
LUT_1D_SIZE 6
LUT_1D_INPUT_RANGE 0.0 1.0

0.0 0.0 0.0
0.2 0.1 0.1
0.4 0.3 0.2
0.6 0.5 0.4
0.8 0.7 0.6
1.0 1.0 1.0
```

### 3D LUT

**Header keywords:**
```
LUT_3D_SIZE N
LUT_3D_INPUT_RANGE MIN_VAL MAX_VAL
```

- `N` — number of entries per channel (results in N×N×N total entries)
- `MIN_VAL` / `MAX_VAL` — input value range

**Data format:** N³ lines, each with 3 space-separated floats (R, G, B). The ordering is **R changing most rapidly**, then G, then B. For a size-6 LUT with range [0, 1]:

- First 6 values: R varies 0.0→1.0, G=0.0, B=0.0
- Next 6 values: R varies 0.0→1.0, G=0.2, B=0.0
- ...continues until all combinations are covered

**Interpolation:** The spec supports both **trilinear** and **tetrahedral** interpolation for 3D LUTs.

### Shaper LUT

An optional 1D LUT that precedes the main LUT. It re-maps the input range for better precision in specific regions. Defined with the same `LUT_1D_SIZE` / `LUT_1D_INPUT_RANGE` keywords, appearing before the main LUT definition.

### Optional Properties

| Keyword | Description |
|---------|-------------|
| `TITLE "Description"` | Descriptive title for the LUT |
| `# comment` | Lines starting with `#` are comments, ignored by parser |
| `LUT_IN_VIDEO_RANGE` | Input is in video range (64-940 in 10-bit) |
| `LUT_OUT_VIDEO_RANGE` | Output is in video range (64-940 in 10-bit) |

### Parsing Algorithm

```
1. Read file line by line
2. For each line:
   a. Trim whitespace
   b. Skip empty lines
   c. If starts with '#', skip (comment)
   d. If starts with 'TITLE', extract title string
   e. If starts with 'LUT_1D_SIZE', parse N → set 1D size
   f. If starts with 'LUT_1D_INPUT_RANGE', parse min/max
   g. If starts with 'LUT_3D_SIZE', parse N → set 3D size
   h. If starts with 'LUT_3D_INPUT_RANGE', parse min/max
   i. If starts with 'LUT_IN_VIDEO_RANGE' or 'LUT_OUT_VIDEO_RANGE', set flag
   j. Otherwise, parse as data line: split by whitespace, parse 3 floats
3. After parsing, validate:
   - If 3D LUT: expect N³ data lines
   - If 1D LUT: expect N data lines
   - If shaper LUT present: expect N data lines before main LUT data
4. Return structured LUT object
```

---

## .3dl Format Specification

### Source
[Autodesk Lustre 3D LUT Documentation](https://download.autodesk.com/us/systemdocs/help/2011/lustre/files/WSc4e151a45a3b785a24c3d9a411df9298473-7ffd.htm)

### File Structure

The `.3dl` format is a text-based format with a specific structure:

```
3DMESH
Mesh <input_bit_depth> <output_bit_depth>
<grid_size>
<data lines...>
```

### Keywords

| Keyword | Description |
|---------|-------------|
| `3DMESH` | Mesh keyword (case-sensitive) |
| `Mesh` | Mesh definition keyword (case-sensitive) |
| Input bit depth | Number of bits for input (e.g., 4, 10, 16) |
| Output bit depth | Number of bits for output (e.g., 12, 16) |

### Grid Size Calculation

The grid size is determined by the input bit depth:
- **Grid size = 2^(input_bit_depth) + 1**
- Example: 4-bit input → 17×17×17 grid
- Example: 10-bit input → 1025×1025×1025 grid (impractical)

**Supported grid sizes in Lustre:** 17³, 33³, 65³

### Data Format

Each data line contains 3 integer values (R, G, B output values) in the range determined by the output bit depth:
- 12-bit output: values 0-4095
- 16-bit output: values 0-65535

The first triplet is the output value at (0,0,0), the second at (0,0,1), etc., with **R changing most rapidly** (same ordering as .cube).

### Example

```
3DMESH
Mesh 4 12
17
0 0 0
1 0 0
2 0 0
...
```

### Parsing Algorithm

```
1. Read first line, verify it contains "3DMESH"
2. Read second line, verify it contains "Mesh"
3. Parse input_bit_depth and output_bit_depth from second line
4. Read third line, parse grid_size
5. Validate: grid_size should equal 2^input_bit_depth + 1
6. Read grid_size³ data lines, each with 3 integer values
7. Normalize output values to [0, 1] range by dividing by (2^output_bit_depth - 1)
8. Return structured LUT object
```

### Key Differences from .cube

| Feature | .cube | .3dl |
|---------|-------|------|
| Data type | Floating point | Integer |
| Size specification | Explicit (`LUT_3D_SIZE N`) | Implicit from bit depth |
| Range specification | Explicit (`LUT_3D_INPUT_RANGE`) | Implicit (always 0 to 1) |
| Domain | Configurable | Fixed [0, 1] |
| Max size | 65536 (1D), varies (3D) | 65³ (practical) |
| Header keywords | Flexible | Fixed format |

---

## WebGL Texture Generation from LUT Data

### WebGL 1D Textures

**WebGL does not support 1D textures.** The common workaround is to use a 2D texture as a 1D strip:
- Create a 2D texture with dimensions N×1 (or 1×N)
- Sample with `texture2D(u_lut, vec2(x, 0.5))`

### WebGL 3D Textures (WebGL2)

3D textures are supported in WebGL2 via `texImage3D()`.

**Source:** [MDN WebGL2RenderingContext.texImage3D()](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/texImage3D)

#### Creating a 3D LUT Texture

```typescript
function createLUT3DTexture(
  gl: WebGL2RenderingContext,
  data: Float32Array,  // N*N*N*3 or N*N*N*4
  size: number         // N (grid size per dimension)
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, texture);

  // Set texture parameters
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  // Upload data
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,                          // level
    gl.RGBA16F,                 // internalformat (or RGBA8 for 8-bit)
    size,                       // width
    size,                       // height
    size,                       // depth
    0,                          // border
    gl.RGBA,                    // format
    gl.FLOAT,                   // type (or UNSIGNED_BYTE for RGBA8)
    data                        // pixel data
  );

  return texture;
}
```

#### Texture Format Options

| Internal Format | Type | Precision | Use Case |
|----------------|------|-----------|----------|
| `RGBA8` | `UNSIGNED_BYTE` | 8-bit per channel | Standard, most compatible |
| `RGBA16F` | `FLOAT` | 16-bit float | High precision, widely supported |
| `RGBA32F` | `FLOAT` | 32-bit float | Maximum precision, requires `EXT_color_buffer_float` |

**Recommendation:** Use `RGBA16F` with `FLOAT` type for best balance of precision and compatibility. For broader compatibility, use `RGBA8` with `UNSIGNED_BYTE`.

#### Data Layout for 3D Texture

The LUT data must be arranged in memory to match the 3D texture layout. For a 3D LUT with R changing most rapidly:

```typescript
// For a size-N 3D LUT, data is stored as:
// data[((b * N + g) * N + r) * 4 + channel]
// where r, g, b are indices in [0, N-1]

function arrangeLUT3D(data: Float32Array, size: number): Float32Array {
  const result = new Float32Array(size * size * size * 4);
  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const srcIdx = ((b * size + g) * size + r) * 3;
        result[idx++] = data[srcIdx];     // R
        result[idx++] = data[srcIdx + 1]; // G
        result[idx++] = data[srcIdx + 2]; // B
        result[idx++] = 1.0;              // A
      }
    }
  }
  return result;
}
```

### WebGL 3D Texture Size Limits

The maximum 3D texture size is implementation-dependent. Query it at runtime:

```typescript
const max3DSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
```

**Typical values:**
- Desktop GPUs: 2048 or 4096
- Mobile GPUs: 256 or 512
- Minimum guaranteed: 256 (per WebGL spec)

**Practical LUT sizes:**
- 17³ = 4,913 entries — works everywhere
- 33³ = 35,937 entries — works on most desktop GPUs
- 65³ = 274,625 entries — may fail on mobile/low-end GPUs

**Source:** [Apple Developer Documentation — GL_MAX_3D_TEXTURE_SIZE](https://developer.apple.com/documentation/opengles/gl_max_3d_texture_size)

---

## Shader-Side LUT Application with Interpolation

### Trilinear Interpolation (WebGL2)

Trilinear interpolation is the simplest approach and can use WebGL's built-in texture filtering.

**Source:** [OpenColorIO — Lut3DOpGPU.cpp](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenColorIO/main/src/OpenColorIO/ops/lut3d/Lut3DOpGPU.cpp)

#### GLSL Shader (Trilinear)

```glsl
#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D u_lutTexture;
uniform float u_lutSize;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;

void main() {
  vec3 color = texture(u_image, v_texCoord).rgb;
  
  // Scale to LUT coordinates
  // Note: .zyx ordering because blue varies most rapidly in the grid
  float dim = u_lutSize;
  vec3 coords = (color.zyx * (dim - 1.0) + 0.5) / dim;
  
  // Sample with built-in trilinear interpolation
  vec3 graded = texture(u_lutTexture, coords).rgb;
  
  fragColor = vec4(graded, 1.0);
}
```

**Important:** The `.zyx` ordering is used because in the LUT data, blue varies most rapidly (R is innermost). This matches the memory layout where the texture's x-axis corresponds to B, y-axis to G, z-axis to R.

#### Texture Setup for Trilinear

```typescript
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
```

**Note:** The fractional components are quantized to 8-bits on some hardware when using `GL_LINEAR`, which can introduce error with small grid sizes.

### Tetrahedral Interpolation

Tetrahedral interpolation provides more accurate results by splitting the cube into 6 tetrahedra and interpolating within the correct one.

**Source:** [OpenColorIO PR #1708 — Enforce GL_NEAREST with GPU tetrahedral interpolation](https://github.com/AcademySoftwareFoundation/OpenColorIO/pull/1708/files)

#### GLSL Shader (Tetrahedral)

```glsl
#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D u_lutTexture;
uniform float u_lutSize;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;

void main() {
  vec3 color = texture(u_image, v_texCoord).rgb;
  
  float dim = u_lutSize;
  float incr = 1.0 / dim;
  
  // Scale to LUT index space [0, dim-1]
  vec3 coords = color.rgb * (dim - 1.0);
  
  // Base index (floor)
  vec3 baseInd = floor(coords);
  
  // Fractional part
  vec3 frac = coords - baseInd;
  
  // Scale/offset to [0,1] for texture lookup
  // Use .zyx because blue varies most rapidly in grid
  baseInd = (baseInd.zyx + 0.5) / dim;
  
  // Fetch the 4 corners of the tetrahedron
  vec3 v1 = texture(u_lutTexture, baseInd).rgb;
  vec3 nextInd = baseInd + incr;
  vec3 v4 = texture(u_lutTexture, nextInd).rgb;
  
  vec3 f1, f2, f3, f4;
  vec3 v2, v3;
  
  if (frac.r >= frac.g) {
    if (frac.g >= frac.b) {
      // R > G > B
      nextInd = baseInd + vec3(0.0, 0.0, incr);
      v2 = texture(u_lutTexture, nextInd).rgb;
      nextInd = baseInd + vec3(0.0, incr, incr);
      v3 = texture(u_lutTexture, nextInd).rgb;
      f1 = 1.0 - frac.r;
      f4 = frac.b;
      f2 = frac.r - frac.g;
      f3 = frac.g - frac.b;
    } else if (frac.r >= frac.b) {
      // R > B > G
      nextInd = baseInd + vec3(0.0, 0.0, incr);
      v2 = texture(u_lutTexture, nextInd).rgb;
      nextInd = baseInd + vec3(incr, 0.0, incr);
      v3 = texture(u_lutTexture, nextInd).rgb;
      f1 = 1.0 - frac.r;
      f4 = frac.g;
      f2 = frac.r - frac.b;
      f3 = frac.b - frac.g;
    } else {
      // B > R > G
      nextInd = baseInd + vec3(incr, 0.0, 0.0);
      v2 = texture(u_lutTexture, nextInd).rgb;
      nextInd = baseInd + vec3(incr, 0.0, incr);
      v3 = texture(u_lutTexture, nextInd).rgb;
      f1 = 1.0 - frac.b;
      f4 = frac.g;
      f2 = frac.b - frac.r;
      f3 = frac.r - frac.g;
    }
  } else {
    if (frac.g <= frac.b) {
      // B > G > R
      nextInd = baseInd + vec3(incr, 0.0, 0.0);
      v2 = texture(u_lutTexture, nextInd).rgb;
      nextInd = baseInd + vec3(incr, incr, 0.0);
      v3 = texture(u_lutTexture, nextInd).rgb;
      f1 = 1.0 - frac.b;
      f4 = frac.r;
      f2 = frac.b - frac.g;
      f3 = frac.g - frac.r;
    } else if (frac.r >= frac.b) {
      // G > R > B
      nextInd = baseInd + vec3(0.0, incr, 0.0);
      v2 = texture(u_lutTexture, nextInd).rgb;
      nextInd = baseInd + vec3(0.0, incr, incr);
      v3 = texture(u_lutTexture, nextInd).rgb;
      f1 = 1.0 - frac.g;
      f4 = frac.b;
      f2 = frac.g - frac.r;
      f3 = frac.r - frac.b;
    } else {
      // G > B > R
      nextInd = baseInd + vec3(0.0, incr, 0.0);
      v2 = texture(u_lutTexture, nextInd).rgb;
      nextInd = baseInd + vec3(incr, incr, 0.0);
      v3 = texture(u_lutTexture, nextInd).rgb;
      f1 = 1.0 - frac.g;
      f4 = frac.r;
      f2 = frac.g - frac.b;
      f3 = frac.b - frac.r;
    }
  }
  
  // Combine: f1*v1 + f2*v2 + f3*v3 + f4*v4
  vec3 graded = (f2 * v2) + (f3 * v3);
  graded = graded + (f1 * v1) + (f4 * v4);
  
  fragColor = vec4(graded, 1.0);
}
```

#### Texture Setup for Tetrahedral

```typescript
// Must use GL_NEAREST for tetrahedral interpolation
// because we're doing manual interpolation in the shader
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
```

### Comparison: Trilinear vs Tetrahedral

| Feature | Trilinear | Tetrahedral |
|---------|-----------|-------------|
| Accuracy | Good | Better (no diagonal artifacts) |
| Performance | Faster (hardware) | Slower (4 texture lookups + math) |
| Texture filtering | `GL_LINEAR` | `GL_NEAREST` |
| Shader complexity | Simple | Complex |
| Visual artifacts | Possible diagonal banding | Clean |
| Recommended use | Real-time preview | Final quality |

**Source:** [Babylon.js Forum — Color grading using .cube LUTs](https://forum.babylonjs.com/t/color-grading-using-cube-luts/60117/3)

---

## Existing Libraries (npm packages)

### 1. color-lut

**Source:** [npm.io/package/color-lut](https://npm.io/package/color-lut) | [GitHub](https://github.com/leezhian/color-lut)

- **Version:** 1.0.2
- **License:** MIT
- **Size:** 70 kB
- **TypeScript types:** Yes
- **Supports:** `.cube` and `.CSP` file parsing
- **Architecture:** Web Worker-based (v1.0.x), main-thread (v0.5.x)
- **Limitations:**
  - v1.0.x uses `type: module`, not supported in Firefox/Safari workers
  - Appears abandoned (low download count, no recent updates)
  - Designed for CPU-based image processing, not WebGL
  - Returns `ColorLUT` as `number[][][]` (3D array)

**Verdict:** Useful as a reference for parsing logic, but not directly usable for WebGL texture generation. The parsing approach can be adapted.

### 2. Babylon.js ColorGradingTexture

**Source:** [Babylon.js Docs — ColorGradingTexture](https://doc.babylonjs.com/typedoc/classes/_babylonjs_core.ColorGradingTexture)

- Built-in support for 3D LUTs
- Handles cases where 3D textures aren't supported
- Uses 2D texture fallback for 1D LUTs
- Full shader implementation included

**Verdict:** Good reference for implementation patterns, but tightly coupled to Babylon.js engine.

### 3. OpenColorIO (C++ with GPU shader generation)

**Source:** [OpenColorIO — Lut3DOpGPU.cpp](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenColorIO/main/src/OpenColorIO/ops/lut3d/Lut3DOpGPU.cpp)

- Industry-standard color management library
- GPU shader generation for both trilinear and tetrahedral
- Well-tested, production-ready shader code
- C++ library (not directly usable in JS/TS)

**Verdict:** Best reference for shader implementation. The GLSL code can be directly adapted for WebGL2.

### 4. Other Notable Libraries

| Library | Notes |
|---------|-------|
| [postprocessing](https://www.npmjs.com/package/postprocessing) | Has LUT support via `LUT3DEffect` |
| [LUTShader](https://pub.dev/documentation/openworld/latest/three_dart_jsm_three_dart_jsm_shaders_LUTShader/LUTShader.html) | Flutter/Dart port of three.js LUT shader |
| [three.js LUTShader](https://github.com/mrdoob/three.js) | Reference implementation in three.js examples |

---

## Code Examples for Parsers

### TypeScript .cube Parser

```typescript
export interface LUTData {
  title?: string;
  type: '1D' | '3D';
  size: number;
  inputRange: [number, number];
  outputRange: [number, number];
  data: Float32Array;  // N*3 for 1D, N*N*N*3 for 3D
  shaperLUT?: {
    size: number;
    inputRange: [number, number];
    data: Float32Array;
  };
  inVideoRange: boolean;
  outVideoRange: boolean;
}

export function parseCubeLUT(content: string): LUTData {
  const lines = content.split(/\r?\n/);
  
  let title: string | undefined;
  let type: '1D' | '3D' | undefined;
  let size = 0;
  let inputRange: [number, number] = [0, 1];
  let outputRange: [number, number] = [0, 1];
  let inVideoRange = false;
  let outVideoRange = false;
  
  const dataLines: number[][] = [];
  const shaperLines: number[][] = [];
  let parsingShaper = false;
  let parsingMain = false;
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    
    // Skip empty lines
    if (line.length === 0) continue;
    
    // Comments
    if (line.startsWith('#')) continue;
    
    // Title
    if (line.startsWith('TITLE')) {
      const match = line.match(/TITLE\s+"([^"]*)"/);
      if (match) title = match[1];
      continue;
    }
    
    // Video range flags
    if (line === 'LUT_IN_VIDEO_RANGE') {
      inVideoRange = true;
      continue;
    }
    if (line === 'LUT_OUT_VIDEO_RANGE') {
      outVideoRange = true;
      continue;
    }
    
    // 1D LUT size
    const size1DMatch = line.match(/^LUT_1D_SIZE\s+(\d+)/);
    if (size1DMatch) {
      if (!parsingMain) {
        parsingShaper = true;
      } else {
        type = '1D';
        size = parseInt(size1DMatch[1], 10);
      }
      continue;
    }
    
    // 3D LUT size
    const size3DMatch = line.match(/^LUT_3D_SIZE\s+(\d+)/);
    if (size3DMatch) {
      type = '3D';
      size = parseInt(size3DMatch[1], 10);
      parsingShaper = false;
      parsingMain = true;
      continue;
    }
    
    // Input range
    const rangeMatch = line.match(/^LUT_(?:1D|3D)_INPUT_RANGE\s+([-\d.eE]+)\s+([-\d.eE]+)/);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (parsingShaper && !parsingMain) {
        // Shaper LUT range - stored separately
      } else {
        inputRange = [min, max];
      }
      continue;
    }
    
    // Data line (3 space-separated floats)
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        if (parsingShaper && !parsingMain) {
          shaperLines.push([r, g, b]);
        } else {
          dataLines.push([r, g, b]);
        }
      }
    }
  }
  
  // Validate
  if (!type) {
    throw new Error('Invalid .cube file: no LUT_1D_SIZE or LUT_3D_SIZE found');
  }
  
  const expectedCount = type === '3D' ? size * size * size : size;
  if (dataLines.length !== expectedCount) {
    throw new Error(
      `Invalid .cube file: expected ${expectedCount} data lines, got ${dataLines.length}`
    );
  }
  
  // Flatten data
  const data = new Float32Array(dataLines.length * 3);
  for (let i = 0; i < dataLines.length; i++) {
    data[i * 3] = dataLines[i][0];
    data[i * 3 + 1] = dataLines[i][1];
    data[i * 3 + 2] = dataLines[i][2];
  }
  
  // Build result
  const result: LUTData = {
    title,
    type,
    size,
    inputRange,
    outputRange,
    data,
    inVideoRange,
    outVideoRange,
  };
  
  // Add shaper LUT if present
  if (shaperLines.length > 0) {
    const shaperData = new Float32Array(shaperLines.length * 3);
    for (let i = 0; i < shaperLines.length; i++) {
      shaperData[i * 3] = shaperLines[i][0];
      shaperData[i * 3 + 1] = shaperLines[i][1];
      shaperData[i * 3 + 2] = shaperLines[i][2];
    }
    result.shaperLUT = {
      size: shaperLines.length,
      inputRange: [0, 1],  // Default, could be parsed from header
      data: shaperData,
    };
  }
  
  return result;
}
```

### TypeScript .3dl Parser

```typescript
export interface LUT3DLData {
  title?: string;
  inputBitDepth: number;
  outputBitDepth: number;
  gridSize: number;
  data: Float32Array;  // gridSize^3 * 3, normalized to [0, 1]
}

export function parse3DLLUT(content: string): LUT3DLData {
  const lines = content.split(/\r?\n/);
  
  let lineIdx = 0;
  
  // Skip empty lines at start
  while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
  
  // First non-empty line should be "3DMESH"
  if (lineIdx >= lines.length || !lines[lineIdx].includes('3DMESH')) {
    throw new Error('Invalid .3dl file: missing 3DMESH header');
  }
  lineIdx++;
  
  // Skip empty lines
  while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
  
  // Second line: "Mesh <input_bit_depth> <output_bit_depth>"
  if (lineIdx >= lines.length) {
    throw new Error('Invalid .3dl file: missing Mesh definition');
  }
  const meshLine = lines[lineIdx].trim();
  const meshMatch = meshLine.match(/Mesh\s+(\d+)\s+(\d+)/i);
  if (!meshMatch) {
    throw new Error('Invalid .3dl file: invalid Mesh definition');
  }
  const inputBitDepth = parseInt(meshMatch[1], 10);
  const outputBitDepth = parseInt(meshMatch[2], 10);
  lineIdx++;
  
  // Skip empty lines
  while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
  
  // Third line: grid size
  if (lineIdx >= lines.length) {
    throw new Error('Invalid .3dl file: missing grid size');
  }
  const gridSize = parseInt(lines[lineIdx].trim(), 10);
  if (isNaN(gridSize)) {
    throw new Error('Invalid .3dl file: invalid grid size');
  }
  lineIdx++;
  
  // Validate grid size matches bit depth
  const expectedGridSize = Math.pow(2, inputBitDepth) + 1;
  if (gridSize !== expectedGridSize) {
    throw new Error(
      `Invalid .3dl file: grid size ${gridSize} does not match ` +
      `expected ${expectedGridSize} for ${inputBitDepth}-bit input`
    );
  }
  
  // Parse data lines
  const totalEntries = gridSize * gridSize * gridSize;
  const data = new Float32Array(totalEntries * 3);
  const outputMax = Math.pow(2, outputBitDepth) - 1;
  
  let dataIdx = 0;
  while (lineIdx < lines.length && dataIdx < totalEntries) {
    const line = lines[lineIdx].trim();
    lineIdx++;
    
    if (line === '' || line.startsWith('#')) continue;
    
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      throw new Error(`Invalid .3dl data line ${dataIdx}: "${line}"`);
    }
    
    const r = parseInt(parts[0], 10);
    const g = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      throw new Error(`Invalid .3dl data line ${dataIdx}: non-integer values`);
    }
    
    // Normalize to [0, 1]
    data[dataIdx * 3] = r / outputMax;
    data[dataIdx * 3 + 1] = g / outputMax;
    data[dataIdx * 3 + 2] = b / outputMax;
    dataIdx++;
  }
  
  if (dataIdx !== totalEntries) {
    throw new Error(
      `Invalid .3dl file: expected ${totalEntries} data lines, got ${dataIdx}`
    );
  }
  
  return {
    inputBitDepth,
    outputBitDepth,
    gridSize,
    data,
  };
}
```

### WebGL Texture Creation Helper

```typescript
export interface LUTTexture {
  texture: WebGLTexture;
  size: number;
  type: '1D' | '3D';
}

export function createLUTTexture(
  gl: WebGL2RenderingContext,
  lut: LUTData,
  useFloat: boolean = true
): LUTTexture {
  if (lut.type === '1D') {
    // 1D LUT: use 2D texture as strip (N x 1)
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Convert to RGBA
    const rgbaData = new Float32Array(lut.size * 4);
    for (let i = 0; i < lut.size; i++) {
      rgbaData[i * 4] = lut.data[i * 3];
      rgbaData[i * 4 + 1] = lut.data[i * 3 + 1];
      rgbaData[i * 4 + 2] = lut.data[i * 3 + 2];
      rgbaData[i * 4 + 3] = 1.0;
    }
    
    if (useFloat) {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA16F,
        lut.size, 1, 0,
        gl.RGBA, gl.FLOAT, rgbaData
      );
    } else {
      // Convert to 8-bit
      const byteData = new Uint8Array(lut.size * 4);
      for (let i = 0; i < lut.size * 4; i++) {
        byteData[i] = Math.round(rgbaData[i] * 255);
      }
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RBA8,
        lut.size, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, byteData
      );
    }
    
    return { texture, size: lut.size, type: '1D' };
  } else {
    // 3D LUT: use 3D texture
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, texture);
    
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    
    // Convert to RGBA
    const n = lut.size;
    const rgbaData = new Float32Array(n * n * n * 4);
    for (let i = 0; i < n * n * n; i++) {
      rgbaData[i * 4] = lut.data[i * 3];
      rgbaData[i * 4 + 1] = lut.data[i * 3 + 1];
      rgbaData[i * 4 + 2] = lut.data[i * 3 + 2];
      rgbaData[i * 4 + 3] = 1.0;
    }
    
    if (useFloat) {
      gl.texImage3D(
        gl.TEXTURE_3D, 0, gl.RGBA16F,
        n, n, n, 0,
        gl.RGBA, gl.FLOAT, rgbaData
      );
    } else {
      const byteData = new Uint8Array(n * n * n * 4);
      for (let i = 0; i < n * n * n * 4; i++) {
        byteData[i] = Math.round(rgbaData[i] * 255);
      }
      gl.texImage3D(
        gl.TEXTURE_3D, 0, gl.RGBA8,
        n, n, n, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, byteData
      );
    }
    
    return { texture, size: n, type: '3D' };
  }
}
```

---

## Edge Cases and Error Handling

### LUT Size Limits

| LUT Type | Max Size (spec) | Practical WebGL Limit | Notes |
|----------|-----------------|----------------------|-------|
| 1D LUT | 65536 | 65536 (as 2D strip) | No issues expected |
| 3D LUT 17³ | 4,913 | 4,913 | Works everywhere |
| 3D LUT 33³ | 35,937 | 35,937 | Works on most desktop GPUs |
| 3D LUT 65³ | 274,625 | 274,625 | May fail on mobile/low-end |
| 3D LUT 129³ | 2,146,689 | 2,146,689 | Likely exceeds mobile limits |

**Runtime check:**
```typescript
const max3DSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
if (lutSize > max3DSize) {
  // Fall back to lower resolution or show error
  console.warn(`LUT size ${lutSize} exceeds maximum ${max3DSize}`);
}
```

### Domain Handling

1. **Input range [0, 1]:** Most common, no special handling needed
2. **Input range [0, 255] or [0, 65535]:** Normalize to [0, 1] before applying LUT
3. **Video range (64-940):** Convert to data range before LUT application
4. **Custom ranges:** Scale input to [0, 1] using: `normalized = (value - min) / (max - min)`

### Metadata Handling

- **TITLE:** Store for display in UI
- **Comments (#):** Ignore during parsing, optionally preserve for display
- **LUT_IN_VIDEO_RANGE / LUT_OUT_VIDEO_RANGE:** Apply appropriate range conversion
- **Shaper LUT:** Apply as pre-processing step before main LUT

### Error Cases

| Error | Detection | Handling |
|-------|-----------|----------|
| Missing size keyword | No `LUT_1D_SIZE` or `LUT_3D_SIZE` found | Throw parse error |
| Wrong data count | Data lines ≠ expected count | Throw parse error |
| Invalid numbers | `NaN` after parsing | Throw parse error |
| Empty file | No content | Throw parse error |
| File too large | > 100MB | Reject with user message |
| 3DL bit depth mismatch | Grid size ≠ 2^bit_depth + 1 | Throw parse error |
| 3DL non-integer values | parseFloat succeeds but parseInt fails | Throw parse error |
| WebGL 3D texture too large | size > MAX_3D_TEXTURE_SIZE | Fall back or error |
| Missing WebGL2 | `WebGL2RenderingContext` not available | Show error message |

### Security Considerations

Since users can load external `.cube`/`.3dl` files:

1. **File size limit:** Reject files > 50MB to prevent memory exhaustion
2. **Data count validation:** Verify actual data lines match declared size
3. **Number validation:** Check for `NaN`, `Infinity` in parsed values
4. **Range clamping:** Clamp output values to [0, 1] to prevent shader issues
5. **No code execution:** LUT files are data-only, no eval or dynamic code

---

## Recommendations for images-viewer

### Architecture

```
src/
├── lut/
│   ├── types.ts           # LUTData, LUTTexture interfaces
│   ├── parse-cube.ts      # .cube file parser
│   ├── parse-3dl.ts       # .3dl file parser
│   ├── texture.ts         # WebGL texture creation
│   ├── shader.ts          # GLSL shader sources
│   ├── apply.ts           # LUT application pipeline
│   └── presets/           # Built-in preset LUTs
│       ├── index.ts
│       └── ...            # .cube files for film emulation
```

### Implementation Priority

1. **Phase 1: .cube parsing + 3D LUT (trilinear)**
   - Most common format
   - Simplest shader
   - Covers majority of use cases

2. **Phase 2: .cube 1D LUT support**
   - Use 2D texture strip
   - Simple shader modification

3. **Phase 3: .3dl parsing**
   - Less common but used in film/TV
   - Integer data, needs normalization

4. **Phase 4: Tetrahedral interpolation**
   - Higher quality
   - More complex shader
   - Optional toggle for users

5. **Phase 5: Shaper LUT support**
   - Advanced use case
   - Pre-processing step

### Key Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Default interpolation | Trilinear | Simpler, faster, good enough for preview |
| Optional interpolation | Tetrahedral | Better quality for final output |
| Texture format | RGBA16F | Good precision, wide support |
| Fallback format | RGBA8 | Maximum compatibility |
| 1D LUT storage | 2D texture (N×1) | WebGL doesn't support 1D textures |
| Max 3D LUT size | 65³ | Covers most practical LUTs |
| Preset LUTs | Bundle as .cube files | Easy to add/modify |

---

## Sources

1. [Cube LUT Format Specification — Blackmagic Design / DaVinci Resolve Developer Docs](https://raw.githubusercontent.com/CommandPost/ResolveCafe/bfe8073eb3572963463a80e7a00e933b56bd75cf/docs/developers/luts.md)
2. [Autodesk Lustre 3D LUT Documentation](https://download.autodesk.com/us/systemdocs/help/2011/lustre/files/WSc4e151a45a3b785a24c3d9a411df9298473-7ffd.htm)
3. [MDN — WebGL2RenderingContext.texImage3D()](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/texImage3D)
4. [OpenColorIO — Lut3DOpGPU.cpp (Trilinear & Tetrahedral Shader Code)](https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenColorIO/main/src/OpenColorIO/ops/lut3d/Lut3DOpGPU.cpp)
5. [OpenColorIO PR #1708 — Enforce GL_NEAREST with GPU tetrahedral interpolation](https://github.com/AcademySoftwareFoundation/OpenColorIO/pull/1708/files)
6. [npm.io — color-lut package](https://npm.io/package/color-lut)
7. [GitHub — leezhian/color-lut](https://github.com/leezhian/color-lut)
8. [Babylon.js Forum — Color grading using .cube LUTs](https://forum.babylonjs.com/t/color-grading-using-cube-luts/60117/3)
9. [Babylon.js Docs — ColorGradingTexture](https://doc.babylonjs.com/typedoc/classes/_babylonjs_core.ColorGradingTexture)
10. [Apple Developer Documentation — GL_MAX_3D_TEXTURE_SIZE](https://developer.apple.com/documentation/opengles/gl_max_3d_texture_size)
11. [Stack Overflow — Are 1D Textures Supported in WebGL yet?](https://stackoverflow.com/questions/23539853/are-1d-textures-supported-in-webgl-yet)
12. [Tetrahedral Interpolation on Regular Grids — Eurographics Digital Library](https://diglib.eg.org/server/api/core/bitstreams/e506644a-12b2-4b92-8b19-975ab4f15782/content)
