import { getFontEmbedCSS, toBlob } from "html-to-image";

// 1×1 transparent PNG: what html-to-image draws if an image can't be fetched
// at capture time, instead of failing the whole export.
const TRANSPARENT_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// The Sofia Sans @font-face CSS, built once per page load. Without this,
// html-to-image re-fetches and re-inserts every font file on each export,
// so each export is slower and bigger than the last.
let fontCss: Promise<string> | null = null;

/**
 * Renders a Kit card element to a PNG File (2026-10-07). Waits for fonts and
 * images first: capturing before Sofia Sans loads silently falls back to a
 * system font in the image.
 */
export async function renderCard(el: HTMLElement, fileName: string): Promise<File> {
  await document.fonts.ready;
  await Promise.all(
    Array.from(el.querySelectorAll("img")).map(async (img) => {
      try {
        if (!img.complete) await new Promise((resolve, reject) => ((img.onload = resolve), (img.onerror = reject)));
        await img.decode();
      } catch {
        img.style.display = "none";
      }
    })
  );
  fontCss ??= getFontEmbedCSS(el).catch(() => "");
  const blob = await toBlob(el, {
    pixelRatio: 1,
    fontEmbedCSS: await fontCss,
    imagePlaceholder: TRANSPARENT_PIXEL,
    // A hidden (failed) photo is left out entirely rather than re-fetched.
    filter: (node) => !(node instanceof HTMLImageElement && node.style.display === "none"),
  });
  if (!blob) throw new Error("Image export returned nothing");
  return new File([blob], fileName, { type: "image/png" });
}

export type ShareResult = "shared" | "downloaded" | "cancelled" | "needsTap";

/**
 * Opens the share sheet with the file, or downloads it where sharing files
 * isn't supported. Phones only allow share() for a few seconds after a tap;
 * if rendering took longer, the browser refuses with NotAllowedError and the
 * caller should offer a second tap that calls this again straight away.
 */
export async function shareFile(file: File): Promise<ShareResult> {
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      if (err instanceof DOMException && err.name === "NotAllowedError") return "needsTap";
      throw err;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
