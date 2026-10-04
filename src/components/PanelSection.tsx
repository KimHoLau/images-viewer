import { useId, useState, type ReactNode } from 'react';

export interface PanelSectionProps {
  title: string;
  /** 右侧的附加信息，例如重置按钮 */
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** 右侧面板的可折叠分区 */
export function PanelSection({
  title,
  action,
  defaultOpen = true,
  children,
}: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="panel-section">
      <div className="panel-section__bar">
        <button
          type="button"
          className="panel-section__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`panel-section__chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
          <span className="panel-section__title">{title}</span>
        </button>
        {action ? <div className="panel-section__action">{action}</div> : null}
      </div>
      {open ? (
        <div className="panel-section__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
