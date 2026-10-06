import { LOG_SPACES, findLogSpace } from '../color/log-spaces';
import { selectCurrentImage, selectHasLut, useAppStore } from '../store/useAppStore';

/**
 * Log 色彩空间选择区。
 *
 * 只在 RAW 上可用：Log 转换要的是线性光与足够的动态范围，浏览器解出来的 8 位 sRGB
 * 位图两条都不满足，所以非 RAW 时下拉框禁用而不是给出错误的结果。
 * 选中之后当前 LUT 会在这个 Log 空间里应用——这正是整件事的目的。
 *
 * 面板里有两个下拉框：第一个选色彩空间，第二个（选中空间且挂了 LUT 时才出现）选
 * **LUT 的输出在哪个空间**。后者不能靠猜：ARRI 的 `LogC4 → Rec.709` 输出端已经是
 * 显示空间，再当 Log 解码一次会把蓝通道放大到 2 以上、夹成纯青的天空。
 */
export function LogPanel() {
  const entry = useAppStore(selectCurrentImage);
  const logSpaceId = useAppStore((state) => state.logSpaceId);
  const hasLut = useAppStore(selectHasLut);
  const setLogSpace = useAppStore((state) => state.setLogSpace);
  const lutOutputEncoded = useAppStore((state) => state.lutOutputEncoded);
  const setLutOutputEncoded = useAppStore((state) => state.setLutOutputEncoded);

  const isRaw = entry?.isRaw ?? false;
  const selected = logSpaceId ? findLogSpace(logSpaceId) : null;
  /** 挂了 LUT 但没选空间：LUT 会被套在 sRGB 显示值上，而这多半不是用户想要的 */
  const lutWithoutLogSpace = hasLut && selected === null;

  return (
    <div className="log-panel">
      <label className="field">
        <span className="field__label">色彩空间</span>
        <select
          className="field__control"
          value={logSpaceId ?? ''}
          disabled={!isRaw}
          onChange={(event) => setLogSpace(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">关闭</option>
          {LOG_SPACES.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>

      <p className="panel-hint">
        {!isRaw
          ? selected
            ? // 选择还在（换图不会清掉），但非 RAW 图片没有线性数据，它不会生效
              `当前图片不是 RAW，${selected.name} 暂不生效`
            : '仅 RAW 图片可用：Log 转换需要线性光与 16 位动态范围'
          : (selected?.description ?? '关闭时 RAW 按 sRGB 显示')}
      </p>

      {isRaw && selected && hasLut ? (
        <>
          <p className="panel-hint log-panel__notice">当前 LUT 将在 {selected.name} 空间里应用</p>
          <label className="field">
            <span className="field__label">LUT 输出空间</span>
            <select
              className="field__control"
              value={lutOutputEncoded ? 'encoded' : 'display'}
              onChange={(event) => setLutOutputEncoded(event.target.value === 'encoded')}
            >
              <option value="display">显示空间（相机转 Rec.709 的 LUT 选这个）</option>
              <option value="encoded">Log 空间（串联 Log 进 / Log 出的 LUT）</option>
            </select>
          </label>
          <p className="panel-hint">
            {lutOutputEncoded
              ? `LUT 的输出按 ${selected.name} 解码回工作空间再显示`
              : 'LUT 的输出直接当显示值。ARRI 的 LogC4 → Rec.709 是这种；把它当 Log 再解码一次，天空会变成纯青。'}
          </p>
        </>
      ) : null}

      {/*
        反过来的那一半也得说清：挂了 LUT 却没选空间时，LUT 是套在 sRGB 显示值上的。
        按 Log 定义的 LUT（ARRI LogC4 → Rec.709 这类）这样用会大幅提亮、暗部砸死、
        高光撞顶，而画面上看不出是漏选了色域——这正是「加载官方 LUT 后严重偏色」的成因。
      */}
      {isRaw && lutWithoutLogSpace ? (
        <p className="panel-hint log-panel__notice log-panel__notice--warning">
          当前 LUT 直接套在 sRGB 显示值上。若它是按 Log 定义的（如 ARRI LogC4 → Rec.709），
          画面会整体提亮、暗部砸死、高光撞顶；请选一个与素材匹配的色彩空间。
        </p>
      ) : null}
    </div>
  );
}
