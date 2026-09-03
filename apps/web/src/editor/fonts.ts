// Curated font stacks offered in the text inspector. Each entry's `value`
// is written verbatim into the canvas `font` string, so it must be a valid
// CSS font-family list with a generic fallback.
export interface FontOption {
  readonly label: string;
  readonly value: string;
}

export const DEFAULT_TEXT_FONT =
  "'Pretendard Variable', 'Apple SD Gothic Neo', sans-serif";

export const FONT_OPTIONS: readonly FontOption[] = [
  {
    label: "Pretendard (한국어)",
    value: DEFAULT_TEXT_FONT,
  },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "System UI", value: "system-ui, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Impact", value: "Impact, Haettenschweiler, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', cursive" },
];

export const FONT_WEIGHTS: readonly { readonly label: string; readonly value: number }[] = [
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "Black", value: 900 },
];
