/**
 * Packing RSVP tokens into multi-word chunks (fork addition).
 *
 * Upstream RSVP always flashes one segmenter token at a time. For Japanese the
 * segmenter's tokens are tiny (「吾輩 / は / 猫 / で / ある」), which flickers.
 * This module packs consecutive tokens into a chunk of at most N characters,
 * breaking only where breaking is safe:
 *
 *   - Japanese text breaks at BudouX 文節 (phrase) boundaries;
 *   - other languages break at the existing token boundaries;
 *   - sentence ends and block/paragraph boundaries are never crossed;
 *   - a single phrase longer than the limit falls back to token boundaries.
 *
 * Pure: the caller supplies the boundary metadata, this module only assembles.
 * It also owns the trailing-punctuation classification both the packer and the
 * display timing need, so the two share one set of terminators and closers.
 */
import type { RsvpWord } from './types';
import { containsCJK } from './utils';

/**
 * A word plus the boundary metadata the packer needs. The extractor fills these
 * in only when chunking is enabled, so the one-word-at-a-time path stays
 * exactly as it was.
 */
export interface RsvpToken extends RsvpWord {
  /** A block/paragraph boundary (block element or `<br>`) precedes this token. */
  hardBreakBefore?: boolean;
  /** A phrase (文節 / word) boundary follows this token — a chunk may end here. */
  phraseBoundaryAfter?: boolean;
  /** A sentence ends with this token — a chunk must end here. */
  sentenceEndAfter?: boolean;
  /**
   * Nothing stood between this token and the previous one in the source, so
   * re-joining them must not insert a space. Set for tokens the segmenter split
   * apart (`best—of`, `10–15`) and for tokens that meet across an inline element
   * such as `“<em>x</em>”`.
   */
  tightJoinBefore?: boolean;
}

// Closing quotes and brackets that may sit between the punctuation and the end
// of a token, as in 「ある。」 or `said."`. Shared by both patterns below so they
// can never drift apart.
const CLOSERS = ')\\]}"\'’”』」）】》〉〕〗〙〛｝］';

/**
 * A sentence terminator (half- or full-width) optionally followed by closers,
 * e.g. 「ある。」 or `said."`.
 */
const SENTENCE_END_PATTERN = new RegExp(`[.!?。！？][${CLOSERS}]*$`);

/**
 * Trailing punctuation that earns the extra display pause. Includes the
 * full-width forms (。、！？；：，): the half-width set never matched them, so
 * Japanese and Chinese sentence ends used to flash past with no pause at all.
 */
const PAUSE_PUNCTUATION_PATTERN = new RegExp(`[.!?,;:–—。、！？；：，][${CLOSERS}]*$`);

/** Whether a token's text ends a sentence. */
export function endsSentence(text: string): boolean {
  return SENTENCE_END_PATTERN.test(text);
}

/** Whether a token's text ends on punctuation that earns the extra pause. */
export function endsWithPausePunctuation(text: string): boolean {
  return PAUSE_PUNCTUATION_PATTERN.test(text);
}

/**
 * Put the focus point of a multi-word chunk on the character nearest the middle
 * that isn't whitespace, preferring the left when both sides are equally close.
 * (`calculateORP`'s one-third rule is tuned for single words and would land far
 * left of the visual centre of a chunk.)
 */
export function calculateChunkORP(text: string): number {
  if (text.length === 0) return 0;
  const middle = Math.floor(text.length / 2);
  for (let offset = 0; offset < text.length; offset++) {
    const left = middle - offset;
    if (left >= 0 && text[left]!.trim() !== '') return left;
    const right = middle + offset;
    if (right < text.length && text[right]!.trim() !== '') return right;
  }
  return 0;
}

/**
 * Pack tokens into chunks of at most `maxChars` characters. `maxChars <= 0`
 * disables packing and returns the tokens unchanged (the upstream behaviour).
 */
export function packTokensIntoChunks(tokens: RsvpToken[], maxChars: number): RsvpWord[] {
  if (maxChars <= 0 || tokens.length === 0) return tokens;

  const chunks: RsvpWord[] = [];
  let pending: RsvpToken[] = [];
  let pendingLength = 0;

  const flush = (): void => {
    if (pending.length === 0) return;
    chunks.push(mergeTokens(pending));
    pending = [];
    pendingLength = 0;
  };

  const append = (group: RsvpToken[], groupLength: number): void => {
    if (pending.length > 0) {
      const gap = separatorBetween(pending[pending.length - 1]!, group[0]!).length;
      pendingLength += gap + groupLength;
    } else {
      pendingLength = groupLength;
    }
    pending.push(...group);
  };

  /** Length the pending chunk would reach if `group` were appended to it. */
  const lengthWith = (group: RsvpToken[], groupLength: number): number => {
    if (pending.length === 0) return groupLength;
    const gap = separatorBetween(pending[pending.length - 1]!, group[0]!).length;
    return pendingLength + gap + groupLength;
  };

  for (const group of groupByPhrase(tokens)) {
    const groupLength = joinedLength(group.tokens);

    if (groupLength > maxChars) {
      // A phrase that cannot fit a chunk on its own: emit what we have and fall
      // back to token boundaries inside the phrase.
      flush();
      for (const token of group.tokens) {
        const single = [token];
        const singleLength = token.text.length;
        if (pending.length > 0 && lengthWith(single, singleLength) > maxChars) flush();
        append(single, singleLength);
      }
    } else {
      if (pending.length > 0 && lengthWith(group.tokens, groupLength) > maxChars) flush();
      append(group.tokens, groupLength);
    }

    if (group.forcedEnd) flush();
  }
  flush();

  return chunks;
}

interface PhraseGroup {
  tokens: RsvpToken[];
  /** A boundary that packing must not cross follows this group. */
  forcedEnd: boolean;
}

/**
 * Cut the token list at every phrase boundary, marking the cuts that packing is
 * forbidden to cross (sentence ends, block/paragraph breaks, blank frames).
 */
function groupByPhrase(tokens: RsvpToken[]): PhraseGroup[] {
  const groups: PhraseGroup[] = [];
  let start = 0;
  for (let i = 1; i <= tokens.length; i++) {
    const forced = i === tokens.length || isForcedBreakBefore(tokens, i);
    if (forced || tokens[i - 1]!.phraseBoundaryAfter) {
      groups.push({ tokens: tokens.slice(start, i), forcedEnd: forced });
      start = i;
    }
  }
  return groups;
}

function isForcedBreakBefore(tokens: RsvpToken[], i: number): boolean {
  const previous = tokens[i - 1]!;
  const current = tokens[i]!;
  return (
    current.hardBreakBefore === true ||
    previous.sentenceEndAfter === true ||
    // The blank ISI frame the extractor inserts between two identical words only
    // works as a separator if it stays a frame of its own.
    isBlank(previous.text) ||
    isBlank(current.text)
  );
}

const isBlank = (text: string): boolean => text.trim().length === 0;

/**
 * Tokens that were adjacent in the source are re-joined exactly as they stood.
 * Otherwise CJK text needs no separator, while Latin and other space-delimited
 * scripts get a single space; a mixed pair is joined tight, matching how the
 * source text runs CJK against Latin without one.
 */
function separatorBetween(before: RsvpToken, after: RsvpToken): string {
  if (after.tightJoinBefore) return '';
  return containsCJK(before.text) || containsCJK(after.text) ? '' : ' ';
}

function joinedLength(tokens: RsvpToken[]): number {
  let length = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0) length += separatorBetween(tokens[i - 1]!, tokens[i]!).length;
    length += tokens[i]!.text.length;
  }
  return length;
}

function mergeTokens(members: RsvpToken[]): RsvpWord {
  // A chunk of one is the token itself: same object, same ORP, no tokenCount —
  // so a section packed at a tight limit behaves exactly like the unpacked one.
  if (members.length === 1) return members[0]!;

  let text = '';
  let pauseMultiplier = 0;
  for (let i = 0; i < members.length; i++) {
    const member = members[i]!;
    if (i > 0) text += separatorBetween(members[i - 1]!, member);
    text += member.text;
    pauseMultiplier += member.pauseMultiplier;
  }

  const chunk: RsvpWord = {
    text,
    orpIndex: calculateChunkORP(text),
    // Summed, so a chunk occupies the display for as long as its words would
    // have individually — WPM keeps meaning words per minute.
    pauseMultiplier,
    tokenCount: members.length,
  };

  const range = mergeRanges(members);
  if (range) {
    chunk.range = range;
    chunk.docIndex = members[0]!.docIndex;
  }
  return chunk;
}

/**
 * A range spanning from the first member's start to the last member's end, so
 * position tracking, TTS sync and the exit highlight all see the whole chunk.
 * Returns undefined unless every member has a range — a partial span would
 * point the reader at the wrong place.
 */
function mergeRanges(members: RsvpToken[]): Range | undefined {
  const first = members[0]!.range;
  const last = members[members.length - 1]!.range;
  if (!first || !last) return undefined;
  if (members.some((member) => !member.range)) return undefined;

  // Create the range in the book iframe's document, not this realm's.
  const doc = first.startContainer.ownerDocument;
  if (!doc) return undefined;
  try {
    const range = doc.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    return range;
  } catch {
    return undefined;
  }
}
