import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

const baseProps = {
  label: '曝光',
  value: 0,
  min: -3,
  max: 3,
  step: 0.01,
  defaultValue: 0,
};

describe('Slider', () => {
  it('renders the label and formatted value', () => {
    render(<Slider {...baseProps} value={1.25} onChange={() => {}} />);

    expect(screen.getByText('曝光')).toBeInTheDocument();
    expect(screen.getByText('1.25')).toBeInTheDocument();
    expect(screen.getByLabelText('曝光')).toHaveValue('1.25');
  });

  it('appends the unit when given', () => {
    render(<Slider {...baseProps} unit="EV" value={0.5} onChange={() => {}} />);
    expect(screen.getByText('0.50 EV')).toBeInTheDocument();
  });

  it('reports changes as numbers', () => {
    const onChange = vi.fn();
    render(<Slider {...baseProps} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('曝光'), { target: { value: '1.5' } });

    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  it('resets to the default when the value button is clicked', () => {
    const onChange = vi.fn();
    render(<Slider {...baseProps} value={2} onChange={onChange} />);

    fireEvent.click(screen.getByTitle('点击复位'));

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('resets on double click of the range input', () => {
    const onChange = vi.fn();
    render(<Slider {...baseProps} value={-2} onChange={onChange} />);

    fireEvent.doubleClick(screen.getByLabelText('曝光'));

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('marks a modified slider', () => {
    const { container } = render(<Slider {...baseProps} value={1} onChange={() => {}} />);
    expect(container.querySelector('.slider--modified')).not.toBeNull();
  });

  it('does not mark a default slider as modified', () => {
    const { container } = render(<Slider {...baseProps} onChange={() => {}} />);
    expect(container.querySelector('.slider--modified')).toBeNull();
  });

  it('disables both controls when disabled', () => {
    render(<Slider {...baseProps} disabled onChange={() => {}} />);

    expect(screen.getByLabelText('曝光')).toBeDisabled();
    expect(screen.getByTitle('点击复位')).toBeDisabled();
  });
});
