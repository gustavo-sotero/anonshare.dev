import { describe, expect, test } from 'bun:test';
import { pingRedisUrl } from './index';

describe('pingRedisUrl', () => {
  test('uses the full Redis URL and disconnects after a successful ping', async () => {
    let receivedUrl = '';
    let disconnectCalls = 0;

    await expect(
      pingRedisUrl('redis://default:secret@example.com:6379', (url, options) => {
        receivedUrl = url;

        expect(options).toMatchObject({
          commandTimeout: 2_000,
          connectTimeout: 2_000,
          enableReadyCheck: false,
          lazyConnect: true,
          maxRetriesPerRequest: 1
        });

        return {
          disconnect: () => {
            disconnectCalls += 1;
          },
          ping: async () => 'PONG'
        };
      })
    ).resolves.toBeUndefined();

    expect(receivedUrl).toBe('redis://default:secret@example.com:6379');
    expect(disconnectCalls).toBe(1);
  });

  test('surfaces auth failures and still disconnects the probe client', async () => {
    let disconnectCalls = 0;

    await expect(
      pingRedisUrl('redis://default:secret@example.com:6379', () => ({
        disconnect: () => {
          disconnectCalls += 1;
        },
        ping: async () => {
          throw new Error('NOAUTH Authentication required.');
        }
      }))
    ).rejects.toThrow('NOAUTH Authentication required.');

    expect(disconnectCalls).toBe(1);
  });

  test('rejects unexpected ping responses', async () => {
    await expect(
      pingRedisUrl('redis://default:secret@example.com:6379', () => ({
        disconnect: () => {},
        ping: async () => 'OK'
      }))
    ).rejects.toThrow('Unexpected Redis health check response: OK');
  });
});
