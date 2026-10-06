import { describe, it, expect, beforeEach, vi } from 'vitest';
import { confessionService } from '../services/confessionService';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';

describe('Settings Cascading & Real-Time Sync to Confessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should cascade default_template_id to all unpublished confessions and invalidate image cache', async () => {
    const confessions: Confession[] = [
      {
        id: 'conf-1',
        google_sheet_id: 'sheet-1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 10,
        name: 'Alex',
        original_text: 'I have a huge crush on someone in my class.',
        cleaned_text: 'I have a huge crush on someone in my class.',
        display_name: 'Alex',
        is_anonymous: true,
        status: 'READY_FOR_REVIEW',
        moderation_status: 'LOW',
        moderation_reason: 'Passed safety validation.',
        ai_processed: true,
        template_id: 'template-old',
        generated_image_url: 'https://cdn.example.com/images/card-1.png',
        generated_image_path: '/path/to/card-1.png',
        caption: 'Confession #010 💭\n\nShare your thoughts below 👇\n\n#confession',
        hashtags: ['#confession'],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'conf-published',
        google_sheet_id: 'sheet-1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 5,
        name: 'Jordan',
        original_text: 'Published confession text.',
        cleaned_text: 'Published confession text.',
        display_name: 'Jordan',
        is_anonymous: true,
        status: 'PUBLISHED',
        moderation_status: 'LOW',
        moderation_reason: 'Passed safety validation.',
        ai_processed: true,
        template_id: 'template-old',
        generated_image_url: 'https://cdn.example.com/images/card-pub.png',
        generated_image_path: '/path/to/card-pub.png',
        caption: 'Confession #005 💭\n\n#confession',
        hashtags: ['#confession'],
        scheduled_at: null,
        published_at: new Date().toISOString(),
        instagram_media_id: 'ig-123456',
        instagram_permalink: 'https://instagram.com/p/abc/',
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    mockStore.setConfessions(confessions);

    const result = await confessionService.syncSettingsToConfessions({
      default_template_id: 'template-new-gold',
    });

    expect(result.updatedCount).toBe(1);

    const updatedConf1 = mockStore.getConfessionById('conf-1');
    expect(updatedConf1?.template_id).toBe('template-new-gold');
    expect(updatedConf1?.generated_image_url).toBeNull();
    expect(updatedConf1?.generated_image_path).toBeNull();

    // Published post must NEVER be touched
    const publishedPost = mockStore.getConfessionById('conf-published');
    expect(publishedPost?.template_id).toBe('template-old');
    expect(publishedPost?.generated_image_url).toBe('https://cdn.example.com/images/card-pub.png');
  });

  it('should cascade default_hashtags and rebuild captions for unpublished confessions', async () => {
    const confessions: Confession[] = [
      {
        id: 'conf-2',
        google_sheet_id: 'sheet-1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 25,
        name: 'Sam',
        original_text: 'Late night library sessions are the best.',
        cleaned_text: 'Late night library sessions are the best.',
        display_name: 'Sam',
        is_anonymous: true,
        status: 'APPROVED',
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'template-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: 'Old caption',
        hashtags: ['#oldtag'],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    mockStore.setConfessions(confessions);

    const newTags = ['#campus', '#collegelife', '#hpssecret'];
    await confessionService.syncSettingsToConfessions({
      default_hashtags: newTags,
    });

    const updatedConf2 = mockStore.getConfessionById('conf-2');
    expect(updatedConf2?.hashtags).toEqual(newTags);
    expect(updatedConf2?.caption).toContain('#campus #collegelife #hpssecret');
    expect(updatedConf2?.caption).toContain('Confession #025');
  });

  it('should invalidate image cache when brand_name or instagram_handle is updated', async () => {
    const confessions: Confession[] = [
      {
        id: 'conf-3',
        google_sheet_id: 'sheet-1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 30,
        name: 'Taylor',
        original_text: 'Secret crush on professor.',
        cleaned_text: 'Secret crush on professor.',
        display_name: 'Taylor',
        is_anonymous: true,
        status: 'READY_FOR_REVIEW',
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'template-1',
        generated_image_url: 'https://cdn.example.com/images/card-old-brand.png',
        generated_image_path: '/path/card-old-brand.png',
        caption: 'Caption',
        hashtags: ['#confession'],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    mockStore.setConfessions(confessions);

    await confessionService.syncSettingsToConfessions({
      brand_name: 'HPS Confessions Official',
      instagram_handle: '@_hpsconfession_',
    });

    const updatedConf3 = mockStore.getConfessionById('conf-3');
    expect(updatedConf3?.generated_image_url).toBeNull();
    expect(updatedConf3?.generated_image_path).toBeNull();
  });

  it('should invalidate image cache when a template is updated via invalidateImagesForTemplate', async () => {
    const confessions: Confession[] = [
      {
        id: 'conf-4',
        google_sheet_id: 'sheet-1',
        google_sheet_name: 'Confessions',
        google_sheet_row: 40,
        name: 'Morgan',
        original_text: 'Funny campus memory.',
        cleaned_text: 'Funny campus memory.',
        display_name: 'Morgan',
        is_anonymous: true,
        status: 'APPROVED',
        moderation_status: 'LOW',
        moderation_reason: null,
        ai_processed: true,
        template_id: 'tpl-neon',
        generated_image_url: 'https://cdn.example.com/images/card-neon.png',
        generated_image_path: '/path/card-neon.png',
        caption: 'Caption',
        hashtags: ['#confession'],
        scheduled_at: null,
        published_at: null,
        instagram_media_id: null,
        instagram_permalink: null,
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    mockStore.setConfessions(confessions);

    const invalidatedCount = await confessionService.invalidateImagesForTemplate('tpl-neon');
    expect(invalidatedCount).toBe(1);

    const updatedConf4 = mockStore.getConfessionById('conf-4');
    expect(updatedConf4?.generated_image_url).toBeNull();
    expect(updatedConf4?.generated_image_path).toBeNull();
  });
});
