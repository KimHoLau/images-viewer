# EXIF-on-export: hard facts

Scope note (from the delegating agent's correction): **only RAW source files are in scope**
(CR2/CR3/NEF/ARW/RAF/DNG/ORF/RW2/PEF/SRW/X3F). Parsing EXIF out of a plain JPEG/PNG/WebP/TIFF
*source* is out of scope. Facts only; no design, no recommendations.

Evidence style: `path:line` for local claims, URL for external claims. Where I could not reach a
primary source, the claim is marked **uncertain** rather than inferred.

---

## 1. libraw-wasm: what the API can and cannot give us for a RAW file

### 1.1 Package identity

- Version `1.1.1`, MIT — `node_modules/@colorhythm/libraw-wasm/package.json:3`, `:47`.
- Sole runtime dependency `typed-cstruct` — `node_modules/@colorhythm/libraw-wasm/package.json:60-62`.
- Repository/homepage `github.com/colorhythm/libraw-wasm` — `node_modules/@colorhythm/libraw-wasm/package.json:54`.
- Changelog: `1.1.1` (2026-08-03 per the file), `1.1.0` added "Analysis getters for stored and
  visible geometry, source layout, black and saturation data, and camera characterization" —
  `node_modules/@colorhythm/libraw-wasm/CHANGELOG.md:3`, `:21-23`. (The dates in the changelog read
  2026; reported as written.)

### 1.2 Does any public method return raw EXIF/TIFF bytes? **No.**

- The package exports exactly two values: `class LibRawError` and `class LibRaw`
  (`node_modules/@colorhythm/libraw-wasm/dist/index.d.ts:5`, `:9`; file ends with a bare
  `export {}` at `:629`).
- The complete public method list is `index.d.ts:15-628`. There is **no** `getExif()`, no
  EXIF-block getter, no MakerNote-bytes getter, and no generic "raw file byte range" getter.
- A case-insensitive search of `"exif"` across every file in the package returns only:
  `EXIF_MaxAp` (`index.d.ts:122`), `libraw_makernotes_t.common` fields
  `exifAmbientTemperature`/`exifHumidity`/`exifPressure`/`exifWaterDepth`/`exifAcceleration`/
  `exifCameraElevationAngle`/`exifExposureIndex` (`index.d.ts:602-609`), and
  `ExifColorSpace` inside the generated struct types. Nothing returns an EXIF byte block.

### 1.3 Exact metadata surface (signatures + fields)

All accessors return `typ.RecursiveReadonly<{...}>` (read-only struct copies decoded out of WASM
memory). Getter implementations confirm they read LibRaw's `imgdata` structs directly:
`dist/index.js:355-410`.

| Method | Declared at | Fields (verbatim from the `.d.ts`) |
| --- | --- | --- |
| `getIParams()` | `index.d.ts:97-115` | `guard`, `maker_index`, `raw_count`, `dng_version`, `is_foveon`, `colors`, `filters`, `xtrans`, `xtrans_abs`, `xmplen`, `make`, `model`, `software`, `normalized_make`, `normalized_model`, `cdesc`, `readonly xmpdata: string` |
| `getLensInfo()` | `index.d.ts:116-176` | `MinFocal`, `MaxFocal`, `MaxAp4MinFocal`, `MaxAp4MaxFocal`, `FocalLengthIn35mmFormat`, `EXIF_MaxAp`, `nikon{...}`, `dng{...}`, `Lens`, `LensMake`, `LensSerial`, `InternalLensSerial`, `makernotes{...}` (incl. `LensID: bigint`, `CamID: bigint`, `CurFocal`, `CurAp`, `FocalType`) |
| `getImgOther()` | `index.d.ts:177-199` | `analogbalance`, `iso_speed`, `shutter`, `aperture`, `focal_len`, `timestamp: bigint`, `shot_order`, `gpsdata`, `parsed_gps{latitude, longitude, gpstimestamp, altitude, altref, latref, longref, gpsstatus, gpsparsed}`, `desc`, `artist` |
| `getThumbnail()` | `index.d.ts:200-207` | `tformat` (`LIBRAW_THUMBNAIL_BITMAP \| BITMAP16 \| H265 \| JPEG \| JPEGXL \| LAYER \| ROLLEI \| UNKNOWN`), `twidth`, `theight`, `tlength`, `tcolors`, `readonly thumb: number[]` |
| `getShootingInfo()` | `index.d.ts:208-218` | `MeteringMode`, `ExposureMode`, `ImageStabilization`, `ExposureProgram`, `FocusMode`, `DriveMode`, `AFPoint`, `BodySerial`, `InternalBodySerial` |
| `getMakernotes()` | `index.d.ts:219-621` | Per-vendor parsed structs (`canon`, `nikon`, `sony`, …, `common`) — see 1.6 |
| `getFlip()` | `index.d.ts:55`, impl `index.js:210-212` | `number` — LibRaw `imgdata.sizes.flip` (`libraw-types.d.ts:586`, `:3925`) |

Answering the specific field questions:

- **camera make/model**: `getIParams().make`, `.model`, `.normalized_make`, `.normalized_model`,
  `.software` — `index.d.ts:108-112`.
- **lens**: `getLensInfo().Lens`, `.LensMake`, `.LensSerial`, `.InternalLensSerial`,
  `.MinFocal`/`.MaxFocal`/`.FocalLengthIn35mmFormat`/`.EXIF_MaxAp` — `index.d.ts:116-139`; plus
  `getLensInfo().makernotes.*` — `:140-175`.
- **ISO / shutter / aperture / focal length**: `getImgOther().iso_speed`, `.shutter`, `.aperture`,
  `.focal_len` — `index.d.ts:179-182`.
- **capture date**: `getImgOther().timestamp` — declared `bigint` (`index.d.ts:183`); the repo
  already coerces it: `src/services/raw-decoder.worker.ts:145`.
- **GPS**: `getImgOther().gpsdata` (raw block) and `.parsed_gps` (parsed lat/long/alt/time)
  — `index.d.ts:185-196`. `getImgOther().gpsdata` is described upstream as "GPS data (unparsed
  block, to write to output as is)" (LibRaw docs, below).
- **orientation**: **not exposed as the EXIF tag.** There is no `Orientation` field anywhere in
  the public surface. The only orientation-ish value is `getFlip()`, which reads LibRaw
  `imgdata.sizes.flip`. LibRaw documents `flip` as: "Image orientation (0 if does not require
  rotation; 3 if requires 180-deg rotation; 5 if 90 deg counterclockwise, 6 if 90 deg clockwise)"
  — <https://www.libraw.org/docs/API-datastruct-eng.html> (section `libraw_image_sizes_t`).
  `getFlip()` returns that number raw (`index.js:210-212`).
- **thumbnails**: `getThumbnail()` (raw LibRaw thumbnail struct) and `dcrawMakeMemThumb()`
  (`index.d.ts:36-44`, returns `{height,width,colors,type_,bits,data_size,data}`) plus
  `unpackThumb()` / `unpackThumbEx(i)` (`index.d.ts:23-24`).

Repo's current consumption of this surface: `getIParams()`/`getImgOther()` at
`src/services/raw-decoder.worker.ts:121-146`; `unpackThumb()` + `dcrawMakeMemThumb()` at
`src/workers/thumbnail.worker.ts:69-70`.

### 1.4 A1 — does the embedded-preview JPEG carry the original APP1/EXIF segment?

This is the load-bearing question, and the answer from LibRaw's own code and docs is: **it can, and
LibRaw explicitly tests for it.**

1. LibRaw documents the JPEG thumbnail buffer as verbatim file content:
   "**LIBRAW_THUMBNAIL_JPEG** — The thumbnail buffer contains a JPEG file (read from the RAW file
   "as is," without any manipulations performed on it)."
   — <https://www.libraw.org/docs/API-datastruct-eng.html> (section *enum LibRaw_thumbnail_formats*).
2. LibRaw documents that the processed thumbnail image includes an EXIF header:
   for `libraw_processed_image_t`, `data_size` "For JPEG image - exact JPEG size (i.e. extracted
   thumbnail size + JPEG header + **EXIF header**)."
   — <https://www.libraw.org/docs/API-datastruct-eng.html> (section
   *libraw_processed_image_t*).
3. LibRaw's implementation proves the same at byte level (`dcraw_make_mem_thumb`):

   ```c
   if (memcmp(T.thumb + 6, "Exif\0",5))
       mk_exif = 1;
   int dsize = T.tlength + mk_exif * (sizeof(exif) + sizeof(tiff_hdr));
   ...
   ret->data[0] = 0xff; ret->data[1] = 0xd8;          /* SOI */
   if (mk_exif) {
       memcpy(exif, "\xff\xe1  Exif\0\0", 10);         /* APP1 + "Exif\0\0" */
       exif[1] = htons(8 + sizeof th);
       memmove(ret->data + 2, exif, sizeof(exif));
       tiff_head(&th, 0);
       memmove(ret->data + (2 + sizeof(exif)), &th, sizeof(th));
       memmove(ret->data + (2 + sizeof(exif) + sizeof(th)), T.thumb + 2, T.tlength - 2);
   } else {
       memmove(ret->data + 2, T.thumb + 2, T.tlength - 2);   /* verbatim */
   }
   ```

   — <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/postprocessing/mem_image.cpp>
   (function `LibRaw::dcraw_make_mem_thumb`).

   Consequences, stated precisely:
   - The test is at `T.thumb + 6`. In a JPEG, offset 2 is the first marker and offset 6 is where a
     standard APP1 segment's `Exif\0\0` identifier sits (SOI 2 + `FFE1` 2 + length 2 = 6). So
     **LibRaw expects that `T.thumb` may already begin with `FFD8 FFE1 <len> "Exif\0\0"`** — i.e.
     the RAW's embedded preview JPEG may already carry the original EXIF APP1 segment, and in that
     case `T.thumb` is that segment's bytes.
   - When the preview does *not* start with an APP1-Exif segment, LibRaw **synthesizes a minimal,
     partial EXIF block** instead (see 1.5) — it does not recover the original EXIF from elsewhere in
     the RAW.
4. The identical test/write logic exists in the file writer:
   `LibRaw::jpeg_thumb_writer()` — `T.thumb + 6` check, same synthesis, same verbatim copy.
   — <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/write/file_write.cpp>.
5. The thumbnail is addressed as a byte range in the RAW file, not a re-encoded image:
   `LibRaw::thumbOK()` uses `ID.toffset` (offset in file) and `T.tlength`, requires
   `tsize + ID.toffset <= fsize`, and for `LIBRAW_INTERNAL_THUMBNAIL_JPEG` sets `tsize = T.tlength`.
   — <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/utils/thumb_utils.cpp>.

What the *repo* already does with this today (so the blob is already being produced and discarded):

```
src/workers/thumbnail.worker.ts:69   decoder.unpackThumb();
src/workers/thumbnail.worker.ts:70   const thumb = decoder.dcrawMakeMemThumb();
src/workers/thumbnail.worker.ts:72-74 if (thumb.type_ === 'LIBRAW_IMAGE_JPEG' ...) {
                                        const source = new Blob([thumb.data as BlobPart], {type:'image/jpeg'});
                                        const bitmap = await createImageBitmap(source);
```

So `dcrawMakeMemThumb()` output is fed straight into `createImageBitmap()` and the JPEG bytes
(including whatever APP1 segment LibRaw produced) are dropped afterwards.

> **实测更新（后补，`scripts/probe-thumb-exif.mjs`）：本仓库唯一的真实样本 `samples/IMGP2971.DNG`
> 走的正是上面 1.4 里那个 else 分支。** 它的内嵌预览是**裸 JPEG**（文件偏移 16771232 处
> `FFD8` 后直接是 `FFDB`，没有任何 `FFE1` APP1），所以 `T.thumb + 6` 不是 `Exif\0`，
> LibRaw 用 `tiff_head()` 合成了一条最小块：标出的标签集与下面 1.5 的写入集逐条吻合，
> `Software` 直接写着 `dcraw v9.26`，没有 MakerNote / LensModel / DateTimeOriginal。
> 交叉验证：`dcrawMakeMemThumb().data_size - getThumbnail().tlength = 1386`，正好一整条 APP1 段。
> ⇒ **「从内嵌预览原样提取原 EXIF」这条路对本样本不成立**；改走容器自身的 IFD0/ExifIFD
> （DNG 是 TIFF，`ExifOffset` 直接挂着完整拍摄信息）。本节其余内容作为 LibRaw 行为的描述仍然
> 有效，但不要据此假设任意一份 RAW 的预览都带原块——那需要逐份实测。

**Uncertainties in A1 (stated, not papered over):**

- I could not locate the definition of `LibRaw::unpack_thumb()` itself. It is not in
  `src/utils/` (`thumb_utils.cpp` holds only `kodak_thumb_loader`, `thumbOK`,
  `dcraw_thumb_writer`), nor in `src/metadata/`, `src/postprocessing/`, or `src/preprocessing/`
  (directory listings from the GitHub contents API). The "verbatim byte range" reading therefore
  rests on the LibRaw doc wording "read from the RAW file 'as is'", the `thumbOK()` offset+length
  arithmetic, and the `T.thumb + 6 == "Exif\0"` test — three independent LibRaw sources, but not on
  the copy loop itself.
- **Which vendors put a full APP1 (with original MakerNotes) into the embedded preview, and how
  large it is, is not established by any source I found.** LibRaw's `if/else` implies both cases
  occur. Per-file/vendor behaviour is therefore genuinely unknown without measurement.
- The synthesized fallback block (used when the preview has no APP1 Exif) contains **only** the
  tags enumerated in 1.5 — not the original MakerNotes.

### 1.5 What the *synthesized* EXIF block contains (relevant if the preview lacks APP1)

`tiff_head(&th, 0)` (full = 0) writes: byte order `0x4949` ("II", little-endian), magic 42,
first-IFD offset 10, then tags 270 ImageDescription, 271 Make, 272 Model, 274 Orientation
(from `"12435867"[flip]-'0'`), 282 XResolution (300/1), 283 YResolution (300/1),
284 PlanarConfiguration = 1, 296 ResolutionUnit = 2, 305 Software = `"dcraw v<version>"`,
306 DateTime, 315 Artist, 34665 ExifOffset → {33434 ExposureTime, 33437 FNumber, 34855 ISO,
37386 FocalLength}, and 34853 GPS if `gpsdata[1]` is non-zero.
— <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/write/file_write.cpp>
(`LibRaw::tiff_head`, `LibRaw::tiff_set`).

Notably absent from that fallback: MakerNote, LensModel/LensInfo, DateTimeOriginal,
PixelXDimension/PixelYDimension, IFD1 (thumbnail), Interop IFD, and any vendor data.

### 1.6 A3 — `getIParams().xmpdata` and `getMakernotes()`

**`xmpdata`**

- Upstream meaning: "**unsigned xmplen; char \*xmpdata;** — XMP packed data length and pointer to
  extracted XMP packet." — <https://www.libraw.org/docs/API-datastruct-eng.html>
  (section `libraw_iparams_t`).
- Binding types: `xmplen: number` (`index.d.ts:107`) and `readonly xmpdata: string`
  (`index.d.ts:114`). The struct is decoded with `typ.charPointerAsString()` —
  `dist/index.js:15`.
- `charPointerAsString` reads a `u32` pointer and then slices WASM memory up to the next NUL byte:
  `const ptr = readU32(opts); const zeorIndex = opts.buf.indexOf(0, ptr);`
  — `node_modules/typed-cstruct/dist/builders/string.js:4-13`.
  **There is no NULL check**: if LibRaw left the pointer NULL, this searches from heap offset 0
  (`string.js:8-10`). Practical consequence: treat `xmplen > 0` as the only reliable
  "XMP present" test; the returned string is meaningless when `xmplen === 0`.
- What it yields is an XMP packet (XML), not EXIF. For CR3, LibRaw fills it from a top-level
  ISO-BMFF `uuid` box whose 16-byte UUID equals `UUID_XMP`, allocating `szAtom - 23` bytes and
  NUL-terminating; that path is bounded by `szAtom < 1024000`
  — <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/metadata/cr3_parser.cpp>
  (`LibRaw::parseCR3`).

**`getMakernotes()`**

- Returns parsed `libraw_makernotes_t` fields only (vendor sub-structs + `common`) —
  `index.d.ts:219-621`. There is no byte buffer, no offset table, no length, and therefore no way
  to reconstruct a MakerNote block from it.
- Upstream describes the struct as: "The structure contains camera/vendor specific metadata
  extracted from file. No description provided, sorry, if you're interested in particular
  tag/camera/vendor - use Exiftool documentation as a reference" —
  <https://www.libraw.org/docs/API-datastruct-eng.html> (section `libraw_data_t`).
- `getLensInfo()` and `getShootingInfo()` are likewise parsed scalars/strings
  (`index.d.ts:116-176`, `:208-218`), not raw EXIF structures.
- So: `getMakernotes()` is **not** sufficient to reconstruct anything MakerNote-like at byte level.
  It can populate human-readable fields; it cannot reproduce the original block, and it exposes no
  offsets to fix up.

### 1.7 A2 — lifting an EXIF IFD block out of a TIFF-based RAW

**Which formats are TIFF/IFD-structured vs not** (per ExifTool's own support table, which marks
both as read/write): `CR2 r/w`, `CR3 r/w`, `NEF r/w`, `ARW r/w`, `RAF r/w`, `DNG r/w`, `ORF r/w`,
`RW2 r/w`, `PEF r/w`, `SRW r/w`, `X3F r/w`
— <https://manpages.ubuntu.com/manpages/noble/man1/exiftool.1p.html> ("Below is a list of file
types and meta information formats currently supported by ExifTool").

- ExifTool: "EXIF ... This type of information is formatted according to the TIFF specification, and
  may be found in JPG, TIFF, PNG, JP2, PGF, MIFF, HDP, PSP and XCF images, **as well as many
  TIFF-based RAW images** ... The EXIF meta information is organized into different Image File
  Directories (IFD's)" — <https://exiftool.org/TagNames/EXIF.html>.
- Relevant tag locations from the same page:
  - IFD0: `Make` 0x010f, `Model` 0x0110, `Orientation` 0x0112, `XResolution` 0x011a,
    `YResolution` 0x011b, `ResolutionUnit` 0x0128, `Software` 0x0131,
    `ApplicationNotes` 0x02bc (XMP in a TIFF-based file).
  - IFD0 pointer: `ExifOffset` 0x8769 "→ EXIF Tags" (the Exif SubIFD).
  - IFD1: `ThumbnailOffset` 0x0201 — "called JPEGInterchangeFormat in the specification, this is
    ThumbnailOffset in IFD1 of JPEG and some TIFF-based images, IFD0 of MRW images and AVI and MOV
    videos, and the SubIFD in IFD1 of SRW images; **PreviewImageStart in MakerNotes and IFD0 of ARW
    and SR2 images**; **JpgFromRawStart in SubIFD of NEF images and IFD2 of PEF images**" — and
    `ThumbnailLength` 0x0202 (JPEGInterchangeFormatLength).
  - ExifIFD: `ExposureTime` 0x829a, `FNumber` 0x829d, `MakerNote` 0x927c, `UserComment` 0x9286,
    `ExifImageWidth` 0xa002 "(called PixelXDimension by the EXIF spec.)", `ExifImageHeight` 0xa003
    "(called PixelYDimension by the EXIF spec.)", `LensInfo` 0xa432, `LensMake` 0xa433,
    `LensModel` 0xa434, `LensSerialNumber` 0xa435.
  - `InteropOffset` 0xa005, `Orientation` values 1-8 with meanings ("1 = Horizontal (normal) …
    6 = Rotate 90 CW … 8 = Rotate 270 CW").
  - MakerNote 0x927c is `undef`, ExifIFD, and ExifTool enumerates ~90 vendor variants
    (`MakerNoteCanon`, `MakerNoteNikon`, `MakerNoteSony`, …).
- **Offset base.** I did not retrieve the CIPA Exif spec PDF (the authoritative owner of "offsets
  are relative to the start of the TIFF header"). Code-level evidence from LibRaw instead:
  - A TIFF/IFD block's first-IFD offset must be 8: `bad_hdr()` is
    `((order != 0x4d4d) && (order != 0x4949)) || (get2() != 0x002a) || (get4() != 0x00000008)` —
    <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/metadata/cr3_parser.cpp>.
  - Tag data offsets are resolved by subtracting a base: `*tag_dataoffset = sget4(pos) - save;`
    — `LibRaw::tiff_sget`, <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/utils/utils_libraw.cpp>.
  ⇒ A block is only self-contained if it is taken *including* its TIFF header (byte order + 0x002A
  + first-IFD offset) at the block's own byte 0, because inside the block all offsets are relative
  to that header.
- Byte order is a property of the block: PNG's eXIf decoder recommendations require the first four
  bytes to be either `73 73 42 0` (`"II"`, 16-bit LE 42) or `77 77 0 42` (`"MM"`, 16-bit BE 42), and
  "All other values are reserved for possible future definition"
  — <http://h64-50-233-100.mdsnwi.tisp.static.tds.net/pub/libpng/documents/pngext-1.5.0.html>
  §3.7.2 (this is the "Extensions to the PNG 1.2 Specification, Version 1.5.0" document that
  PNG Third Edition folded into the core spec; see §4 below).
- LibRaw's own TIFF/EXIF writer emits little-endian `II` —
  `th->t_order = htonl(0x4d4d4949) >> 16;` in `LibRaw::tiff_head`
  (<https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/write/file_write.cpp>).

**Is verbatim block copying a real, used technique? Yes — and ExifTool documents its sharp edges.**

- `-tagsFromFile` copies tag values from another file; with no tags listed it copies "all possible
  tags ... (the same as specifying `-all`)", and `-all:all` preserves "the same family 1 group they
  had in the source file (ie. the same specific location, like ExifIFD or XMP-dc)"
  — <https://manpages.ubuntu.com/manpages/noble/man1/exiftool.1p.html> (option `-tagsFromFile`).
- The same page, `-tagsFromFile` **note 3**, verbatim: "**The maker note information is copied as a
  block**, so it isn't affected like other information by subsequent tag assignments on the command
  line, and individual makernote tags may not be excluded from a block copy. Also, since the
  PreviewImage referenced from the maker notes may be rather large, **it is not copied, and must be
  transferred separately if desired.**"
- Note 2 on the same page: "In general, MakerNotes tags are considered "Permanent", and may be
  edited but not created or deleted individually. This avoids many potential problems, including
  the inevitable compatibility problems with OEM software which may be very inflexible about the
  information it expects to find in the maker notes."
- The same manpage lists the option `-F[OFFSET] (-fixBase) — Fix the base for maker notes
  offsets` (Option Overview). ExifTool's own pod also contains a section titled "Fix the base for
  maker notes offsets" (`https://exiftool.org/exiftool_pod.pdf`, surfaced by search; I read the
  option name from the manpage mirror, not the section body).
- ExifTool reports `MakerNotes  r/w/c` (read/write/create) in its meta-information table
  — same manpage URL.
- A RAW→JPEG copy example exists in the manpage's COPYING EXAMPLES: "For example, to copy metadata
  from NEF files to the corresponding JPG previews in a directory where other JPG images may
  exist: …" — **uncertain**: the page was truncated before that section, so I only have this from a
  search-engine snippet of that URL, not from the fetched text.

**Formats that are NOT TIFF-based, therefore excluded from a single-block lift**

- **CR3** is ISO-BMFF/MP4-structured. LibRaw parses it with an atom walker
  (`LibRaw::parseCR3`) whose atom table includes `ftyp, moov, trak, mdia, minf, stbl, stsd, CRAW,
  CMP1, CMT1..CMT4, mdat, stsz, stsc, co64`, plus Canon `uuid` boxes
  — <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/metadata/cr3_parser.cpp>.
  EXIF is **split across four separate atoms**, each of which is *itself* a TIFF header + IFD:
  `moov/uuid/CMT1` → `parse_tiff_ifd` (IFD0), `CMT2` → `parse_exif` (Exif IFD), `CMT3` →
  `parse_makernote`, `CMT4` → `parse_gps` + `parse_gps_libraw` (same file).
  ⇒ A verbatim lift from CR3 requires taking four independent self-contained blocks and re-stitching
  the IFD pointers between them; no single contiguous EXIF block exists in the file.
  Thumbnails in CR3 are separate byte ranges too: a JPEG media track
  (`MediaType == 2`, `thumb_offset = d->MediaOffset; thumb_length = d->MediaSize;`) or the Canon
  preview `uuid` box with `"PRVW"` at +12 (`thumb_length = szAtom - 56; thumb_offset = ftell(ifp);`).
- **RAF** (Fujifilm private container): **uncertain** — I found no primary source in this pass.
  ExifTool lists `RAF r/w`, which establishes only that ExifTool can handle it.
- ORF / RW2 / PEF / SRW / X3F: only the ExifTool `r/w` table row is established here; I did not
  verify their container structure individually.

### 1.8 What breaks when a RAW EXIF/TIFF block is copied verbatim (question 6, condensed)

| Breakage mode | Evidence |
| --- | --- |
| **MakerNote internal offsets** need a base fix-up; MakerNotes are copied as an opaque block | ExifTool option `-F[OFFSET] (-fixBase) — Fix the base for maker notes offsets`; `-tagsFromFile` note 3 ("maker note information is copied as a block"); ExifTool's pod section "Fix the base for maker notes offsets" — <https://manpages.ubuntu.com/manpages/noble/man1/exiftool.1p.html> |
| **MakerNote-referenced preview images are not part of the block** | `-tagsFromFile` note 3: "the PreviewImage referenced from the maker notes ... is not copied, and must be transferred separately if desired" (same URL) |
| **IFD1 / embedded thumbnail** — IFD1 is addressed by `ThumbnailOffset` 0x0201 + `ThumbnailLength` 0x0202; copying the directory without the referenced bytes leaves dangling pointers; the offset/length tags live in IFD1 (or IFD0/SubIFD/MakerNotes depending on vendor) | ExifTool EXIF tag table, 0x0201/0x0202 — <https://exiftool.org/TagNames/EXIF.html>. PNG's own guidance: "there is no expectation that any thumbnails present in the Exif profile have (or have not) been updated if the main image was changed" — pngext-1.5.0 §3.7.3 (URL above) |
| **Byte order governs the block** — a block must be taken together with its `II`/`MM` header | pngext-1.5.0 §3.7.2 (decoders check `II*\0` or `MM\0*`) |
| **Stale geometry after re-render/resize**: `PixelXDimension` (0xa002) / `PixelYDimension` (0xa003) are the Exif names for `ExifImageWidth`/`ExifImageHeight` — ExifTool notes exactly that mapping | <https://exiftool.org/TagNames/EXIF.html> (0xa002, 0xa003) |
| **Stale orientation**: `Orientation` 0x0112 has 8 defined values (`1 = Horizontal (normal)`, `6 = Rotate 90 CW`, `8 = Rotate 270 CW`, …) — a viewer applies them | <https://exiftool.org/TagNames/EXIF.html> (0x0112) |
| **Resolution tags**: `XResolution` 0x011a / `YResolution` 0x011b / `ResolutionUnit` 0x0128 (note "the value 1 is not standard EXIF") are IFD0 tags that describe the *encoded* image | <https://exiftool.org/TagNames/EXIF.html> |
| **APP1 size ceiling**: PNG's eXIf encoder recommendation — "if the Exif profile is going to be written to a JPEG datastream, the total length of the eXIf chunk data may need to be adjusted to not exceed 2^16-9 bytes, so it can fit into a JPEG APP1 marker (Exif) segment" | pngext-1.5.0 §3.7.1 |
| **ICC vs EXIF**: they are separate segments/chunks — JPEG APP2 is `ICC_Profile` (ExifTool JPEG page), PNG uses `iCCP` (separate chunk) | <https://exiftool.org/TagNames/JPEG.html>, <https://exiftool.org/TagNames/PNG.html> |
| **Unsafe-to-copy Exif content (orientation, width, height, gamma) is a recognised hazard** — PNG chose "safe-to-copy" (`eXIf`) explicitly and says such material "should be regarded as historical in nature only" | pngext-1.5.0 §9.2 eXIf Rationale |

---

## 2. EXIF capability already present in the repo: none

- `package.json` dependencies are exactly four: `@colorhythm/libraw-wasm ^1.1.1`, `react ^19.1.0`,
  `react-dom ^19.1.0`, `zustand ^5.0.5` — `package.json:17-22`. Dev dependencies
  (`package.json:23-48`) contain no metadata library.
- Grep for `exif|EXIF|Exif|piexif|iptc|IPTC|xmp|XMP` across the repo's `*.ts,*.tsx,*.js,*.jsx,*.json,*.md,*.html`
  returns exactly **one** match: the comment at `src/services/image-loader.ts:58`
  (`/** 常规格式：浏览器自己解码，按 EXIF 方向摆正 */`).
- Grep for `exif|piexif|imagemin|sharp|iptc|exiftool` in `package-lock.json` (170,737 bytes)
  returns **zero** matches.
- The full top-level `node_modules` directory listing contains no `exifr`, `piexifjs`, `piexif-ts`,
  `exif-js`, `exiftool*`, `sharp`, `imagemin`, or any package whose name matches
  `exif|piexif|sharp|imagemin|iptc|xmp|jpeg|png|webp|icc`. (The only scoped package that matched
  the second filter is `@adobe/css-tools`, pulled in by `@testing-library`.)
- Conclusion: the repo has **no** direct or transitive EXIF read/write capability today. Its only
  metadata source is libraw-wasm's parsed getters.

---

## 3. Canvas encoding emits no EXIF/IPTC/XMP

The spec's serialization algorithm mentions exactly two inputs (`type`, `quality`) and one metadata
instruction, and never mentions EXIF, IPTC or XMP. Verbatim from the HTML Standard's source for
section "Serializing bitmaps to a file" (`#serialising-bitmaps-to-a-file`):

> "When a user agent is to create **a serialization of the bitmap as a file**, given a *type* and an
> optional *quality*, it must create an image file in the format given by *type*. If an error occurs
> during the creation of the image file (e.g. an internal encoder error), then the result of the
> serialization is null."

> "The image file's pixel data must be the bitmap's pixel data scaled to one image pixel per
> coordinate space unit, and **if the file format used supports encoding resolution metadata, the
> resolution must be given as 96dpi** (one image pixel per CSS pixel)."

> "If *type* is supplied, then it must be interpreted as a MIME type giving the format to use. …
> User agents must support PNG ("image/png"). User agents may support other types. … For image types
> that do not support an alpha channel, the serialized image must be the bitmap image composited
> onto an opaque black background using the source-over operator."

Source: <https://raw.githubusercontent.com/whatwg-cn/html/refs/heads/master/src/the-elements-of-html/scripting/the-canvas-element/serializing-bitmaps-to-a-file.en.html>
(verbatim English source of the WHATWG HTML Standard section; normative location
<https://html.spec.whatwg.org/multipage/canvas.html#serialising-bitmaps-to-a-file>).

`toBlob`'s algorithm just calls that serialization on a copy of the bitmap:
"This `toBlob(callback, type, quality)` method … Let result be null. If this canvas element's bitmap
has pixels … set result to a copy of this canvas element's bitmap. … set result to a serialization of
result as a file with type and quality if given."
— <https://html.spec.whatwg.org/multipage/canvas.html> (fetched; the same section).

So the precise characterisation is: **the algorithm has no metadata-preservation step at all** (an
absence, not an explicit prohibition), and it *does* mandate one metadata value — resolution
metadata, forced to 96 dpi. MDN states the same in user-facing form for both entry points:

> "The created image will have a resolution of 96dpi for file formats that support encoding
> resolution metadata."
— <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob> and
<https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob>.

The repo's export path goes through exactly these two APIs: `OffscreenCanvas.convertToBlob()` at
`src/services/export.ts:133-136`, falling back to `HTMLCanvasElement.toBlob()` at
`src/services/export.ts:148-157`.

**Uncertain / not found:** no Chromium, WebKit or Gecko bug or spec issue was retrieved in this pass
that explicitly discusses EXIF preservation in canvas encoding. I therefore report the conclusion as
derived from the algorithm's text (no metadata step; resolution forced to 96 dpi), not from an
explicit "metadata is dropped" sentence.

---

## 4. Container support for EXIF, and which side of the boundary it sits on

### JPEG — APP1 marker segment

- ExifTool's JPEG tag table: `'APP1' | EXIF | ... | --> EXIF Tags`; `'APP2' | ICC_Profile | ...`;
  `'APP0' | JFIF`; `'COM' | Comment`; `'APP14' | Adobe | yes`
  — <https://exiftool.org/TagNames/JPEG.html>.
- Payload layout: the Exif profile in an APP1 segment is **wrapped** — JPEG APP1 marker + 16-bit
  length, then the 6-byte `"Exif\0\0"` identifier, then a TIFF-structured block (byte order mark,
  0x002A, first-IFD offset). Direct byte-level evidence from LibRaw's writer:
  `memcpy(exif, "\xff\xe1  Exif\0\0", 10); exif[1] = htons(8 + sizeof th);` followed by
  `tiff_head(&th, 0)` — <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/write/file_write.cpp>
  and the same construct in `mem_image.cpp` (URLs in §1.4).
- Size ceiling: PNG's eXIf encoder note implies the JPEG APP1 capacity limit — "not exceed
  2^16-9 bytes, so it can fit into a JPEG APP1 marker (Exif) segment"
  — pngext-1.5.0 §3.7.1 (URL in §4 PNG below).
- **Uncertain:** how many APP1 segments a reader will honour (multi-segment Exif) — no primary
  source retrieved. The CIPA Exif spec itself (owner of the APP1 structure) was not fetched: PDF at
  <https://www.cipa.jp/std/documents/download_e.html?CIPA_DC-008-2026-E> (link taken from
  ExifTool's EXIF page).

### WebP — RIFF `EXIF` chunk

From the WebP Container Specification (libwebp's own doc, the canonical source):

- Extended format layout: "An extended format file consists of: A 'VP8X' Chunk … An optional 'ICCP'
  Chunk … Image data. **An optional 'EXIF' Chunk with Exif metadata.** An optional 'XMP ' Chunk with
  XMP metadata. An optional list of unknown chunks."
- "Metadata can be stored in 'EXIF' or 'XMP ' Chunks. **There SHOULD be at most one chunk of each
  type** ('EXIF' and 'XMP '). If there are more such chunks, readers MAY ignore all except the
  first one."
- Chunk record: `ChunkHeader('EXIF')` + `Exif Metadata: Chunk Size bytes — Image metadata in Exif
  format.` The FourCC is exactly the 4 ASCII bytes `E`,`X`,`I`,`F` (no trailing space; contrast
  `'XMP '` which *does* have a trailing space).
- RIFF framing: "If *Chunk Size* is odd, a single padding byte -- which MUST be `0` to conform with
  RIFF -- is added." Chunk Size excludes the FourCC, the size field, and padding.
- Ordering: reconstruction/colour chunks (`VP8X, ICCP, ANIM, ANMF, ALPH, VP8 , VP8L`) MUST be in
  the documented order; "**Metadata and unknown chunks MAY appear out of order.**"
- `VP8X` flags: "Exif metadata (E): 1 bit — Set if the file contains Exif metadata." The flag byte
  is the first of the `Rsv|I|L|E|X|A|R` + 24 reserved bits layout.
  Implementation constant: `EXIF_FLAG = 0x00000008` in `WebPFeatureFlags`
  — <https://raw.githubusercontent.com/webmproject/libwebp/main/src/webp/mux_types.h>.
  (`ANIMATION_FLAG = 0x2`, `XMP_FLAG = 0x4`, `EXIF_FLAG = 0x8`, `ALPHA_FLAG = 0x10`,
  `ICCP_FLAG = 0x20`, `ALL_VALID_FLAGS = 0x3e`.)
- `VP8X` is required for the chunk to exist at all, because the `EXIF` chunk only appears in the
  extended format.
- libwebp's mux API addresses it by FourCC: `WebPMuxSetChunk(mux, "EXIF", &chunk_data, copy_data)`
  with `WEBP_CHUNK_EXIF  // EXIF` — <https://raw.githubusercontent.com/webmproject/libwebp/main/src/webp/mux.h>.
- **Wrapped or raw?** The container spec says only "Image metadata in Exif format" — it does **not**
  state whether the `Exif\0\0` identifier is included. **Uncertain.** (libwebp treats the chunk
  payload as an opaque `WebPData` blob, which gives no answer either.)
- Sources: <https://raw.githubusercontent.com/webmproject/libwebp/main/doc/webp-container-spec.txt>
  (WebP Container Specification, sections *Extended File Format*, *Metadata*, *RIFF File Format*);
  the Google-served copy at <https://developers.google.com/speed/webp/docs/riff_container> was not
  retrievable from this environment (repeated fetch failures).

### PNG — `eXIf` chunk (raw TIFF block, explicitly **unwrapped**)

PNG Third Edition moved `eXIf` from the extensions document into the core spec — "PNG Third Edition
moves the definition of the `eXIf` chunk, which was already in the PNG Extensions document, into
the main specification" — <https://w3c.github.io/png/Implementation_Report_3e/> §7. The REC is
<https://www.w3.org/TR/png-3/> (W3C Recommendation, 24 June 2025), where it is §11.3.4.5
"eXIf Exchangeable Image File (Exif) Profile" (entry visible in the fetched table of contents of
<https://www.w3.org/TR/png-3/>). The REC page is too large for this environment's fetcher to reach
§11.3.4.5, so the wording below is quoted from the extension document that PNG Third Edition
incorporated (version 1.5.0, 15 July 2017, per its own revision history):

> "**3.7. `eXIf` Exchangeable Image File (Exif) Profile** — The four-byte chunk type field contains
> the decimal values 101 88 73 102 (ASCII "eXIf"). The data segment of the eXIf chunk contains an
> Exif profile in the format specified in "4.7.2 Interoperability Structure of APP1 in Compressed
> Data" of [CIPA DC-008-2016] **except that the JPEG APP1 marker, length, and the "Exif ID code"
> described in 4.7.2(C), i.e., "Exif", NULL, and padding byte, are not included.**"

> "The eXIf chunk may appear anywhere between the IHDR and IEND chunks except between IDAT chunks.
> The eXIf chunk size is constrained only by the maximum of 2^31-1 bytes imposed by the PNG
> specification. **Only one eXIf chunk is allowed in a PNG datastream.**"

> "The eXIf chunk contains metadata concerning the original image data. **If the image has been
> edited subsequent to creation of the Exif profile, this data might no longer apply to the PNG
> image data.** It is recommended that unless a decoder has independent knowledge of the validity of
> the Exif data, the data should be considered to be of historical value only."

Also from the same document: decoders should verify the first four bytes are `73 73 42 0`
(`"II"` LE 42) or `77 77 0 42` (`"MM"` BE 42) (§3.7.2); if the profile will later be placed in a
JPEG, the data "may need to be adjusted to not exceed 2^16-9 bytes" (§3.7.1); and PNG made the chunk
safe-to-copy *despite* the profile containing unsafe-to-copy material "such as image orientation,
width, height, gamma, and JPEG-specific compression information" (§9.2).

Source read at:
<http://h64-50-233-100.mdsnwi.tisp.static.tds.net/pub/libpng/documents/pngext-1.5.0.html>
(the document's own canonical location is `http://libpng.download/documents/pngext-1.5.0.html`;
`web.archive.org` copies were not retrievable from this environment).

**One layout difference between the 2017 extension text and PNG Third Edition** — the implementation
report states: "The Web Platform places a constraint on Exif image metadata that affects layout,
such as image orientation: it is required to be placed *before the image data*. **PNG Third Edition
enforces that constraint, for Exif in PNG.**" — <https://w3c.github.io/png/Implementation_Report_3e/>
§7.
⇒ Under the current REC, orientation-affecting Exif must precede IDAT. **Uncertain:** the exact REC
wording could not be read (page size); the 2017 text allowed eXIf anywhere except between IDAT
chunks.

Summary of the passthrough question:

| Format | Carries EXIF? | Wrapper | Exact bytes |
| --- | --- | --- | --- |
| JPEG | yes | **wrapped** | `FFE1`, 2-byte length, then `45 78 69 66 00 00` (`"Exif\0\0"`), then TIFF block |
| WebP | yes (`EXIF` chunk, extended format only, `VP8X.E` flag) | **uncertain** | FourCC `EXIF` + uint32 LE size + payload (payload framing undocumented in the container spec) + 1 pad byte if size odd |
| PNG | yes (`eXIf`, exactly one) | **raw, unwrapped** | payload *is* the TIFF/Exif profile; APP1 marker, length and `"Exif\0\0"` are explicitly excluded |

### In-browser writers (no server)

| Library | npm / repo | Write coverage | Maintenance | Browser-capable? |
| --- | --- | --- | --- | --- |
| `piexifjs` | <https://registry.npmjs.org/piexifjs/latest>, <https://github.com/hMatoba/piexifjs> | npm metadata: description "Read and write exif.", keywords `["jpeg","exif"]`, `main: "piexif.js"`. **JPEG only as far as its own package metadata states**; no WebP or PNG claim appears in the registry metadata. | Version `1.0.6`, npm publish timestamp 1561135163924 (2019-06-21) — no release since | Pure JS, no Node APIs in metadata; the ecosystem treats it as a browser library. **Uncertain:** I did not read the source/README to enumerate its API surface (the repo's `README.md` is not at that path — 404). |
| `exifr` | <https://registry.npmjs.org/exifr/latest>, <https://github.com/MikeKovarik/exifr>, README <https://raw.githubusercontent.com/MikeKovarik/exifr/master/README.md> | **Read-only.** Its own description: "📷 The fastest and most versatile JavaScript EXIF **reading** library." The documented API is `parse`, `gps`, `orientation`, `rotation`, `thumbnail`, `thumbnailUrl`, `sidecar`, and the `Exifr` class — there is no write function anywhere in the README. It reads JPEG/TIFF/HEIC/PNG/AVIF. | Version `7.1.3`, npm publish timestamp 1628150459431 (2021-08-05) | Yes, explicitly (BlobReader, browser bundles) |
| `@uswriting/exiftool` | <https://registry.npmjs.org/@uswriting%2Fexiftool/latest>, <https://github.com/6over3/exiftool> | Description: "**ExifTool powered by WebAssembly to extract and write metadata** from files in browsers and Node.js environments using zeroperl". Keywords include `browser`, `wasm`, `exif`, `iptc`, `xmp`. Underlying ExifTool writes JPEG/PNG/WebP (see ExifTool file-type table: `JPEG r/w`, `PNG r/w`, `WEBP r/w`). | Version `1.0.9`, npm publish timestamp 1764904020866 (2025-12-05), Apache-2.0, npm provenance attestation present, dependency `@6over3/zeroperl-ts 1.0.10` | Yes — that is its stated purpose. Package itself unpacks to 291,940 bytes; **the total in-browser payload including the zeroperl runtime was not measured (uncertain)**. |
| `sharp` | — | Node-only (libvips native binding). **Uncertain:** I did not fetch a sharp doc page in this pass; stated only because no browser/WASM build appears in the risk area investigated. Treat as unverified. | — | No (native module) |
| PNG chunk editors (`png-chunks-extract` + `png-chunks-encode`, `upng-js`, `pngjs`, `@jsquash/png`) | — | **Unverified in this pass.** These libraries manipulate/write arbitrary PNG chunks in JS, which would be the mechanism for inserting an `eXIf` chunk, but I did not fetch their npm/README pages. | — | — |
| WebP chunk writers (`webpmux` WASM builds, `@jsquash/webp`) | — | **Unverified in this pass.** No library was confirmed able to emit a WebP `EXIF` chunk from JavaScript in a browser. | — | — |

`exifr` is additionally confirmed read-only by the structure of its README: the only exported
entry points are parse/extract and the `Exifr` class; there is no `write`, `insert`, or `dump`
API documented.

---

## 5. Real-world consumer support for EXIF in WebP and PNG

The strongest primary evidence I found is W3C's own PNG Third Edition Implementation Report
(<https://w3c.github.io/png/Implementation_Report_3e/>, last modified 2025-06-04), §7
"Exchangeable Image File (Exif)". It credits, for PNG `eXIf`:

- ExifTool — "supports reading and writing PNG metadata, including Exif".
- Pillow (Python) — "supports reading and writing Exif in PNG".
- Exiv2 (C++) — "supports both reading and writing Exif in PNG".
- GIMP — shown "displaying Exif metadata" (screenshot `img/Gimp-Exif-viewer.png`) and "showing
  optional image rotate when opening a PNG image" (screenshot `img/Gimp-PNG-import-rotate-Exif.png`).
- Browsers, **orientation only** (not general EXIF display):
  - "Respecting Exif image-orientation for PNG images in CSS (`image-orientation`) is implemented in
    **WebKit-based browsers**."
  - "Respecting Exif image orientation for PNG images in Canvas 2D is implemented in **WebKit-based
    browsers** and **Blink-based browsers**."
  - "**Blink-based browsers** … and **Mozilla Firefox** implement Exif orientation in CSS for
    JPEG/JFIF images, and **are expected to implement it for PNG as well**. ([Chrome bug](https://issues.chromium.org/issues/40125224)
    and [Firefox bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1682759))."
- The report also states: "Removing metadata is a common technique when images are prepared for the
  web."

Per-cell honesty table (this is where evidence runs out):

| Reader | WebP `EXIF` chunk | PNG `eXIf` chunk |
| --- | --- | --- |
| Chrome / Edge (Blink) | **No primary source found.** No evidence was retrieved that Chrome surfaces EXIF from WebP to a user at all. | **Orientation only** (Canvas 2D), per the implementation report above. Blink's PNG orientation in CSS is listed as *expected*, not implemented. |
| Firefox | **No primary source found.** | **Orientation in CSS for JPEG only**; PNG listed as *expected* (bug 1682759). |
| Safari / WebKit | **No primary source found.** | **Orientation only** (CSS + Canvas 2D), per the implementation report. |
| macOS Preview / Finder | **No primary source found.** | **No primary source found.** |
| Windows Photos / Explorer | **No primary source found.** | **No primary source found.** The Windows property system does define per-property photo metadata policies (`System.Photo.*`, e.g. `System.Photo.Orientation`, `System.Photo.LensModel`, `System.Photo.MakerNote`) — <https://learn.microsoft.com/en-us/windows/win32/wic/photo-metadata-policies> and <https://learn.microsoft.com/en-us/windows/win32/wic/system-photo> — but the pages I fetched are index pages and **do not state which container formats each property is read from**. |
| Adobe Lightroom / Bridge | **No primary source found.** | **No primary source found.** The PNG implementation report credits "Adobe Photoshop, Lightroom and Camera Raw, MacOS ProApps, Compressor, Final Cut Pro" for **CICP** colour signalling (§2), *not* for Exif — this must not be read as eXIf support. |

Practical reading of the above: for both WebP and PNG, what is *documented* is metadata-library
support (ExifTool/Pillow/Exiv2) and PNG-oriented browser **rotation** behaviour. There is
**no primary source in this pass** establishing that any mainstream consumer viewer *displays*
EXIF fields from a WebP `EXIF` chunk or a PNG `eXIf` chunk. That gap is the honest answer.

---

## 6. Where EXIF lives in the RAW formats, and what a verbatim copy breaks

Consolidated from §1.7 and §1.8 (kept as its own section because the original brief asked per-format):

| Format | Container | Where EXIF lives | Evidence |
| --- | --- | --- | --- |
| **DNG** | TIFF/EP (TIFF-based) | IFD0 + Exif SubIFD via `ExifOffset` 0x8769; DNG-specific tags 0xc612-0xcd48 ("tags 0xc612-0xcd48 are defined by the DNG specification") | <https://exiftool.org/TagNames/EXIF.html> (0x8769, 0xc612), ExifTool pointing to the Adobe DNG spec at <https://helpx.adobe.com/photoshop/digital-negative.html> |
| **NEF** | TIFF-based | Main image in a `SubIFD`; the embedded JPEG preview is referenced by `JpgFromRawStart`/`JpgFromRawLength` **inside the SubIFD** (ExifTool's own note for 0x0201/0x0202) | <https://exiftool.org/TagNames/EXIF.html> (0x0201, 0x0202 notes) |
| **ARW** | TIFF-based | `PreviewImageStart`/`PreviewImageLength` appear **in MakerNotes and IFD0 of ARW** (same note) | <https://exiftool.org/TagNames/EXIF.html> |
| **PEF** | TIFF-based | `JpgFromRawStart`/`JpgFromRawLength` in **IFD2** | <https://exiftool.org/TagNames/EXIF.html> |
| **SRW** | TIFF-based | `ThumbnailOffset`/`ThumbnailLength` in the **SubIFD in IFD1** | <https://exiftool.org/TagNames/EXIF.html> |
| **CR2** | TIFF-based | `PreviewImageStart`/`PreviewImageLength` in **IFD0 of CR2 images** | <https://exiftool.org/TagNames/EXIF.html> |
| **CR3** | **ISO-BMFF/MP4-style atom container** (not TIFF) | Four separate TIFF-structured blocks: `moov/uuid/CMT1` = IFD0 (`parse_tiff_ifd`), `CMT2` = Exif IFD (`parse_exif`), `CMT3` = MakerNotes (`parse_makernote`), `CMT4` = GPS (`parse_gps`) | <https://raw.githubusercontent.com/LibRaw/LibRaw/master/src/metadata/cr3_parser.cpp> |
| **RAF** | Fujifilm private container | **Uncertain — no primary source retrieved.** ExifTool lists `RAF r/w` only | <https://manpages.ubuntu.com/manpages/noble/man1/exiftool.1p.html> |
| **ORF / RW2 / X3F** | — | **Uncertain** beyond ExifTool's `r/w` rows | same manpage URL |

MakerNotes (tag 0x927c, `undef`, ExifIFD, ~90 vendor variants) are the fragile part: ExifTool copies
them as a block, exposes a `-fixBase` option to "Fix the base for maker notes offsets", and notes
that the preview image they reference "is not copied, and must be transferred separately if
desired" — <https://manpages.ubuntu.com/manpages/noble/man1/exiftool.1p.html>. MakerNote internal
offsets are exactly the thing a byte-block move perturbs.

---

## Uncertainties (consolidated)

1. **Whether a given RAW's embedded preview JPEG actually contains a full APP1 Exif block.** LibRaw's
   `T.thumb + 6` test proves the case exists, not how common it is or which vendors do it. Only
   measurement on real files settles this.
2. **`LibRaw::unpack_thumb()`'s implementation was not located** (not in `src/utils/`,
   `src/metadata/`, `src/postprocessing/`, `src/preprocessing/` per their directory listings), so the
   "verbatim byte range" claim rests on LibRaw's docs + `thumbOK()` + the `dcraw_make_mem_thumb`
   test rather than on the copy loop.
3. **WebP `EXIF` payload framing** (whether the payload includes `"Exif\0\0"`) is not stated by the
   WebP container spec.
4. **The CIPA Exif specification text was not fetched** (PDF), so byte-order/offset-base rules are
   evidenced from LibRaw code and the PNG eXIf text rather than from the spec that owns them.
5. **PNG Third Edition's exact eXIf wording** was not reachable (page too large to fetch past §1 of
   the TOC); quoted text is from the 2017 extension document that the REC incorporated. The REC
   additionally *enforces* "orientation metadata before image data", per the implementation report.
6. **Consumer-app support matrix** (§5) is mostly "no primary source found" for WebP EXIF and for
   PNG eXIf in macOS/Windows/Adobe viewers; only orientation behaviour in browsers is documented.
7. **Writer-library coverage** is incomplete: `piexifjs`'s format coverage is taken from its npm
   metadata (keywords `jpeg`), not from reading its source; `sharp`, PNG chunk editors and WebP chunk
   writers were not verified at all in this pass.
8. **`xmpdata` when the XMP pointer is NULL** returns bytes sliced from heap offset 0 because
   `charPointerAsString` has no NULL check (`typed-cstruct/dist/builders/string.js:8-10`); in
   practice this appears to yield an empty string, but `xmplen > 0` is the only sound test.
