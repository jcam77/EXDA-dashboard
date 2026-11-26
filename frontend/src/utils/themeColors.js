// Theme colours as real colour values, for drawing on a canvas (uPlot) or in
// SVG/inline styles that cannot use Tailwind classes. Values come from the
// theme tokens in index.css, so they follow the light/dark switch.
import { useEffect, useState } from 'react';

export const SERIES_COUNT = 8;

const readVar = (name) => {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
};

// themeColor('primary', 0.12) -> "hsl(192 70% 62% / 0.12)"; fallback if the token is missing.
export const themeColor = (name, alpha = 1, fallback = 'currentColor') => {
  const value = readVar(name);
  if (!value) return fallback;
  return alpha < 1 ? `hsl(${value} / ${alpha})` : `hsl(${value})`;
};

// 'hsl(var(--series-1))' -> 'hsl(213 77% 56%)': a CSS colour that uses theme
// variables, turned into a value a canvas can draw with.
export const resolveColor = (color) => String(color || '').replace(/var\(--([\w-]+)\)/g, (_m, name) => readVar(name) || '0 0% 50%');

// Series colours as CSS (for HTML and SVG), in the order of the theme tokens.
export const SERIES_CSS = Array.from({ length: 8 }, (_, i) => `hsl(var(--series-${i + 1}))`);

// The plot series colours in order (--series-1 ... --series-8).
export const seriesColors = () => Array.from({ length: SERIES_COUNT }, (_, i) => themeColor(`series-${i + 1}`, 1, '#888888'));

// Changes whenever the light/dark class on <html> changes, so canvas plots can redraw.
export const useThemeKey = () => {
  const read = () => (typeof document === 'undefined' ? '' : document.documentElement.className);
  const [key, setKey] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setKey(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return key;
};
