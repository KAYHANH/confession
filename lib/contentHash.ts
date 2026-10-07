import crypto from 'crypto';

/**
 * Normalizes confession text for robust duplicate detection and canonical comparison.
 * - Applies Unicode NFKC normalization
 * - Strips invisible and zero-width characters
 * - Normalizes all whitespace (newlines, tabs, multiple spaces) into a single space
 * - Lowercases the result
 * - Trims leading and trailing spaces
 */
export function normalizeConfessionText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    // Remove zero-width spaces, invisible separators, directional marks
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u202A-\u202E\u180E\u2060]/g, '')
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
