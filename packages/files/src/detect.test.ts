import { describe, expect, it } from "vitest";
import { detectType, imageSize, safeFileName } from "./detect.js";
import { parseClamdReply, ScannerUnavailableError } from "./scanner.js";
import { attachmentDisposition } from "./storage.js";

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpeg(width: number, height: number): Buffer {
  // SOI, an APP0 segment, then a baseline SOF0 frame header.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

describe("file type detection", () => {
  it("recognises media from its bytes", () => {
    expect(detectType(png(1, 1))).toBe("image/png");
    expect(detectType(jpeg(1, 1))).toBe("image/jpeg");
    expect(detectType(Buffer.from("GIF89a\x10\x00\x20\x00", "latin1"))).toBe("image/gif");
    expect(detectType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(detectType(Buffer.from("\0\0\0\x18ftypisom", "latin1"))).toBe("video/mp4");
    expect(detectType(Buffer.from("\0\0\0\x14ftypqt  ", "latin1"))).toBe("video/quicktime");
    expect(detectType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe("video/webm");
    expect(detectType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectType(Buffer.from("ID3\x04", "latin1"))).toBe("audio/mpeg");
    expect(detectType(Buffer.from("Plain text, café ✓"))).toBe("text/plain");
  });

  it("tells EPUB from other ZIP archives", () => {
    const zip = (name: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(name, "latin1")]);
    expect(detectType(zip("mimetypeapplication/epub+zip"))).toBe("application/epub+zip");
    expect(detectType(zip("payload.exe"))).toBe("application/zip");
  });

  it("does not trust names or declared types", () => {
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe("application/octet-stream");
    expect(detectType(Buffer.from("<svg onload=alert(1)>"))).toBe("text/plain");
  });
});

describe("image size", () => {
  it("reads PNG, JPEG, GIF and WebP dimensions", () => {
    expect(imageSize(png(1200, 800), "image/png")).toEqual({ width: 1200, height: 800 });
    expect(imageSize(jpeg(640, 480), "image/jpeg")).toEqual({ width: 640, height: 480 });
    expect(imageSize(Buffer.from("GIF89a\x10\x00\x20\x00", "latin1"), "image/gif")).toEqual({ width: 16, height: 32 });
    const vp8x = Buffer.alloc(30);
    vp8x.write("RIFF", 0, "latin1");
    vp8x.write("WEBPVP8X", 8, "latin1");
    vp8x.writeUIntLE(1919, 24, 3);
    vp8x.writeUIntLE(1079, 27, 3);
    expect(imageSize(vp8x, "image/webp")).toEqual({ width: 1920, height: 1080 });
  });

  it("gives up on truncated headers instead of guessing", () => {
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBeUndefined();
    expect(imageSize(Buffer.alloc(4), "image/png")).toBeUndefined();
  });
});

describe("safe file names", () => {
  it("keeps the base name only, without control or reserved characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(safeFileName('a<b>:"c|?*\u0000d.txt')).toBe("a_b___c____d.txt");
    expect(safeFileName("...hidden")).toBe("hidden");
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("x".repeat(300) + ".txt")).toHaveLength(200);
  });

  it("builds an attachment header that is safe and keeps Unicode names", () => {
    expect(attachmentDisposition('résumé "final".pdf')).toBe(`attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf`);
  });
});

describe("clamd replies", () => {
  it("reads clean and infected verdicts", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ status: "clean" });
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ status: "infected", signature: "Win.Test.EICAR_HDB-1" });
  });

  it("treats anything else as the scanner being unavailable, never as clean", () => {
    expect(() => parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toThrow(ScannerUnavailableError);
    expect(() => parseClamdReply("")).toThrow(ScannerUnavailableError);
  });
});
