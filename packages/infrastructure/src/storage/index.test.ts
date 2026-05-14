import { describe, expect, test } from 'bun:test';
import { createStorageAdapter, type StorageError } from './index';

type FakeStorageFile = {
  deleteCalls?: number;
  deleteImpl?: () => Promise<unknown>;
  existsImpl?: () => Promise<boolean>;
  presignImpl?: (options: {
    expiresIn: number;
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD' | 'POST';
  }) => string | Promise<string>;
  statImpl?: () => Promise<{ size: number; type?: string }>;
  streamImpl?: () => ReadableStream;
  writeImpl?: (
    body: string | Uint8Array | Response,
    options?: { type?: string; contentDisposition?: string }
  ) => Promise<unknown>;
};

function makeFile(overrides: FakeStorageFile = {}) {
  let deleteCalls = 0;

  return {
    get deleteCalls() {
      return deleteCalls;
    },
    async delete() {
      deleteCalls += 1;
      return overrides.deleteImpl ? overrides.deleteImpl() : undefined;
    },
    async exists() {
      return overrides.existsImpl ? overrides.existsImpl() : true;
    },
    presign(options: { expiresIn: number; method: 'GET' | 'PUT' | 'DELETE' | 'HEAD' | 'POST' }) {
      return overrides.presignImpl ? overrides.presignImpl(options) : `signed:${options.method}`;
    },
    async stat() {
      return overrides.statImpl ? overrides.statImpl() : { size: 128, type: 'text/plain' };
    },
    stream() {
      return overrides.streamImpl
        ? overrides.streamImpl()
        : new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            }
          });
    },
    async write(
      body: string | Uint8Array | Response,
      options?: { type?: string; contentDisposition?: string }
    ) {
      return overrides.writeImpl ? overrides.writeImpl(body, options) : undefined;
    }
  };
}

describe('createStorageAdapter', () => {
  test('confirms object visibility after a successful write', async () => {
    let writeCalls = 0;
    let statCalls = 0;

    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          statImpl: async () => {
            statCalls += 1;
            return { size: 3, type: 'application/octet-stream' };
          },
          writeImpl: async () => {
            writeCalls += 1;
          }
        })
    });

    await expect(
      adapter.putConfirmed({
        key: 'objects/example',
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/octet-stream',
        contentLength: 3
      })
    ).resolves.toBeUndefined();

    expect(writeCalls).toBe(1);
    expect(statCalls).toBe(1);
  });

  test('fails confirmed writes when storage metadata never matches the uploaded size', async () => {
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          statImpl: async () => ({ size: 1, type: 'application/octet-stream' })
        })
    });

    await expect(
      adapter.putConfirmed({
        key: 'objects/example',
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/octet-stream',
        contentLength: 3
      })
    ).rejects.toThrow('Storage confirmation size mismatch');
  });

  test('exposes spec-aligned method aliases for object operations', async () => {
    let lastPresignMethod: string | undefined;
    let writeCalls = 0;

    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          presignImpl: (options) => {
            lastPresignMethod = options.method;
            return 'https://storage.example.test/object';
          },
          writeImpl: async () => {
            writeCalls += 1;
          }
        })
    });

    await adapter.putObject({
      key: 'objects/example',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream',
      contentLength: 3
    });

    await expect(adapter.getObject('objects/example')).resolves.toBeInstanceOf(ReadableStream);
    await expect(adapter.objectExists('objects/example')).resolves.toBe(true);
    await expect(adapter.headObject('objects/example')).resolves.toEqual({
      contentLength: 128,
      contentType: 'text/plain'
    });
    await expect(adapter.deleteObject('objects/example')).resolves.toBeUndefined();
    await expect(
      adapter.createSignedUrl('objects/example', { expiresInSeconds: 60, method: 'HEAD' })
    ).resolves.toBe('https://storage.example.test/object');

    expect(writeCalls).toBe(1);
    expect(lastPresignMethod).toBe('HEAD');
  });

  test('supports generic signed URLs for future PUT-based uploads', async () => {
    let captured:
      | {
          expiresIn: number;
          method: 'GET' | 'PUT' | 'DELETE' | 'HEAD' | 'POST';
        }
      | undefined;

    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          presignImpl: (options) => {
            captured = options;
            return 'https://storage.example.test/upload';
          }
        })
    });

    const url = await adapter.createSignedUrl('objects/example', {
      expiresInSeconds: 300,
      method: 'PUT'
    });

    expect(url).toBe('https://storage.example.test/upload');
    expect(captured).toEqual({ expiresIn: 300, method: 'PUT' });
  });

  test('lists objects with prefix filtering and pagination cursor', async () => {
    let capturedOptions:
      | {
          prefix?: string;
          maxKeys?: number;
          startAfter?: string;
        }
      | undefined;

    const adapter = createStorageAdapter({
      getFile: () => makeFile(),
      listObjects: async (options) => {
        capturedOptions = options;
        return {
          contents: [
            {
              key: 'objects/a',
              size: 10,
              lastModified: new Date('2026-03-12T10:00:00Z'),
              etag: 'etag-a'
            },
            {
              key: 'objects/b',
              size: 20,
              lastModified: new Date('2026-03-12T10:05:00Z'),
              etag: 'etag-b'
            }
          ],
          isTruncated: true
        };
      }
    });

    const result = await adapter.list({ prefix: 'objects/', maxKeys: 2, startAfter: 'objects/0' });

    expect(capturedOptions).toEqual({ prefix: 'objects/', maxKeys: 2, startAfter: 'objects/0' });
    expect(result).toEqual({
      objects: [
        {
          key: 'objects/a',
          size: 10,
          lastModified: new Date('2026-03-12T10:00:00Z'),
          etag: 'etag-a'
        },
        {
          key: 'objects/b',
          size: 20,
          lastModified: new Date('2026-03-12T10:05:00Z'),
          etag: 'etag-b'
        }
      ],
      isTruncated: true,
      nextStartAfter: 'objects/b'
    });
  });

  test('presignedGet delegates to GET signed URLs', async () => {
    let capturedMethod: string | undefined;

    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          presignImpl: (options) => {
            capturedMethod = options.method;
            return 'https://storage.example.test/download';
          }
        })
    });

    const url = await adapter.presignedGet('objects/example', 120);

    expect(url).toBe('https://storage.example.test/download');
    expect(capturedMethod).toBe('GET');
  });

  test('returns null from head when the object does not exist', async () => {
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          existsImpl: async () => false
        })
    });

    await expect(adapter.head('objects/missing')).resolves.toBeNull();
  });

  test('treats provider not_found errors as missing objects for head/get/exists/delete', async () => {
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          existsImpl: async () => {
            throw new Error('404 not found');
          }
        })
    });

    await expect(adapter.head('objects/missing')).resolves.toBeNull();
    await expect(adapter.get('objects/missing')).resolves.toBeNull();
    await expect(adapter.exists('objects/missing')).resolves.toBe(false);
    await expect(adapter.delete('objects/missing')).resolves.toBeUndefined();
  });

  test('defaults missing stat content types to application/octet-stream', async () => {
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          statImpl: async () => ({ size: 512 })
        })
    });

    await expect(adapter.head('objects/file')).resolves.toEqual({
      contentLength: 512,
      contentType: 'application/octet-stream'
    });
  });

  test('treats delete on missing objects as a no-op', async () => {
    const file = makeFile({
      existsImpl: async () => false
    });
    const adapter = createStorageAdapter({
      getFile: () => file
    });

    await expect(adapter.delete('objects/missing')).resolves.toBeUndefined();
    expect(file.deleteCalls).toBe(0);
  });

  test('classifies authorization failures as permanent storage errors', async () => {
    let attempts = 0;
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          existsImpl: async () => {
            attempts += 1;
            throw new Error('403 forbidden');
          }
        })
    });

    await expect(adapter.exists('objects/file')).rejects.toMatchObject({
      kind: 'permanent'
    } satisfies Partial<StorageError>);
    expect(attempts).toBe(1);
  });

  test('classifies timed out writes as transient storage errors', async () => {
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          writeImpl: async () => new Promise(() => undefined)
        }),
      timeouts: {
        writeMs: 1
      }
    });

    await expect(
      adapter.put({
        key: 'objects/file',
        body: new Uint8Array([1]),
        contentType: 'application/octet-stream',
        contentLength: 1
      })
    ).rejects.toMatchObject({ kind: 'transient' } satisfies Partial<StorageError>);
  });

  test('retries transient metadata failures before succeeding', async () => {
    let attempts = 0;

    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          existsImpl: async () => {
            attempts += 1;
            if (attempts < 3) {
              throw new Error('network reset');
            }

            return true;
          }
        })
    });

    await expect(adapter.exists('objects/file')).resolves.toBe(true);
    expect(attempts).toBe(3);
  });

  test('does not retry non-replayable stream uploads on transient failures', async () => {
    let writeAttempts = 0;
    const adapter = createStorageAdapter({
      getFile: () =>
        makeFile({
          writeImpl: async () => {
            writeAttempts += 1;
            throw new Error('socket hang up');
          }
        })
    });

    await expect(
      adapter.put({
        key: 'objects/file',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          }
        }),
        contentType: 'application/octet-stream',
        contentLength: 3
      })
    ).rejects.toMatchObject({ kind: 'transient' } satisfies Partial<StorageError>);

    expect(writeAttempts).toBe(1);
  });
});
