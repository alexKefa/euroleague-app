import { KitCardOptions, drawKitCard } from "./kit-canvas";

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * Draws the card on an offscreen canvas and returns it as a PNG File
 * (2026-10-07). If the photo ever taints the canvas (the CDN dropped its
 * CORS header), export fails with SecurityError; redraw without the photo
 * rather than fail the whole share.
 */
export async function renderCard(options: KitCardOptions, fileName: string): Promise<File> {
  const canvas = document.createElement("canvas");
  await drawKitCard(canvas, options);
  let blob: Blob | null;
  try {
    blob = await toBlob(canvas);
  } catch {
    await drawKitCard(canvas, options, false);
    blob = await toBlob(canvas);
  }
  if (!blob) throw new Error("Image export returned nothing");
  return new File([blob], fileName, { type: "image/png" });
}

export type ShareResult = "shared" | "downloaded" | "cancelled" | "needsTap";

/**
 * Opens the share sheet with the file, or downloads it where sharing files
 * isn't supported. Phones only allow share() for a few seconds after a tap;
 * if rendering took longer, the browser refuses with NotAllowedError and the
 * caller offers a second tap that calls this again straight away.
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
