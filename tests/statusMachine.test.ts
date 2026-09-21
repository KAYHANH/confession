import { describe, it, expect } from 'vitest';
import { confessionService, ALLOWED_TRANSITIONS } from '../services/confessionService';

describe('Confession Status State Machine & Guardrails', () => {
  it('should allow valid sequential status transitions', () => {
    expect(confessionService.isValidTransition('NEW', 'IMPORTED')).toBe(true);
    expect(confessionService.isValidTransition('IMPORTED', 'PROCESSING')).toBe(true);
    expect(confessionService.isValidTransition('PROCESSING', 'READY_FOR_REVIEW')).toBe(true);
    expect(confessionService.isValidTransition('READY_FOR_REVIEW', 'APPROVED')).toBe(true);
    expect(confessionService.isValidTransition('APPROVED', 'PUBLISHING')).toBe(true);
    expect(confessionService.isValidTransition('PUBLISHING', 'PUBLISHED')).toBe(true);
  });

  it('should reject invalid illegal state skips', () => {
    expect(confessionService.isValidTransition('NEW', 'PUBLISHED')).toBe(false);
    expect(confessionService.isValidTransition('IMPORTED', 'PUBLISHING')).toBe(false);
    expect(confessionService.isValidTransition('READY_FOR_REVIEW', 'PUBLISHED')).toBe(false);
  });

  it('should disallow publishing from terminal PUBLISHED status', () => {
    expect(confessionService.isValidTransition('PUBLISHED', 'PUBLISHING')).toBe(false);
    expect(confessionService.isValidTransition('PUBLISHED', 'PROCESSING')).toBe(false);
    expect(ALLOWED_TRANSITIONS['PUBLISHED'].length).toBe(0);
  });

  it('should allow recovering from FAILED to PUBLISHING', () => {
    expect(confessionService.isValidTransition('FAILED', 'PUBLISHING')).toBe(true);
  });
});
