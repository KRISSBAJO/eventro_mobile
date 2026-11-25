/** Browser version of theme-store.ts: the appearance choice in localStorage. */
const KEY = 'eventro-app:appearance';

export function readAppearance(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeAppearance(value: string) {
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    /* storage blocked: the choice applies for this visit only */
  }
}
