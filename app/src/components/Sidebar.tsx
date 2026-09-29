import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  AudioLines,
  BrainCircuit,
  Captions,
  Images,
  type LucideIcon,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Volume2,
  Wand2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import voiceboxLogo from '@/assets/voicebox-logo.png';
import { ResourcesWidget } from '@/components/Sidebar/ResourcesWidget';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { cn } from '@/lib/utils/cn';
import { usePlatform } from '@/platform/PlatformContext';
import type { UpdateStatus } from '@/platform/types';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { version } from '../../package.json';

interface SidebarProps {
  isMacOS?: boolean;
}

const tabs: Array<{
  id: string;
  path: string;
  icon: LucideIcon;
  labelKey?: string;
  label?: string;
}> = [
  { id: 'main', path: '/', icon: Volume2, labelKey: 'nav.generate' },
  { id: 'gallery', path: '/gallery', icon: Images, labelKey: 'nav.gallery' },
  { id: 'stories', path: '/stories', icon: AudioLines, labelKey: 'nav.stories' },
  { id: 'captures', path: '/captures', icon: Captions, labelKey: 'nav.captures' },
  { id: 'voices', path: '/voices', icon: Mic, labelKey: 'nav.voices' },
  { id: 'effects', path: '/effects', icon: Wand2, labelKey: 'nav.effects' },
];

// Pinned to the bottom, as in the reference layout.
const footerTabs: typeof tabs = [
  { id: 'models', path: '/models', icon: BrainCircuit, labelKey: 'nav.manageModels' },
  { id: 'settings', path: '/settings', icon: SlidersHorizontal, labelKey: 'nav.settings' },
];

export const SIDEBAR_WIDTH = { expanded: '14rem', collapsed: '5rem' } as const;

export function Sidebar({ isMacOS }: SidebarProps) {
  const { t } = useTranslation();
  const matchRoute = useMatchRoute();
  const isPlayerOpen = !!usePlayerStore((s) => s.audioUrl);
  const platform = usePlatform();
  const userCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  // Small windows get the icon rail regardless of the saved preference.
  const narrow = useMediaQuery('(max-width: 1023px)');
  const collapsed = userCollapsed || narrow;

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(platform.updater.getStatus());
  useEffect(() => platform.updater.subscribe(setUpdateStatus), [platform.updater]);

  // Layout (main margin, floating boxes) reads the width from this variable.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded,
    );
  }, [collapsed]);

  const isActive = (path: string) =>
    path === '/' ? matchRoute({ to: '/', fuzzy: false }) : matchRoute({ to: path, fuzzy: true });

  const renderTab = (tab: (typeof tabs)[number]) => {
    const Icon = tab.icon;
    const active = isActive(tab.path);
    const label = tab.label ?? (tab.labelKey ? t(tab.labelKey) : tab.id);
    const link = (
      <Link
        key={tab.id}
        to={tab.path}
        aria-label={label}
        className={cn(
          'relative flex items-center gap-3 rounded-full text-sm font-medium transition-all duration-200',
          collapsed ? 'h-12 w-12 justify-center' : 'h-10 w-full px-4',
          active
            ? 'bg-white/[0.07] text-foreground shadow-lg backdrop-blur-sm border border-white/[0.08]'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
      >
        {active && (
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              maskImage: 'linear-gradient(to right, black, transparent 70%)',
              WebkitMaskImage: 'linear-gradient(to right, black, transparent 70%)',
              border: '1px solid hsl(var(--accent) / 0.4)',
            }}
          />
        )}
        <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="relative z-10 truncate">{label}</span>}
      </Link>
    );
    return collapsed ? (
      <SimpleTooltip key={tab.id} content={label} side="right">
        {link}
      </SimpleTooltip>
    ) : (
      link
    );
  };

  return (
    <div
      className={cn(
        'fixed left-0 top-0 flex h-full flex-col border-r border-border bg-sidebar py-6 transition-[width] duration-200',
        collapsed ? 'w-20 items-center px-0' : 'w-56 px-3',
        isMacOS && 'pt-14',
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn('mb-6 flex items-center gap-2', collapsed ? 'flex-col' : 'px-2')}>
        <img src={voiceboxLogo} alt="Voicebox" className="sidebar-logo h-10 w-10 object-contain" />
        {!collapsed && <span className="flex-1 text-base font-bold">Voicebox</span>}
        {!narrow && (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      <nav className={cn('flex flex-col gap-1.5', collapsed && 'items-center gap-3')}>
        {tabs.map(renderTab)}
      </nav>

      <div
        className={cn(
          'mt-auto flex flex-col gap-2 transition-all duration-300',
          collapsed && 'items-center',
        )}
        style={{ paddingBottom: isPlayerOpen ? '7rem' : undefined }}
      >
        <ResourcesWidget collapsed={collapsed} />
        <div className={cn('flex flex-col gap-1.5', collapsed && 'items-center gap-3')}>
          {footerTabs.map(renderTab)}
        </div>
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <span className="text-[10px] text-muted-foreground/50">v{version}</span>
          {updateStatus.available && (
            <Link
              to="/settings"
              className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent transition-colors hover:bg-accent/25"
            >
              {t('nav.updateBadge')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
