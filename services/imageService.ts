import fs from 'fs';
import path from 'path';
import { Confession, Template } from '@/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { calculateCardTypography, MIN_BODY_FONT_SIZE } from '@/lib/paginationEngine';

export interface ImageGenerationOptions {
  confession: Confession;
  template: Template;
  brandName?: string;
  instagramHandle?: string;
  confessionNumber?: number;
  slideText?: string;
  slideIndex?: number;
  totalSlides?: number;
  customFilename?: string;
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
   * Calculate dynamic font size based on text length to prevent overflow in 1080x1080 canvas.
   * Enforces MIN_BODY_FONT_SIZE: NEVER shrinks below MIN_BODY_FONT_SIZE (28px).
   */
  public calculateDynamicFontSize(
    text: string,
    baseSize: number = 44,
    minFontSize: number = MIN_BODY_FONT_SIZE
  ): {
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
    const metrics = calculateCardTypography(text, {
      baseFontSize: baseSize,
      minFontSize,
    });

    return {
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      padding: metrics.padding,
      showBigQuote: metrics.showBigQuote,
      quoteSize: metrics.quoteSize,
      justify: metrics.justify,
      marginY: metrics.marginY,
      signatureMargin: metrics.signatureMargin,
      signatureSize: metrics.signatureSize,
      warning: metrics.warning,
    };
  }

  /**
   * Generate 1080×1350 (4:5 portrait) HTML content for the template
   */
  public generateCardHtml(options: ImageGenerationOptions): string {
    const { confession, template, brandName = 'Campus Confessions', instagramHandle = '@campusconfessions', confessionNumber = 1 } = options;
    
    const rawText = options.slideText || confession.cleaned_text || confession.original_text;
    const safeText = this.escapeHtml(rawText);
    const safeName = this.escapeHtml(confession.is_anonymous ? 'Anonymous' : confession.display_name);
    const safeBrand = this.escapeHtml(brandName);
    const safeHandle = this.escapeHtml(instagramHandle);
    const numFormatted = String(confessionNumber).padStart(3, '0');
    const isCarousel = Boolean(options.totalSlides && options.totalSlides > 1);
    const badgeText = isCarousel
      ? `CONFESSION #${numFormatted} • ${(options.slideIndex || 0) + 1}/${options.totalSlides}`
      : `CONFESSION #${numFormatted}`;

    const cfg = this.calculateDynamicFontSize(rawText, template.font_size);
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
      max-height: 850px;
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
    ${template.show_confession_number ? `<div class="badge">${badgeText}</div>` : '<div></div>'}
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
    <div>${isCarousel ? `${(options.slideIndex || 0) + 1}/${options.totalSlides}` : 'ConfessionFlow'}</div>
  </div>
</body>
</html>`;
  }

  /**
   * Render HTML card to PNG file
   */
  public async generatePostImage(options: ImageGenerationOptions): Promise<{ localPath: string; publicUrl: string }> {
    const { confession } = options;
    const filename = options.customFilename || `${confession.id}.png`;
    const localFilePath = path.join(this.outputDir, filename);

    // Use Sharp SVG engine directly — instant, no browser launch overhead
    await this.generateSvgPngFallback(options, localFilePath);

    // If generating a specific slide (e.g. slide 1), also copy to primary confession.id.png for backward compatibility
    if (options.customFilename && (options.slideIndex === 0 || !options.slideIndex)) {
      const defaultPath = path.join(this.outputDir, `${confession.id}.png`);
      try {
        fs.copyFileSync(localFilePath, defaultPath);
      } catch {}
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
   * Safely parse CSS backgrounds (solid colors or linear gradients) into valid SVG defs and fill
   */
  public parseSvgBackground(background: string): { defs: string; fill: string } {
    if (!background || typeof background !== 'string') {
      return { defs: '', fill: '#fff1f2' };
    }

    const trimmed = background.trim();

    // Check if it's a solid color (no gradient)
    if (!trimmed.toLowerCase().includes('gradient')) {
      return { defs: '', fill: trimmed };
    }

    // Default angle coords: diagonal top-left (0%,0%) to bottom-right (100%,100%)
    let x1 = '0%';
    let y1 = '0%';
    let x2 = '100%';
    let y2 = '100%';

    const angleMatch = trimmed.match(/(\d+)deg/i);
    if (angleMatch) {
      const deg = parseInt(angleMatch[1], 10);
      if (deg >= 70 && deg <= 110) {
        x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '0%';
      } else if (deg >= 160 && deg <= 200) {
        x1 = '0%'; y1 = '0%'; x2 = '0%'; y2 = '100%';
      } else {
        x1 = '0%'; y1 = '0%'; x2 = '100%'; y2 = '100%';
      }
    }

    // Extract color stops: handles #hex, rgb(...), rgba(...) with optional percentage e.g. #fff1f2 0%
    const colorStopRegex = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))(?:\s+(\d+)%)?/g;
    const stops: { color: string; offset: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = colorStopRegex.exec(trimmed)) !== null) {
      stops.push({
        color: match[1],
        offset: match[2] !== undefined ? `${match[2]}%` : '',
      });
    }

    if (stops.length === 0) {
      return { defs: '', fill: '#fff1f2' };
    }

    // Assign offsets if missing
    const formattedStops = stops
      .map((s, idx) => {
        const offset = s.offset || `${Math.round((idx / Math.max(stops.length - 1, 1)) * 100)}%`;
        return `<stop offset="${offset}" stop-color="${s.color}" />`;
      })
      .join('\n        ');

    const defs = `<linearGradient id="bgGrad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
        ${formattedStops}
      </linearGradient>`;

    return { defs, fill: 'url(#bgGrad)' };
  }

  /**
   * High-fidelity SVG renderer generating a pixel-perfect 1080x1350 visual card
   */
  private async generateSvgPngFallback(options: ImageGenerationOptions, targetPath: string): Promise<void> {
    const { confession, template, brandName = 'Campus Confessions', instagramHandle = '@campusconfessions', confessionNumber = 1 } = options;
    const numFormatted = String(confessionNumber).padStart(3, '0');
    const rawText = options.slideText || confession.cleaned_text || confession.original_text || '';
    const safeText = this.escapeHtml(rawText);
    const safeName = this.escapeHtml(confession.is_anonymous ? 'Anonymous' : confession.display_name);

    const isCarousel = Boolean(options.totalSlides && options.totalSlides > 1);
    const badgeText = isCarousel
      ? `CONFESSION #${numFormatted} • ${(options.slideIndex || 0) + 1}/${options.totalSlides}`
      : `CONFESSION #${numFormatted}`;
    const badgeWidth = isCarousel ? 360 : 280;
    const badgeTextX = isCarousel ? 250 : 210;

    const typo = calculateCardTypography(rawText, {
      baseFontSize: template.font_size,
    });
    const fontSize = typo.fontSize;
    const lineSpacing = typo.lineSpacing;
    const showQuote = typo.showBigQuote;
    const lines = typo.renderedLines;

    // Footer divider starts at y=960 in 1080px canvas
    const footerDividerY = 960;
    const headerBottomY = 135;
    const signatureSpace = template.show_name ? 55 : 0;
    const quoteSpace = showQuote ? 50 : 0;

    const totalTextHeight = lines.length * lineSpacing;
    const availableHeight = footerDividerY - headerBottomY - signatureSpace - quoteSpace;

    // Dynamically center text vertically within available content area
    let startY = Math.max(
      headerBottomY + quoteSpace + 15,
      Math.min(340, Math.round(headerBottomY + quoteSpace + (availableHeight - totalTextHeight) / 2))
    );

    // Render all lines (no truncation since text is properly paginated)
    const displayLines = lines;
    const lastLineY = startY + Math.max(0, displayLines.length - 1) * lineSpacing;
    const signatureY = Math.min(925, Math.max(lastLineY + 38, startY + totalTextHeight + 20));

    const isSerif = template.font_family === 'serif';
    const textFontFamily = isSerif
      ? `'Playfair Display', 'Georgia', 'Times New Roman', serif`
      : `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    const uiFontFamily = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

    const { defs, fill } = this.parseSvgBackground(template.background);

    const svg = `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${defs}
      </defs>
      <rect width="1080" height="1080" fill="${fill}" />
      
      <!-- Ambient Glow Orb -->
      <circle cx="540" cy="540" r="380" fill="${template.accent_color}" fill-opacity="0.06" />

      <!-- Header Badge -->
      <rect x="70" y="70" width="${badgeWidth}" height="52" rx="26" fill="${template.accent_color}" fill-opacity="0.14" stroke="${template.accent_color}" stroke-width="2" />
      <text x="${badgeTextX}" y="103" font-family="${uiFontFamily}" font-size="19" font-weight="700" fill="${template.accent_color}" text-anchor="middle" letter-spacing="1.5">
        ${badgeText}
      </text>
      
      <!-- Brand Top -->
      <text x="1010" y="103" font-family="${uiFontFamily}" font-size="20" font-weight="700" fill="${template.text_color}" opacity="0.8" text-anchor="end">
        ${this.escapeHtml(brandName)}
      </text>

      ${showQuote ? `<!-- Quote Mark -->
      <text x="70" y="${startY - 20}" font-family="Georgia, serif" font-size="82" font-weight="bold" fill="${template.accent_color}" opacity="0.85">&#8220;</text>` : ''}

      <!-- Confession Text Lines -->
      ${displayLines.map((l, i) => l ? `
        <text x="70" y="${startY + i * lineSpacing}" font-family="${textFontFamily}" font-size="${fontSize}" font-weight="600" fill="${template.text_color}">
          ${l}
        </text>
      ` : '').join('')}

      <!-- Signature -->
      ${template.show_name ? `
      <line x1="70" y1="${signatureY}" x2="115" y2="${signatureY}" stroke="${template.accent_color}" stroke-width="3.5" stroke-linecap="round" />
      <text x="130" y="${signatureY + 7}" font-family="${textFontFamily}" font-size="22" font-weight="700" fill="${template.accent_color}">
        ${safeName}
      </text>` : ''}

      <!-- Footer Divider & Meta -->
      <line x1="70" y1="${footerDividerY}" x2="1010" y2="${footerDividerY}" stroke="${template.text_color}" stroke-opacity="0.22" stroke-width="1.5" />
      <text x="70" y="${footerDividerY + 46}" font-family="${uiFontFamily}" font-size="18" font-weight="600" fill="${template.text_color}" opacity="0.75">
        ${this.escapeHtml(brandName)} &#8226; ${this.escapeHtml(instagramHandle)}
      </text>
      <text x="1010" y="${footerDividerY + 46}" font-family="${uiFontFamily}" font-size="18" font-weight="700" fill="${template.accent_color}" opacity="0.9" text-anchor="end">
        ${isCarousel ? `${(options.slideIndex || 0) + 1}/${options.totalSlides}` : 'ConfessionFlow'}
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
      fs.writeFileSync(targetPath, svg, 'utf-8');
    }
  }

  /**
   * Generates PNG images for each slide in a paginated carousel confession.
   * Supports both options object and positional arguments.
   */
  public async generateSlideImages(
    confessionOrOptions:
      | Confession
      | {
          confession: Confession;
          template: Template;
          slides: string[];
          brandName?: string;
          instagramHandle?: string;
          confessionNumber?: number;
        },
    templateArg?: Template,
    slidesArg?: string[],
    optionsArg: {
      brandName?: string;
      instagramHandle?: string;
      confessionNumber?: number;
    } = {}
  ): Promise<Array<{ localPath: string; publicUrl: string; slideIndex: number }>> {
    let confession: Confession;
    let template: Template;
    let slides: string[];
    let brandName: string | undefined;
    let instagramHandle: string | undefined;
    let confessionNumber: number | undefined;

    if ('confession' in confessionOrOptions) {
      confession = confessionOrOptions.confession;
      template = confessionOrOptions.template;
      slides = confessionOrOptions.slides;
      brandName = confessionOrOptions.brandName;
      instagramHandle = confessionOrOptions.instagramHandle;
      confessionNumber = confessionOrOptions.confessionNumber;
    } else {
      confession = confessionOrOptions;
      template = templateArg!;
      slides = slidesArg!;
      brandName = optionsArg.brandName;
      instagramHandle = optionsArg.instagramHandle;
      confessionNumber = optionsArg.confessionNumber;
    }

    const results = await Promise.all(
      slides.map(async (slideText, i) => {
        const filename = slides.length > 1
          ? `${confession.id}-slide-${i + 1}.png`
          : `${confession.id}.png`;

        const res = await this.generatePostImage({
          confession: {
            ...confession,
            cleaned_text: slideText,
          },
          template,
          brandName,
          instagramHandle,
          confessionNumber: confessionNumber || confession.google_sheet_row || 1,
          slideText,
          slideIndex: i,
          totalSlides: slides.length,
          customFilename: filename,
        });

        return {
          localPath: res.localPath,
          publicUrl: res.publicUrl,
          slideIndex: i + 1,
        };
      })
    );

    return results;
  }
}

export const imageService = new ImageService();
