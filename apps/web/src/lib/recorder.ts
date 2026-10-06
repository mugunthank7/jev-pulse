import { applyPalette, GIFEncoder, quantize } from "gifenc";

export type Recording = { gif: Blob; video: Blob; videoExt: "mp4" | "webm"; seconds: number };

const VIDEO_TYPES = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

/**
 * Records THIS TAB (the website itself) to both a GIF and a video file.
 *  - The browser asks the user to share the tab (getDisplayMedia); nothing is captured without that consent.
 *  - Frames are drawn from the live stream onto a canvas at `fps` and encoded to GIF in the browser (gifenc),
 *    while a MediaRecorder saves a higher-quality video of the same stream (MP4 where the browser supports it,
 *    which LinkedIn accepts; otherwise WebM).
 */
export async function beginRecording(opts: { fps?: number; width?: number } = {}): Promise<{ stop: () => Promise<Recording> }> {
  const fps = opts.fps ?? 10;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);

  const video = document.createElement("video");
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  for (let i = 0; i < 50 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 40));
  if (!video.videoWidth) { stream.getTracks().forEach((t) => t.stop()); throw new Error("No video frames from the shared tab."); }

  const width = Math.min(opts.width ?? 800, video.videoWidth);
  const height = Math.round((width * video.videoHeight) / video.videoWidth);
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const t0 = performance.now();
  const tick = window.setInterval(() => {
    ctx.drawImage(video, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: Math.round(1000 / fps) });
  }, 1000 / fps);

  const mimeType = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(250);

  return {
    stop: async () => {
      clearInterval(tick);
      const done = new Promise<void>((r) => { rec.onstop = () => r(); });
      rec.stop(); await done;
      stream.getTracks().forEach((t) => t.stop());
      gif.finish();
      const type = rec.mimeType || "video/webm";
      return { gif: new Blob([gif.bytes() as BlobPart], { type: "image/gif" }), video: new Blob(chunks, { type }), videoExt: type.includes("mp4") ? "mp4" : "webm", seconds: (performance.now() - t0) / 1000 };
    },
  };
}

export const mb = (b: Blob) => `${(b.size / 1048576).toFixed(1)} MB`;
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
