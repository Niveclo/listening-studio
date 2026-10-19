import { readStored, writeStored } from './storage';

export interface DictionaryEntry {
  word: string;
  phonetics: { accent: 'uk' | 'us'; text: string; audio: string }[];
  definitions: { partOfSpeech: string; meaning: string }[];
  englishDefinitions: { partOfSpeech: string; definition: string; examples: string[] }[];
  forms: { name: string; value: string }[];
}

export class DictionaryError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

interface CachedEntry {
  query: string;
  expires: number;
  entry: DictionaryEntry;
}
const lifetime = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, CachedEntry>();
const stored = readStored<unknown>('dictionaryCache:v1', []);

function isEntry(value: unknown): value is DictionaryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as DictionaryEntry;
  return (
    typeof entry.word === 'string' &&
    Array.isArray(entry.phonetics) &&
    entry.phonetics.every(
      (item) => item && ['uk', 'us'].includes(item.accent) && typeof item.text === 'string',
    ) &&
    Array.isArray(entry.definitions) &&
    entry.definitions.every(
      (item) => item && typeof item.meaning === 'string' && typeof item.partOfSpeech === 'string',
    ) &&
    Array.isArray(entry.englishDefinitions) &&
    entry.englishDefinitions.every(
      (item) =>
        item &&
        typeof item.definition === 'string' &&
        typeof item.partOfSpeech === 'string' &&
        Array.isArray(item.examples) &&
        item.examples.every((example) => typeof example === 'string'),
    ) &&
    Array.isArray(entry.forms) &&
    entry.forms.every(
      (item) => item && typeof item.name === 'string' && typeof item.value === 'string',
    )
  );
}

if (Array.isArray(stored)) {
  for (const item of stored.slice(-200)) {
    if (
      item &&
      typeof item.query === 'string' &&
      typeof item.expires === 'number' &&
      item.expires > Date.now() &&
      isEntry(item.entry)
    )
      cache.set(item.query, item);
  }
}

export function cachedDefinition(word: string): DictionaryEntry | null {
  const item = cache.get(word);
  if (!item) return null;
  if (item.expires <= Date.now()) {
    cache.delete(word);
    return null;
  }
  cache.delete(word);
  cache.set(word, item);
  return item.entry;
}

export async function responseError(response: Response): Promise<DictionaryError> {
  const data = await response.json().catch(() => ({}));
  if (typeof data?.code === 'string') return new DictionaryError(data.code);
  // A missing local route is different from the dictionary provider's NOT_FOUND response.
  if (response.status === 404 || data?.error === 'library_unavailable')
    return new DictionaryError('BACKEND_UNAVAILABLE');
  return new DictionaryError('UNAVAILABLE');
}

export async function lookupWord(word: string, signal: AbortSignal): Promise<DictionaryEntry> {
  const response = await fetch(`/api/dictionary?word=${encodeURIComponent(word)}`, { signal });
  if (!response.ok) throw await responseError(response);
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new DictionaryError('BACKEND_UNAVAILABLE');
  const data = await response.json();
  if (!isEntry(data?.entry)) throw new DictionaryError('INVALID_RESPONSE');
  cache.delete(word);
  cache.set(word, { query: word, entry: data.entry, expires: Date.now() + lifetime });
  while (cache.size > 200) cache.delete(cache.keys().next().value!);
  writeStored('dictionaryCache:v1', [...cache.values()]);
  return data.entry;
}
