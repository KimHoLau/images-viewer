import { generateLut3D } from '../lut/generate';
import type { Lut3D, LutSampler } from '../lut/types';
import { luminance, type Rgb } from '../renderer/adjustments-math';
import { smoothstep } from '../utils/math';

/**
 * 测试与真实 WebGL 验证脚本共用的 LUT 夹具。
 *
 * 这些角色原来由七个内置预设扮演（#11）。#26 把预设从产品代码里删掉之后，夹具搬到这里：
 * 夹具是测试的事，不该继续挂在一个已经没人用的产品模块上。三份夹具的形状刻意不同
 * （去色、按亮度分离调、通道增益 + S 曲线），这样"与各种 LUT 组合"才有覆盖面。
 */
export const FIXTURE_LUT_SIZE = 33;

/** 逐通道映射 */
function mapChannels(rgb: Rgb, fn: (channel: number) => number): Rgb {
  return [fn(rgb[0]), fn(rgb[1]), fn(rgb[2])];
}

/** S 曲线；strength 为 0 时原样返回 */
function contrastCurve(channel: number, strength: number): number {
  return channel + (smoothstep(0, 1, channel) - channel) * strength;
}

/** 黑白：三个通道都取 Rec.709 亮度 */
export const grayscaleSampler: LutSampler = (rgb) => {
  const grey = luminance(rgb);
  return [grey, grey, grey];
};

/** 换通道（R←B、G←R、B←G）：验 3D LUT 的采样轴向有没有搞错 */
export const channelSwapSampler: LutSampler = (rgb) => [rgb[2], rgb[0], rgb[1]];

/** 青橙分离调：暗部偏青、高光偏橙，按亮度加权 */
export const splitToneSampler: LutSampler = (rgb) => {
  const brightness = luminance(rgb);
  const shadowWeight = 1 - smoothstep(0, 0.5, brightness);
  const highlightWeight = smoothstep(0.5, 1, brightness);
  const amount = 0.7;
  const shadowGain: Rgb = [0.9, 1.02, 1.14];
  const highlightGain: Rgb = [1.12, 0.99, 0.86];

  const mix = (index: 0 | 1 | 2): number => {
    const value = rgb[index];
    return (
      value +
      (value * shadowGain[index] - value) * shadowWeight * amount +
      (value * highlightGain[index] - value) * highlightWeight * amount
    );
  };

  return [mix(0), mix(1), mix(2)];
};

/** 暖调：抬黑场 + 通道增益 + S 曲线 */
export const warmSampler: LutSampler = (rgb) =>
  mapChannels(
    [rgb[0] * 1.06 + 0.02, rgb[1] * 1.01 + 0.012, rgb[2] * 0.93],
    (channel) => contrastCurve(channel, 0.28),
  );

/** 黑白夹具 LUT */
export const grayscaleLut = generateLut3D(FIXTURE_LUT_SIZE, grayscaleSampler, '夹具：黑白');
/** 青橙分离调夹具 LUT */
export const splitToneLut = generateLut3D(FIXTURE_LUT_SIZE, splitToneSampler, '夹具：青橙');
/** 暖调夹具 LUT */
export const warmLut = generateLut3D(FIXTURE_LUT_SIZE, warmSampler, '夹具：暖调');
/** 换通道夹具 LUT：2³ 就够，轴向对不对一眼能看出来 */
export const channelSwapLut = generateLut3D(2, channelSwapSampler, '夹具：换通道');

/** 形状互不相同的三份，用来跑「与各种 LUT 组合」那一类检查 */
export const LUT_FIXTURES: readonly Lut3D[] = [grayscaleLut, splitToneLut, warmLut];
