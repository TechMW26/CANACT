/** Visual filter presets shared by Story and Reel editors and viewers.
 * Values are valid CSS `filter` strings — applied via inline style at
 * preview time and again at playback time on the consumer side. */
export type MediaFilterId =
  | 'none'
  | 'vivid'
  | 'mono'
  | 'noir'
  | 'warm'
  | 'cool'
  | 'fade'
  | 'vintage'
  | 'clarity'
  | 'dream';

export interface MediaFilter {
  id: MediaFilterId;
  label: string;
  /** CSS `filter` value. `none` ⇒ '' so render code can simply spread. */
  css: string;
}

export const MEDIA_FILTERS: MediaFilter[] = [
  { id: 'none',    label: 'Original', css: '' },
  { id: 'vivid',   label: 'Vivid',    css: 'saturate(1.45) contrast(1.08)' },
  { id: 'clarity', label: 'Clarity',  css: 'contrast(1.18) brightness(1.04) saturate(1.1)' },
  { id: 'warm',    label: 'Warm',     css: 'sepia(0.18) saturate(1.25) hue-rotate(-10deg) brightness(1.04)' },
  { id: 'cool',    label: 'Cool',     css: 'saturate(1.1) hue-rotate(12deg) brightness(1.02)' },
  { id: 'fade',    label: 'Fade',     css: 'contrast(0.92) saturate(0.85) brightness(1.06)' },
  { id: 'vintage', label: 'Vintage',  css: 'sepia(0.45) contrast(1.05) saturate(0.9)' },
  { id: 'mono',    label: 'Mono',     css: 'grayscale(1) contrast(1.05)' },
  { id: 'noir',    label: 'Noir',     css: 'grayscale(1) contrast(1.35) brightness(0.92)' },
  { id: 'dream',   label: 'Dream',    css: 'blur(0.4px) brightness(1.07) saturate(1.15)' },
];

export function filterCss(id?: string | null): string {
  if (!id || id === 'none') return '';
  return MEDIA_FILTERS.find((f) => f.id === id)?.css ?? '';
}
