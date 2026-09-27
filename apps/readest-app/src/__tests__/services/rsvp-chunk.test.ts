import { describe, expect, test } from 'vitest';

import {
  calculateChunkORP,
  endsSentence,
  endsWithPausePunctuation,
  packTokensIntoChunks,
  type RsvpToken,
} from '@/services/rsvp/chunk';

/**
 * Token helper. Defaults to a standalone phrase (every token is its own 文節),
 * which is what the extractor produces for non-Japanese text; Japanese
 * fixtures pass `phraseBoundaryAfter: false` for mid-phrase tokens.
 */
const tok = (text: string, overrides: Partial<RsvpToken> = {}): RsvpToken => ({
  text,
  orpIndex: 0,
  pauseMultiplier: 1,
  phraseBoundaryAfter: true,
  ...overrides,
});

/** A Japanese 文節: only the last token carries the phrase boundary. */
const phrase = (texts: string[], lastOverrides: Partial<RsvpToken> = {}): RsvpToken[] =>
  texts.map((text, i) =>
    i === texts.length - 1
      ? tok(text, { phraseBoundaryAfter: true, ...lastOverrides })
      : tok(text, { phraseBoundaryAfter: false }),
  );

const texts = (words: { text: string }[]): string[] => words.map((w) => w.text);

describe('packTokensIntoChunks', () => {
  test('returns the tokens 1:1 when the limit is off (0)', () => {
    const tokens = [...phrase(['吾輩', 'は']), ...phrase(['猫', 'で', 'ある'])];
    const chunks = packTokensIntoChunks(tokens, 0);

    expect(chunks).toHaveLength(tokens.length);
    expect(texts(chunks)).toEqual(['吾輩', 'は', '猫', 'で', 'ある']);
    expect(chunks.every((c) => c.tokenCount === undefined)).toBe(true);
  });

  test('packs whole phrases together while they fit the limit', () => {
    // 吾輩は(3) + 猫である(4) = 7 chars, under the 10 char limit.
    const tokens = [...phrase(['吾輩', 'は']), ...phrase(['猫', 'で', 'ある'])];
    const chunks = packTokensIntoChunks(tokens, 10);

    expect(texts(chunks)).toEqual(['吾輩は猫である']);
    expect(chunks[0]!.tokenCount).toBe(5);
  });

  test('breaks between phrases rather than mid-phrase when the limit is tight', () => {
    // 吾輩は(3) + 猫である(4) = 7 > 6, so the phrase boundary is the split point.
    const tokens = [...phrase(['吾輩', 'は']), ...phrase(['猫', 'で', 'ある'])];
    const chunks = packTokensIntoChunks(tokens, 6);

    expect(texts(chunks)).toEqual(['吾輩は', '猫である']);
  });

  test('never merges across a sentence end', () => {
    const tokens = [
      ...phrase(['猫', 'である。'], { sentenceEndAfter: true }),
      ...phrase(['名前', 'は']),
    ];
    const chunks = packTokensIntoChunks(tokens, 20);

    expect(texts(chunks)).toEqual(['猫である。', '名前は']);
  });

  test('never merges across a hard (block/paragraph) break', () => {
    const tokens = [
      ...phrase(['一', '行目']),
      ...phrase(['二', '行目']).map((t, i) => (i === 0 ? { ...t, hardBreakBefore: true } : t)),
    ];
    const chunks = packTokensIntoChunks(tokens, 20);

    expect(texts(chunks)).toEqual(['一行目', '二行目']);
  });

  test('splits a phrase longer than the limit at token boundaries', () => {
    // One phrase of three 4-char tokens (12 chars) with an 8 char limit.
    const tokens = phrase(['ああああ', 'いいいい', 'うううう']);
    const chunks = packTokensIntoChunks(tokens, 8);

    expect(texts(chunks)).toEqual(['ああああいいいい', 'うううう']);
    expect(chunks[0]!.tokenCount).toBe(2);
  });

  test('joins CJK members without a separator', () => {
    const chunks = packTokensIntoChunks(phrase(['今日', 'は']), 10);
    expect(chunks[0]!.text).toBe('今日は');
  });

  test('joins Latin members with a single space', () => {
    const chunks = packTokensIntoChunks([tok('the'), tok('quick'), tok('fox')], 20);
    expect(texts(chunks)).toEqual(['the quick fox']);
  });

  test('omits the separator when only one side of the join is CJK', () => {
    const chunks = packTokensIntoChunks(phrase(['ABC', 'です']), 12);
    expect(chunks[0]!.text).toBe('ABCです');
  });

  test('joins members that were adjacent in the source without a separator', () => {
    // "best—of" is split into two tokens by the em-dash rule, but nothing stood
    // between them in the book, so re-joining must not invent a space.
    const chunks = packTokensIntoChunks([tok('best—'), tok('of', { tightJoinBefore: true })], 20);
    expect(texts(chunks)).toEqual(['best—of']);
  });

  test('charges no separator to the limit for a source-adjacent join', () => {
    // "best—of" is 7 characters, so it fits a limit of 7 only if the join is tight.
    const chunks = packTokensIntoChunks([tok('best—'), tok('of', { tightJoinBefore: true })], 7);
    expect(texts(chunks)).toEqual(['best—of']);
  });

  test('keeps an en-dash range tight', () => {
    const chunks = packTokensIntoChunks(
      [tok('pages'), tok('10–'), tok('15', { tightJoinBefore: true })],
      20,
    );
    expect(texts(chunks)).toEqual(['pages 10–15']);
  });

  test('counts the joining spaces against the limit', () => {
    // "the quick" is 9 chars once joined, so a 8 char limit must split it.
    const chunks = packTokensIntoChunks([tok('the'), tok('quick')], 8);
    expect(texts(chunks)).toEqual(['the', 'quick']);
  });

  test('sums the pause multipliers of its members', () => {
    const tokens = phrase(['猫', 'で', 'ある']).map((t) => ({ ...t, pauseMultiplier: 0.9 }));
    const chunks = packTokensIntoChunks(tokens, 10);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pauseMultiplier).toBeCloseTo(2.7);
  });

  test('keeps a single-member chunk exactly as it was', () => {
    const only = tok('hello', { pauseMultiplier: 1.1, orpIndex: 1 });
    const chunks = packTokensIntoChunks([only], 4);

    expect(chunks[0]).toBe(only);
    expect(chunks[0]!.orpIndex).toBe(1);
    expect(chunks[0]!.tokenCount).toBeUndefined();
  });

  test('puts the chunk ORP on a non-whitespace character near the middle', () => {
    const chunks = packTokensIntoChunks([tok('a'), tok('b'), tok('c'), tok('d')], 20);
    const chunk = chunks[0]!;

    expect(chunk.text).toBe('a b c d');
    // The exact middle (index 3) is a space, so the ORP steps to a real letter.
    expect(chunk.text[chunk.orpIndex]!.trim()).not.toBe('');
  });

  test('keeps the blank ISI frame as a chunk of its own', () => {
    // The extractor inserts a blank frame between two identical words; merging
    // it away would defeat the point of the frame.
    const tokens = [
      tok('the'),
      { text: ' ', orpIndex: 0, pauseMultiplier: 0.5 },
      tok('the'),
      tok('cat'),
    ];
    const chunks = packTokensIntoChunks(tokens, 20);

    expect(texts(chunks)).toEqual(['the', ' ', 'the cat']);
  });

  describe('merged range', () => {
    const makeRanges = (text: string, spans: [number, number][]) => {
      const doc = document.implementation.createHTMLDocument('chunk');
      doc.body.innerHTML = `<p>${text}</p>`;
      const node = doc.body.querySelector('p')!.firstChild as Text;
      return spans.map(([start, end]) => {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range;
      });
    };

    test('spans from the first member start to the last member end', () => {
      const [r1, r2, r3] = makeRanges('the quick fox', [
        [0, 3],
        [4, 9],
        [10, 13],
      ]);
      const tokens = [
        tok('the', { range: r1, docIndex: 2 }),
        tok('quick', { range: r2, docIndex: 2 }),
        tok('fox', { range: r3, docIndex: 2 }),
      ];

      const chunk = packTokensIntoChunks(tokens, 20)[0]!;
      expect(chunk.range!.toString()).toBe('the quick fox');
      expect(chunk.docIndex).toBe(2);
    });

    test('omits range and docIndex when a member has no range', () => {
      const [r1] = makeRanges('the quick', [[0, 3]]);
      const tokens = [tok('the', { range: r1, docIndex: 2 }), tok('quick', { docIndex: 2 })];

      const chunk = packTokensIntoChunks(tokens, 20)[0]!;
      expect(chunk.text).toBe('the quick');
      expect(chunk.range).toBeUndefined();
      expect(chunk.docIndex).toBeUndefined();
    });
  });
});

describe('endsSentence', () => {
  test.each([
    'ある。',
    'そう！',
    'なに？',
    'done.',
    'really!',
    'why?',
  ])('treats %s as a sentence end', (text) => {
    expect(endsSentence(text)).toBe(true);
  });

  test.each([
    'ある。」',
    'ある。）',
    'said."',
    "said.'",
    'ある！』',
  ])('allows closing quotes and brackets after the terminator (%s)', (text) => {
    expect(endsSentence(text)).toBe(true);
  });

  test.each(['猫', 'は', 'word', 'word,', '、'])('treats %s as mid-sentence', (text) => {
    expect(endsSentence(text)).toBe(false);
  });
});

describe('endsWithPausePunctuation', () => {
  test.each([
    'done.',
    'wait,',
    'so;',
    'then:',
    'held–',
    'held—',
  ])('matches the half-width form %s', (text) => {
    expect(endsWithPausePunctuation(text)).toBe(true);
  });

  test.each([
    'ある。',
    'そして、',
    'なに！',
    'なぜ？',
    'つまり：',
    'ただし；',
    'そう，',
  ])('matches the full-width form %s', (text) => {
    expect(endsWithPausePunctuation(text)).toBe(true);
  });

  test.each([
    'ある。」',
    'ある。）',
    'そう！』',
    'said."',
    "said.'",
  ])('matches through trailing closing quotes and brackets (%s)', (text) => {
    expect(endsWithPausePunctuation(text)).toBe(true);
  });

  test.each(['word', '猫', 'ある」', '「そう'])('does not match %s', (text) => {
    expect(endsWithPausePunctuation(text)).toBe(false);
  });
});

describe('calculateChunkORP', () => {
  test('lands on the middle character of a solid run', () => {
    expect(calculateChunkORP('abcde')).toBe(2);
  });

  test('steps off a whitespace middle to the nearest real character', () => {
    const text = 'ab cd';
    expect(text[calculateChunkORP(text)]).not.toBe(' ');
  });

  test('returns 0 for an empty string', () => {
    expect(calculateChunkORP('')).toBe(0);
  });

  test('returns 0 when there is no non-whitespace character', () => {
    expect(calculateChunkORP('   ')).toBe(0);
  });
});
