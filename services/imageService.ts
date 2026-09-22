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
  public calculateDynamicFontSize(text: string, baseSize: number = 44): {
    fontSize: number;
    lineHeight: number;
    padding: number;
    showBigQuote: boolean;
    quoteSize: number;
    justify: 'center' | 'flex-start';
    marginY: number;
    signatureMargin: number;
    signatureSize: number;
    warning?: string;
  } {
    const len = text.length;
    if (len < 120) {
      return {
        fontSize: Math.min(50, baseSize + 6),
        lineHeight: 1.45,
        padding: 80,
        showBigQuote: true,
        quoteSize: 76,
        justify: 'center',
        marginY: 28,
        signatureMargin: 26,
        signatureSize: 26,
      };
    }
    if (len < 280) {
      return {
        fontSize: Math.min(40, baseSize + 2),
        lineHeight: 1.4,
        padding: 75,
        showBigQuote: true,
        quoteSize: 60,
        justify: 'center',
        marginY: 24,
        signatureMargin: 22,
        signatureSize: 24,
      };
    }
    if (len < 500) {
      return {
        fontSize: Math.max(26, baseSize - 10),
        lineHeight: 1.35,
        padding: 65,
        showBigQuote: true,
        quoteSize: 42,
        justify: 'center',
        marginY: 18,
        signatureMargin: 18,
        signatureSize: 22,
      };
    }
    if (len < 850) {
      return {
        fontSize: 21,
        lineHeight: 1.3,
        padding: 55,
        showBigQuote: true,
        quoteSize: 32,
        justify: 'flex-start',
        marginY: 14,
        signatureMargin: 16,
        signatureSize: 20,
      };
    }
    if (len < 1400) {
      return {
        fontSize: 17.5,
        lineHeight: 1.25,
        padding: 50,
        showBigQuote: false,
        quoteSize: 0,
        justify: 'flex-start',
        marginY: 10,
        signatureMargin: 12,
        signatureSize: 18,
        warning: 'Confession is long. Layout has been adapted to fit in a single post.',
      };
    }
    if (len < 2000) {
      return {
        fontSize: 15.5,
        lineHeight: 1.22,
        padding: 45,
        showBigQuote: false,
        quoteSize: 0,
        justify: 'flex-start',
        marginY: 8,
        signatureMargin: 10,
        signatureSize: 17,
        warning: 'Confession is too long for a single post. Consider editing or creating a carousel.',
      };
    }
    return {
      fontSize: 14,
      lineHeight: 1.2,
      padding: 40,
      showBigQuote: false,
      quoteSize: 0,
      justify: 'flex-start',
      marginY: 6,
      signatureMargin: 8,
      signatureSize: 16,
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

    const cfg = this.calculateDynamicFontSize(confession.cleaned_text || confession.original_text, template.font_size);
    const fontFamily = template.font_family === 'serif' 
      ? `'Playfair Display', Georgia, serif` 
      : `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

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
      padding: ${cfg.padding}px;
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
      z-index: 10;
      flex-shrink: 0;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      background: ${template.accent_color}18;
      border: 1.5px solid ${template.accent_color}40;
      color: ${template.accent_color};
      border-radius: 9999px;
      font-size: 20px;
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
      justify-content: ${cfg.justify};
      align-items: flex-start;
      margin: ${cfg.marginY}px 0;
      z-index: 2;
      max-height: 840px;
      overflow: hidden;
      width: 100%;
    }

    .quote-mark {
      font-size: ${cfg.quoteSize}px;
      line-height: 1;
      color: ${template.accent_color};
      opacity: 0.8;
      margin-bottom: -10px;
      font-family: Georgia, serif;
      flex-shrink: 0;
    }

    .confession-text {
      font-size: ${cfg.fontSize}px;
      line-height: ${cfg.lineHeight};
      font-weight: 500;
      letter-spacing: -0.01em;
      white-space: pre-wrap;
      word-break: break-word;
      opacity: 0.96;
      width: 100%;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .submitter-signature {
      margin-top: ${cfg.signatureMargin}px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: ${cfg.signatureSize}px;
      font-weight: 600;
      color: ${template.accent_color};
      font-family: 'Inter', sans-serif;
      flex-shrink: 0;
    }

    .submitter-signature::before {
      content: '';
      display: inline-block;
      width: 28px;
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
      padding-top: 18px;
      font-size: 16px;
      font-weight: 500;
      opacity: 0.65;
      font-family: 'Inter', sans-serif;
      z-index: 10;
      flex-shrink: 0;
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
    ${template.layout_config?.quote_icon !== false && cfg.showBigQuote ? `<div class="quote-mark">&ldquo;</div>` : ''}
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

    // Try Playwright rendering if browser binary is actually installed
    let rendered = false;
    try {
      const { chromium } = await import('playwright');
      const browserPath = chromium.executablePath();
      if (fs.existsSync(browserPath)) {
        const browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          timeout: 5000,
        });
        const page = await browser.newPage({
          viewport: { width: 1080, height: 1080 },
          deviceScaleFactor: 1,
        });

        await page.setContent(htmlContent, { waitUntil: 'networkidle' });
        await page.screenshot({ path: localFilePath, type: 'png' });
        await browser.close();
        rendered = true;
      } else {
        // Chromium not installed, seamlessly use Sharp engine
        rendered = false;
      }
    } catch (err: any) {
      console.warn('[ImageService] Playwright browser snapshot failed or unavailable, using high-fidelity Sharp engine:', err?.message);
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

    const len = safeText.length;
    let charsPerLine = 38;
    let fontSize = 32;
    let lineSpacing = 44;
    let startY = 320;
    let showQuote = true;

    if (len < 250) {
      charsPerLine = 38;
      fontSize = 32;
      lineSpacing = 44;
      startY = 320;
      showQuote = true;
    } else if (len < 550) {
      charsPerLine = 48;
      fontSize = 25;
      lineSpacing = 34;
      startY = 260;
      showQuote = true;
    } else if (len < 1100) {
      charsPerLine = 60;
      fontSize = 20;
      lineSpacing = 27;
      startY = 200;
      showQuote = false;
    } else {
      charsPerLine = 72;
      fontSize = 15.5;
      lineSpacing = 21;
      startY = 180;
      showQuote = false;
    }

    // Split into readable lines for SVG text wrapping
    const words = safeText.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ' ' + word).length > charsPerLine) {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += ' ' + word;
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    // Calculate maximum lines that safely fit before footer (footer starts at y=950)
    const maxAvailableHeight = 930 - startY - 70;
    const maxLines = Math.floor(maxAvailableHeight / lineSpacing);
    const displayLines = lines.slice(0, maxLines);
    if (lines.length > maxLines && displayLines.length > 0) {
      const lastIdx = displayLines.length - 1;
      displayLines[lastIdx] = displayLines[lastIdx].substring(0, Math.max(10, charsPerLine - 25)) + '... [Read caption 👇]';
    }

    const lastLineY = startY + (displayLines.length - 1) * lineSpacing;
    const signatureY = Math.min(920, lastLineY + 38);

    const svg = `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${template.background.includes('linear') ? '#1e1b4b' : template.background}" />
          <stop offset="100%" stop-color="${template.background.includes('linear') ? '#4338ca' : '#f3f4f6'}" />
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bgGrad)" />
      
      <!-- Header Badge -->
      <rect x="70" y="70" width="280" height="52" rx="26" fill="${template.accent_color}" fill-opacity="0.18" stroke="${template.accent_color}" stroke-width="2" />
      <text x="210" y="104" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" fill="${template.accent_color}" text-anchor="middle" letter-spacing="1.5">
        CONFESSION #${numFormatted}
      </text>
      
      <!-- Brand Top -->
      <text x="1010" y="104" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="${template.text_color}" opacity="0.75" text-anchor="end">
        ${this.escapeHtml(brandName)}
      </text>

      ${showQuote ? `<!-- Quote Mark -->
      <text x="70" y="${startY - 25}" font-family="Georgia, serif" font-size="76" fill="${template.accent_color}" opacity="0.85">&#8220;</text>` : ''}

      <!-- Confession Text Lines -->
      ${displayLines.map((l, i) => `
        <text x="70" y="${startY + i * lineSpacing}" font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="500" fill="${template.text_color}">
          ${l}
        </text>
      `).join('')}

      <!-- Signature -->
      ${template.show_name ? `
      <line x1="70" y1="${signatureY}" x2="110" y2="${signatureY}" stroke="${template.accent_color}" stroke-width="3" stroke-linecap="round" />
      <text x="125" y="${signatureY + 6}" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" fill="${template.accent_color}">
        ${safeName}
      </text>` : ''}

      <!-- Footer Divider & Meta -->
      <line x1="70" y1="960" x2="1010" y2="960" stroke="${template.text_color}" stroke-opacity="0.18" stroke-width="1.5" />
      <text x="70" y="1005" font-family="system-ui, sans-serif" font-size="18" fill="${template.text_color}" opacity="0.7">
        ${this.escapeHtml(brandName)} &#8226; ${this.escapeHtml(instagramHandle)}
      </text>
      <text x="1010" y="1005" font-family="system-ui, sans-serif" font-size="18" fill="${template.text_color}" opacity="0.5" text-anchor="end">
        ConfessionFlow
      </text>
    </svg>`;

    // Save SVG file
    const svgPath = targetPath.replace(/\.png$/, '.svg');
    fs.writeFileSync(svgPath, svg, 'utf-8');

    // Convert SVG into a true binary PNG using sharp
    try {
      const sharp = (await import('sharp')).default || (await import('sharp'));
      await sharp(Buffer.from(svg)).png().toFile(targetPath);
    } catch (sharpErr: any) {
      console.warn('[ImageService] Sharp conversion fallback warning:', sharpErr?.message);
      // If sharp fails for any reason, write raw file as last resort
      fs.writeFileSync(targetPath, svg, 'utf-8');
    }
  }
}

export const imageService = new ImageService();
