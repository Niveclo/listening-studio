import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../library.local.json', import.meta.url));
const root = dirname(configPath);
const mediaTypes = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};
const filePath = (value) => (isAbsolute(value) ? value : resolve(root, value));
const label = (value, fallback = '') =>
  typeof value === 'string'
    ? { zh: value, en: value }
    : { zh: value?.zh || value?.en || fallback, en: value?.en || value?.zh || fallback };

async function loadLibrary() {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.version !== 1 || !Array.isArray(config.episodes))
    throw new Error('Invalid library configuration');
  const ids = new Set();
  for (const entry of config.episodes) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.videoPath !== 'string'
    ) {
      throw new Error('Invalid or duplicate episode');
    }
    if (entry.subtitlePath && typeof entry.subtitlePath !== 'string')
      throw new Error('Invalid subtitle path');
    ids.add(entry.id);
  }
  return config;
}

async function subtitleState(entry) {
  if (!entry.subtitlePath) return 'missing';
  const path = filePath(entry.subtitlePath);
  if (extname(path).toLowerCase() === '.json') {
    try {
      const run = JSON.parse(await readFile(resolve(dirname(path), 'run.json'), 'utf8'));
      if (['pending', 'running', 'recognized'].includes(run.status)) return 'processing';
      if (run.status !== 'complete') return 'missing';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    return (await stat(path)).isFile() ? 'ready' : 'missing';
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

function sendJson(response, status, value, head = false) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(head ? undefined : body);
}

async function streamMedia(request, response, path) {
  const info = await stat(path);
  if (!info.isFile())
    return sendJson(response, 404, { error: 'video_not_found' }, request.method === 'HEAD');
  const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': mediaTypes[extname(path).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
  };
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = request.headers.range;
  const ifRange = request.headers['if-range'];
  const rangeAllowed = !ifRange || ifRange === etag || ifRange === info.mtime.toUTCString();
  if (range && rangeAllowed) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) {
        const suffix = Number(match[2]);
        start = Math.max(0, info.size - suffix);
        if (suffix === 0) start = info.size;
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), info.size - 1);
      }
    }
    if (
      !match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    ) {
      response.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${info.size}`,
        'Content-Length': 0,
      });
      return response.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  response.writeHead(status, { ...headers, 'Content-Length': Math.max(0, end - start + 1) });
  if (request.method === 'HEAD' || info.size === 0) return response.end();
  const stream = createReadStream(path, { start, end });
  response.on('close', () => stream.destroy());
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

async function handle(request, response, next) {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname !== '/api/library' && !/^\/api\/(media|subtitles)\//.test(pathname)) return next();
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return sendJson(response, 405, { error: 'method_not_allowed' });
  }
  const head = request.method === 'HEAD';
  const config = await loadLibrary();
  if (pathname === '/api/library') {
    const episodes = await Promise.all(
      config.episodes.map(async (entry) => {
        const videoAvailable = await stat(filePath(entry.videoPath))
          .then((value) => value.isFile())
          .catch(() => false);
        const status = await subtitleState(entry);
        return {
          id: entry.id,
          title: label(entry.title, entry.id),
          collection: label(entry.collection || config.title),
          description: label(entry.description),
          poster:
            typeof entry.poster === 'string' &&
            entry.poster.startsWith('/posters/') &&
            !entry.poster.includes('..')
              ? entry.poster
              : '',
          videoAvailable,
          videoUrl: `/api/media/${entry.id}`,
          subtitleStatus: status,
          subtitleUrl: status === 'ready' ? `/api/subtitles/${entry.id}` : null,
          subtitleFormat: entry.subtitlePath
            ? extname(entry.subtitlePath).slice(1).toLowerCase()
            : null,
        };
      }),
    );
    return sendJson(response, 200, { version: 1, title: label(config.title), episodes }, head);
  }
  const match = /^\/api\/(media|subtitles)\/([a-zA-Z0-9_-]+)$/.exec(pathname);
  const entry = match && config.episodes.find((item) => item.id === match[2]);
  if (!entry) return sendJson(response, 404, { error: 'not_found' }, head);
  if (match[1] === 'media') return streamMedia(request, response, filePath(entry.videoPath));
  if ((await subtitleState(entry)) !== 'ready')
    return sendJson(response, 404, { error: 'subtitle_not_ready' }, head);
  const path = filePath(entry.subtitlePath);
  if ((await stat(path)).size > 8 * 1024 * 1024)
    return sendJson(response, 413, { error: 'subtitle_too_large' }, head);
  let text = await readFile(path, 'utf8');
  if (extname(path).toLowerCase() === '.json') {
    const data = JSON.parse(text);
    text = JSON.stringify({
      schema_version: data.schema_version,
      time_unit: data.time_unit,
      time_reference: data.time_reference,
      cues: data.cues,
    });
  }
  response.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(head ? undefined : text);
}

/** Serve only explicitly configured files; never accept a filesystem path from a request. */
export function libraryPlugin() {
  return {
    name: 'local-listening-library',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        handle(request, response, next).catch((error) => {
          console.error('[library]', error.message);
          if (!response.headersSent)
            sendJson(
              response,
              error.code === 'ENOENT' ? 404 : 503,
              { error: error.code === 'ENOENT' ? 'file_not_found' : 'library_unavailable' },
              request.method === 'HEAD',
            );
          else response.destroy();
        });
      });
    },
  };
}
