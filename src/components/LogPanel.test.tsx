import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_SPACES } from '../color/log-spaces';
import { makeBrowseResult } from '../test/fixtures';
import { useAppStore } from '../store/useAppStore';
import { LogPanel } from './LogPanel';

const initialState = useAppStore.getState();

/** 下拉框；面板里只有这一个 select */
function select(): HTMLSelectElement {
  return screen.getByRole('combobox') as HTMLSelectElement;
}

describe('LogPanel', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  it('列出关闭加全部 14 个 Log 空间', () => {
    render(<LogPanel />);

    const options = Array.from(select().options).map((option) => option.value);
    expect(options[0]).toBe('');
    expect(options).toHaveLength(LOG_SPACES.length + 1);
    expect(options.slice(1)).toEqual(LOG_SPACES.map((space) => space.id));
  });

  it('默认选中「关闭」', () => {
    render(<LogPanel />);
    expect(select().value).toBe('');
  });

  it('没有图片时禁用', () => {
    render(<LogPanel />);
    expect(select()).toBeDisabled();
  });

  it('非 RAW 图片时禁用并说明原因', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));

    render(<LogPanel />);

    expect(select()).toBeDisabled();
    expect(screen.getByText(/仅 RAW 图片可用/)).toBeInTheDocument();
  });

  it('RAW 图片时可选', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));

    render(<LogPanel />);

    expect(select()).not.toBeDisabled();
    expect(screen.getByText('关闭时 RAW 按 sRGB 显示')).toBeInTheDocument();
  });

  it('选择后写进 store，并显示该空间的说明', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));

    render(<LogPanel />);
    fireEvent.change(select(), { target: { value: 's-log3' } });

    expect(useAppStore.getState().logSpaceId).toBe('s-log3');
    expect(
      screen.getByText(LOG_SPACES.find((s) => s.id === 's-log3')!.description),
    ).toBeInTheDocument();
  });

  it('选回「关闭」时清掉选择', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
    useAppStore.getState().setLogSpace('s-log3');

    render(<LogPanel />);
    fireEvent.change(select(), { target: { value: '' } });

    expect(useAppStore.getState().logSpaceId).toBeNull();
  });

  it('挂了 LUT 时提示 LUT 会在这个空间里应用', () => {
    act(() => {
      useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
      useAppStore.getState().setLogSpace('s-log3');
    });

    const { rerender } = render(<LogPanel />);
    expect(screen.queryByText(/当前 LUT 将在/)).toBeNull();

    act(() => {
      useAppStore.getState().setLutPreset('mono');
    });
    rerender(<LogPanel />);

    expect(screen.getByText('当前 LUT 将在 S-Log3 空间里应用')).toBeInTheDocument();
  });

  it('切到非 RAW 图片时如实说明选择不生效', () => {
    act(() => {
      useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
      useAppStore.getState().setLogSpace('s-log3');
    });

    const { rerender } = render(<LogPanel />);
    expect(select().value).toBe('s-log3');

    // 同一文件夹里换到 JPEG：选择还在 store 里，但不该让人以为它正在生效
    act(() => {
      useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
      useAppStore.getState().setLogSpace('s-log3');
    });
    rerender(<LogPanel />);

    expect(select()).toBeDisabled();
    expect(screen.getByText('当前图片不是 RAW，S-Log3 暂不生效')).toBeInTheDocument();
  });

  it('非 RAW 时不提示 LUT 会在 Log 空间应用', () => {
    act(() => {
      useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
      useAppStore.getState().setLogSpace('s-log3');
      useAppStore.getState().setLutPreset('mono');
    });

    render(<LogPanel />);

    expect(screen.queryByText(/当前 LUT 将在/)).toBeNull();
  });
});
