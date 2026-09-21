'use client';

import React from 'react';
import { Template } from '@/types';

interface PostCardPreviewProps {
  text: string;
  displayName: string;
  isAnonymous?: boolean;
  confessionNumber?: number;
  template: Template;
  brandName?: string;
  instagramHandle?: string;
  scale?: number; // scale factor for responsive display
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
}: PostCardPreviewProps) {
  const numFormatted = String(confessionNumber).padStart(3, '0');
  const nameToShow = isAnonymous ? 'Anonymous' : (displayName || 'Anonymous');

  // Dynamic font sizing based on length
  const len = text.length;
  let dynamicFontSize = template.font_size;
  let dynamicLineHeight = 1.4;

  if (len < 100) {
    dynamicFontSize += 4;
  } else if (len > 350) {
    dynamicFontSize = Math.max(24, dynamicFontSize - 10);
    dynamicLineHeight = 1.3;
  } else if (len > 600) {
    dynamicFontSize = Math.max(20, dynamicFontSize - 16);
    dynamicLineHeight = 1.25;
  }

  const fontFamily =
    template.font_family === 'serif'
      ? 'Georgia, serif'
      : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  return (
    <div
      className="relative overflow-hidden shadow-2xl rounded-2xl border border-zinc-200/80 select-none transition-transform"
      style={{
        width: 1080 * scale,
        height: 1080 * scale,
      }}
    >
      <div
        className="absolute top-0 left-0 flex flex-col justify-between"
        style={{
          width: 1080,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: template.background,
          color: template.text_color,
          padding: template.layout_config?.padding || 80,
          fontFamily,
        }}
      >
        {/* Glow circle */}
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

        {/* Top Header */}
        <div className="flex justify-between items-center w-full z-10">
          {template.show_confession_number ? (
            <div
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-2xl uppercase tracking-widest"
              style={{
                background: `${template.accent_color}15`,
                border: `2px solid ${template.accent_color}35`,
                color: template.accent_color,
              }}
            >
              CONFESSION #{numFormatted}
            </div>
          ) : (
            <div />
          )}

          {template.show_branding && (
            <div className="text-2xl font-semibold opacity-75 tracking-wide">
              {brandName}
            </div>
          )}
        </div>

        {/* Middle Content */}
        <div className="flex-1 flex flex-col justify-center items-start my-10 z-10 max-h-[720px]">
          {template.layout_config?.quote_icon !== false && (
            <div
              className="text-8xl leading-none opacity-85 font-serif -mb-4"
              style={{ color: template.accent_color }}
            >
              &ldquo;
            </div>
          )}

          <p
            className="font-medium tracking-tight whitespace-pre-wrap break-words opacity-95"
            style={{
              fontSize: `${dynamicFontSize}px`,
              lineHeight: dynamicLineHeight,
            }}
          >
            {text || 'Enter confession text to see preview...'}
          </p>

          {template.show_name && (
            <div
              className="mt-9 flex items-center gap-3 text-3xl font-bold"
              style={{ color: template.accent_color }}
            >
              <span
                className="inline-block w-8 h-1 rounded-full"
                style={{ background: template.accent_color }}
              />
              <span>&mdash; {nameToShow}</span>
            </div>
          )}
        </div>

        {/* Bottom Footer */}
        <div
          className="flex justify-between items-center w-full pt-6 text-xl font-medium opacity-65 z-10 border-t"
          style={{ borderColor: `${template.text_color}20` }}
        >
          <div className="flex items-center gap-2">
            <span>{brandName}</span>
            <span>&bull;</span>
            <span className="font-semibold" style={{ color: template.accent_color }}>
              {instagramHandle}
            </span>
          </div>
          <div className="text-base tracking-wider uppercase font-semibold">
            ConfessionFlow
          </div>
        </div>
      </div>
    </div>
  );
}
