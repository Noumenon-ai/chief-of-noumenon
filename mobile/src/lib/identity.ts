// A stable look for an agent, derived from its id: the same colour and letter as on the web
// (frontend/lib/identity.ts and its --identity-1 .. --identity-10 tokens). Plain TypeScript with no React
// Native imports. `theme-drift.test.ts` checks the colours against globals.css and runs this and the web
// function side by side, so the two cannot drift.

/** The web's ten agent colours. White text on each holds 4.5:1 (checked in `theme.test.tsx`), in both looks. */
export const IDENTITY_COLORS = ['#5b3fd6', '#176b55', '#b33265', '#285fc4', '#a02670', '#7541b0', '#0e697a', '#a32d46', '#4358ab', '#7f309c'] as const;

/** The text colour on an agent colour; the web writes `text-white` there. */
export const ON_IDENTITY = '#ffffff';

export const IDENTITY_COUNT = IDENTITY_COLORS.length;

export function identityIndex(id: number | string): number {
  const text = String(id);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % IDENTITY_COUNT;
}

export function identityColor(id: number | string): string {
  return IDENTITY_COLORS[identityIndex(id)];
}

/** The first letter or digit of a name, upper-cased; "?" when there is none. */
export function initialOf(name: string | null | undefined): string {
  for (const char of (name ?? '').trim()) {
    if (/[\p{L}\p{N}]/u.test(char)) return char.toUpperCase();
  }
  return '?';
}
