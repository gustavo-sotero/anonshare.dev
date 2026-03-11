import { S3Client } from 'bun';
import { storage as storageCfg } from '../config/index';

export interface StorageObject {
  key: string;
  body: ReadableStream | Uint8Array;
  contentType: string;
  contentLength?: number;
}

let client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!client) {
    client = new S3Client({
      accessKeyId: storageCfg.accessKeyId(),
      bucket: storageCfg.bucket(),
      endpoint: storageCfg.endpoint(),
      region: storageCfg.region(),
      secretAccessKey: storageCfg.secretAccessKey(),
      // Keep path-style addressing as the default for MinIO and generic S3-compatible endpoints.
      virtualHostedStyle: false
    });
  }

  return client;
}

function getStorageFile(key: string) {
  return getS3Client().file(key);
}

function toWritableBody(body: StorageObject['body']): Uint8Array | Response {
  return body instanceof ReadableStream ? new Response(body) : body;
}

export const storageAdapter = {
  /**
   * Verify that the configured bucket is reachable and can persist the reserved marker object.
   */
  async checkAccess(): Promise<void> {
    const marker = getStorageFile('.healthcheck');

    if (await marker.exists()) {
      await marker.stat();
      return;
    }

    await marker.write('', { type: 'text/plain;charset=utf-8' });
  },

  /**
   * Upload an object to the configured bucket.
   */
  async put(obj: StorageObject): Promise<void> {
    await getStorageFile(obj.key).write(toWritableBody(obj.body), {
      type: obj.contentType
    });
  },

  /**
   * Get an object's readable stream from the bucket.
   */
  async get(key: string): Promise<ReadableStream | null> {
    const file = getStorageFile(key);

    if (!(await file.exists())) {
      return null;
    }

    return file.stream();
  },

  /**
   * Check whether an object exists without fetching its body.
   */
  async exists(key: string): Promise<boolean> {
    return getStorageFile(key).exists();
  },

  /**
   * Delete an object from the bucket. Safe to call on missing keys.
   */
  async delete(key: string): Promise<void> {
    const file = getStorageFile(key);

    if (!(await file.exists())) {
      return;
    }

    await file.delete();
  },

  /**
   * Return basic metadata for an object without fetching its body.
   * Returns null when the object does not exist.
   */
  async head(key: string): Promise<{ contentType: string; contentLength: number } | null> {
    const file = getStorageFile(key);

    if (!(await file.exists())) {
      return null;
    }

    const stats = await file.stat();

    return {
      contentLength: stats.size,
      contentType: stats.type || 'application/octet-stream'
    };
  },

  /**
   * Generate a presigned GET URL valid for the given number of seconds.
   */
  async presignedGet(key: string, expiresInSeconds: number): Promise<string> {
    return getStorageFile(key).presign({
      expiresIn: expiresInSeconds,
      method: 'GET'
    });
  }
};
