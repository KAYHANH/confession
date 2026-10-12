import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsService } from '../services/settingsService';
import { adaptiveSchedulingEngine } from '../services/growth/adaptiveSchedulingEngine';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';

describe('Auto-Approval & Scheduling In Hands-Free 24/7 Auto-Publish Mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('automatically sets require_approval to false and triggers recalculateFutureQueue when AUTO_PUBLISH is enabled', async () => {
    const mockConfessions: Confession[] = [
      {
        id: 'conf-low-1',
        google_sheet_row: 10,
        google_sheet_id: 'sheet',
        google_sheet_name: 'Sheet1',
        name: 'Anonymous',
        original_text: 'Safe low risk confession',
        cleaned_text: 'Safe low risk confession',
        display_name: 'Anonymous',
        is_anonymous: true,
        status: 'READY_FOR_REVIEW',
        moderation_status: 'LOW',
        moderation_reason: null,
        quality_status: 'HIGH_VALUE',
        ai_processed: true,
        template_id: 't-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: null,
        hashtags: [],
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

    mockStore.setConfessions(mockConfessions);

    // Initial state: MANUAL_APPROVAL with require_approval: true
    mockStore.updateSettings({
      publishing_mode: 'MANUAL_APPROVAL',
      auto_publish: false,
      auto_publish_enabled: false,
      require_approval: true,
    });

    const recalculateSpy = vi.spyOn(adaptiveSchedulingEngine, 'recalculateFutureQueue');

    // Admin switches to Full 24/7 Auto-Publish
    const res = await settingsService.updateSettings({
      auto_publish: true,
      auto_publish_enabled: true,
      publishing_mode: 'AUTO_PUBLISH',
    });

    // 1. require_approval must be automatically synchronized to false
    expect(res.settings.require_approval).toBe(false);
    expect(res.settings.publishing_mode).toBe('AUTO_PUBLISH');
    expect(res.settings.auto_publish).toBe(true);

    // 2. Immediate queue recalculation must have been triggered
    expect(recalculateSpy).toHaveBeenCalled();

    // 3. The safe confession must now be scheduled into the calendar
    const updated = mockStore.getConfessionById('conf-low-1');
    expect(updated?.status).toBe('SCHEDULED');
    expect(updated?.scheduled_at).not.toBeNull();
  });

  it('keeps confessions in READY_FOR_REVIEW when switched to MANUAL_APPROVAL mode', async () => {
    const mockConfessions: Confession[] = [
      {
        id: 'conf-manual-1',
        google_sheet_row: 11,
        google_sheet_id: 'sheet',
        google_sheet_name: 'Sheet1',
        name: 'Anonymous',
        original_text: 'Confession awaiting manual decision',
        cleaned_text: 'Confession awaiting manual decision',
        display_name: 'Anonymous',
        is_anonymous: true,
        status: 'READY_FOR_REVIEW',
        moderation_status: 'LOW',
        moderation_reason: null,
        quality_status: 'HIGH_VALUE',
        ai_processed: true,
        template_id: 't-1',
        generated_image_url: null,
        generated_image_path: null,
        caption: null,
        hashtags: [],
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

    mockStore.setConfessions(mockConfessions);

    const res = await settingsService.updateSettings({
      publishing_mode: 'MANUAL_APPROVAL',
      auto_publish: false,
    });

    expect(res.settings.require_approval).toBe(true);
    expect(res.settings.publishing_mode).toBe('MANUAL_APPROVAL');

    const item = mockStore.getConfessionById('conf-manual-1');
    expect(item?.status).toBe('READY_FOR_REVIEW');
    expect(item?.scheduled_at).toBeNull();
  });
});
