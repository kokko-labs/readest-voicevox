import type { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { VoicevoxSpeechProvider } from './providers/voicevox';
import type { TTSController } from './TTSController';

export class VoicevoxTTSClient extends BufferedTTSClient {
  readonly #voicevoxProvider: VoicevoxSpeechProvider;

  constructor(controller?: TTSController, appService?: AppService | null) {
    const provider = new VoicevoxSpeechProvider();
    super(provider, controller, appService);
    this.#voicevoxProvider = provider;
  }

  override async init(): Promise<boolean> {
    this.initialized = false;
    this.voices = [];
    try {
      if (!(await this.#voicevoxProvider.init())) return false;
      this.voices = await this.#voicevoxProvider.getAllVoices();
      this.initialized = true;
      return true;
    } catch {
      this.voices = [];
      return false;
    }
  }

  override getCapabilities() {
    return {
      ...super.getCapabilities(),
      wordBoundaries: false,
    };
  }
}
