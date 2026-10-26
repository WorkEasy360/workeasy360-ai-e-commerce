/**
 * File type from content, not from the name or the declared Content-Type.
 * Only the types the Media Library accepts are recognised; anything else is
 * "application/octet-stream" and is refused.
 */

/** How many leading bytes detection and image-size reading need. */
export const SNIFF_BYTES = 64 * 1024;

const startsWith = (head: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
const ascii = (head: Buffer, start: number, end: number) => head.subarray(start, end).toString("latin1");

function looksLikeText(head: Buffer): boolean {
  if (head.length === 0 || head.includes(0)) return false;
  try {
    // Valid UTF-8; a multi-byte character cut at the end of the sample is fine.
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 3)));
    return true;
  } catch {
    return false;
  }
}

export function detectType(head: Buffer): string {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    // EPUB stores an uncompressed "mimetype" entry first.
    return ascii(head, 30, 58) === "mimetypeapplication/epub+zip" ? "application/epub+zip" : "application/zip";
  }
  if (ascii(head, 0, 3) === "ID3" || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";
  if (looksLikeText(head)) return "text/plain";
  return "application/octet-stream";
}

/** Pixel size of a PNG, GIF, JPEG or WebP from its leading bytes; undefined if it can't be read. */
export function imageSize(head: Buffer, type: string): { width: number; height: number } | undefined {
  try {
    if (type === "image/png" && ascii(head, 12, 16) === "IHDR") return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    if (type === "image/gif") return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    if (type === "image/webp") {
      const chunk = ascii(head, 12, 16);
      if (chunk === "VP8X") return { width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3) };
      if (chunk === "VP8L") {
        const bits = head.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
      if (chunk === "VP8 ") return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
    }
    if (type === "image/jpeg") {
      // Walk the segments to the first start-of-frame marker.
      let offset = 2;
      while (offset + 9 < head.length) {
        if (head[offset] !== 0xff) return undefined;
        const marker = head[offset + 1]!;
        const length = head.readUInt16BE(offset + 2);
        const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) return { width: head.readUInt16BE(offset + 7), height: head.readUInt16BE(offset + 5) };
        offset += 2 + length;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type MediaKind = "image" | "video" | "file";

/**
 * What each kind of upload may be, and how large. The limits stay under the
 * scanner's 25 MiB stream limit. Digital products' files cover the usual
 * formats sellers deliver: documents, e-books, archives, audio and video.
 */
export const MEDIA_RULES: Record<MediaKind, { types: readonly string[]; maxBytes: number }> = {
  image: { types: ["image/jpeg", "image/png", "image/gif", "image/webp"], maxBytes: 20 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/webm", "video/quicktime"], maxBytes: 25 * 1024 * 1024 - 1 },
  file: {
    types: ["application/pdf", "application/epub+zip", "application/zip", "audio/mpeg", "video/mp4", "image/jpeg", "image/png", "text/plain"],
    maxBytes: 25 * 1024 * 1024 - 1,
  },
};

/** The kind an upload declares itself as, from its declared type; files are chosen explicitly. */
export function kindForDeclaredType(declared: string): MediaKind | undefined {
  if (MEDIA_RULES.image.types.includes(declared)) return "image";
  if (MEDIA_RULES.video.types.includes(declared)) return "video";
  return undefined;
}

/**
 * A display name safe to store and to offer in a download: no path, no
 * control characters, bounded length. The storage key never uses it.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // Control characters are exactly what this removes.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const limited = cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
  return limited || "file";
}
