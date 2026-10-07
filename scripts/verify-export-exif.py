#!/usr/bin/env python3
"""用 Pillow 独立核对导出的图片是否真的带上了原 RAW 的拍摄信息。

为什么是 Pillow：`src/services/exif.ts` 自己会读写 EXIF，拿它去验自己写出来的字节
是循环论证——读写两头一起错也照样自洽。Pillow 是**另一份实现**，对 JPEG 的 APP1 与
PNG 的 eXIf 各有自己的解析路径，它读得到才算数。

用法（一般由 scripts/verify-export-exif.mjs 调用）：
    python scripts/verify_export_exif.py <导出目录>

目录里要有 produced.json（页面交出来的落盘清单与导出尺寸）。逐项打印 PASS/FAIL，
有 FAIL 就以非零码退出。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, UnidentifiedImageError

TAG_NAMES = {
    0x010F: "Make",
    0x0110: "Model",
    0x0112: "Orientation",
    0x0131: "Software",
    0x0132: "DateTime",
    0x013B: "Artist",
    0x828D: "CFARepeatPatternDim",
    0x829A: "ExposureTime",
    0x829D: "FNumber",
    0x8822: "ExposureProgram",
    0x8827: "ISOSpeedRatings",
    0x9003: "DateTimeOriginal",
    0x9207: "MeteringMode",
    0x9209: "Flash",
    0x920A: "FocalLength",
    0x927C: "MakerNote",
    0xA002: "PixelXDimension",
    0xA003: "PixelYDimension",
    0xA405: "FocalLengthIn35mmFilm",
    0xA431: "BodySerialNumber",
    0xA434: "LensModel",
}

# 实测 samples/IMGP2971.DNG 的容器 IFD 里就是这些值（见 #36 的实测评论）
EXPECTED_CONTAINER = {
    0x010F: "PENTAX",
    0x0110: "PENTAX K-30",
    0x0131: "K-30 Ver 1.06",
    0x0132: "2026:10:05 13:16:28",
    0x013B: "KIMHO",
    0x9003: "2026:10:05 13:16:28",
    0x8827: 100,
    0xA405: 46,
}

# 非 TIFF 容器走 LibRaw 字段兜底时，页面喂进去的那份
EXPECTED_FALLBACK = {
    0x010F: "Canon",
    0x0110: "EOS R5",
    0x0131: "Firmware 1.9.0",
    0xA434: "RF24-70mm F2.8 L IS USM",
    0xA431: "SN123456",
    0x8827: 400,
    0xA405: 35,
    0x9003: "2026:10:05 13:16:28",
}


EXIF_IFD = 0x8769
GPS_IFD = 0x8825

# 真 LibRaw 从 samples/IMGP2971.DNG 解出来的那份（见 #36 的实测评论）。
# 这条路上 DateTimeOriginal 是页面按**浏览器本地时区**从时间戳生成的，所以只校形状不校具体值。
EXPECTED_REAL_METADATA = {
    0x010F: "Pentax",
    0x0110: "K-30",
    0x0131: "K-30 Ver 1.06",
    0x8827: 100,
    0xA405: 46,
}
EXIF_DATETIME_PATTERN = re.compile(r"^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$")

results: list[tuple[bool, str, str]] = []


def report(ok: bool, label: str, detail: str = "") -> None:
    results.append((bool(ok), label, detail))


def load_exif(path: Path) -> tuple[dict[int, object], dict[int, object]] | None:
    """返回 (IFD0, ExifIFD) 两层标签；读不出来返回 None"""
    try:
        with Image.open(path) as image:
            # 完整解一遍像素：注入要是破坏了熵编码数据，Image.open 只看文件头是发现不了的
            image.load()
            report(True, f"{path.name}：Pillow 完整解码通过", f"{image.size[0]}×{image.size[1]}")

            exif = image.getexif()
            top = {tag: value for tag, value in exif.items()}
            try:
                nested = dict(exif.get_ifd(EXIF_IFD))
            except Exception:  # noqa: BLE001 - Pillow 对坏 IFD 的抛法不止一种
                nested = {}
            return top, nested
    except (UnidentifiedImageError, OSError) as error:
        report(False, f"{path.name}：Pillow 能打开并解码", str(error))
        return None


def value_of(layers: tuple[dict[int, object], dict[int, object]], tag: int) -> object | None:
    top, nested = layers
    if tag in top:
        return top[tag]
    return nested.get(tag)


def as_number(value: object) -> float | None:
    if value is None or isinstance(value, str):
        return None
    try:
        return float(value)  # Pillow 的有理数是 IFDRational，能直接转
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def as_text(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def check_expected(path: Path, layers: tuple[dict[int, object], dict[int, object]], expected: dict) -> None:
    for tag, want in expected.items():
        actual = as_text(value_of(layers, tag))
        report(actual == want, f"{path.name}：{TAG_NAMES[tag]} == {want!r}", f"实际 {actual!r}")


def check_exif_file(path: Path, size: tuple[int, int]) -> None:
    """容器 IFD 那条路：原拍摄字段在，像素绑定字段是导出尺寸"""
    layers = load_exif(path)
    if layers is None:
        return
    top, nested = layers

    report(bool(top), f"{path.name}：Pillow 读到了 EXIF", f"IFD0 {len(top)} 个标签")
    report(bool(nested), f"{path.name}：ExifIFD 读得到", f"{len(nested)} 个标签")
    if not top:
        return

    check_expected(path, layers, EXPECTED_CONTAINER)
    # 缩过尺寸时，像素绑定字段要跟着导出尺寸走
    check_expected(path, layers, {0xA002: size[0], 0xA003: size[1]})

    # 方向必须归一化成 1：导出像素已经摆正，再转一次就歪了
    orientation = value_of(layers, 0x0112)
    report(orientation == 1, f"{path.name}：Orientation 归一化为 1", f"实际 {orientation!r}")

    # G1：不写 GPS、不搬 MakerNote、不搬容器专属的指针标签
    report(GPS_IFD not in top, f"{path.name}：不写 GPSInfo")
    for tag, name in ((0x927C, "MakerNote"), (0x828D, "CFARepeatPatternDim")):
        report(value_of(layers, tag) is None, f"{path.name}：不搬 {name}")


def check_fallback_file(path: Path) -> None:
    """LibRaw 字段兜底那条路：字段来自页面喂进去的 fallback"""
    layers = load_exif(path)
    if layers is None:
        return
    if not layers[0]:
        report(False, f"{path.name}：Pillow 读到了 EXIF")
        return

    check_expected(path, layers, EXPECTED_FALLBACK)

    for tag, want, label in (
        (0x829A, 1 / 250, "ExposureTime == 1/250"),
        (0x829D, 2.8, "FNumber == 2.8"),
        (0x920A, 35.0, "FocalLength == 35"),
    ):
        actual = as_number(value_of(layers, tag))
        report(
            actual is not None and abs(actual - want) < 1e-6,
            f"{path.name}：{label}",
            f"实际 {actual!r}",
        )

    orientation = value_of(layers, 0x0112)
    report(orientation == 1, f"{path.name}：Orientation 归一化为 1", f"实际 {orientation!r}")


def check_real_metadata_file(path: Path) -> None:
    """真 LibRaw 解出来的字段走兜底那条路：证明这条链在真实数据上也成立"""
    layers = load_exif(path)
    if layers is None:
        return
    if not layers[0]:
        report(False, f"{path.name}：Pillow 读到了 EXIF")
        return

    check_expected(path, layers, EXPECTED_REAL_METADATA)

    shot_at = value_of(layers, 0x9003)
    report(
        isinstance(shot_at, str) and bool(EXIF_DATETIME_PATTERN.match(shot_at.strip())),
        f"{path.name}：DateTimeOriginal 是 EXIF 的日期写法",
        f"实际 {shot_at!r}",
    )

    for tag, want, label in (
        (0x829A, 1 / 250, "ExposureTime == 1/250"),
        (0x829D, 8.0, "FNumber == 8"),
        (0x920A, 31.0, "FocalLength == 31"),
    ):
        actual = as_number(value_of(layers, tag))
        report(
            actual is not None and abs(actual - want) < 1e-6,
            f"{path.name}：{label}",
            f"实际 {actual!r}",
        )

    orientation = value_of(layers, 0x0112)
    report(orientation == 1, f"{path.name}：Orientation 归一化为 1", f"实际 {orientation!r}")


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python scripts/verify_export_exif.py <导出目录>")
        return 2

    directory = Path(sys.argv[1])
    produced = json.loads((directory / "produced.json").read_text(encoding="utf8"))
    sizes = produced.get("sizes") or {}

    # 页面可能在导出途中就失败，那时尺寸表是空的：报 FAIL 而不是崩掉，
    # 一个 traceback 会盖住真正有用的那几行
    scaled = sizes.get("scaled")
    report(
        isinstance(scaled, list) and scaled[0] == 640,
        "scaled 那份的长边是 640",
        f"实际 {scaled!r}",
    )

    for name in produced["files"]:
        path = directory / name
        if not path.exists():
            report(False, f"{name}：文件落盘了")
            continue

        prefix = name.split("-", 1)[0]
        if prefix == "fallback":
            check_fallback_file(path)
            continue
        if prefix == "realmeta":
            check_real_metadata_file(path)
            continue

        size = sizes.get(prefix)
        if not isinstance(size, list):
            report(False, f"{name}：页面交回了导出尺寸")
            continue
        check_exif_file(path, tuple(size))

    report(
        not any(name.endswith(".webp") for name in produced["files"]),
        "没有产出带 EXIF 的 WebP",
    )

    failures = [item for item in results if not item[0]]
    for ok, label, detail in results:
        print(f"{'PASS' if ok else 'FAIL'} {label}{f' :: {detail}' if detail else ''}")
    print(f"\n{len(results) - len(failures)}/{len(results)} 项通过")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
