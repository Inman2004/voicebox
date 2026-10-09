import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

// Simplified 3:2 flags drawn in a 30×20 viewBox. Emoji flags don't render
// on Windows, so these are inline SVG.
const FLAGS: Record<string, ReactNode> = {
  US: (
    <>
      <rect width="30" height="20" fill="#fff" />
      {[0, 2, 4, 6].map((i) => (
        <rect key={i} y={i * (20 / 7)} width="30" height={20 / 7} fill="#b22234" />
      ))}
      <rect width="13" height={(20 / 7) * 4} fill="#3c3b6e" />
    </>
  ),
  GB: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#c8102e" strokeWidth="1.5" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.5" />
    </>
  ),
  ES: (
    <>
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </>
  ),
  FR: (
    <>
      <rect width="10" height="20" fill="#0055a4" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ef4135" />
    </>
  ),
  IT: (
    <>
      <rect width="10" height="20" fill="#009246" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ce2b37" />
    </>
  ),
  IN: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#ff9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.8" />
    </>
  ),
  JP: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#bc002d" />
    </>
  ),
  BR: (
    <>
      <rect width="30" height="20" fill="#009c3b" />
      <path d="M15 2 28 10 15 18 2 10z" fill="#ffdf00" />
      <circle cx="15" cy="10" r="4.2" fill="#002776" />
    </>
  ),
  CN: (
    <>
      <rect width="30" height="20" fill="#ee1c25" />
      <path d="M6 3.2 7.1 6.6H10.6L7.8 8.7 8.9 12.1 6 10 3.1 12.1 4.2 8.7 1.4 6.6H4.9z" fill="#ffff00" />
    </>
  ),
  KR: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <path d="M10 10a5 5 0 0 1 10 0z" fill="#cd2e3a" />
      <path d="M10 10a5 5 0 0 0 10 0z" fill="#0047a0" />
    </>
  ),
  DE: (
    <>
      <rect width="30" height="6.67" fill="#000" />
      <rect y="6.67" width="30" height="6.67" fill="#dd0000" />
      <rect y="13.33" width="30" height="6.67" fill="#ffce00" />
    </>
  ),
  RU: (
    <>
      <rect width="30" height="6.67" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039a6" />
      <rect y="13.33" width="30" height="6.67" fill="#d52b1e" />
    </>
  ),
};

/** Default country for a bare language code (profiles only store language). */
const LANGUAGE_COUNTRY: Record<string, string> = {
  en: 'US',
  es: 'ES',
  fr: 'FR',
  it: 'IT',
  hi: 'IN',
  ja: 'JP',
  pt: 'BR',
  zh: 'CN',
  ko: 'KR',
  de: 'DE',
  ru: 'RU',
};

/** Resolve "en-GB" → "GB", "ja" → "JP". */
export function countryFor(localeOrLanguage?: string | null): string | undefined {
  if (!localeOrLanguage) return undefined;
  const [lang, region] = localeOrLanguage.split('-');
  return region?.toUpperCase() ?? LANGUAGE_COUNTRY[lang.toLowerCase()];
}

interface FlagProps {
  /** A locale ("en-GB") or bare language code ("ja"). */
  locale?: string | null;
  className?: string;
  title?: string;
}

export function Flag({ locale, className, title }: FlagProps) {
  const country = countryFor(locale);
  const art = country ? FLAGS[country] : undefined;
  if (!art) {
    return <Globe className={cn('h-3 w-3 text-muted-foreground', className)} aria-label={title} />;
  }
  return (
    <svg
      viewBox="0 0 30 20"
      className={cn('h-2.5 w-[15px] shrink-0 rounded-[2px] ring-1 ring-black/10', className)}
      role="img"
      aria-label={title ?? country}
    >
      {art}
    </svg>
  );
}
