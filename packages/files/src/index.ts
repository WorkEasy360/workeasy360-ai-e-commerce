/**
 * @workeasy/files: server-only upload handling for the Media Library.
 * Never import from browser code; it holds storage credentials.
 */
export { detectType, imageSize, kindForDeclaredType, MEDIA_RULES, safeFileName, SNIFF_BYTES, type MediaKind } from "./detect.js";
export { MEDIA_SCAN_JOB, mediaScanJob, type MediaScanDeps } from "./media-scan.js";
export { parseClamdReply, pingScanner, scanStream, ScannerUnavailableError, type ScannerConfig, type ScanResult } from "./scanner.js";
export { attachmentDisposition, createObjectStore, type ObjectInfo, type ObjectStore, type ObjectStoreConfig } from "./storage.js";
