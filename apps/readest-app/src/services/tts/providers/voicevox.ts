import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

export const DEFAULT_VOICEVOX_ENDPOINT = 'http://127.0.0.1:50021';

interface VoicevoxStyle {
  id: number;
  name: string;
  type?: string;
}

interface VoicevoxSpeaker {
  name: string;
  styles: VoicevoxStyle[];
}

const responseError = async (operation: string, response: Response): Promise<Error> => {
  let detail = '';
  try {
    detail = (await response.text()).trim();
  } catch {
    // Preserve the HTTP status when an error response has no readable body.
  }
  const suffix = detail ? `: ${detail}` : '';
  const message = `VOICEVOX ${operation} failed (${response.status} ${response.statusText})${suffix}`;
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  ) {
    return new SpeechSynthesisPermanentError(message);
  }
  return new Error(message);
};

const parseStyleId = (voiceId: string): number => {
  const match = /^voicevox:(\d+)$/.exec(voiceId);
  if (!match) {
    throw new SpeechSynthesisPermanentError(`Invalid VOICEVOX voice ID: ${voiceId}`);
  }
  const styleId = Number(match[1]);
  if (!Number.isSafeInteger(styleId)) {
    throw new SpeechSynthesisPermanentError(`Invalid VOICEVOX voice ID: ${voiceId}`);
  }
  return styleId;
};

const withRequestAbortSignal = async <T>(
  parentSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  if (parentSignal.aborted) {
    throw parentSignal.reason ?? new DOMException('Aborted', 'AbortError');
  }

  const controller = new AbortController();
  const forwardAbort = () => {
    controller.abort(parentSignal.reason ?? new DOMException('Aborted', 'AbortError'));
  };
  parentSignal.addEventListener('abort', forwardAbort, { once: true });
  if (parentSignal.aborted) forwardAbort();

  try {
    return await operation(controller.signal);
  } finally {
    // Tauri HTTP retains the request signal listener after consuming the body.
    // Stop completed requests from receiving the paragraph's later cleanup abort.
    parentSignal.removeEventListener('abort', forwardAbort);
  }
};

export class VoicevoxSpeechProvider implements SpeechProvider {
  readonly id = 'voicevox';
  readonly label = 'VOICEVOX';
  readonly cacheable = true;

  readonly #endpoint: string;
  readonly #discoveryTimeoutMs: number;

  constructor(endpoint = DEFAULT_VOICEVOX_ENDPOINT, discoveryTimeoutMs = 2_000) {
    this.#endpoint = endpoint.replace(/\/+$/, '');
    this.#discoveryTimeoutMs = discoveryTimeoutMs;
  }

  async #fetchForDiscovery(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new DOMException('VOICEVOX discovery timed out', 'TimeoutError')),
      this.#discoveryTimeoutMs,
    );
    try {
      return await tauriFetch(url, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async init(): Promise<boolean> {
    try {
      const response = await this.#fetchForDiscovery(`${this.#endpoint}/version`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    const response = await this.#fetchForDiscovery(`${this.#endpoint}/speakers`);
    if (!response.ok) throw await responseError('speaker discovery', response);

    const speakers = await response.json();
    if (!Array.isArray(speakers)) {
      throw new Error('VOICEVOX returned an invalid speakers response');
    }
    return speakers.flatMap((speaker) =>
      isVoicevoxSpeaker(speaker)
        ? speaker.styles.filter(isTalkStyle).map((style) => ({
            id: `voicevox:${style.id}`,
            name: `${speaker.name} (${style.name})`,
            lang: 'ja-JP',
          }))
        : [],
    );
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    const styleId = parseStyleId(req.voice);
    const params = new URLSearchParams({
      text: req.text,
      speaker: String(styleId),
    });

    const query = await withRequestAbortSignal(signal, async (requestSignal) => {
      const response = await tauriFetch(`${this.#endpoint}/audio_query?${params}`, {
        method: 'POST',
        signal: requestSignal,
      });
      if (!response.ok) throw await responseError('audio query', response);
      return await response.json();
    });
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new SpeechSynthesisPermanentError('VOICEVOX returned an invalid audio query');
    }
    (query as Record<string, unknown>)['pitchScale'] = Math.min(
      0.15,
      Math.max(-0.15, req.pitch - 1),
    );

    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    const audio = await withRequestAbortSignal(signal, async (requestSignal) => {
      const response = await tauriFetch(`${this.#endpoint}/synthesis?speaker=${styleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
        signal: requestSignal,
      });
      if (!response.ok) throw await responseError('synthesis', response);
      return await response.arrayBuffer();
    });
    if (!audio.byteLength) {
      throw new SpeechSynthesisPermanentError('VOICEVOX returned no audio data');
    }
    return { audio, boundaries: [] };
  }
}

const isVoicevoxSpeaker = (value: unknown): value is VoicevoxSpeaker => {
  if (!value || typeof value !== 'object') return false;
  const speaker = value as Partial<VoicevoxSpeaker>;
  return typeof speaker.name === 'string' && Array.isArray(speaker.styles);
};

const isTalkStyle = (value: unknown): value is VoicevoxStyle => {
  if (!value || typeof value !== 'object') return false;
  const style = value as Partial<VoicevoxStyle>;
  return (
    typeof style.id === 'number' &&
    Number.isSafeInteger(style.id) &&
    style.id >= 0 &&
    typeof style.name === 'string' &&
    (style.type === undefined || style.type === 'talk')
  );
};
