import {
  AudioLines,
  Cpu,
  type LucideIcon,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react';

/** Backend engine metadata names a lucide icon; resolve it here. */
const ICONS: Record<string, LucideIcon> = {
  'volume-2': Volume2,
  'sliders-horizontal': SlidersHorizontal,
  'audio-lines': AudioLines,
  sparkles: Sparkles,
  zap: Zap,
  cpu: Cpu,
};

export function engineIcon(name?: string): LucideIcon {
  return (name && ICONS[name]) || Volume2;
}
