/**
 * BudouX phrase (文節) segmentation for Japanese, loaded on demand.
 *
 * Mirrors @/utils/jieba: the model is pulled in with a dynamic import so books
 * in other languages never pay for it. RSVP's word extractor is synchronous, so
 * callers preload with `initBudoux()` and then check `isBudouxReady()`.
 */
type JapaneseParser = {
  parseBoundaries: (sentence: string) => number[];
};

let parser: JapaneseParser | null = null;
let initPromise: Promise<void> | null = null;

const initBudoux = async (): Promise<void> => {
  if (parser) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const { loadDefaultJapaneseParser } = await import('budoux');
        parser = loadDefaultJapaneseParser();
      } catch (e) {
        initPromise = null;
        throw e;
      }
    })();
  }
  return initPromise;
};

const isBudouxReady = (): boolean => parser !== null;

/**
 * Offsets at which a new phrase starts, in ascending order. The start of the
 * text (0) and its end are not included. Returns an empty list when the model
 * has not loaded, so callers must gate on `isBudouxReady()`.
 */
const parseJaPhraseBoundaries = (text: string): number[] => {
  if (!parser || !text) return [];
  try {
    return parser.parseBoundaries(text);
  } catch (e) {
    console.warn('BudouX failed to parse a text node:', e);
    return [];
  }
};

export { initBudoux, isBudouxReady, parseJaPhraseBoundaries };
