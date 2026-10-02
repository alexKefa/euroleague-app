import { Pipe, PipeTransform } from "@angular/core";

// Player/card photos come from EuroLeague's media CDN as 750x1000 originals,
// but are shown anywhere from ~32px avatars to ~340px cards. Left to the
// browser, that big one-pass downscale smears small dark details (light-eyed
// players got white eyes on small cards, 2026-10-02) and every avatar
// downloads ~590 KB. The CDN resizes on request (?width=), so ask for close
// to the rendered size and let srcset pick a sharper one on high-DPI screens.

const CDN_PREFIX = "https://media-cdn.cortextech.io/";
const WIDTHS = [80, 160, 240, 320, 480];
const ORIGINAL_WIDTH = 750;

export interface CdnImage {
  src: string;
  srcset: string | null;
  sizes: string | null;
}

/** `cssWidth` is the largest width (CSS px) the image renders at. */
export function cdnImage(url: string, cssWidth: number): CdnImage {
  if (!url.startsWith(CDN_PREFIX)) return { src: url, srcset: null, sizes: null };
  const sized = (w: number) => `${url}${url.includes("?") ? "&" : "?"}width=${w}`;
  // Fallback src for browsers that ignore srcset: enough for a 2x screen.
  const fallback = WIDTHS.find((w) => w >= cssWidth * 2) ?? WIDTHS[WIDTHS.length - 1];
  return {
    src: sized(fallback),
    srcset: [...WIDTHS.map((w) => `${sized(w)} ${w}w`), `${url} ${ORIGINAL_WIDTH}w`].join(", "),
    sizes: `${Math.round(cssWidth)}px`,
  };
}

/** `[src]="url | cdnSized: 36"` — a single 2x-sized src, for small avatars. */
@Pipe({ name: "cdnSized", standalone: true })
export class CdnSizedPipe implements PipeTransform {
  transform(url: string | null | undefined, cssWidth: number): string | null {
    return url ? cdnImage(url, cssWidth).src : null;
  }
}
