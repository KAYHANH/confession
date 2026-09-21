import { describe, it, expect } from 'vitest';
import { moderationService } from '../services/moderationService';

describe('ModerationService & PII Detection', () => {
  it('should mask 10-digit phone numbers properly', () => {
    const masked = moderationService.maskPhone('9876543210');
    expect(masked).toBe('********10');
  });

  it('should mask email addresses safely', () => {
    const masked = moderationService.maskEmail('student@university.edu');
    expect(masked).toContain('***');
    expect(masked.endsWith('@university.edu')).toBe(true);
  });

  it('should flag text containing phone numbers as MEDIUM or HIGH risk', () => {
    const text = 'Call me at 9876543210 to know the gossip';
    const result = moderationService.analyzeContent(text);
    expect(result.piiDetected.length).toBeGreaterThan(0);
    expect(result.piiDetected[0].type).toBe('phone');
    expect(result.risk).toBe('MEDIUM');
  });

  it('should flag severe threat or self-harm keywords as HIGH risk', () => {
    const text = 'I want to kill myself because exams were too hard';
    const result = moderationService.analyzeContent(text);
    expect(result.risk).toBe('HIGH');
    expect(result.reasons.some((r) => r.includes('critical safety risk'))).toBe(true);
  });

  it('should classify wholesome everyday confessions as LOW risk', () => {
    const text = 'I secretly leave chocolates on my roommates desk before every semester exam.';
    const result = moderationService.analyzeContent(text);
    expect(result.risk).toBe('LOW');
    expect(result.piiDetected.length).toBe(0);
    expect(result.flaggedKeywords.length).toBe(0);
  });

  it('should replace detected PII with masked tokens in text', () => {
    const text = 'Contact me on 9876543210 or john@test.com';
    const analysis = moderationService.analyzeContent(text);
    const masked = moderationService.maskSensitiveInformation(text, analysis.piiDetected);

    expect(masked).not.toContain('9876543210');
    expect(masked).toContain('********10');
    expect(masked).not.toContain('john@test.com');
  });
});
