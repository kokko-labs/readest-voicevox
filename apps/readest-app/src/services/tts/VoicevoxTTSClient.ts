import type { AppService } from '@/types/system';
import { isSameLang } from '@/utils/lang';
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

  override async getVoices(lang: string) {
    const voices = (await this.getAllVoices()).filter((voice) => isSameLang(voice.lang, lang));

    return [
      {
        id: this.name,
        name: this.provider.label,
        // `/speakers` is already ordered like the VOICEVOX picker. Preserve
        // that speaker/style order instead of applying Readest's name sort.
        voices,
        disabled: !this.initialized || voices.length === 0,
      },
    ];
  }
}
