export type Locale = 'zh' | 'en';
export type SubtitleMode = 'bilingual' | 'en' | 'zh' | 'hidden';
export type ThemeMode = 'light' | 'dark';
export interface Cue {
  id: string;
  start: number;
  end: number;
  en: string;
  zh: string;
  needsReview: boolean;
}
export interface Episode {
  id: string;
  title: { zh: string; en: string };
  collection: { zh: string; en: string };
  description: { zh: string; en: string };
  videoUrl: string;
  subtitleUrl: string | null;
  subtitleFormat: string | null;
  subtitleStatus: 'ready' | 'processing' | 'missing';
  videoAvailable: boolean;
  poster: string;
}
