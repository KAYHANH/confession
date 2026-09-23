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

  it('should accurately parse solid color backgrounds into direct SVG fill', () => {
    const res = imageService.parseSvgBackground('#fafaf9');
    expect(res.fill).toBe('#fafaf9');
    expect(res.defs).toBe('');
  });

  it('should accurately parse Love & Romance linear gradient with correct stops', () => {
    const loveGradient = 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 50%, #fecdd3 100%)';
    const res = imageService.parseSvgBackground(loveGradient);

    expect(res.fill).toBe('url(#bgGrad)');
    expect(res.defs).toContain('<linearGradient id="bgGrad"');
    expect(res.defs).toContain('stop-color="#fff1f2"');
    expect(res.defs).toContain('stop-color="#ffe4e6"');
    expect(res.defs).toContain('stop-color="#fecdd3"');
    expect(res.defs).not.toContain('#1e1b4b');
    expect(res.defs).not.toContain('#4338ca');
  });

  it('should accurately parse Dark Velvet linear gradient with dark luxury stops', () => {
    const darkGradient = 'linear-gradient(145deg, #09090b 0%, #18181b 100%)';
    const res = imageService.parseSvgBackground(darkGradient);

    expect(res.fill).toBe('url(#bgGrad)');
    expect(res.defs).toContain('stop-color="#09090b"');
    expect(res.defs).toContain('stop-color="#18181b"');
  });

  it('should generate an actual PNG card using Love & Romance template with high contrast text and gradient', async () => {
    const loveTemplate: Template = {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Love & Romance',
      description: 'Soft blush rose gradient',
      background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 50%, #fecdd3 100%)',
      text_color: '#881337',
      accent_color: '#f43f5e',
      font_family: 'serif',
      font_size: 44,
      show_branding: true,
      show_confession_number: true,
      show_name: true,
      layout_config: { padding: 80 },
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const res = await imageService.generatePostImage({
      confession: {
        ...mockConfession,
        id: 'test-love-confession',
        original_text: 'I really love attending school and now I realize how precious those days were.',
        cleaned_text: 'I really love attending school and now I realize how precious those days were.',
      },
      template: loveTemplate,
      brandName: 'Campus Confessions',
      instagramHandle: '@_hpsconfession_',
      confessionNumber: 15,
    });

    const fs = await import('fs');
    expect(fs.existsSync(res.localPath)).toBe(true);

    const svgPath = res.localPath.replace(/\.png$/, '.svg');
    expect(fs.existsSync(svgPath)).toBe(true);

    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    // Verify soft blush gradient stops are used
    expect(svgContent).toContain('stop-color="#fff1f2"');
    expect(svgContent).toContain('stop-color="#ffe4e6"');
    expect(svgContent).toContain('stop-color="#fecdd3"');
    // Verify old midnight navy gradient stops are NOT used
    expect(svgContent).not.toContain('stop-color="#1e1b4b"');
    expect(svgContent).not.toContain('stop-color="#4338ca"');
    // Verify high-contrast dark burgundy text color is used
    expect(svgContent).toContain('fill="#881337"');
    // Verify bold / semi-bold font weight for mobile readability
    expect(svgContent).toContain('font-weight="600"');
    // Verify serif font family is applied
    expect(svgContent).toContain('Playfair Display');
  });
});

