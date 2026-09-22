'use client';

import React from 'react';
import { Template } from '@/types';

export interface PostCardPreviewProps {
  text: string;
  displayName: string;
  isAnonymous?: boolean;
  confessionNumber?: number;
  template: Template;
  brandName?: string;
  instagramHandle?: string;
  scale?: number;
  mode?: 'fit' | 'hook' | 'carousel';
  slideIndex?: number;
  totalSlides?: number;
}

export function splitIntoSlides(t: string, maxWordsOrChars: number = 20): string[] {
  if (!t) return [''];
  // When called with small numbers (≤50), treat as word limit; larger = char limit (legacy)
  const maxWords = maxWordsOrChars <= 50 ? maxWordsOrChars : 20;
  const wordCount = t.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= maxWords) return [t];

  // Split at sentence boundaries
  const sentences = t.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [t];
  const slides: string[] = [];
  let cur = '';
  let curWords = 0;

  for (const s of sentences) {
    const sWords = s.trim().split(/\s+/).filter(Boolean).length;
    if (curWords + sWords > maxWords && curWords >= 5) {
      slides.push(cur.trim());
      cur = s;
      curWords = sWords;
    } else {
      cur += (cur ? ' ' : '') + s.trimStart();
      curWords += sWords;
    }
  }
  if (cur.trim()) slides.push(cur.trim());
  return slides.length > 0 ? slides : [t];
}

export function getCardTypography(textLength: number, baseSize: number = 44) {
  if (textLength < 120) {
    return {
      fontSize: Math.min(50, baseSize + 6),
      lineHeight: 1.45,
      padding: 80,
      showBigQuote: true,
      quoteSize: 76,
      justify: 'center' as const,
      marginY: 28,
      signatureMargin: 26,
      signatureSize: 26,
    };
  }
  if (textLength < 280) {
    return {
      fontSize: Math.min(40, baseSize + 2),
      lineHeight: 1.4,
      padding: 75,
      showBigQuote: true,
      quoteSize: 60,
      justify: 'center' as const,
      marginY: 24,
      signatureMargin: 22,
      signatureSize: 24,
    };
  }
  if (textLength < 500) {
    return {
      fontSize: Math.max(26, baseSize - 10),
      lineHeight: 1.35,
      padding: 65,
      showBigQuote: true,
      quoteSize: 42,
      justify: 'center' as const,
      marginY: 18,
      signatureMargin: 18,
      signatureSize: 22,
    };
  }
  if (textLength < 850) {
    return {
      fontSize: 21,
      lineHeight: 1.3,
      padding: 55,
      showBigQuote: true,
      quoteSize: 32,
      justify: 'flex-start' as const,
      marginY: 14,
      signatureMargin: 16,
      signatureSize: 20,
    };
  }
  if (textLength < 1400) {
    return {
      fontSize: 17.5,
      lineHeight: 1.25,
      padding: 50,
      showBigQuote: false,
      quoteSize: 0,
      justify: 'flex-start' as const,
      marginY: 10,
      signatureMargin: 12,
      signatureSize: 18,
    };
  }
  if (textLength < 2000) {
    return {
      fontSize: 15.5,
      lineHeight: 1.22,
      padding: 45,
      showBigQuote: false,
      quoteSize: 0,
      justify: 'flex-start' as const,
      marginY: 8,
      signatureMargin: 10,
      signatureSize: 17,
    };
  }
  return {
    fontSize: 14,
    lineHeight: 1.2,
    padding: 40,
    showBigQuote: false,
    quoteSize: 0,
    justify: 'flex-start' as const,
    marginY: 6,
    signatureMargin: 8,
    signatureSize: 16,
  };
}

export function PostCardPreview({
  text,
  displayName,
  isAnonymous = true,
  confessionNumber = 1,
  template,
  brandName = 'Campus Confessions',
  instagramHandle = '@campusconfessions',
  scale = 0.45,
  mode = 'fit',
  slideIndex = 0,
  totalSlides = 1,
}: PostCardPreviewProps) {
  const numFormatted = String(confessionNumber).padStart(3, '0');
  const nameToShow = isAnonymous ? 'Anonymous' : (displayName || 'Anonymous');

  // Determine text to render based on mode
  let textToRender = text || 'Enter confession text to see preview...';
  if (mode === 'hook' && text.length > 420) {
    const truncated = text.substring(0, 400);
    const lastPunctuation = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('? '), truncated.lastIndexOf('! '));
    const cleanCut = lastPunctuation > 200 ? truncated.substring(0, lastPunctuation + 1) : truncated.trim();
    textToRender = `${cleanCut}\n\n[📖 Read full confession in caption 👇]`;
  }

  const cfg = getCardTypography(textToRender.length, template.font_size);

  const fontFamily =
    template.font_family === 'serif'
      ? 'Georgia, serif'
      : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const badgeText =
    totalSlides > 1
      ? `CONFESSION #${numFormatted} (${slideIndex + 1}/${totalSlides})`
      : `CONFESSION #${numFormatted}`;

  return (
    <div
      className="relative overflow-hidden shadow-2xl rounded-2xl border border-zinc-200/80 select-none transition-transform"
      style={{
        width: 1080 * scale,
        height: 1350 * scale,
      }}
    >
      <div
        className="absolute top-0 left-0 flex flex-col justify-between"
        style={{
          width: 1080,
          height: 1350,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: template.background,
          color: template.text_color,
          padding: cfg.padding,
          fontFamily,
        }}
      >
        {/* Ambient Glow */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            width: 600,
            height: 600,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${template.accent_color}18 0%, transparent 70%)`,
          }}
        />

        {/* Top Header (flex-shrink: 0 protects against overlap) */}
        <div className="flex justify-between items-center w-full z-10 shrink-0">
          {template.show_confession_number ? (
            <div
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full font-bold text-xl uppercase tracking-widest"
              style={{
                background: `${template.accent_color}15`,
                border: `2px solid ${template.accent_color}35`,
                color: template.accent_color,
              }}
            >
              {badgeText}
            </div>
          ) : (
            <div />
          )}

          {template.show_branding && (
            <div className="text-xl font-semibold opacity-75 tracking-wide">
              {brandName}
            </div>
          )}
        </div>

        {/* Middle Content Area */}
        <div
          className="z-10 w-full overflow-hidden flex flex-col"
          style={{
            flex: 1,
            justifyContent: cfg.justify,
            alignItems: 'flex-start',
            marginTop: `${cfg.marginY}px`,
            marginBottom: `${cfg.marginY}px`,
            maxHeight: '1120px',
          }}
        >
          {template.layout_config?.quote_icon !== false && cfg.showBigQuote && (
            <div
              className="leading-none opacity-85 font-serif shrink-0 -mb-2"
              style={{
                color: template.accent_color,
                fontSize: `${cfg.quoteSize}px`,
              }}
            >
              &ldquo;
            </div>
          )}

          <p
            className="font-medium tracking-tight whitespace-pre-wrap break-words opacity-95 w-full"
            style={{
              fontSize: `${cfg.fontSize}px`,
              lineHeight: cfg.lineHeight,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {textToRender}
          </p>

          {template.show_name && (
            <div
              className="flex items-center gap-2.5 font-bold shrink-0"
              style={{
                marginTop: `${cfg.signatureMargin}px`,
                fontSize: `${cfg.signatureSize}px`,
                color: template.accent_color,
              }}
            >
              <span
                className="inline-block w-7 h-0.5 rounded-full"
                style={{ background: template.accent_color }}
              />
              <span>&mdash; {nameToShow}</span>
            </div>
          )}
        </div>

        {/* Bottom Footer (flex-shrink: 0 protects against overlap) */}
        <div
          className="flex justify-between items-center w-full pt-4 text-base font-medium opacity-65 z-10 border-t shrink-0"
          style={{ borderColor: `${template.text_color}20` }}
        >
          <div className="flex items-center gap-2">
            <span>{brandName}</span>
            <span>&bull;</span>
            <span className="font-semibold" style={{ color: template.accent_color }}>
              {instagramHandle}
            </span>
          </div>
          <div className="text-xs tracking-wider uppercase font-semibold">
            ConfessionFlow
          </div>
        </div>
      </div>
    </div>
  );
}
