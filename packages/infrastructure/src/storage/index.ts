import { S3Client } from 'bun';
import { storage as storageCfg } from '../config/index';

export interface StorageObject {
  key: string;
  body: ReadableStream | Uint8Array;
  contentType: string;
  contentLength?: number;
}

export type StorageHeadObject = {
  contentType: string;
  contentLength: number;
};

export type StorageSignedUrlMethod = 'GET' | 'PUT' | 'DELETE' | 'HEAD' | 'POST';

export type StorageSignedUrlOptions = {
  expiresInSeconds: number;
  method?: StorageSignedUrlMethod;
};

type StorageFileLike = {
  exists(): Promise<boolean>;
  stat(): Promise<{ size: number; type?: string }>;
  write(body: string | Uint8Array | Response, options?: { type?: string }): Promise<unknown>;
  stream(): ReadableStream;
  delete(): Promise<unknown>;
  presign(options: { expiresIn: number; method: StorageSignedUrlMethod }): string | Promise<string>;
};

type StorageTimeouts = {
  writeMs: number;
  readMs: number;
  metaMs: number;
};

type StorageRetryPolicy = {
  attempts: number;
  delayMs: number;
};

type CreateStorageAdapterOptions = {
  getFile?: (key: string) => StorageFileLike;
  timeouts?: Partial<StorageTimeouts>;
};

export interface StorageAdapter {
  checkAccess(): Promise<void>;
  put(obj: StorageObject): Promise<void>;
  putObject(obj: StorageObject): Promise<void>;
  get(key: string): Promise<ReadableStream | null>;
  getObject(key: string): Promise<ReadableStream | null>;
  exists(key: string): Promise<boolean>;
  objectExists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  head(key: string): Promise<StorageHeadObject | null>;
  headObject(key: string): Promise<StorageHeadObject | null>;
  createSignedUrl(key: string, options: StorageSignedUrlOptions): Promise<string>;
  presignedGet(key: string, expiresInSeconds: number): Promise<string>;
}

/**
 * Discriminated error thrown by every storageAdapter operation.
 *
 * `kind` values:
 * - `transient`  — network glitch, timeout, throttling; safe to retry.
 * - `permanent`  — auth/permission, bucket misconfiguration; retrying will not help.
 * - `not_found`  — the requested object does not exist (only thrown when existence
 *                  is a semantic requirement of the operation, e.g. stat without
 *                  an existence pre-check).
 *
 * Callers (upload handler, reconciler, admin dashboard) can use
 * `instanceof StorageError` without importing any provider-specific symbols.
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly kind: 'transient' | 'permanent' | 'not_found',
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'StorageError';
  }
}

/**
 * Classify a raw provider error into a typed StorageError.
 *
 * Classification heuristics (conservative — defaults to transient so that
 * unknown errors are retried rather than silently discarded):
 * - "timed out" → transient  (our own withTimeout wrapper)
 * - HTTP 404 / "not found"   → not_found
 * - HTTP 401/403 / auth terms → permanent
 * - everything else           → transient
 */
function classifyStorageError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;

  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('timed out')) {
    return new StorageError(msg, 'transient', err);
  }

  if (/\b404\b|not.?found/i.test(msg)) {
    return new StorageError(msg, 'not_found', err);
  }

  if (/\b40[13]\b|forbidden|unauthorized|invalid.*credential|access.?denied/i.test(msg)) {
    return new StorageError(msg, 'permanent', err);
  }

  return new StorageError(msg, 'transient', err);
}

/**
 * Centralised timeout values for storage operations.
 * Large uploads need more time; reads and metadata ops should be faster.
 */
const WRITE_TIMEOUT_MS = 10 * 60 * 1_000; // 10 min — allows slow 256 MB PUT
const READ_TIMEOUT_MS = 5 * 60 * 1_000; // 5 min
const META_TIMEOUT_MS = 15_000; // 15 s — exists / stat / delete

const DEFAULT_STORAGE_TIMEOUTS: StorageTimeouts = {
  writeMs: WRITE_TIMEOUT_MS,
  readMs: READ_TIMEOUT_MS,
  metaMs: META_TIMEOUT_MS
};

const DEFAULT_STORAGE_RETRY_POLICY: StorageRetryPolicy = {
  attempts: 3,
  delayMs: 150
};

/**
 * Race a promise against a timer; throw with a clear message on timeout.
 * Using Promise.race keeps the storage interface provider-agnostic, since
 * Bun's native S3 API does not expose per-request timeout options on S3Client.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Storage operation timed out after ${ms}ms (${label})`)),
        ms
      );
    })
  ]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(
  operation: () => Promise<T>,
  retryPolicy: StorageRetryPolicy
): Promise<T> {
  let lastError: StorageError | null = null;

  for (let attempt = 1; attempt <= retryPolicy.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      const storageError = classifyStorageError(err);
      lastError = storageError;

      if (storageError.kind !== 'transient' || attempt === retryPolicy.attempts) {
        throw storageError;
      }

      await sleep(retryPolicy.delayMs * attempt);
    }
  }

  throw lastError ?? new StorageError('Storage operation failed after retries', 'transient');
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

export function createStorageAdapter(options: CreateStorageAdapterOptions = {}): StorageAdapter {
  const getFile = options.getFile ?? getStorageFile;
  const timeouts = {
    ...DEFAULT_STORAGE_TIMEOUTS,
    ...options.timeouts
  };
  const retryPolicy = DEFAULT_STORAGE_RETRY_POLICY;

  async function checkAccess(): Promise<void> {
    await withRetries(async () => {
      const marker = getFile('.healthcheck');

      if (await withTimeout(marker.exists(), timeouts.metaMs, 'checkAccess.exists')) {
        await withTimeout(marker.stat(), timeouts.metaMs, 'checkAccess.stat');
        return;
      }

      await withTimeout(
        marker.write('', { type: 'text/plain;charset=utf-8' }),
        timeouts.metaMs,
        'checkAccess.write'
      );
    }, retryPolicy);
  }

  async function put(obj: StorageObject): Promise<void> {
    const writeOperation = () =>
      withTimeout(
        getFile(obj.key).write(toWritableBody(obj.body), { type: obj.contentType }),
        timeouts.writeMs,
        'put'
      );

    if (obj.body instanceof ReadableStream) {
      try {
        await writeOperation();
      } catch (err) {
        throw classifyStorageError(err);
      }
      return;
    }

    await withRetries(writeOperation, retryPolicy);
  }

  async function get(key: string): Promise<ReadableStream | null> {
    try {
      return await withRetries(async () => {
        const file = getFile(key);

        if (!(await withTimeout(file.exists(), timeouts.metaMs, 'get.exists'))) {
          return null;
        }

        return withTimeout(Promise.resolve(file.stream()), timeouts.readMs, 'get.stream');
      }, retryPolicy);
    } catch (err) {
      const storageError = classifyStorageError(err);

      if (storageError.kind === 'not_found') {
        return null;
      }

      throw storageError;
    }
  }

  async function exists(key: string): Promise<boolean> {
    try {
      return await withRetries(
        () => withTimeout(getFile(key).exists(), timeouts.metaMs, 'exists'),
        retryPolicy
      );
    } catch (err) {
      const storageError = classifyStorageError(err);

      if (storageError.kind === 'not_found') {
        return false;
      }

      throw storageError;
    }
  }

  async function deleteObject(key: string): Promise<void> {
    try {
      await withRetries(async () => {
        const file = getFile(key);

        if (!(await withTimeout(file.exists(), timeouts.metaMs, 'delete.exists'))) {
          return;
        }

        await withTimeout(file.delete(), timeouts.metaMs, 'delete');
      }, retryPolicy);
    } catch (err) {
      const storageError = classifyStorageError(err);

      if (storageError.kind === 'not_found') {
        return;
      }

      throw storageError;
    }
  }

  async function head(key: string): Promise<StorageHeadObject | null> {
    try {
      return await withRetries(async () => {
        const file = getFile(key);

        if (!(await withTimeout(file.exists(), timeouts.metaMs, 'head.exists'))) {
          return null;
        }

        const stats = await withTimeout(file.stat(), timeouts.metaMs, 'head.stat');

        return {
          contentLength: stats.size,
          contentType: stats.type || 'application/octet-stream'
        };
      }, retryPolicy);
    } catch (err) {
      const storageError = classifyStorageError(err);

      if (storageError.kind === 'not_found') {
        return null;
      }

      throw storageError;
    }
  }

  async function createSignedUrl(key: string, options: StorageSignedUrlOptions): Promise<string> {
    return withRetries(
      () =>
        withTimeout(
          Promise.resolve(
            getFile(key).presign({
              expiresIn: options.expiresInSeconds,
              method: options.method ?? 'GET'
            })
          ),
          timeouts.metaMs,
          'createSignedUrl'
        ),
      retryPolicy
    );
  }

  return {
    checkAccess,
    put,
    putObject: put,
    get,
    getObject: get,
    exists,
    objectExists: exists,
    delete: deleteObject,
    deleteObject,
    head,
    headObject: head,
    createSignedUrl,
    async presignedGet(key: string, expiresInSeconds: number): Promise<string> {
      return createSignedUrl(key, { expiresInSeconds, method: 'GET' });
    }
  };
}

export const storageAdapter = createStorageAdapter();
