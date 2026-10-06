import { DeterministicQualityResult, QualityCategory } from '@/types/quality';

// Comprehensive Unicode Emoji regular expression
const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base})[\uFE00-\uFE0F\u200D]*|[\uFE00-\uFE0F\u200D]/gu;

// Common keyboard smashes (QWERTY, Dvorak, home row sequences)
const KEYBOARD_SEQUENCES = [
  'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'jkl;',
  'qwer', 'wert', 'erty', 'rtyu', 'tyui', 'yuio', 'uiop',
  'zxcv', 'xcvb', 'cvbn', 'vbnm',
  'qazw', 'wsxe', 'edcr', 'rfvt', 'tgbz', 'yhnj', 'ujmk',
  '1234', '2345', '3456', '4567', '5678', '6789', '7890',
  'abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij',
];

// Common test submission phrases
const TEST_PHRASES = [
  'test', 'testing', 'test submission', 'check',
  'checking', 'test 123', 'test test', 'hello test', 'sample test',
  'trial', 'asdf', 'demo', 'foo', 'bar', 'test post',
];

export class DeterministicQualityService {
  /**
   * Run cheap, comprehensive deterministic quality checks on raw or normalized text
   */
  public analyze(rawText: string): DeterministicQualityResult {
    const text = (rawText || '').trim();

    // Counts
    const character_count = text.length;
    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    const word_count = words.length;

    // Letter count (supports English, Latin, Devanagari, and common multilingual alphabets)
    const letters = text.match(/[\p{L}]/gu) || [];
    const letter_count = letters.length;

    // Digit count
    const digits = text.match(/\d/g) || [];
    const digit_count = digits.length;

    // Emoji count
    const emojis = text.match(EMOJI_REGEX) || [];
    const emoji_count = emojis.length;

    // Punctuation count
    const punctuations = text.match(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'–—]/g) || [];
    const punctuation_count = punctuations.length;

    // Whitespace count
    const whitespaces = text.match(/\s/g) || [];
    const whitespace_count = whitespaces.length;

    // Sentences
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0);
    const sentence_count = Math.max(1, sentences.length);

    // Statistical Ratios
    const uniqueChars = new Set(text.toLowerCase().replace(/\s/g, ''));
    const nonWsLength = Math.max(1, character_count - whitespace_count);
    const unique_character_ratio = Math.round((uniqueChars.size / nonWsLength) * 100) / 100;

    const lowerWords = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
    const uniqueWords = new Set(lowerWords.filter(Boolean));
    const unique_word_ratio = word_count > 0 ? Math.round((uniqueWords.size / word_count) * 100) / 100 : 0;

    const alphabetic_ratio = character_count > 0 ? Math.round((letter_count / character_count) * 100) / 100 : 0;

    // Detection Flags
    const whitespace_only = character_count === 0 || text.replace(/\s+/g, '').length === 0;

    const textWithoutEmojis = text.replace(EMOJI_REGEX, '').replace(/\s+/g, '');
    const emoji_only = !whitespace_only && emoji_count > 0 && textWithoutEmojis.length === 0;

    const single_character = text.replace(/\s+/g, '').length === 1;
    const single_word = word_count === 1 && !whitespace_only;
    const very_short = character_count > 0 && character_count < 12 && word_count <= 2;
    const is_short_content = !whitespace_only && !emoji_only && word_count <= 5;

    const textWithoutEmojiOrPunct = text
      .replace(EMOJI_REGEX, '')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'–—\s]/g, '')
      .toLowerCase();

    // Check repeated characters (e.g., "aaaaaaaa", "hehehehe", "hhhhhhh", "looool")
    const hasLongRepeat = /(.)\1{3,}/i.test(textWithoutEmojiOrPunct);
    const isRepeatedLaughter = /^(he|ha|lol|lmao|xd|rofl){2,}$/i.test(textWithoutEmojiOrPunct);
    const repeated_characters =
      hasLongRepeat ||
      isRepeatedLaughter ||
      (textWithoutEmojiOrPunct.length >= 4 && uniqueChars.size <= 2);

    // Check random numbers (e.g., "123456", "987654321")
    const textWithoutPunct = text.replace(/[.,\s]/g, '');
    const random_numbers = digit_count >= 3 && /^\d+$/.test(textWithoutPunct);

    // Repeated emoji
    const repeated_emoji = emoji_only && emoji_count >= 2;

    // URL or Handle only
    const url_only = /^(?:https?:\/\/|www\.)[^\s]+$/i.test(text);
    const username_only = /^@[a-zA-Z0-9_.]+$/.test(text);

    // Keyboard smash detection
    const lowerText = text.toLowerCase().replace(/\s+/g, '');
    let hasSequentialSmash = false;
    for (const seq of KEYBOARD_SEQUENCES) {
      if (lowerText.includes(seq)) {
        hasSequentialSmash = true;
        break;
      }
    }

    // High consonant clusters check per word (e.g. "sdfghjk", "zxcvbnm", "fgtrds")
    // Include 'y' in vowels to avoid flagging words like "trying", "rhythm", "crypt", etc.
    const wordsWithoutPunct = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean);
    const hasConsonantCluster = wordsWithoutPunct.some((w) => /[^aeiouy]{5,}/i.test(w) && !['rhythm', 'rhythms', 'lengths', 'strengths'].includes(w));
    const isConsonantDominant = hasConsonantCluster;

    const keyboard_smash =
      hasSequentialSmash ||
      isConsonantDominant ||
      (letter_count >= 5 && unique_character_ratio > 0.85 && !/[aeiouy]/i.test(textWithoutEmojiOrPunct));

    // Gibberish pattern
    const gibberish_pattern =
      keyboard_smash ||
      (textWithoutEmojiOrPunct.length > 10 && uniqueChars.size <= 3 && !hasLongRepeat);

    // Obvious test submission
    const cleanLower = text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const obvious_test_submission = TEST_PHRASES.includes(cleanLower);

    // Standalone name-only pattern (Single word capitalized or 1-2 words with no verb/predicate)
    const isSingleTitleCaseWord =
      single_word &&
      /^[A-Z][a-z]{1,15}$/.test(text.replace(/[.,!?]/g, '')) &&
      !['I', 'We', 'You', 'Love', 'Sorry', 'Thanks', 'Bye', 'Hi', 'Hey', 'Help', 'Why', 'Wait', 'Never'].includes(
        text.replace(/[.,!?]/g, '')
      );
    const name_only_pattern = isSingleTitleCaseWord;

    // Determine high-confidence junk (allowed to bypass expensive Groq analysis)
    let isObviousJunk = false;
    let junkReason: string | null = null;
    let suggestedCategory: QualityCategory | null = null;
    let deterministicScore = 70; // baseline neutral

    if (whitespace_only) {
      isObviousJunk = true;
      junkReason = 'Empty or whitespace-only submission.';
      suggestedCategory = 'LOW_INFORMATION';
      deterministicScore = 0;
    } else if (emoji_only) {
      isObviousJunk = true;
      junkReason = 'Emoji-only submission with no confession text, question, or context.';
      suggestedCategory = 'EMOJI_ONLY';
      deterministicScore = 5;
    } else if (character_count > 0 && letter_count === 0 && digit_count === 0 && emoji_count === 0) {
      // Pure punctuation (e.g. "...", "!!!", "???")
      isObviousJunk = true;
      junkReason = 'Punctuation-only submission without narrative content.';
      suggestedCategory = 'LOW_INFORMATION';
      deterministicScore = 5;
    } else if (random_numbers) {
      isObviousJunk = true;
      junkReason = 'Numeric digits only with no contextual confession.';
      suggestedCategory = 'LOW_INFORMATION';
      deterministicScore = 5;
    } else if (keyboard_smash) {
      isObviousJunk = true;
      junkReason = 'Keyboard smash / random character sequence.';
      suggestedCategory = 'GIBBERISH';
      deterministicScore = 5;
    } else if (obvious_test_submission) {
      isObviousJunk = true;
      junkReason = 'Obvious test or trial submission.';
      suggestedCategory = 'TEST_SUBMISSION';
      deterministicScore = 10;
    } else if (url_only || username_only) {
      isObviousJunk = true;
      junkReason = 'Isolated URL or social handle without confession context.';
      suggestedCategory = 'SPAM';
      deterministicScore = 10;
    } else if (single_character) {
      isObviousJunk = true;
      junkReason = 'Single character submission with no context.';
      suggestedCategory = 'LOW_INFORMATION';
      deterministicScore = 5;
    } else if (is_short_content) {
      // SPECIAL SHORT_CONTENT QUALITY BUCKET: word_count <= 5
      // DO NOT automatically reject!
      // Assign to SHORT_CONTENT with neutral baseline (NEEDS_REVIEW default)
      // and send to enhanced semantic evaluation.
      suggestedCategory = 'SHORT_CONTENT';
      deterministicScore = 60;
    } else if (word_count >= 15) {
      deterministicScore = 85;
      suggestedCategory = 'NORMAL';
    } else {
      deterministicScore = 70;
      suggestedCategory = 'NORMAL';
    }

    return {
      character_count,
      word_count,
      letter_count,
      digit_count,
      emoji_count,
      sentence_count,
      punctuation_count,
      whitespace_count,
      unique_character_ratio,
      unique_word_ratio,
      alphabetic_ratio,
      emoji_only,
      whitespace_only,
      single_word,
      single_character,
      very_short,
      is_short_content,
      repeated_characters,
      keyboard_smash,
      url_only,
      username_only,
      random_numbers,
      repeated_emoji,
      gibberish_pattern,
      obvious_test_submission,
      name_only_pattern,
      isObviousJunk,
      junkReason,
      suggestedCategory,
      deterministicScore,
    };
  }
}

export const deterministicQualityService = new DeterministicQualityService();
