import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  /** Fires once when a drag/keyboard interaction settles (for persisting). */
  onCommit?: (value: number) => void;
  size?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}

// The arc sweeps 270°, from 135° (bottom-left) clockwise to 45° (bottom-right).
const START = 135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/**
 * Rotary control. Drag vertically (Shift for fine), scroll, or use arrow
 * keys; double-click resets to *defaultValue*.
 */
export function Knob({
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  onChange,
  onCommit,
  size = 64,
  label,
  disabled,
  className,
}: KnobProps) {
  const drag = React.useRef<{ y: number; value: number } | null>(null);
  const latest = React.useRef(value);
  latest.current = value;

  const clamp = React.useCallback(
    (v: number) => {
      const stepped = Math.round((v - min) / step) * step + min;
      return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
    },
    [min, max, step],
  );

  const set = (v: number) => {
    const next = clamp(v);
    if (next !== latest.current) onChange(next);
    return next;
  };

  const ratio = (value - min) / (max - min || 1);
  const angle = START + ratio * SWEEP;
  const c = size / 2;
  const r = size / 2 - 5;
  const tip = polar(c, c, r - 11, angle);
  const tail = polar(c, c, (r - 11) * 0.45, angle);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const range = max - min;
    const pixels = e.shiftKey ? 600 : 150;
    set(drag.current.value + ((drag.current.y - e.clientY) / pixels) * range);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommit?.(latest.current);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const big = (max - min) / 10;
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step;
    else if (e.key === 'PageUp') next = value + big;
    else if (e.key === 'PageDown') next = value - big;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    onCommit?.(set(next));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    onCommit?.(set(value + (e.deltaY < 0 ? step : -step)));
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      onDoubleClick={() => {
        if (defaultValue !== undefined && !disabled) onCommit?.(set(defaultValue));
      }}
      className={cn(
        'relative touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        disabled ? 'opacity-50' : 'cursor-ns-resize',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <path
          d={arcPath(c, c, r, START, START + SWEEP)}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {ratio > 0.001 && (
          <path
            d={arcPath(c, c, r, START, angle)}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth={6}
            strokeLinecap="round"
          />
        )}
        <circle cx={c} cy={c} r={r - 7} fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <line
          x1={tail.x}
          y1={tail.y}
          x2={tip.x}
          y2={tip.y}
          stroke="hsl(var(--foreground))"
          strokeWidth={3}
          strokeLinecap="round"
          opacity={0.85}
        />
      </svg>
    </div>
  );
}
