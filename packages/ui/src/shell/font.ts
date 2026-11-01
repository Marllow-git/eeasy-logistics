import localFont from 'next/font/local';

/**
 * IBM Plex Sans Arabic (OFL, fonts/OFL.txt), weights 400 and 600, the official unmodified woff2
 * files of `@ibm/plex-sans-arabic` 1.1.0 (`fonts/complete/woff2`; lead ruling on WEB-1 §8.2 #17:
 * no subset, so the Reserved Font Name stays intact), self-hosted (web §10.1): no third-party font
 * origin. The CSS variable feeds the `--font-sans` token in tokens.css, so a brand font (web
 * §12.1) is a change to this file and that token.
 */
export const plex = localFont({
  src: [
    { path: '../../fonts/IBMPlexSansArabic-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/IBMPlexSansArabic-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'sans-serif'],
});
