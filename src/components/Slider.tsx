export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 双击滑块回到的默认值 */
  defaultValue: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** 带数值显示的参数滑块；双击标题行可回到默认值 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  unit,
  disabled = false,
  onChange,
}: SliderProps) {
  const displayValue = `${value.toFixed(2)}${unit ? ` ${unit}` : ''}`;
  const isModified = Math.abs(value - defaultValue) > 1e-6;

  return (
    <div className={`slider${isModified ? ' slider--modified' : ''}`}>
      <div className="slider__header">
        <span className="slider__label">{label}</span>
        <button
          type="button"
          className="slider__value"
          title="点击复位"
          onClick={() => onChange(defaultValue)}
          disabled={disabled}
        >
          {displayValue}
        </button>
      </div>
      <input
        className="slider__input"
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
      />
    </div>
  );
}
