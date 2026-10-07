import crypto from 'crypto';

/**
 * Decodes standard HTML entities and numerical entities.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ''; }
    });
}

/**
 * Normalizes confession text for robust duplicate detection and canonical comparison.
 * - Decodes HTML entities (&amp;, &quot;, &#39;, &nbsp;, etc.)
 * - Applies Unicode NFKC normalization
 * - Strips invisible and zero-width characters
 * - Converts escaped breaks (\n, \r, \t) and multi-spaces into single spaces
 * - Lowercases the result
 * - Trims leading and trailing spaces
 */
export function normalizeConfessionText(text: string | null | undefined): string {
  if (!text) return '';
  const decoded = decodeHtmlEntities(String(text));
  return decoded
    .normalize('NFKC')
    // Remove zero-width spaces, invisible separators, directional marks
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u202A-\u202E\u180E\u2060]/g, '')
    // Normalize literal escaped characters (\n, \r, \t)
    .replace(/\\n|\\r|\\t/g, ' ')
    // Normalize newlines and whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Generates a deterministic SHA-256 hash of the normalized confession text.
 */
export function generateContentHash(text: string | null | undefined): string {
  const normalized = normalizeConfessionText(text);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Generates a SHA-256 hash of the raw (non-normalized, only trimmed) confession text.
 */
export function generateRawContentHash(text: string | null | undefined): string {
  const raw = (text || '').trim();
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Creates an idempotency key for publishing attempts.
 * Format: confession:{confessionId}:attempt:{attempt}:instagram
 */
export function createPublishIdempotencyKey(
  confessionId: string,
  attempt: number = 1,
  channel: string = 'instagram'
): string {
  const cleanId = String(confessionId || '').trim();
  return `confession:${cleanId}:attempt:${attempt}:${channel}`;
}

/**
 * Creates an account-level channel idempotency key based on content hash.
 * This guarantees the exact same text is never pushed twice across the channel.
 */
export function createContentIdempotencyKey(
  contentHash: string,
  channel: string = 'instagram'
): string {
  return `content:${contentHash}:${channel}`;
}
