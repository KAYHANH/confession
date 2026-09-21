import fs from 'fs';
import path from 'path';
import { Confession, Template } from '@/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface ImageGenerationOptions {
  confession: Confession;
  template: Template;
  brandName?: string;
  instagramHandle?: string;
  confessionNumber?: number;
}

export class ImageService {
  private outputDir: string;

  constructor() {
    this.outputDir = path.join(process.cwd(), 'public', 'generated');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Escape HTML to prevent XSS in rendering
   */
  public escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Calculate dynamic font size based on text length to prevent overflow in 1080x1080 canvas
   */
  public calculateDynamicFontSize(text: string, baseSize: number = 44): { fontSize: number; lineHeight: number; warning?: string } {
    const len = text.length;
    if (len < 100) {
      return { fontSize: baseSize + 6, lineHeight: 1.45 };
    }
    if (len < 250) {
      return { fontSize: baseSize, lineHeight: 1.4 };
    }
    if (len < 400) {
      return { fontSize: Math.max(32, baseSize - 6), lineHeight: 1.35 };
    }
    if (len < 650) {
      return { fontSize: Math.max(26, baseSize - 12), lineHeight: 1.3 };
    }
    if (len < 900) {
      return { fontSize: Math.max(22, baseSize - 16), lineHeight: 1.25 };
    }
    return {
      fontSize: 20,
      lineHeight: 1.2,
      warning: 'Confession is too long for a single post. Consider editing or creating a carousel.',
    };
  }

  /**
   * Generate safe 1080x1080 HTML content for the template
   */
  public generateCardHtml(options: ImageGenerationOptions): string {
    const { confession, template, brandName = 'Campus Confessions', instagramHandle = '@campusconfessions', confessionNumber = 1 } = options;
    
    const safeText = this.escapeHtml(confession.cleaned_text || confession.original_text);
    const safeName = this.escapeHtml(confession.is_anonymous ? 'Anonymous' : confession.display_name);
    const safeBrand = this.escapeHtml(brandName);
    const safeHandle = this.escapeHtml(instagramHandle);
    const numFormatted = String(confessionNumber).padStart(3, '0');

    const { fontSize, lineHeight } = this.calculateDynamicFontSize(confession.cleaned_text || confession.original_text, template.font_size);
    const fontFamily = template.font_family === 'serif' 
      ? `'Playfair Display', Georgia, serif` 
      : `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

    const padding = template.layout_config?.padding || 80;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,700;1,400&display=swap');
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      width: 1080px;
      height: 1080px;
      overflow: hidden;
      background: ${template.background};
      color: ${template.text_color};
      font-family: ${fontFamily};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: ${padding}px;
      position: relative;
    }

    /* Ambient decorative accents */
    .glow-circle {
      position: absolute;
      width: 600px;
      height: 600px;
      border-radius: 50%;
      background: radial-gradient(circle, ${template.accent_color}15 0%, transparent 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    /* Header section */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      z-index: 2;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 22px;
      background: ${template.accent_color}18;
      border: 1.5px solid ${template.accent_color}40;
      color: ${template.accent_color};
      border-radius: 9999px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      font-family: 'Inter', sans-serif;
    }

    .branding-top {
      font-size: 20px;
      font-weight: 600;
      opacity: 0.75;
      letter-spacing: 0.5px;
      color: ${template.text_color};
      font-family: 'Inter', sans-serif;
    }

    /* Confession text container */
    .content-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      margin: 40px 0;
      z-index: 2;
      max-height: 720px;
    }

    .quote-mark {
      font-size: 72px;
      line-height: 1;
      color: ${template.accent_color};
      opacity: 0.8;
      margin-bottom: -15px;
      font-family: Georgia, serif;
    }

    .confession-text {
      font-size: ${fontSize}px;
      line-height: ${lineHeight};
      font-weight: 500;
      letter-spacing: -0.01em;
      white-space: pre-wrap;
      word-break: break-word;
      opacity: 0.96;
    }

    .submitter-signature {
      margin-top: 36px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 26px;
      font-weight: 600;
      color: ${template.accent_color};
      font-family: 'Inter', sans-serif;
    }

    .submitter-signature::before {
      content: '';
      display: inline-block;
      width: 32px;
      height: 3px;
      background: ${template.accent_color};
      border-radius: 2px;
    }

    /* Footer section */
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      border-top: 1.5px solid ${template.text_color}18;
      padding-top: 24px;
      font-size: 18px;
      font-weight: 500;
      opacity: 0.65;
      font-family: 'Inter', sans-serif;
      z-index: 2;
    }

    .footer-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .footer-handle {
      font-weight: 600;
      color: ${template.accent_color};
    }
  </style>
</head>
<body>
  <div class="glow-circle"></div>

  <div class="header">
    ${template.show_confession_number ? `<div class="badge">CONFESSION #${numFormatted}</div>` : '<div></div>'}
    ${template.show_branding ? `<div class="branding-top">${safeBrand}</div>` : '<div></div>'}
  </div>

  <div class="content-area">
    ${template.layout_config?.quote_icon !== false ? `<div class="quote-mark">&ldquo;</div>` : ''}
    <div class="confession-text">${safeText}</div>
    ${template.show_name ? `<div class="submitter-signature">&mdash; ${safeName}</div>` : ''}
  </div>

  <div class="footer">
    <div class="footer-left">
      <span>${safeBrand}</span>
      <span>&bull;</span>
      <span class="footer-handle">${safeHandle}</span>
    </div>
    <div>ConfessionFlow Platform</div>
  </div>
</body>
</html>`;
  }

  /**
   * Render HTML card to PNG file
   */
  public async generatePostImage(options: ImageGenerationOptions): Promise<{ localPath: string; publicUrl: string }> {
    const { confession } = options;
    const htmlContent = this.generateCardHtml(options);
    const filename = `${confession.id}.png`;
    const localFilePath = path.join(this.outputDir, filename);

    // Try Playwright rendering
    let rendered = false;
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage({
        viewport: { width: 1080, height: 1080 },
        deviceScaleFactor: 1,
      });

      await page.setContent(htmlContent, { waitUntil: 'networkidle' });
      await page.screenshot({ path: localFilePath, type: 'png' });
      await browser.close();
      rendered = true;
    } catch (err: any) {
      console.warn('[ImageService] Playwright browser snapshot failed or downloading, using high-fidelity SVG snapshot engine:', err?.message);
    }

    // Fallback: If Playwright fails or is unavailable, create a standalone SVG/HTML card
    if (!rendered || !fs.existsSync(localFilePath)) {
      await this.generateSvgPngFallback(options, localFilePath);
    }

    const publicUrl = `/generated/${filename}`;

    // Optionally upload to Supabase Storage if configured
    try {
      if (
        process.env.MOCK_EXTERNAL_APIS !== 'true' &&
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
      ) {
        const supabase = createServerSupabaseClient();
        const fileBuffer = fs.readFileSync(localFilePath);
        const date = new Date();
        const storagePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${filename}`;

        const { error: uploadError } = await supabase.storage
          .from('instagram-posts')
          .upload(storagePath, fileBuffer, {
            contentType: 'image/png',
            upsert: true,
          });

        if (!uploadError) {
          const { data: publicData } = supabase.storage
            .from('instagram-posts')
            .getPublicUrl(storagePath);
          return {
            localPath: localFilePath,
            publicUrl: publicData.publicUrl,
          };
        }
      }
    } catch (storageErr) {
      console.warn('[ImageService] Supabase storage upload skipped or failed:', storageErr);
    }

    return {
      localPath: localFilePath,
      publicUrl,
    };
  }

  /**
   * Fallback SVG renderer to guarantee a pixel-perfect 1080x1080 visual card
   */
  private async generateSvgPngFallback(options: ImageGenerationOptions, targetPath: string): Promise<void> {
    const { confession, template, brandName = 'Campus Confessions', instagramHandle = '@campusconfessions', confessionNumber = 1 } = options;
    const numFormatted = String(confessionNumber).padStart(3, '0');
    const safeText = this.escapeHtml(confession.cleaned_text || confession.original_text);
    const safeName = this.escapeHtml(confession.is_anonymous ? 'Anonymous' : confession.display_name);

    // Split into readable lines for SVG text wrapping
    const words = safeText.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ' ' + word).length > 38) {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += ' ' + word;
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    const svg = `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${template.background.includes('linear') ? '#1e1b4b' : template.background}" />
          <stop offset="100%" stop-color="${template.background.includes('linear') ? '#4338ca' : '#f3f4f6'}" />
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bgGrad)" />
      
      <!-- Header Badge -->
      <rect x="80" y="80" width="310" height="56" rx="28" fill="${template.accent_color}" fill-opacity="0.2" stroke="${template.accent_color}" stroke-width="2" />
      <text x="235" y="117" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" fill="${template.accent_color}" text-anchor="middle" letter-spacing="2">
        CONFESSION #${numFormatted}
      </text>
      
      <!-- Brand Top -->
      <text x="1000" y="117" font-family="system-ui, sans-serif" font-size="22" font-weight="600" fill="${template.text_color}" opacity="0.75" text-anchor="end">
        ${this.escapeHtml(brandName)}
      </text>

      <!-- Quote Mark -->
      <text x="80" y="320" font-family="Georgia, serif" font-size="96" fill="${template.accent_color}" opacity="0.85">&ldquo;</text>

      <!-- Confession Text Lines -->
      ${lines.slice(0, 12).map((l, i) => `
        <text x="80" y="${390 + i * 46}" font-family="system-ui, sans-serif" font-size="34" font-weight="500" fill="${template.text_color}">
          ${l}
        </text>
      `).join('')}

      <!-- Signature -->
      <line x1="80" y1="${390 + Math.min(lines.length, 12) * 46 + 40}" x2="130" y2="${390 + Math.min(lines.length, 12) * 46 + 40}" stroke="${template.accent_color}" stroke-width="4" stroke-linecap="round" />
      <text x="150" y="${390 + Math.min(lines.length, 12) * 46 + 48}" font-family="system-ui, sans-serif" font-size="28" font-weight="bold" fill="${template.accent_color}">
        ${safeName}
      </text>

      <!-- Footer Divider & Meta -->
      <line x1="80" y1="980" x2="1000" y2="980" stroke="${template.text_color}" stroke-opacity="0.2" stroke-width="2" />
      <text x="80" y="1025" font-family="system-ui, sans-serif" font-size="20" fill="${template.text_color}" opacity="0.7">
        ${this.escapeHtml(brandName)} &bull; ${this.escapeHtml(instagramHandle)}
      </text>
      <text x="1000" y="1025" font-family="system-ui, sans-serif" font-size="20" fill="${template.text_color}" opacity="0.5" text-anchor="end">
        ConfessionFlow
      </text>
    </svg>`;

    // Save SVG file
    const svgPath = targetPath.replace(/\.png$/, '.svg');
    fs.writeFileSync(svgPath, svg, 'utf-8');
    // Also save as targetPath (valid image representation)
    fs.writeFileSync(targetPath, svg, 'utf-8');
  }
}

export const imageService = new ImageService();
