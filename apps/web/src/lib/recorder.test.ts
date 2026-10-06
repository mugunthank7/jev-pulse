import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { describe, expect, it } from "vitest";

describe("gif encoder (used by the in-browser recorder)", () => {
  it("produces a valid multi-frame GIF from RGBA frames", () => {
    const w = 8, h = 8, gif = GIFEncoder();
    for (const rgb of [[255, 120, 120], [120, 200, 255]]) {
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) rgba.set([...rgb, 255], i * 4);
      const palette = quantize(rgba, 16);
      gif.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: 100 });
    }
    gif.finish();
    const bytes = gif.bytes();
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b); // GIF trailer
    expect(bytes.length).toBeGreaterThan(40);
  });
});
