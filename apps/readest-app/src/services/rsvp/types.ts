export interface RsvpWord {
  text: string;
  orpIndex: number;
  pauseMultiplier: number;
  range?: Range;
  docIndex?: number;
  cfi?: string; // Canonical Fragment Identifier for precise position tracking
  /**
   * How many underlying words this entry shows at once. Absent (or 1) for the
   * upstream one-word-at-a-time display; set by the chunk packer so pacing and
   * hyphen splitting can tell a chunk from a single word.
   */
  tokenCount?: number;
}

export interface RsvpState {
  active: boolean;
  playing: boolean;
  words: RsvpWord[];
  currentIndex: number;
  currentPartIndex: number;
  wpm: number;
  punctuationPauseMs: number;
  splitHyphens: boolean;
  cjkCharMode: boolean;
  startDelaySeconds: number;
  /** Characters per flash for chunked display; 0 means one word at a time. */
  maxChunkChars: number;
  hasCJK: boolean;
  progress: number;
}

export interface RsvpPosition {
  cfi: string;
  wordText: string;
}

export interface RsvpStopPosition {
  wordIndex: number;
  totalWords: number;
  text: string;
  range?: Range;
  docIndex?: number;
  cfi?: string; // Canonical Fragment Identifier for the stop position
}

export interface RsvpStartChoice {
  hasSavedPosition: boolean;
  hasSelection: boolean;
  selectionText?: string;
}
