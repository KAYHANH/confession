import { describe, it, expect } from 'vitest';
import { aiService } from '../services/aiService';

describe('AIService Confession Processing', () => {
  it('should clean text and generate caption without inventing facts', async () => {
    const rawText = 'i have liked my best friend for two years but never told her';
    const result = await aiService.processConfession(rawText, 'Rahul', false, 1);

    // Text cleaned & capitalized
    expect(result.cleanedText.startsWith('I have liked')).toBe(true);
    // Preserves original core meaning
    expect(result.cleanedText.toLowerCase()).toContain('best friend for two years');
    // Display name respected
    expect(result.displayName).toBe('Rahul');
    // Caption generated with confession header
    expect(result.caption).toContain('Confession #001');
    // Relevant hashtags present
    expect(result.hashtags.length).toBeGreaterThanOrEqual(2);
    expect(result.hashtags.some((tag) => tag.includes('confession'))).toBe(true);
  });

  it('should anonymize display name when submitter is anonymous', async () => {
    const rawText = 'I left my jacket in the lab overnight and someone put candy in the pocket';
    const result = await aiService.processConfession(rawText, 'Sneha', true, 5);

    expect(result.displayName).toBe('Anonymous');
  });
});
