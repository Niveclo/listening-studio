import { setTimeout as delay } from 'node:timers/promises';
import { URLSearchParams } from 'node:url';

const provider = 'https://uapis.cn';
const cacheLifetime = 7 * 24 * 60 * 60 * 1000;

class DictionaryError extends Error {
  constructor(code, status = 503, retryAfter = 0) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const text = (value) => (typeof value === 'string' ? value.trim().slice(0, 4000) : '');
const list = (value) => (Array.isArray(value) ? value : []);
const hasChinese = (entry) =>
  list(entry?.definitions).some((item) => /\p{Script=Han}/u.test(text(item?.meaning)));

function normalizeEntry(entry, query) {
  const word = /^[a-z]+(?:['-][a-z]+)*$/i.test(entry.word) ? entry.word : query;
  return {
    word,
    phonetics: ['uk', 'us'].map((accent) => ({
      accent,
      text: text(entry.phonetics?.[accent]?.text),
      audio: `/api/dictionary/audio?word=${encodeURIComponent(word)}&accent=${accent}`,
    })),
    definitions: list(entry.definitions)
      .filter((item) => /\p{Script=Han}/u.test(text(item?.meaning)))
      .slice(0, 40)
      .map((item) => ({ partOfSpeech: text(item.part_of_speech), meaning: text(item.meaning) })),
    englishDefinitions: list(entry.english_definitions)
      .filter((item) => text(item?.definition))
      .slice(0, 40)
      .map((item) => ({
        partOfSpeech: text(item.part_of_speech),
        definition: text(item.definition),
        examples: list(item.examples).map(text).filter(Boolean).slice(0, 2),
      })),
    forms: list(entry.word_forms)
      .filter((item) => text(item?.name) && text(item?.value))
      .slice(0, 20)
      .map((item) => ({ name: text(item.name), value: text(item.value) })),
  };
}

function sendJson(response, status, data, retryAfter = 0) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
  });
  response.end(body);
}

/** Fixed upstream routes, shared cache and a queue keep LAN clients within the free API rate. */
export function dictionaryPlugin() {
  const cache = new Map();
  const inFlight = new Map();
  let queue = Promise.resolve();
  let nextRequest = 0;
  let pending = 0;
  let cooldown = null;

  async function upstream(path, params) {
    if (cooldown && cooldown.until > Date.now()) throw cooldown.error;
    if (pending >= 16) throw new DictionaryError('RATE_LIMITED', 429, 5);
    pending++;
    const turn = queue.then(async () => {
      await delay(Math.max(0, nextRequest - Date.now()));
      nextRequest = Date.now() + 350;
    });
    queue = turn.catch(() => {});
    try {
      await turn;
      if (cooldown && cooldown.until > Date.now()) throw cooldown.error;
      const url = new URL(path, provider);
      url.search = new URLSearchParams(params).toString();
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(12000),
        redirect: 'error',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const code = String(error.code || '').toUpperCase();
        const message = text(error.message);
        const quota =
          response.status === 402 ||
          /QUOTA.*(?:EXHAUSTED|EXCEEDED)|INSUFFICIENT_CREDITS/.test(code) ||
          /(?:quota|credits).*(?:exhausted|exceeded|insufficient)|(?:积分|额度).*(?:耗尽|用尽|不足)/i.test(
            message,
          );
        if (quota) {
          const failure = new DictionaryError('QUOTA_EXHAUSTED', 429, 60);
          cooldown = { until: Date.now() + 60000, error: failure };
          throw failure;
        }
        if (response.status === 429) {
          const retry = Math.max(1, Math.min(60, Number(response.headers.get('retry-after')) || 2));
          const failure = new DictionaryError('RATE_LIMITED', 429, retry);
          cooldown = { until: Date.now() + retry * 1000, error: failure };
          throw failure;
        }
        if (response.status === 404) throw new DictionaryError('NOT_FOUND', 404);
        throw new DictionaryError('UNAVAILABLE');
      }
      // Dictionary JSON and short pronunciation clips should never exceed this bound.
      const reader = response.body?.getReader();
      if (!reader) throw new DictionaryError('UNAVAILABLE');
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024 * 1024) throw new DictionaryError('UNAVAILABLE');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const body = Buffer.concat(chunks);
      if (path.endsWith('/audio')) {
        if (!response.headers.get('content-type')?.includes('audio/') || !body.length)
          throw new DictionaryError('AUDIO_UNAVAILABLE', 502);
        return body;
      }
      return JSON.parse(body.toString('utf8'));
    } catch (error) {
      if (error instanceof DictionaryError) throw error;
      throw new DictionaryError('UNAVAILABLE');
    } finally {
      pending--;
    }
  }

  async function lookup(word) {
    let fast;
    try {
      fast = await upstream('/api/v1/dictionary/lookup', { word, engine: 'local' });
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
    }
    let entry = fast?.entry;
    // Some inflections return only phonetics from the fast engine (e.g. "governed").
    if (!hasChinese(entry)) {
      try {
        const fallback = await upstream('/api/v1/dictionary/lookup', { word });
        if (fallback.entry) {
          const previous = entry;
          entry = { ...previous, ...fallback.entry };
          entry.phonetics = {
            uk: { ...previous?.phonetics?.uk, ...fallback.entry.phonetics?.uk },
            us: { ...previous?.phonetics?.us, ...fallback.entry.phonetics?.us },
          };
        }
      } catch (error) {
        if (error.code !== 'NOT_FOUND') throw error;
      }
    }
    if (!entry) throw new DictionaryError('NOT_FOUND', 404);
    const normalized = normalizeEntry(entry, word);
    if (!normalized.definitions.length && !normalized.englishDefinitions.length)
      throw new DictionaryError('NOT_FOUND', 404);
    return { entry: normalized, source: 'UAPI' };
  }

  async function cached(key, load) {
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) {
      cache.delete(key);
      cache.set(key, existing);
      return existing.value;
    }
    if (inFlight.has(key)) return inFlight.get(key);
    if (inFlight.size >= 32) throw new DictionaryError('RATE_LIMITED', 429, 5);
    const request = load().then((value) => {
      cache.delete(key);
      cache.set(key, { value, expires: Date.now() + cacheLifetime });
      while (cache.size > 256) cache.delete(cache.keys().next().value);
      return value;
    });
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    name: 'listening-dictionary',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost');
        if (!['/api/dictionary', '/api/dictionary/audio'].includes(url.pathname)) return next();
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
        }
        if (request.headers['sec-fetch-site'] === 'cross-site')
          return sendJson(response, 403, { code: 'FORBIDDEN' });
        const word = (url.searchParams.get('word') || '').trim().replaceAll('’', "'").toLowerCase();
        if (word.length > 64 || !/^[a-z]+(?:['-][a-z]+)*$/.test(word))
          return sendJson(response, 400, { code: 'INVALID_WORD' });
        const audio = url.pathname.endsWith('/audio');
        const accent = url.searchParams.get('accent') || 'uk';
        if (audio && !['uk', 'us'].includes(accent))
          return sendJson(response, 400, { code: 'INVALID_ACCENT' });
        const operation = audio
          ? cached(`audio:${word}:${accent}`, () =>
              upstream('/api/v1/dictionary/audio', { word, accent }),
            )
          : cached(`word:${word}`, () => lookup(word));
        operation
          .then((data) => {
            if (response.destroyed) return;
            if (!audio) return sendJson(response, 200, data);
            response.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Length': data.length,
              'Cache-Control': 'private, max-age=604800',
              'X-Content-Type-Options': 'nosniff',
            });
            response.end(data);
          })
          .catch((error) => {
            if (!response.destroyed)
              sendJson(
                response,
                error.status || 503,
                { code: error.code || 'UNAVAILABLE' },
                error.retryAfter,
              );
          });
      });
    },
  };
}
