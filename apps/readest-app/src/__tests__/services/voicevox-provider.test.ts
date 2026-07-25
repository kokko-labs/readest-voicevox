import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { VoicevoxTTSClient } from '@/services/tts/VoicevoxTTSClient';
import {
  DEFAULT_VOICEVOX_ENDPOINT,
  VoicevoxSpeechProvider,
} from '@/services/tts/providers/voicevox';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@/services/tts/TTSController', () => ({
  TTSController: class {},
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

const fetchMock = vi.mocked(tauriFetch);

describe('VoicevoxSpeechProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('probes the local engine version', async () => {
    fetchMock.mockResolvedValueOnce(new Response('0.25.2'));

    await expect(new VoicevoxSpeechProvider().init()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_VOICEVOX_ENDPOINT}/version`,
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test('returns false when the local engine is unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(new VoicevoxSpeechProvider().init()).resolves.toBe(false);
  });

  test('times out engine discovery instead of blocking initialization', async () => {
    fetchMock.mockImplementationOnce(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    await expect(new VoicevoxSpeechProvider(DEFAULT_VOICEVOX_ENDPOINT, 5).init()).resolves.toBe(
      false,
    );
  });

  test('flattens speakers and styles into namespaced Japanese voices', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([
        {
          name: '四国めたん',
          styles: [
            { name: 'ノーマル', id: 2 },
            { name: 'あまあま', id: 0 },
          ],
        },
        {
          name: 'ずんだもん',
          styles: [
            { name: 'ノーマル', id: 3, type: 'talk' },
            { name: 'ハミング', id: 3002, type: 'sing' },
          ],
        },
        { name: 'broken speaker', styles: null },
      ]),
    );

    await expect(new VoicevoxSpeechProvider().getAllVoices()).resolves.toEqual([
      { id: 'voicevox:2', name: '四国めたん (ノーマル)', lang: 'ja-JP' },
      { id: 'voicevox:0', name: '四国めたん (あまあま)', lang: 'ja-JP' },
      { id: 'voicevox:3', name: 'ずんだもん (ノーマル)', lang: 'ja-JP' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_VOICEVOX_ENDPOINT}/speakers`,
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test('runs audio_query then synthesis and returns WAV bytes without word boundaries', async () => {
    const query = { accent_phrases: [], speedScale: 1 };
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    fetchMock.mockResolvedValueOnce(Response.json(query)).mockResolvedValueOnce(new Response(wav));

    const signal = new AbortController().signal;
    const result = await new VoicevoxSpeechProvider().synthesize(
      {
        lang: 'ja-JP',
        text: 'こんにちは 世界',
        voice: 'voicevox:3',
        pitch: 2,
      },
      signal,
    );

    expect(new Uint8Array(result.audio)).toEqual(wav);
    expect(result.boundaries).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${DEFAULT_VOICEVOX_ENDPOINT}/audio_query?text=${encodeURIComponent(
        'こんにちは',
      )}+${encodeURIComponent('世界')}&speaker=3`,
      { method: 'POST', signal },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${DEFAULT_VOICEVOX_ENDPOINT}/synthesis?speaker=3`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...query, pitchScale: 0.15 }),
        signal,
      },
    );
  });

  test('reports non-successful VOICEVOX responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('speaker not found', { status: 400 }));

    await expect(
      new VoicevoxSpeechProvider().synthesize(
        { lang: 'ja-JP', text: 'test', voice: 'voicevox:999', pitch: 1 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('keeps rate-limit responses transient so the buffered client can retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('try later', { status: 429 }));

    const error = await new VoicevoxSpeechProvider()
      .synthesize(
        { lang: 'ja-JP', text: 'test', voice: 'voicevox:3', pitch: 1 },
        new AbortController().signal,
      )
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SpeechSynthesisPermanentError);
  });

  test('rejects malformed voice IDs without sending a request', async () => {
    await expect(
      new VoicevoxSpeechProvider().synthesize(
        { lang: 'ja-JP', text: 'test', voice: 'edge-voice', pitch: 1 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('propagates cancellation to the native HTTP transport', async () => {
    fetchMock.mockImplementationOnce(async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    const controller = new AbortController();
    const request = new VoicevoxSpeechProvider().synthesize(
      { lang: 'ja-JP', text: '長い文章', voice: 'voicevox:3', pitch: 1 },
      controller.signal,
    );

    controller.abort(new DOMException('Aborted', 'AbortError'));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('VoicevoxTTSClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('initializes only after both the health probe and voice discovery succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('0.25.2'))
      .mockResolvedValueOnce(
        Response.json([{ name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }] }]),
      );
    const client = new VoicevoxTTSClient();

    await expect(client.init()).resolves.toBe(true);
    await expect(client.getAllVoices()).resolves.toEqual([
      {
        id: 'voicevox:3',
        name: 'ずんだもん (ノーマル)',
        lang: 'ja-JP',
        disabled: false,
      },
    ]);
    expect(client.getCapabilities().wordBoundaries).toBe(false);
  });

  test('preserves the VOICEVOX speaker and style order in its voice group', async () => {
    fetchMock.mockResolvedValueOnce(new Response('0.25.2')).mockResolvedValueOnce(
      Response.json([
        {
          name: 'Z speaker',
          styles: [
            { name: 'Z style', id: 20 },
            { name: 'A style', id: 21 },
          ],
        },
        {
          name: 'A speaker',
          styles: [{ name: 'A style', id: 10 }],
        },
      ]),
    );
    const client = new VoicevoxTTSClient();
    await client.init();

    const [group] = await client.getVoices('ja');

    expect(group?.voices.map((voice) => voice.id)).toEqual([
      'voicevox:20',
      'voicevox:21',
      'voicevox:10',
    ]);
  });

  test('does not reject controller initialization when VOICEVOX is unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const client = new VoicevoxTTSClient();

    await expect(client.init()).resolves.toBe(false);
    await expect(client.getAllVoices()).resolves.toEqual([]);
  });
});
