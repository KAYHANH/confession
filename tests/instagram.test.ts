import { describe, it, expect } from 'vitest';
import { instagramService } from '../services/instagramService';
import { Confession } from '../types';

describe('InstagramService & Duplicate Publication Prevention', () => {
  const mockConfession: Confession = {
    id: 'conf-ig-1',
    google_sheet_id: 'sheet_1',
    google_sheet_name: 'Confessions',
    google_sheet_row: 1,
    name: 'Rahul',
    original_text: 'Test text',
    cleaned_text: 'Test text',
    display_name: 'Rahul',
    is_anonymous: false,
    status: 'APPROVED',
    moderation_status: 'LOW',
    moderation_reason: null,
    ai_processed: true,
    template_id: 'tpl-1',
    generated_image_url: '/generated/sample.png',
    generated_image_path: null,
    caption: 'Test caption',
    hashtags: ['#test'],
    scheduled_at: null,
    published_at: null,
    instagram_media_id: null,
    instagram_permalink: null,
    retry_count: 0,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('should publish successfully in mock mode with realistic media ID and permalink', async () => {
    const result = await instagramService.publishPost(
      mockConfession,
      '/generated/sample.png',
      'Test caption'
    );

    expect(result.success).toBe(true);
    expect(result.mediaId).toBeDefined();
    expect(result.permalink).toContain('instagram.com/p/');
  });

  it('should strictly block duplicate publishing if already PUBLISHED or media ID exists', async () => {
    const publishedConfession: Confession = {
      ...mockConfession,
      status: 'PUBLISHED',
      instagram_media_id: 'existing_media_12345',
    };

    const result = await instagramService.publishPost(
      publishedConfession,
      '/generated/sample.png',
      'Test caption'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already published');
  });
});
