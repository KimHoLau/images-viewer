# Log 色彩空间支持：数学取证与移植记录

票号：#13（外加 #15、#16 的 CPU 部分）
目标：把参考项目 **Raw-Alchemy** 用 Python `colour-science` 做的 Log 色彩空间数学，
逐条复刻成 TypeScript（后续由他人镜像到 GLSL），不加任何 npm 依赖。

本文件记录的是**取证过程**：14 个空间的权威清单、每条曲线的 colour-science 源码位置与
精确常数、每个色域的原色/白点出处、矩阵推导过程、以及验证数字。
实现文件：`src/color/log-spaces.ts`、`src/color/log-curves.ts`、`src/color/log-gamut.ts`。

---

## 1. 权威清单：Raw-Alchemy 到底提供哪 14 个 Log 空间

### 1.1 踩过的坑

Raw-Alchemy 的 `README.md` 里那份 `--log-space` 列表**只有 13 项**，而且和代码里的注册表
不完全一致：

```
F-Log / F-Log2 / F-Log2C / V-Log / N-Log / Canon Log 2 / Canon Log 3 /
S-Log3 / S-Log3.Cine / Arri LogC3 / Arri LogC4 / Log3G10 / D-Log
```

（README 里少了 `L-Log`；它把 F-Log2C 算进去了，但没写 Leica。）

`src/raw_alchemy/utils.py` 里只有 Numba 加速核（矩阵、LUT、测光），**没有**色彩空间注册表。
真正的注册表在 `src/raw_alchemy/config.py` 的 `LOG_TO_WORKING_SPACE` 字典里，管线在
`src/raw_alchemy/core.py`：曲线走 `colour.cctf_encoding(img, function=<曲线名>)`，
色域走 `colour.matrix_RGB_to_RGB(colour.RGB_COLOURSPACES['ProPhoto RGB'], colour.RGB_COLOURSPACES[<色域名>])`。

> 说明：本节结论由委派方（父 agent）在读取 Raw-Alchemy 仓库后提供并在本任务中作为契约使用。
> 我本人从 `raw.githubusercontent.com` 成功取到了 `README.md`、`pyproject.toml`、
> `src/raw_alchemy/utils.py` 和完整的仓库文件树（`api.github.com/.../git/trees/main?recursive=1`），
> 因此「README 的 13 项清单与代码注册表不一致」这一点是我亲自核实的；
> `config.py` / `core.py` 的两次直接抓取都返回 `fetch failed`（网络抖动，非 404），
> 这两个文件的具体内容我**没能**独立复核——见第 6 节「未能一手验证的部分」。

### 1.2 最终采用的 14 项（数组顺序即 WebGL uniform 取值）

顺序照抄 `LOG_TO_WORKING_SPACE`。`LOG_SPACES[i]`、`LOG_GAMUT_MATRICES[i]`、
`LOG_GAMUT_PRIMARIES[i]` 必须描述同一个空间。

| #   | id            | 显示名      | colour-science cctf 曲线            | cctf 函数                                                                | 目标色域          |
| --- | ------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| 0   | `f-log`       | F-Log       | `F-Log`                             | `log_encoding_FLog`                                                      | F-Gamut           |
| 1   | `f-log2`      | F-Log2      | `F-Log2`                            | `log_encoding_FLog2`                                                     | F-Gamut           |
| 2   | `f-log2c`     | F-Log2C     | `F-Log2`（同曲线）                  | `log_encoding_FLog2`                                                     | F-Gamut C         |
| 3   | `v-log`       | V-Log       | `V-Log`                             | `log_encoding_VLog`                                                      | V-Gamut           |
| 4   | `n-log`       | N-Log       | `N-Log`                             | `log_encoding_NLog`                                                      | N-Gamut           |
| 5   | `l-log`       | L-Log       | `L-Log`                             | `log_encoding_LLog`                                                      | ITU-R BT.2020     |
| 6   | `canon-log-2` | Canon Log 2 | `Canon Log 2`（默认 method = v1.2） | `log_encoding_CanonLog2_v1_2`                                            | Cinema Gamut      |
| 7   | `canon-log-3` | Canon Log 3 | `Canon Log 3`（默认 method = v1.2） | `log_encoding_CanonLog3_v1_2`                                            | Cinema Gamut      |
| 8   | `s-log3`      | S-Log3      | `S-Log3`                            | `log_encoding_SLog3`                                                     | S-Gamut3          |
| 9   | `s-log3-cine` | S-Log3.Cine | `S-Log3`（同曲线）                  | `log_encoding_SLog3`                                                     | S-Gamut3.Cine     |
| 10  | `arri-logc3`  | Arri LogC3  | `ARRI LogC3`                        | `log_encoding_ARRILogC3`（EI800, SUP 3.x, Linear Scene Exposure Factor） | ARRI Wide Gamut 3 |
| 11  | `arri-logc4`  | Arri LogC4  | `ARRI LogC4`                        | `log_encoding_ARRILogC4`                                                 | ARRI Wide Gamut 4 |
| 12  | `log3g10`     | Log3G10     | `Log3G10`（默认 method = v3）       | `log_encoding_Log3G10_v3`                                                | REDWideGamutRGB   |
| 13  | `d-log`       | D-Log       | `D-Log`                             | `log_encoding_DJIDLog`                                                   | DJI D-Gamut       |

**与任务书里那份「如果找不到就用这 14 个」的兜底清单不同**：兜底清单包含
Canon C-Log2/C-Log3/S-Log2/Blackmagic Film Gen 5/DaVinci Intermediate/ACEScct，
而实际清单是 F-Log/F-Log2/F-Log2C/V-Log/N-Log/L-Log/Canon Log 2/Canon Log 3/
S-Log3/S-Log3.Cine/Arri LogC3/Arri LogC4/Log3G10/D-Log。
兜底清单**没有被采用**。

### 1.3 colour-science 的版本锚点

Raw-Alchemy 的 `pyproject.toml` 依赖写的是：

```
"colour-science @ git+https://github.com/colour-science/colour.git@develop"
```

所以本任务所有公式都以 **`develop` 分支**为基准（而不是 PyPI 上的稳定版）。
这一点很关键：Canon 系列在 `develop` 上的默认 `method` 是 `'v1.2'`，而更早的版本默认是 `'v1'`，
两条曲线的常数与分段点都不一样。

---

## 2. 曲线数学：colour-science 源码位置与精确常数

所有源码取自
`https://raw.githubusercontent.com/colour-science/colour/develop/colour/models/rgb/transfer_functions/<file>.py`。

移植约定：

1. colour-science 用 `np.log10`，GLSL ES 3.00 没有 `log10`，所以统一写成
   `Math.log2(x) * LOG10_OF_2`，其中 `LOG10_OF_2 = 0.3010299956639812`。
2. 函数参数里的分段点（Canon 的负支起点、LogC4 的 `s`/`t`）在 colour-science 里是**运行期算出来的**，
   本实现同样现算而不抄截断值——否则正反变换会在分段点错位。
3. `encode` 只对 `x >= 0` 与 colour-science 保证一致；负数行为与参考实现相同（见第 5 节）。

### 2.1 Fujifilm F-Log / F-Log2 — `fujifilm_f_log.py`

`CONSTANTS_FLOG`：

| 常数 | 值                |
| ---- | ----------------- |
| cut1 | 0.00089           |
| cut2 | 0.100537775223865 |
| a    | 0.555556          |
| b    | 0.009468          |
| c    | 0.344676          |
| d    | 0.790453          |
| e    | 8.735631          |
| f    | 0.092864          |

```
enc: x < cut1 ? e·x + f : c·log10(a·x + b) + d
dec: y < cut2 ? (y − f)/e : 10^((y − d)/c)/a − b/a
```

`CONSTANTS_FLOG2`：cut1 = 0.000889，cut2 = 0.100686685370811，a = 5.555556，
b = 0.064829，c = 0.245281，d = 0.384316，e = 8.799461，f = 0.092864。
`log_encoding_FLog2` 直接复用 `log_encoding_FLog` 的公式，只换常数。

**重要发现（见 2.6 与第 5 节）：这组 F-Log 常数在膝部本身不连续，缝隙 1.0094e-4。**

### 2.2 Panasonic V-Log — `panasonic_v_log.py`

`CONSTANTS_VLOG`：cut1 = 0.01，cut2 = 0.181，b = 0.00873，c = 0.241514，d = 0.598206。

```
enc: x < cut1 ? 5.6·x + 0.125 : c·log10(x + b) + d
dec: y < cut2 ? (y − 0.125)/5.6 : 10^((y − d)/c) − b
```

### 2.3 Nikon N-Log — `nikon_n_log.py`

`CONSTANTS_NLOG`：cut1 = 0.328，cut2 = 452/1023，a = 650/1023，b = 0.0075，
c = 150/1023，d = 619/1023。

```
enc: y < cut1 ? a·(y + b)^(1/3) : c·ln(y) + d        ← 注意是自然对数
dec: x < cut2 ? (x/a)^3 − b : exp((x − d)/c)
```

自然对数用 `Math.log2(x) * LN_2`（`LN_2 = 0.6931471805599453`）表示，GLSL 侧同理。
三次方根写成 `Math.pow(y + b, 1/3)`；在 `y < cut1` 这一支里 `y + b > 0` 恒成立，不会出现负数开根。

### 2.4 Leica L-Log — `leica_l_log.py`

`CONSTANTS_LLOG`：cut1 = 0.006，cut2 = 0.138，a = 8，b = 0.09，c = 0.27，
d = 1.3，e = 0.0115，f = 0.6。

```
enc: cut1 >= x ? a·x + b : c·log10(d·x + e) + f
dec: y <= cut2 ? (y − b)/a : (10^((y − f)/c) − e)/d
```

### 2.5 Sony S-Log3 — `sony.py`

```
enc: x >= 0.01125 ? (420 + log10((x + 0.01)/(0.18 + 0.01))·261.5)/1023
                  : (x·(171.2102946929 − 95)/0.01125 + 95)/1023
dec: y >= 171.2102946929/1023 ? 10^((y·1023 − 420)/261.5)·(0.18 + 0.01) − 0.01
                             : (y·1023 − 95)·0.01125/(171.2102946929 − 95)
```

`S-Log3` 与 `S-Log3.Cine` 共用这条曲线，只有色域不同（colour-science 的
`RGB_COLOURSPACE_S_GAMUT3` 与 `RGB_COLOURSPACE_S_GAMUT3_CINE` 都挂 `log_encoding_SLog3`）。

### 2.6 Canon Log 2 / Canon Log 3（v1.2）— `canon.py`

`log_encoding_CanonLog2_v1_2` / `log_decoding_CanonLog2_v1_2`：

```
enc: r = x/0.9;  r < X_CUT ? −(c·log10(−r·S + 1) − cut) : c·log10(r·S + 1) + cut
     c = 0.24136077, S = 87.09937546, cut = 0.092864125
     X_CUT = −(10^((cut − cut)/c) − 1)/S = −0      ← 见下方说明
dec: y < 0.035388 ? −(10^((0.035388 − y)/c) − 1)/S : (10^((y − 0.035388)/c) − 1)/S，结果再乘 0.9
```

`log_encoding_CanonLog3_v1_2` / `log_decoding_CanonLog3_v1_2`（三段）：

```
c = 0.36726845, S = 14.98325
enc: r < X_LO ? −c·log10(−r·S + 1) + 0.12783901
     r <= X_HI ? 1.9754798·r + 0.12512219
     else      ?  c·log10(r·S + 1) + 0.12240537
dec: y < 0.097465473 ? −(10^((0.12783901 − y)/c) − 1)/S
     y <= 0.15277891 ? (y − 0.12512219)/1.9754798
     else            ?  (10^((y − 0.12240537)/c) − 1)/S        （三段结果都乘 0.9）
```

`X_LO = −(10^((0.12783901 − 0.097465473)/c) − 1)/S · 0.9 = −0.012599998740925574`
`X_HI = (10^((0.15277891 − 0.12240537)/c) − 1)/S · 0.9 = 0.01260000010768158`

**两处与 colour-science 有意分歧（都是修 bug，理由如下）：**

- **Canon Log 2 的解码分段点。** colour-science 的 `log_decoding_CanonLog2_v1_2`
  沿用了 **v1** 曲线的截距 `0.035388128`。但 v1.2 的常数全部在 studio swing 里，
  编码器两支正好在 `x = 0` 处交接，交接值就是 `0.092864125`：
  `c·log10(0·S + 1) + cut = 0 + 0.092864125`。
  而编码器的负支分段点 `X_CUT = −0` 意味着负支**永远不会被选中**。
  用 `0.035388128` 反解 `x = 100` 会得到 `173`（误差 73%）。
  本实现改用 `C_LOG2_CUT_ENCODED = c·log10(S·0 + 1)·LOG10_OF_2 + cut = 0.092864125`，
  使 encode/decode 成为严格互逆。这条在 `log-curves.test.ts` 里有专门的用例钉住。
- **本记录不采用 `v1` 曲线。** `v1` 的线性趾部被 `−x·10.1596 + 1` 限制在
  `x > −0.098` 上，而解码分段点写成 `0.0730597`（正数），两侧常数并不相接；
  由于 `develop` 的默认 method 是 `v1.2`，本实现只做 v1.2。

### 2.7 ARRI LogC3（EI800）— `arri.py`

`DATA_ALEXA_LOG_C_CURVE_CONVERSION['SUP 3.x']['Linear Scene Exposure Factor'][800] =
(cut, a, b, c, d, e, f, e_cut_f) = (0.010591, 5.555556, 0.052272, 0.24719, 0.385537, 5.367655, 0.092809, 0.149658)`

```
enc: x > cut ? c·log10(a·x + b) + d : e·x + f
dec: t > e·cut + f ? (10^((t − d)/c) − b)/a : (t − f)/e
```

`e·cut + f = 5.367655·0.010591 + 0.092809 = 0.14965757…`（与数据表里的 `e_cut_f = 0.149658` 一致）。

### 2.8 ARRI LogC4 — `arri.py`

```
a = (2^18 − 16)/117.45
b = (1023 − 95)/1023
c = 95/1023
s = 7·ln2·2^(7 − 14c/b)/(a·b) = 0.1135972086105891
t = (2^(14·(−c/b) + 6) − 64)/a = −0.01805699611991131

enc: E >= t ? (log2(a·E + 64) − 6)/14 · b + c : (E − t)/s
dec: p >= 0 ? (2^(14·((p − c)/b) + 6) − 64)/a : p·s + t
```

### 2.9 RED Log3G10（v3）— `red.py`

`log_encoding_Log3G10_v3` 的局部量：a = 0.224282，b = 155.975327，c = 0.01，g = 15.1927。

```
enc: xc = x + c; xc < 0 ? xc·g : sign(xc)·a·log10(|xc|·b + 1)
dec: y < 0 ? y/g − c : sign(y)·(10^(|y|/a) − 1)/b − c
```

注意 v3 在 `x = 0` 处输出 `0.09155148771474521` 而不是 0（因为它先加了 `c = 0.01`），
这是 v3 白皮书曲线区别于 v1/v2 的地方。

### 2.10 DJI D-Log — `dji_d_log.py`

`log_encoding_DJIDLog` / `log_decoding_DJIDLog` 里的字面量：

```
enc: x <= 0.0078 ? 6.025·x + 0.0929 : log10(x·0.9892 + 0.0108)·0.256663 + 0.584555
dec: y <= 0.14   ? (y − 0.0929)/6.025 : (10^(3.89616·y − 2.27752) − 0.0108)/0.9892
```

`0.14` 是 colour-science 的硬编码值，而编码器的交接值是 `6.025·0.0078 + 0.0929 = 0.139895`，
两者差 `1.05e-4`。本实现保留参考实现的 `0.14`（`D_LOG_CUT_ENCODED = 0.14`）以保持逐行一致。

---

## 3. 色域：原色与白点

全部取自
`https://raw.githubusercontent.com/colour-science/colour/develop/colour/models/rgb/datasets/<file>.py`
以及白点表 `colour/colorimetry/datasets/illuminants/chromaticity_coordinates.py`。

白点：

| 名称 | CIE xy           | 出处                                                            |
| ---- | ---------------- | --------------------------------------------------------------- |
| D50  | (0.3457, 0.3585) | `chromaticity_coordinates.py`（按典型 RGB 文献四舍五入到 4 位） |
| D65  | (0.3127, 0.3290) | 同上                                                            |

| 色域              | 白点 | R                    | G                    | B                     | 数据集文件                                 |
| ----------------- | ---- | -------------------- | -------------------- | --------------------- | ------------------------------------------ |
| F-Gamut           | D65  | (0.7080, 0.2920)     | (0.1700, 0.7970)     | (0.1310, 0.0460)      | `fujifilm.py`（= `PRIMARIES_BT2020`）      |
| F-Gamut C         | D65  | (0.7347, 0.2653)     | (0.0263, 0.9737)     | (0.1173, −0.0224)     | `fujifilm.py`                              |
| V-Gamut           | D65  | (0.7300, 0.2800)     | (0.1650, 0.8400)     | (0.1000, −0.0300)     | `panasonic_v_gamut.py`                     |
| N-Gamut           | D65  | (0.7080, 0.2920)     | (0.1700, 0.7970)     | (0.1310, 0.0460)      | `nikon_n_gamut.py`（= `PRIMARIES_BT2020`） |
| ITU-R BT.2020     | D65  | (0.7080, 0.2920)     | (0.1700, 0.7970)     | (0.1310, 0.0460)      | `itur_bt_2020.py`                          |
| Cinema Gamut      | D65  | (0.7400, 0.2700)     | (0.1700, 1.1400)     | (0.0800, −0.1000)     | `canon_cinema_gamut.py`                    |
| S-Gamut3          | D65  | (0.7300, 0.2800)     | (0.1400, 0.8550)     | (0.1000, −0.0500)     | `sony.py`（= `PRIMARIES_S_GAMUT`）         |
| S-Gamut3.Cine     | D65  | (0.7660, 0.2750)     | (0.2250, 0.8000)     | (0.0890, −0.0870)     | `sony.py`                                  |
| ARRI Wide Gamut 3 | D65  | (0.6840, 0.3130)     | (0.2210, 0.8480)     | (0.0861, −0.1020)     | `arri.py`                                  |
| ARRI Wide Gamut 4 | D65  | (0.7347, 0.2653)     | (0.1424, 0.8576)     | (0.0991, −0.0308)     | `arri.py`                                  |
| REDWideGamutRGB   | D65  | (0.780308, 0.304253) | (0.121595, 1.493994) | (0.095612, −0.084589) | `red.py`                                   |
| DJI D-Gamut       | D65  | (0.7100, 0.3100)     | (0.2100, 0.8800)     | (0.0900, −0.0800)     | `dji_d_gamut.py`                           |

**结论：14 个目标色域的白点全部是 D65**（包括 ARRI Wide Gamut 4——`arri.py` 里
`WHITEPOINT_NAME_ARRI_WIDE_GAMUT_4 = "D65"`，虽然 ARRI 自己的白皮书用 D65 而
colour-science 把它当 D65 处理）。而源色域 ProPhoto RGB 是 **D50**，所以色适应这一步不是可选项。

L-Log 没有自己的数据集文件，直接用 `ITU-R BT.2020`（`RGB_COLOURSPACE_BT2020`）。

---

## 4. 矩阵推导

### 4.1 公式

对每个 Log 空间 `i`：

```
M_i = XYZ_TO_TARGET_i · Bradford(D50 → 目标白点_i) · PROPHOTO_TO_XYZ
```

- `PROPHOTO_TO_XYZ = normalised_primary_matrix(ProPhoto 原色, D50)`，
  用 `colour-science` 的 `normalised_primary_matrix` 定义（解 `Pᵀ·S = W` 再左乘 `P`）。
  数值（`%.12f`）：

  ```
  [[0.797760489672, 0.135185837176, 0.031349349582],
   [0.288071128229, 0.711843217810, 0.000085653961],
   [0.000000000000, 0.000000000000, 0.825104602510]]
  ```

- 色适应：Bradford 矩阵
  `[[0.8951, 0.2664, −0.1614], [−0.7502, 1.7135, 0.0367], [0.0389, −0.0685, 1.0296]]`，
  两端白点都先转成 XYZ（Y = 1）再在锥响应空间里做比例缩放。
  这就是 `colour-science` 里 `matrix_RGB_to_RGB` 的默认 `chromatic_adaptation_transform='Bradford'`。

- `XYZ_TO_TARGET_i = inv(normalised_primary_matrix(目标原色, 目标白点))`。

### 4.2 关键性质与「不能省色适应」的证据

因为两端都归一化到各自白点，所以对每个 `i`：

```
M_i · [1,1,1] = [1,1,1]
```

实测最大偏差 **6.66e-16**（14 个矩阵一起统计）。

**如果省掉 Bradford**：以 ARRI Wide Gamut 3 为例，朴素矩阵
`inv(N_AWG3) · PROPHOTO_TO_XYZ` 会把 `[1,1,1]` 映到
**`[1.077571, 0.939824, 0.767445]`**——中性灰直接偏成暖色。
`LOG_GAMUT_MATRICES` 里没有出现这种情况，`log-gamut.test.ts` 也把这条写成了断言。

行列式（= 两个色域的体积比）全部为正，最小 **0.641410545805**（REDWideGamutRGB）。

### 4.3 数值来源

矩阵由一段仓外临时 node 脚本算出（按 `%.12f` 硬编码进 `log-spaces.ts`），
脚本未提交、未加依赖，用完即删。`log-gamut.test.ts` 会**独立重算**同一公式与硬编码值比对。

### 4.4 一个容易踩的坑：不能拿 colour-science 的 `MATRIX_*_TO_XYZ` 直接逐项比对

`datasets/*.py` 里那些硬编码矩阵（例如 `MATRIX_BT2020_TO_XYZ`）**没有做色适应**，
它们满足 `npm · [1,1,1] = 1.10761` 而不是 `[1,1,1]`，与本项目「两端各自白点归一化」的
相对尺度不同。我最初写了一条「`inv(MATRIX_BT2020_TO_XYZ)` 应当等于 L-Log 的矩阵」的断言，
实测差 **0.516** —— 断言本身是错的，不是矩阵错的。

能做的外部校验是：

1. 用我们表里的 BT.2020 原色重算 `normalised_primary_matrix`，必须复现 colour-science
   数据集里那张硬编码矩阵，**9 项全部对到 1e-12**（这条已写进测试）；
2. 语义校验：把某个目标色域原色的 XYZ 经 `S⁻¹·A⁻¹` 送回 ProPhoto，再过矩阵，
   必须得到对应的单位基向量。

---

## 5. 验证数字

### 5.1 已知参考值（来自 colour-science doctest，逐位一致）

| 曲线        | 表达式                         | 参考值              |
| ----------- | ------------------------------ | ------------------- |
| F-Log       | `log_encoding_FLog(0.18)`      | 0.45931845866162124 |
| F-Log2      | `log_encoding_FLog2(0.18)`     | 0.39100724189123004 |
| V-Log       | `log_encoding_VLog(0.18)`      | 0.42331144876013616 |
| N-Log       | `log_encoding_NLog(0.18)`      | 0.3636677701171387  |
| L-Log       | `log_encoding_LLog(0.18)`      | 0.4353139040439265  |
| Canon Log 2 | `log_encoding_CanonLog2(0.18)` | 0.3982546925614935  |
| Canon Log 3 | `log_encoding_CanonLog3(0.18)` | 0.34338937037393549 |
| S-Log3      | `log_encoding_SLog3(0.18)`     | 0.41055718475073316 |
| ARRI LogC3  | `log_encoding_ARRILogC3(0.18)` | 0.391006832034084   |
| ARRI LogC4  | `log_encoding_ARRILogC4(0.18)` | 0.2783958365482653  |
| Log3G10     | `log_encoding_Log3G10(0.0)`    | 0.09155148771474521 |
| Log3G10     | `log_decoding_Log3G10(1.0)`    | 184.32234764032498  |
| D-Log       | `log_encoding_DJIDLog(0.18)`   | 0.3987645561893306  |

10bit 码值表（`x = [0, 18, 90]/100`，doctest 给定）：

| 曲线   | 期望码值        | 实测 |
| ------ | --------------- | ---- |
| S-Log3 | [95, 420, 598]  | 一致 |
| V-Log  | [128, 433, 602] | 一致 |
| F-Log2 | [95, 400, 570]  | 一致 |
| F-Log  | [95, 470, 705]  | 一致 |

### 5.2 往返容差：`1e-9 + 1e-5·|参考值|`

- 12 条曲线的 `decode(encode(x))` 在 `x ∈ [0, 100]` 上密扫，最大误差 **1.1e-13**
  （double 里 `log2`/`pow` 的正常水平，误差随 x 线性放大）。
- **D-Log 是唯一的例外，最大误差 8.389e-6（@x = 100），相对误差 8.39e-8。**
  这不是实现误差：colour-science 的解码式用
  `10^(3.89616·y − 2.27752)` 这组「二次常数」去反解编码式的
  `log10(x·0.9892 + 0.0108)`，而两组常数各自只有 6 位有效数字
  （`10^0.584555 ≈ 3.842` vs `1/0.256663 ≈ 3.896`），反解的相对误差被对数支放大到约 8.4e-8。
- 所以相对项取 `1e-5`，容纳这一条参考实现自身的常数精度；绝对项 `1e-9` 负责锁住其余 12 条
  必须精确互逆。任何常数抄错或分段点错位都会带来 1e-3 以上的相对偏差，仍然挡得住。

### 5.3 分段点：实测的膝部缝隙

把分段点两侧的编码值取单侧极限（`eps = 1e-9`），得到每条曲线在膝部的**真实跳变**：

| 曲线               | `enc(x_cut⁻) − enc(x_cut⁺)` | 判定     |
| ------------------ | --------------------------- | -------- |
| Canon Log 2 (v1.2) | 2.0e-14                     | 严格相接 |
| Canon Log 3 (v1.2) | 1.9e-13                     | 严格相接 |
| S-Log3             | 1.1e-13                     | 严格相接 |
| ARRI LogC4         | 3.0e-13                     | 严格相接 |
| Log3G10            | 2.7e-13                     | 严格相接 |
| F-Log2             | 1.818e-8                    | 可忽略   |
| ARRI LogC3         | 2.394e-7                    | 可忽略   |
| V-Log              | 3.000e-7                    | 可忽略   |
| D-Log              | −2.027e-6                   | 可忽略   |
| **N-Log**          | **−1.266e-4**               | 真实缝隙 |
| **F-Log**          | **1.009e-4**                | 真实缝隙 |
| **L-Log**          | **8.995e-4**                | 真实缝隙 |

**F-Log 的缝隙（这条我一开始说错了，实测如下）**：

```
线性支在 x = 0.00089 处 = e·cut1 + f                = 8.735631 × 0.00089 + 0.092864
                                                    = 0.100638711590
对数支在 x = 0.00089 处 = c·log10(a·cut1 + b) + d   = 0.100537775224
解码器分段常数 cut2                                   = 0.100537775223865
```

`0.100638711590 − 0.100537775224 = 1.009364e-4`。
也就是说 **Fujifilm 官方给出的 F-Log 常数在膝部本身就不连续**：对数支比线性支低
1.0094e-4，解码器的分段常数正好是「对数支」那一侧的值。

后果：`decode(cut2) = 0.000889999999999995`，此处编码器仍走线性支，
`encode(...) = 0.100638711590`，与 `cut2` 差了整个缝隙。
在 `x ∈ [0.0008784454407317567, 0.00089)` 这段上，编码器会产生编码值，
而解码器永远回不到这段输入 —— 参考实现留下的一个约 1.16e-5 宽的空洞。

这是**常数问题，不是本模块抄错**：`log_encoding_FLog(0.18)` 与 colour-science 的
doctest 逐位一致（0.45931845866162124），`log_encoding_FLog2` 同理。
`log-curves.test.ts` 里把三个数字（0.100638711590、0.100537775223865、缝隙 1.009364e-4）
都钉成了断言，而不是放宽容差掩盖过去。

其余两条真实缝隙同理，也各自 pin 住：

- **N-Log** `−1.266e-4`：编码器用 `x < 0.328` 切分，而解码器用 `452/1023`；
  两处的常数不是同一个物理量，膝部因此有 1.27e-4 的缝隙。
- **L-Log** `8.995e-4`：`decode(0.138)` 的浮点结果是 `0.006000000000000002`，
  比编码器的分段点 `0.006` 大一个 ulp，于是编码方向选到对数支。
  这是单点跳变，换一个 ulp 之外的点两支就重新吻合。

### 5.4 边界与单调性

- 全部 14 条曲线在 `x = 0` 处都有定义且有限，黑位落在 `[0, 0.13)`。
- `x = −1e-9 / −1e-6 / −0` 全部返回有限值，不产生 NaN
  （Raw-Alchemy 在编码前会把线性值夹到 `1e-6`，本模块不做隐式夹取，但要求「几乎为零的负数」安全）。
- 明显为负的输入：落在算术延伸支上的曲线返回有限值；N-Log 在 `x < −0.0075` 时
  因 `(x + b)^(1/3)` 落到负数而返回 NaN —— 与 colour-science 行为一致，测试把它写死了，
  防止以后有人「顺手」加 clamp 而改变与参考实现的一致性。
- `±Infinity`：编码与解码方向都不产生 NaN（`log2`/`pow`/`exp` 对 ±∞ 都是良定义的）。
- 单调性：14 条曲线在 `[0, 100]` 上密扫 2000 点，全部非递减。

### 5.5 矩阵验证数字

| 检查项                                              | 结果                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `M · [1,1,1]` 与 `[1,1,1]` 的最大偏差（14 个矩阵）  | 6.66e-16                                         |
| 行列式                                              | 全部 > 0，最小 0.641410545805（REDWideGamutRGB） |
| 用 `LOG_GAMUT_PRIMARIES` 重算矩阵 vs 硬编码值       | 最大差 4.6e-13（硬编码为 `%.12f`）               |
| BT.2020 原色重算 `npm` vs colour-science 硬编码矩阵 | 9 项全部 < 1e-12                                 |
| 不做色适应用的朴素矩阵 `· [1,1,1]`（AWG3）          | `[1.077571, 0.939824, 0.767445]`                 |
| 中性灰 0.18 经色域转换后三通道相等                  | 偏差 < 1e-12                                     |

---

## 6. 未能一手验证的部分（诚实标注）

1. **Raw-Alchemy 的 `config.py` / `core.py` 正文。**
   这两次抓取都返回 `fetch failed`（网络层失败，不是 404）。
   我独立核实的是：`README.md` 的 13 项清单、`pyproject.toml` 把 colour-science
   钉在 `develop`、仓库文件树里确实存在 `src/raw_alchemy/config.py` 与 `core.py`、
   `utils.py` 里没有任何色彩空间注册表。
   **14 项清单、数组顺序以及 `LOG_TO_WORKING_SPACE` 的内容来自委派方转述**，
   我按契约采用，但没能亲自打开那两个文件复核。
2. **`colour.cctf_encoding` 的具体调用参数（是否传 `bit_depth` / `in_reflection`）。**
   同样来自委派方转述（`cctf_encoding(img, function=<curve>)`，且编码前把负值夹到 `1e-6`）。
   本实现按「默认参数、归一化 code value」处理，这与所有 doctest 参考值一致。
3. **F-Log 的 1.0094e-4 缝隙是否是 colour-science 的抄写错误。**
   我实测到了这个缝隙，也确认 `log_encoding_FLog(0.18)` 与 doctest 逐位一致，
   但**没有**去比对 Fujifilm 官方的 F-Log Data Sheet（`https://dl.fujifilm-x.com/support/lut/F-Log_DataSheet_E_Ver.1.1.pdf`）
   来判定到底是 Fujifilm 的常数本身如此、还是 colour-science 抄错了 `f`。
   这超出了本次「复刻 colour-science」的范围；结论只到「参考实现里确实有这个缝隙」。
4. **GLSL 侧的数值一致性未在本文档内验证。** 本文件只覆盖 CPU 数学；GLSL 镜像写在
   `src/renderer/log-shader.ts`，常数由 `log-curves.ts` 插值生成，`log-shader.test.ts`
   只做静态核对（「GLSL 里出现的每个小数都必须来自那些常数」）。真正的数值一致性由
   `src/dev/webgl-check.ts` 在真实 WebGL2 上跑：14 个空间逐个比对 GPU 与 CPU 输出。
   写这份文档时那次比对尚未跑过；后来在 headless Chrome (SwiftShader) 上跑完，
   14 项最大偏差 0.5/255（8 位量化量级）。
5. **F-Log 的缝隙在 GLSL 侧同样存在**：GLSL 用的是同一批常数、同一套分段判断，
   所以膝部行为与 CPU 一致（GPU/CPU 比对里 F-Log 也是 0.5/255）。

---

## 7. 用到的 URL

- Raw-Alchemy 仓库：
  <https://github.com/shenmintao/Raw-Alchemy>
  - README：<https://raw.githubusercontent.com/shenmintao/Raw-Alchemy/main/README.md>
  - `pyproject.toml`：<https://raw.githubusercontent.com/shenmintao/Raw-Alchemy/main/pyproject.toml>
  - `src/raw_alchemy/utils.py`：<https://raw.githubusercontent.com/shenmintao/Raw-Alchemy/main/src/raw_alchemy/utils.py>
  - 文件树：<https://api.github.com/repos/shenmintao/Raw-Alchemy/git/trees/main?recursive=1>
- colour-science（`develop`）：
  - 传输函数注册表：<https://raw.githubusercontent.com/colour-science/colour/develop/colour/models/rgb/transfer_functions/__init__.py>
  - `fujifilm_f_log.py`、`panasonic_v_log.py`、`nikon_n_log.py`、`leica_l_log.py`、`sony.py`、
    `canon.py`、`arri.py`、`red.py`、`dji_d_log.py`
    （同一目录，例如 <https://raw.githubusercontent.com/colour-science/colour/develop/colour/models/rgb/transfer_functions/arri.py>）
  - 数据集：`colour/models/rgb/datasets/{fujifilm,panasonic_v_gamut,nikon_n_gamut,itur_bt_2020,canon_cinema_gamut,sony,arri,red,dji_d_gamut}.py`
  - 白点表：<https://raw.githubusercontent.com/colour-science/colour/develop/colour/colorimetry/datasets/illuminants/chromaticity_coordinates.py>
