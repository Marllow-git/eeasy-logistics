'use client';

import { create } from 'qrcode';
import { useMemo } from 'react';
import { cn } from '../cn';

/** Light modules around the symbol (ISO/IEC 18004 asks for four). */
const quietZone = 4;

/** The dark modules of `value` as one SVG path, or undefined when it cannot be encoded. */
export function qrPath(value: string): { size: number; path: string } | undefined {
  let modules: { size: number; get: (row: number, column: number) => number | boolean };
  try {
    modules = create(value, { errorCorrectionLevel: 'M' }).modules;
  } catch {
    return undefined;
  }
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let column = 0; column < modules.size; column++) {
      if (modules.get(row, column)) parts.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`);
    }
  }
  return { size: modules.size + quietZone * 2, path: parts.join('') };
}

/**
 * A QR code drawn in the browser (WEB-2 plan 2.9, 2.10): `qrcode` computes the modules and React
 * draws them as one SVG path, so no markup string is injected and nothing leaves the page (the
 * value is an `otpauth://` URI with a TOTP secret: never logged, never in a URL). Dark on light in
 * both themes; QR codes never mirror.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const drawn = useMemo(() => qrPath(value), [value]);
  if (drawn === undefined) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${drawn.size} ${drawn.size}`}
      shapeRendering="crispEdges"
      className={cn('size-48 rounded-md bg-white', className)}
    >
      <rect width={drawn.size} height={drawn.size} fill="#ffffff" />
      <path d={drawn.path} fill="#000000" />
    </svg>
  );
}
