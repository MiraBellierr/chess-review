/**
 * The interface icon set: plain geometry in the 24-box, one stroke weight and
 * round joins, so the whole set reads as one hand.
 *
 * (The move-label marks once drawn here retired when the review's class badges
 * became vendored art — see `src/assets/classifications/index.ts` and
 * `CREDITS.md`.)
 */

export type UiIconName =
  | 'start'
  | 'prev'
  | 'next'
  | 'end'
  | 'flip'
  | 'arrow'
  | 'explore'
  | 'check'
  | 'alert'
  | 'plus'
  | 'download';

const UI_PATHS: Record<UiIconName, string> = {
  start: 'M6.8 6v12M17.4 6.6v10.8L9.8 12z',
  prev: 'M15.8 6.6v10.8L8.2 12z',
  next: 'M8.2 6.6v10.8L15.8 12z',
  end: 'M17.2 6v12M6.6 6.6v10.8L14.2 12z',
  flip: 'M12 4.6v14.8M8.4 8.2 12 4.6l3.6 3.6M8.4 15.8 12 19.4l3.6-3.6',
  arrow: 'M4.8 19.2 17.6 6.4M10.4 6.4h7.2v7.2',
  explore: 'M10.6 4.6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l4.4 4.4',
  check: '<circle cx="12" cy="12" r="8.8"/><path d="M8.4 12.3l2.4 2.4 4.8-5.4"/>',
  alert: 'M12 4.4 20.2 19H3.8zM12 10.2v3.6M12 16.6h.01',
  plus: 'M12 5.6v12.8M5.6 12h12.8',
  download: 'M12 4.8v9.6M7.8 10.6l4.2 4.2 4.2-4.2M5.6 19.2h12.8',
};

function Svg({
  inner,
  size,
  strokeWidth,
}: {
  inner: string;
  size: number;
  strokeWidth: number;
}) {
  // Entries are either a bare path `d` or full markup (for circle-based marks).
  const html = inner.trimStart().startsWith('<') ? inner : `<path d="${inner}"/>`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function Icon({ name, size = 20 }: { name: UiIconName; size?: number }) {
  return <Svg inner={UI_PATHS[name]} size={size} strokeWidth={1.8} />;
}
