import { describe, it, expect } from 'vitest';
import { imageService } from '../services/imageService';
import { Confession, Template } from '../types';

describe('ImageService 1080x1080 HTML & Dynamic Fitting', () => {
  const mockTemplate: Template = {
    id: 'test-template',
    name: 'Test',
    description: 'Testing',
    background: '#ffffff',
    text_color: '#000000',
    accent_color: '#e1306c',
    font_family: 'sans',
    font_size: 44,
    show_branding: true,
    show_confession_number: true,
    show_name: true,
    layout_config: { padding: 80 },
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockConfession: Confession = {
    id: 'test-conf-1',
    google_sheet_id: 'sheet_1',
    google_sheet_name: 'Confessions',
    google_sheet_row: 10,
    name: 'Aman',
    original_text: 'Test confession text <script>alert("xss")</script>',
    cleaned_text: 'Test confession text <script>alert("xss")</script>',
    display_name: 'Aman',
    is_anonymous: false,
    status: 'READY_FOR_REVIEW',
    moderation_status: 'LOW',
    moderation_reason: null,
    ai_processed: true,
    template_id: 'test-template',
    generated_image_url: null,
    generated_image_path: null,
    caption: 'Sample caption',
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

  it('should safely escape HTML characters to prevent XSS injection in generated cards', () => {
    const html = imageService.generateCardHtml({
      confession: mockConfession,
      template: mockTemplate,
      confessionNumber: 10,
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should adjust font size down dynamically for longer confessions', () => {
    const shortText = 'Short confession';
    const longText = 'A'.repeat(500);

    const shortSize = imageService.calculateDynamicFontSize(shortText, 44);
    const longSize = imageService.calculateDynamicFontSize(longText, 44);

    expect(shortSize.fontSize).toBeGreaterThan(longSize.fontSize);
  });

  it('should flag a warning when confession exceeds single post character capacity', () => {
    const extremelyLongText = 'Word '.repeat(300); // 1500 chars
    const fit = imageService.calculateDynamicFontSize(extremelyLongText, 44);

    expect(fit.warning).toBeDefined();
    expect(fit.warning).toContain('too long for a single post');
  });
});
