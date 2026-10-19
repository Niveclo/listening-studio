import type { Cue } from '../types';

function plainText(text: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original;
      const code =
        entity[1].toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .trim();
}

function timestamp(text: string): number {
  const parts = text.replace(',', '.').split(':').map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((value) => !Number.isFinite(value) || value < 0)
  )
    return NaN;
  if (parts.at(-1)! >= 60 || (parts.length === 3 && parts[1] >= 60)) return NaN;
  return parts.reduce((value, part) => value * 60 + part, 0);
}

function valid(cue: Cue): boolean {
  return (
    Number.isFinite(cue.start) &&
    Number.isFinite(cue.end) &&
    cue.start >= 0 &&
    cue.end > cue.start &&
    Boolean(cue.en || cue.zh)
  );
}

/** Accept the OCR v1 contract, SRT, and plain-text WebVTT; render all content as text. */
export function parseSubtitles(source: string, format = ''): Cue[] {
  if (source.length > 8 * 1024 * 1024) throw new Error('subtitle_too_large');
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  let cues: Cue[] = [];
  if (format.toLowerCase() === 'json' || text.startsWith('{')) {
    const data = JSON.parse(text);
    if (
      data.schema_version !== 1 ||
      data.time_unit !== 'seconds' ||
      data.time_reference !== 'original_video' ||
      !Array.isArray(data.cues)
    ) {
      throw new Error('unsupported_subtitle_schema');
    }
    cues = data.cues
      .filter((row: unknown) => row && typeof row === 'object')
      .map((row: Record<string, unknown>, index: number) => ({
        id: `cue-${index}`,
        start: typeof row.start === 'number' ? row.start : NaN,
        end: typeof row.end === 'number' ? row.end : NaN,
        en: typeof row.en === 'string' ? row.en.trim() : '',
        zh: typeof row.zh === 'string' ? row.zh.trim() : '',
        needsReview: row.needs_review === true,
      }));
  } else {
    for (const block of text.split(/\n\s*\n/)) {
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block)) continue;
      const lines = block.split('\n');
      const timeLine = lines.findIndex((line) => line.includes('-->'));
      if (timeLine < 0) continue;
      const match = /^(\S+)\s+-->\s+(\S+)/.exec(lines[timeLine].trim());
      if (!match) continue;
      const english: string[] = [];
      const chinese: string[] = [];
      for (const line of lines.slice(timeLine + 1)) {
        const content = plainText(line);
        if (!content) continue;
        if (/[\u3400-\u9fff]/.test(content)) chinese.push(content);
        else english.push(content);
      }
      cues.push({
        id: `cue-${cues.length}`,
        start: timestamp(match[1]),
        end: timestamp(match[2]),
        en: english.join(' '),
        zh: chinese.join(' '),
        needsReview: false,
      });
    }
  }
  cues = cues.filter(valid).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!cues.length) throw new Error('no_valid_subtitles');
  return cues;
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** Index of the last cue that has started, including pauses between cues. */
export function cueAt(cues: Cue[], time: number): number {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
