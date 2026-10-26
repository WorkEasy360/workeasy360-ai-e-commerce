import type { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Private S3-compatible storage for uploads. Browsers write only to the
 * quarantine bucket, through short-lived presigned PUTs; files reach the
 * media bucket only after the worker has checked and scanned them, and leave
 * it only through short-lived presigned GETs.
 */
export interface ObjectStoreConfig {
  /** Where the servers reach storage; undefined means Amazon S3 in `region`. */
  endpoint?: string | undefined;
  /** Where browsers reach storage; presigned URLs are signed for this host. Undefined: as `endpoint`. */
  publicEndpoint?: string | undefined;
  region: string;
  /**
   * Static credentials for S3-compatible storage. Without them the AWS SDK's
   * default chain is used: on EC2, the instance's IAM role (no stored keys).
   */
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  quarantineBucket: string;
  /** Scanned media: product images, videos and digital products' files. */
  mediaBucket: string;
  /** Generated exports. */
  exportsBucket: string;
}

export interface ObjectInfo {
  bytes: number;
  contentType: string | undefined;
}

export interface ObjectStore {
  readonly quarantineBucket: string;
  readonly mediaBucket: string;
  readonly exportsBucket: string;
  /** A URL the browser can PUT exactly this object to, with this type and size, until it expires. */
  presignUpload(key: string, contentType: string, bytes: number, expiresInSeconds: number): Promise<string>;
  /** A URL that downloads an object (from the media bucket unless given) as an attachment with a safe name, until it expires. */
  presignDownload(key: string, fileName: string, contentType: string, expiresInSeconds: number, bucket?: string): Promise<string>;
  /** A URL that shows a media object inline (images, video), until it expires. */
  presignView(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** Stores a server-generated object (exports). */
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  head(bucket: string, key: string): Promise<ObjectInfo | undefined>;
  read(bucket: string, key: string): Promise<Readable>;
  /** Moves a scanned object from quarantine to the media bucket. */
  promote(key: string): Promise<void>;
  remove(bucket: string, key: string): Promise<void>;
}

function client(config: ObjectStoreConfig, endpoint: string | undefined): S3Client {
  return new S3Client({
    region: config.region,
    // Self-hosted S3-compatible storage needs path-style URLs; Amazon S3 uses its own addresses.
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(config.accessKeyId && config.secretAccessKey ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } } : {}),
  });
}

const isNotFound = (err: unknown) =>
  err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 404 || err.name === "NotFound" || err.name === "NoSuchKey");

/** RFC 6266 attachment header with an ASCII fallback and the UTF-8 name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createObjectStore(config: ObjectStoreConfig): ObjectStore {
  const internal = client(config, config.endpoint);
  const browser = client(config, config.publicEndpoint ?? config.endpoint);
  return {
    quarantineBucket: config.quarantineBucket,
    mediaBucket: config.mediaBucket,
    exportsBucket: config.exportsBucket,

    presignUpload(key, contentType, bytes, expiresInSeconds) {
      // Type and length are signed, so the browser cannot store anything else under this key.
      return getSignedUrl(browser, new PutObjectCommand({ Bucket: config.quarantineBucket, Key: key, ContentType: contentType, ContentLength: bytes }), {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
    },

    presignView(key, contentType, expiresInSeconds) {
      return getSignedUrl(
        browser,
        new GetObjectCommand({ Bucket: config.mediaBucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: "inline" }),
        { expiresIn: expiresInSeconds },
      );
    },

    presignDownload(key, fileName, contentType, expiresInSeconds, bucket = config.mediaBucket) {
      return getSignedUrl(
        browser,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: attachmentDisposition(fileName),
          ResponseContentType: contentType,
        }),
        { expiresIn: expiresInSeconds },
      );
    },

    async head(bucket, key) {
      try {
        const res = await internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },

    async read(bucket, key) {
      const res = await internal.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return res.Body as Readable;
    },

    async promote(key) {
      await internal.send(new CopyObjectCommand({ Bucket: config.mediaBucket, Key: key, CopySource: `${config.quarantineBucket}/${encodeURIComponent(key)}` }));
      await internal.send(new DeleteObjectCommand({ Bucket: config.quarantineBucket, Key: key }));
    },

    async put(bucket, key, body, contentType) {
      await internal.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
    },

    async remove(bucket, key) {
      await internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
