// Round clips draw logos and player photos onto a canvas that gets recorded.
// Those images live on EuroLeague's CDN, and a cross-origin image would
// taint the canvas and block recording, so the endpoint inlines them as
// data URIs. Cached in memory by URL: logos repeat on every clip.

const cache = new Map<string, string>();

/** The image at `url` as a data URI, or null when there's no URL, it fails, times out, or isn't an image. */
export async function imageToDataUri(url: string | null, timeoutMs = 4000): Promise<string | null> {
  if (!url) return null;
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const uri = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    cache.set(url, uri);
    return uri;
  } catch {
    return null;
  }
}
