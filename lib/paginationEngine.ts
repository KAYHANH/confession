import { Template } from '@/types';

export interface PaginatedSlide {
  index: number; // 1-indexed (1, 2, 3...)
  text: string;
  isFirst: boolean;
  isLast: boolean;
  wordCount: number;
  characterCount: number;
}

export interface PaginationConfig {
  fontSize?: number;
  lineHeightRatio?: number;
  contentWidth?: number;      // default: 940px (1080 - 140px margins)
  maxAvailableHeight?: number; // default: 840px (1350 - header, footer, signature, quote)
  minLookbackRatio?: number;  // search for clean break in last 35% of fitting chunk
}

export interface PaginationResult {
  sourceConfession: string;
  slides: PaginatedSlide[];
  totalSlides: number;
  format: 'IMAGE' | 'CAROUSEL';
  recommendedFormat: 'Single Post' | 'Carousel';
  canFitSingle: boolean;
  wordCount: number;
  characterCount: number;
  exceedsPlatformLimit: boolean;
  validationError?: string;
}

/**
 * Tokenize a string into non-whitespace tokens (words, punctuation, emojis).
 * Supports full Unicode (including surrogate pairs and multi-codepoint emojis).
 */
export function tokenize(text: string): string[] {
  return text.trim().match(/\S+/gu) || [];
}

/**
 * Verifies that all tokens from sourceConfession appear in the slides in exact order.
 * Ensures zero content loss, zero text duplication, and zero silent truncations.
 */
export function verifyContentPreservation(sourceConfession: string, slides: string[]): boolean {
  const sourceTokens = tokenize(sourceConfession);
  const slideTokens = tokenize(slides.join(' '));

  if (sourceTokens.length !== slideTokens.length) {
    return false;
  }

  for (let i = 0; i < sourceTokens.length; i++) {
    if (sourceTokens[i] !== slideTokens[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Wraps text into lines based on paragraph structure and character capacity per line.
 * Preserves explicit newlines and paragraph breaks.
 */
export function wrapTextIntoLines(text: string, charsPerLine: number = 42): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    const words = para.trim().split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if ((currentLine + ' ' + word).length <= charsPerLine) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Measure the rendered line count for a given text block.
 */
export function measureRenderedLines(text: string, charsPerLine: number = 42): number {
  return wrapTextIntoLines(text, charsPerLine).length;
}

/**
 * Calculates typography and line metrics for 1080x1350 card.
 * Consistent across preview, server SVG renderer, and download canvas.
 */
export function getSlideTypographyMetrics(
  textLength: number,
  baseFontSize: number = 38
): {
  fontSize: number;
  lineSpacing: number;
  charsPerLine: number;
  maxLinesPerSlide: number;
  maxHeight: number;
} {
  // Max available height between header (y=122 + 30) and footer (y=1210) minus signature (56px) and quote (80px)
  const maxHeight = 840;

  if (textLength < 180) {
    // Large, spacious display typography for short confessions
    const fontSize = Math.min(46, baseFontSize + 6);
    const lineSpacing = Math.round(fontSize * 1.42);
    const charsPerLine = 36;
    const maxLinesPerSlide = Math.floor(maxHeight / lineSpacing);
    return { fontSize, lineSpacing, charsPerLine, maxLinesPerSlide, maxHeight };
  }

  if (textLength < 450) {
    // Standard legible typography
    const fontSize = Math.min(36, baseFontSize);
    const lineSpacing = Math.round(fontSize * 1.38);
    const charsPerLine = 42;
    const maxLinesPerSlide = Math.floor(maxHeight / lineSpacing);
    return { fontSize, lineSpacing, charsPerLine, maxLinesPerSlide, maxHeight };
  }

  if (textLength < 900) {
    // Slightly more compact for medium text
    const fontSize = 30;
    const lineSpacing = 42;
    const charsPerLine = 48;
    const maxLinesPerSlide = Math.floor(maxHeight / lineSpacing);
    return { fontSize, lineSpacing, charsPerLine, maxLinesPerSlide, maxHeight };
  }

  // Carousel slide standard (balanced density and legibility)
  const fontSize = 28;
  const lineSpacing = 39;
  const charsPerLine = 52;
  const maxLinesPerSlide = Math.floor(maxHeight / lineSpacing);
  return { fontSize, lineSpacing, charsPerLine, maxLinesPerSlide, maxHeight };
}

/**
 * Check if the entire confession can safely fit on a single 1080x1350 card
 * without visual overflow or shrinking below minimum readable font size (22px).
 */
export function canFitOnSingleCard(sourceConfession: string, _template?: Template): boolean {
  const text = sourceConfession.trim();
  if (!text) return true;

  // Single card can scale down to min readable size 24px (charsPerLine ~52, maxLines ~24)
  const maxSingleCardLines = 24;
  const charsPerLine = 52;
  const lines = wrapTextIntoLines(text, charsPerLine);

  return lines.length <= maxSingleCardLines;
}

/**
 * Paginate source confession across 1 to N slides based on true rendered layout.
 * NEVER truncates text. All source text appears in exactly one slide.
 */
export function paginateConfession(
  sourceConfession: string,
  _config?: PaginationConfig
): PaginationResult {
  const cleanSource = (sourceConfession || '').trim();
  const wordCount = cleanSource.split(/\s+/).filter(Boolean).length;
  const characterCount = cleanSource.length;

  if (!cleanSource) {
    return {
      sourceConfession: '',
      slides: [
        {
          index: 1,
          text: '',
          isFirst: true,
          isLast: true,
          wordCount: 0,
          characterCount: 0,
        },
      ],
      totalSlides: 1,
      format: 'IMAGE',
      recommendedFormat: 'Single Post',
      canFitSingle: true,
      wordCount: 0,
      characterCount: 0,
      exceedsPlatformLimit: false,
    };
  }

  // 1. Check if complete text fits safely on 1 card at comfortable size
  // Comfortable 1-card limit is ~16 lines at standard size
  const standardMetrics = getSlideTypographyMetrics(characterCount);
  const initialLines = wrapTextIntoLines(cleanSource, standardMetrics.charsPerLine);

  if (initialLines.length <= standardMetrics.maxLinesPerSlide) {
    return {
      sourceConfession: cleanSource,
      slides: [
        {
          index: 1,
          text: cleanSource,
          isFirst: true,
          isLast: true,
          wordCount,
          characterCount,
        },
      ],
      totalSlides: 1,
      format: 'IMAGE',
      recommendedFormat: 'Single Post',
      canFitSingle: true,
      wordCount,
      characterCount,
      exceedsPlatformLimit: false,
    };
  }

  // 2. If it does not fit in 1 standard slide, dynamically paginate across multiple slides
  // In carousel mode, each slide uses comfortable reading typography
  const slideMetrics = getSlideTypographyMetrics(500); // 30px fontSize, 48 chars/line
  const maxLines = Math.min(16, slideMetrics.maxLinesPerSlide); // Keep ~14-16 lines per slide for optimal readability
  const charsPerLine = slideMetrics.charsPerLine;

  const rawSlides: string[] = [];
  let remaining = cleanSource;

  while (remaining.length > 0) {
    const remainingLines = wrapTextIntoLines(remaining, charsPerLine);
    if (remainingLines.length <= maxLines) {
      rawSlides.push(remaining.trim());
      break;
    }

    // Binary search on character slice to find maximum text fitting in maxLines
    let low = 1;
    let high = remaining.length;
    let maxFittingCharIdx = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const substr = remaining.slice(0, mid);
      if (wrapTextIntoLines(substr, charsPerLine).length <= maxLines) {
        maxFittingCharIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Safe boundary hierarchy:
    // 1. Paragraph boundary (\n\n or \n)
    // 2. Sentence boundary (. ! ? with optional closing quote/paren)
    // 3. Clause boundary (, ; : -)
    // 4. Word boundary (whitespace)
    const minLookback = Math.max(1, Math.floor(maxFittingCharIdx * 0.65));
    const searchSlice = remaining.slice(0, maxFittingCharIdx);
    let cutIdx = maxFittingCharIdx;
    let foundBoundary = false;

    // 1. Check paragraph boundary
    const lastDoubleNewline = searchSlice.lastIndexOf('\n\n');
    if (lastDoubleNewline >= minLookback) {
      cutIdx = lastDoubleNewline;
      foundBoundary = true;
    } else {
      const lastSingleNewline = searchSlice.lastIndexOf('\n');
      if (lastSingleNewline >= minLookback) {
        cutIdx = lastSingleNewline;
        foundBoundary = true;
      }
    }

    // 2. Check sentence boundary (. ! ?)
    if (!foundBoundary) {
      const sentenceRegex = /[.!?]['"”)\]]?(?=\s|$)/g;
      let match: RegExpExecArray | null;
      let lastSentenceEnd = -1;
      while ((match = sentenceRegex.exec(searchSlice)) !== null) {
        const endPos = match.index + match[0].length;
        if (endPos >= minLookback) {
          lastSentenceEnd = endPos;
        }
      }
      if (lastSentenceEnd !== -1) {
        cutIdx = lastSentenceEnd;
        foundBoundary = true;
      }
    }

    // 3. Check clause boundary (, ; :)
    if (!foundBoundary) {
      const clauseRegex = /[,;:-](?=\s)/g;
      let match: RegExpExecArray | null;
      let lastClauseEnd = -1;
      while ((match = clauseRegex.exec(searchSlice)) !== null) {
        const endPos = match.index + match[0].length;
        if (endPos >= minLookback) {
          lastClauseEnd = endPos;
        }
      }
      if (lastClauseEnd !== -1) {
        cutIdx = lastClauseEnd;
        foundBoundary = true;
      }
    }

    // 4. Check whitespace boundary (avoid mid-word split)
    if (!foundBoundary) {
      const lastSpace = searchSlice.lastIndexOf(' ');
      if (lastSpace >= minLookback) {
        cutIdx = lastSpace;
        foundBoundary = true;
      }
    }

    // Fallback: If no clean boundary found in lookback window, search forward up to next space
    if (!foundBoundary) {
      const nextSpace = remaining.indexOf(' ', maxFittingCharIdx);
      if (nextSpace !== -1 && nextSpace - maxFittingCharIdx < 20) {
        cutIdx = nextSpace;
      }
    }

    const slideChunk = remaining.slice(0, cutIdx).trim();
    if (slideChunk) {
      rawSlides.push(slideChunk);
    }
    remaining = remaining.slice(cutIdx).trimStart();
  }

  // 3. Run validation pass: verify all original words exist across slides
  const isPreserved = verifyContentPreservation(cleanSource, rawSlides);
  let validationError: string | undefined;
  if (!isPreserved) {
    validationError = 'Unable to safely paginate the confession without losing content.';
  }

  const totalSlides = rawSlides.length;
  const exceedsPlatformLimit = totalSlides > 10;
  if (exceedsPlatformLimit && !validationError) {
    validationError = `This confession is too long for one Instagram carousel (generated ${totalSlides} slides, platform limit is 10). Please shorten it or choose a different publishing format.`;
  }

  const slides: PaginatedSlide[] = rawSlides.map((text, idx) => ({
    index: idx + 1,
    text,
    isFirst: idx === 0,
    isLast: idx === rawSlides.length - 1,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    characterCount: text.length,
  }));

  const canFitSingle = canFitOnSingleCard(cleanSource);

  return {
    sourceConfession: cleanSource,
    slides,
    totalSlides,
    format: totalSlides > 1 ? 'CAROUSEL' : 'IMAGE',
    recommendedFormat: totalSlides > 1 ? 'Carousel' : 'Single Post',
    canFitSingle,
    wordCount,
    characterCount,
    exceedsPlatformLimit,
    validationError,
  };
}

/**
 * Builds an independent Instagram caption.
 * By default, NEVER includes the full confession body unless mode === 'hook'.
 */
export function buildInstagramCaption(options: {
  confessionNumber: number;
  hashtags?: string[];
  mode?: 'fit' | 'hook' | 'carousel' | 'auto';
  sourceConfession?: string;
  teaser?: string;
}): string {
  const numFormatted = String(options.confessionNumber || 1).padStart(3, '0');
  const defaultTags = ['#confession', '#campuslife', '#studentconfessions'];
  const tagsList = options.hashtags && options.hashtags.length > 0 ? options.hashtags : defaultTags;
  const tagsStr = tagsList.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');

  // ONLY Hook + Caption explicitly includes the full confession in the caption
  if (options.mode === 'hook' && options.sourceConfession) {
    return `Confession #${numFormatted} 💭\n\n${options.sourceConfession.trim()}\n\nShare your thoughts below 👇\n\n${tagsStr}`;
  }

  // Teaser prompt if provided
  if (options.teaser && options.teaser.trim()) {
    return `Confession #${numFormatted} 💭\n\n${options.teaser.trim()}\n\nShare your thoughts below 👇\n\n${tagsStr}`;
  }

  // Standard clean Instagram caption
  return `Confession #${numFormatted} 💭\n\nShare your thoughts below 👇\n\n${tagsStr}`;
}

/**
 * Extracts a punchy hook from a long confession for "Hook + Caption" mode.
 */
export function createHookText(sourceConfession: string, maxChars: number = 280): string {
  const trimmed = sourceConfession.trim();
  if (trimmed.length <= maxChars) {
    return `${trimmed}\n\n[📖 Read full confession in caption 👇]`;
  }

  const slice = trimmed.substring(0, maxChars);
  const sentenceRegex = /[.!?]['"”)\]]?(?=\s|$)/g;
  let match: RegExpExecArray | null;
  let lastSentenceEnd = -1;
  while ((match = sentenceRegex.exec(slice)) !== null) {
    if (match.index + match[0].length >= 100) {
      lastSentenceEnd = match.index + match[0].length;
    }
  }

  const cutIdx = lastSentenceEnd !== -1 ? lastSentenceEnd : Math.max(100, slice.lastIndexOf(' '));
  const hookPortion = trimmed.substring(0, cutIdx).trim();

  return `${hookPortion}...\n\n[📖 Read full confession in caption 👇]`;
}

export interface PublicationPayloadValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Rigorous pre-flight validation before publishing to Instagram.
 * Blocks publishing if content loss, invalid state, or slide limits are detected.
 */
export function validatePublicationPayload(params: {
  sourceConfession: string;
  slides: string[];
  mode: 'fit' | 'hook' | 'carousel';
  caption: string;
}): PublicationPayloadValidation {
  const errors: string[] = [];
  const { sourceConfession, slides, mode, caption } = params;

  // 1. sourceConfession exists
  if (!sourceConfession || !sourceConfession.trim()) {
    errors.push('Source confession is empty or missing.');
  }

  // 2. rendered slides exist
  if (!slides || slides.length === 0) {
    errors.push('No rendered slides provided for publication.');
  }

  // 3. if CAROUSEL: slides.length >= 2
  if (mode === 'carousel' && slides.length < 2) {
    errors.push('Carousel format requires at least 2 slides.');
  }

  // 4. every source text segment is non-empty
  if (slides && slides.some((s) => !s || !s.trim())) {
    errors.push('One or more slides contain empty content.');
  }

  // 5 & 6. For Carousel and Fit modes, verify all source content is consumed and no text was lost
  if (mode !== 'hook' && sourceConfession) {
    const isPreserved = verifyContentPreservation(sourceConfession, slides);
    if (!isPreserved) {
      errors.push('Unable to safely paginate the confession without losing content. Source text and slide content mismatch.');
    }
  }

  // 7. Caption does not contain the full confession unless explicitly requested (Hook mode)
  if (mode !== 'hook' && sourceConfession && sourceConfession.trim().length > 40) {
    if (caption.includes(sourceConfession.trim())) {
      errors.push('Instagram caption must not duplicate the full confession body in visual post mode.');
    }
  }

  // 8. Platform limit: Instagram allows at most 10 carousel items
  if (slides && slides.length > 10) {
    errors.push(`This confession is too long for one Instagram carousel (has ${slides.length} slides, platform limit is 10). Please shorten it or choose a different publishing format.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
