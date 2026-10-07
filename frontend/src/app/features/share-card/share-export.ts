import { toBlob } from "html-to-image";

/**
 * Turns a rendered Kit card into a PNG and hands it to the phone's share
 * sheet, or downloads it where sharing files isn't supported (2026-10-07).
 * Fonts and images are awaited first: capturing before Sofia Sans loads
 * silently falls back to a system font in the image. An image that failed to
 * load is hidden, so the card still exports without the photo.
 */
export async function exportCard(el: HTMLElement, fileName: string): Promise<"shared" | "downloaded" | "cancelled"> {
  await document.fonts.ready;
  const images = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      try {
        if (!img.complete) await new Promise((resolve, reject) => ((img.onload = resolve), (img.onerror = reject)));
        await img.decode();
      } catch {
        img.style.display = "none";
      }
    })
  );

  const blob = await toBlob(el, { pixelRatio: 1, cacheBust: true });
  if (!blob) throw new Error("Image export returned nothing");
  const file = new File([blob], fileName, { type: "image/png" });

  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      throw err;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
