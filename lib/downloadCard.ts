'use client';

import { Template } from '@/types';
import { getCardTypography, splitIntoSlides } from '@/components/confessions/PostCardPreview';

export interface DownloadCardOptions {
  text: string;
  displayName: string;
  isAnonymous?: boolean;
  confessionNumber?: number;
  template: Template;
  brandName?: string;
  instagramHandle?: string;
  mode?: 'fit' | 'hook' | 'carousel';
  slideIndex?: number;
  totalSlides?: number;
  fileName?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds standard 1080x1080 HTML content for rasterization and download
 */
export function buildCardHtmlForExport(options: DownloadCardOptions): string {
  const {
    text,
    displayName,
    isAnonymous = true,
    confessionNumber = 1,
    template,
    brandName = 'Campus Confessions',
    instagramHandle = '@campusconfessions_official',
    mode = 'fit',
    slideIndex = 0,
    totalSlides = 1,
  } = options;

  const numFormatted = String(confessionNumber).padStart(3, '0');
  const nameToShow = isAnonymous ? 'Anonymous' : (displayName || 'Anonymous');

  let textToRender = text || 'Anonymous Confession';
  if (mode === 'hook' && text.length > 420) {
    const truncated = text.substring(0, 400);
    const lastPunctuation = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! ')
    );
    const cleanCut = lastPunctuation > 200 ? truncated.substring(0, lastPunctuation + 1) : truncated.trim();
    textToRender = `${cleanCut}\n\n[📖 Read full confession in caption 👇]`;
  }

  const cfg = getCardTypography(textToRender.length, template.font_size);
  const fontFamily =
    template.font_family === 'serif'
      ? 'Georgia, serif'
      : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const badgeText =
    totalSlides > 1
      ? `CONFESSION #${numFormatted} (${slideIndex + 1}/${totalSlides})`
      : `CONFESSION #${numFormatted}`;

  const safeText = escapeHtml(textToRender);
  const safeName = escapeHtml(nameToShow);
  const safeBrand = escapeHtml(brandName);
  const safeHandle = escapeHtml(instagramHandle);

  return `
    <div xmlns="http://www.w3.org/1999/xhtml" style="
      width: 1080px;
      height: 1080px;
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: ${template.background};
      color: ${template.text_color};
      padding: ${cfg.padding}px;
      font-family: ${fontFamily};
      -webkit-font-smoothing: antialiased;
    ">
      <!-- Glow -->
      <div style="
        position: absolute;
        width: 600px;
        height: 600px;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle, ${template.accent_color}25 0%, transparent 70%);
        pointer-events: none;
      "></div>

      <!-- Top Header -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        z-index: 10;
        flex-shrink: 0;
      ">
        ${
          template.show_confession_number
            ? `<div style="
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 24px;
                background: ${template.accent_color}18;
                border: 2px solid ${template.accent_color}40;
                color: ${template.accent_color};
                border-radius: 9999px;
                font-size: 20px;
                font-weight: 700;
                letter-spacing: 1.5px;
                text-transform: uppercase;
              ">${badgeText}</div>`
            : `<div></div>`
        }
        ${
          template.show_branding
            ? `<div style="
                font-size: 20px;
                font-weight: 600;
                opacity: 0.75;
                letter-spacing: 0.5px;
              ">${safeBrand}</div>`
            : `<div></div>`
        }
      </div>

      <!-- Middle Content -->
      <div style="
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: ${cfg.justify};
        align-items: flex-start;
        margin-top: ${cfg.marginY}px;
        margin-bottom: ${cfg.marginY}px;
        max-height: 840px;
        overflow: hidden;
        width: 100%;
        z-index: 10;
      ">
        ${
          template.layout_config?.quote_icon !== false && cfg.showBigQuote
            ? `<div style="
                color: ${template.accent_color};
                font-size: ${cfg.quoteSize}px;
                line-height: 1;
                font-family: Georgia, serif;
                opacity: 0.85;
                margin-bottom: -10px;
                flex-shrink: 0;
              ">&ldquo;</div>`
            : ''
        }
        <div style="
          font-size: ${cfg.fontSize}px;
          line-height: ${cfg.lineHeight};
          font-weight: 500;
          white-space: pre-wrap;
          word-break: break-word;
          opacity: 0.95;
          width: 100%;
        ">${safeText}</div>

        ${
          template.show_name
            ? `<div style="
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: bold;
                font-size: ${cfg.signatureSize}px;
                color: ${template.accent_color};
                margin-top: ${cfg.signatureMargin}px;
                flex-shrink: 0;
              ">
                <span style="
                  display: inline-block;
                  width: 28px;
                  height: 3px;
                  border-radius: 9999px;
                  background: ${template.accent_color};
                "></span>
                <span>&mdash; ${safeName}</span>
              </div>`
            : ''
        }
      </div>

      <!-- Footer -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        padding-top: 16px;
        font-size: 16px;
        font-weight: 500;
        opacity: 0.65;
        border-top: 1.5px solid ${template.text_color}25;
        z-index: 10;
        flex-shrink: 0;
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>${safeBrand}</span>
          <span>&bull;</span>
          <span style="color: ${template.accent_color}; font-weight: 600;">${safeHandle}</span>
        </div>
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
          ConfessionFlow
        </div>
      </div>
    </div>
  `;
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Downloads a single confession post card as a crystal-clear 1080x1080 PNG image.
 */
export async function downloadCardAsPng(options: DownloadCardOptions): Promise<void> {
  if (typeof window === 'undefined') return;

  const numFormatted = String(options.confessionNumber || 1).padStart(3, '0');
  const slidePart =
    options.totalSlides && options.totalSlides > 1
      ? `-slide-${(options.slideIndex || 0) + 1}`
      : '';
  const defaultFileName = `confession-${numFormatted}${slidePart}.png`;
  const fileName = options.fileName || defaultFileName;

  const cardHtml = buildCardHtmlForExport(options);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
      <foreignObject width="1080" height="1080">
        ${cardHtml}
      </foreignObject>
    </svg>
  `;

  return new Promise<void>((resolve, reject) => {
    try {
      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 1080;
          canvas.height = 1080;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas 2D context unavailable');
          }

          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(svgUrl);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const downloadUrl = URL.createObjectURL(blob);
                triggerDownload(downloadUrl, fileName);
                setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
                resolve();
              } else {
                const dataUrl = canvas.toDataURL('image/png');
                triggerDownload(dataUrl, fileName);
                resolve();
              }
            },
            'image/png',
            1.0
          );
        } catch (canvasErr) {
          console.warn('[downloadCardAsPng] Canvas drawing fallback to SVG:', canvasErr);
          triggerDownload(svgUrl, fileName.replace(/\.png$/, '.svg'));
          resolve();
        }
      };

      img.onerror = () => {
        triggerDownload(svgUrl, fileName.replace(/\.png$/, '.svg'));
        resolve();
      };

      img.src = svgUrl;
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Sequentially downloads all slides of a multi-slide confession post.
 */
export async function downloadAllSlides(options: DownloadCardOptions): Promise<number> {
  const rawText = options.text || '';
  const slides = splitIntoSlides(rawText, 480);
  const total = slides.length;

  for (let i = 0; i < total; i++) {
    await downloadCardAsPng({
      ...options,
      text: slides[i],
      mode: 'carousel',
      slideIndex: i,
      totalSlides: total,
    });
    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, 450));
    }
  }
  return total;
}
