import { LOG_SPACES, findLogSpace } from '../color/log-spaces';
import { selectCurrentImage, selectHasLut, useAppStore } from '../store/useAppStore';

/**
 * Log 色彩空间选择区。
 *
 * 只在 RAW 上可用：Log 转换要的是线性光与足够的动态范围，浏览器解出来的 8 位 sRGB
 * 位图两条都不满足，所以非 RAW 时下拉框禁用而不是给出错误的结果。
 * 选中之后当前 LUT 会在这个 Log 空间里应用——这正是整件事的目的。
 */
export function LogPanel() {
  const entry = useAppStore(selectCurrentImage);
  const logSpaceId = useAppStore((state) => state.logSpaceId);
  const hasLut = useAppStore(selectHasLut);
  const setLogSpace = useAppStore((state) => state.setLogSpace);

  const isRaw = entry?.isRaw ?? false;
  const selected = logSpaceId ? findLogSpace(logSpaceId) : null;

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
        <p className="panel-hint log-panel__notice">当前 LUT 将在 {selected.name} 空间里应用</p>
      ) : null}
    </div>
  );
}
