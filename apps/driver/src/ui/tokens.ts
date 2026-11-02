// The design tokens of ADR-0033 (packages/ui/src/tokens.css) ported to React Native values, so the
// driver kit and the web speak one palette. Light theme only, as on the web in wave 0; field use asks
// for 56 dp targets and high contrast (driver app §10).
export const colors = {
  background: '#ffffff',
  foreground: '#0f172a',
  surface: '#f8fafc',
  muted: '#f1f5f9',
  mutedForeground: '#475569',
  border: '#e2e8f0',
  input: '#64748b',
  primary: '#0b6b6b',
  primaryPressed: '#095757',
  primaryForeground: '#ffffff',
  danger: '#b42318',
  dangerForeground: '#ffffff',
  warning: '#8a4b00',
  warningForeground: '#ffffff',
  success: '#067647',
  successForeground: '#ffffff',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 4, md: 8, lg: 12, full: 9999 } as const;

/** Arabic glyphs need one step more line height than Latin (web §6.2). */
export const text = {
  title: { fontSize: 24, lineHeightAr: 42, lineHeightEn: 30, fontWeight: '600' },
  body: { fontSize: 17, lineHeightAr: 30, lineHeightEn: 25, fontWeight: '400' },
  small: { fontSize: 15, lineHeightAr: 26, lineHeightEn: 22, fontWeight: '400' },
} as const;

/** The minimum touch target in the field (driver app §10). */
export const touchTarget = 56;
