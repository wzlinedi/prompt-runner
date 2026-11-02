// Local server of the Prompt Runner: serves the page and (see relay.mjs) forwards chat requests.
// It listens on the loopback address only, holds no state between requests, and never logs
// anything but time, method, path, status, and duration (contracts/relay-api.md).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeAccessLog, announce } from './output.mjs';
import { createChatHandler, SECURITY_HEADERS, MAX_ANSWER_BYTES } from './relay.mjs';
import { tokensCss, PAGE_TOKENS } from './public/src/theme.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendWith(headers, res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, ...headers });
  res.end(body);
}

/** Maps a request path to a file under public/, or null when it is not one of the served files. */
function resolveStatic(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return null;
  if (/^\/src\/[A-Za-z0-9_./-]+\.mjs$/.test(decoded)) {
    const file = path.join(PUBLIC_DIR, decoded);
    if (file.startsWith(PUBLIC_DIR + path.sep)) return file;
  }
  return null;
}

/**
 * Starts the server. Options (all optional; only the command-line entry point below is reachable by the user):
 *  port, token, timeoutMs, bodyLimit, answerLimit  - see contracts/relay-api.md ("Process")
 *  log          - sink for access-log lines (default: standard output)
 *  extraFiles   - { '/path': 'content' } served in addition to public/ (used by the end-to-end tests)
 *  pageScripts  - module script URLs added to the page (used by the end-to-end tests)
 *  relayFetch   - fetch used for the upstream call (used by tests)
 *  securityHeaders - headers of the page responses (tests only: the end-to-end harness lets the page reach its fake platform's counter)
 */
export async function startServer({
  port = 8787,
  token = randomBytes(24).toString('hex'),
  timeoutMs = 180_000,
  bodyLimit = 64 * 1024 * 1024,
  answerLimit = MAX_ANSWER_BYTES,
  log = writeAccessLog,
  extraFiles = {},
  pageScripts = [],
  relayFetch = globalThis.fetch,
  securityHeaders = SECURITY_HEADERS,
} = {}) {
  const send = (...args) => sendWith(securityHeaders, ...args);
  const indexSource = await readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  // The page's styles start with the design tokens it shares with the report (spec FR-048), so there is one definition of them.
  const stylesCss = `${tokensCss(':root', PAGE_TOKENS)}\n${await readFile(path.join(PUBLIC_DIR, 'styles.css'), 'utf8')}`;
  const scriptTags = pageScripts.map((src) => `<script type="module" src="${src}"></script>`).join('\n');
  const indexHtml = indexSource.replace('__RELAY_TOKEN__', token).replace('</body>', `${scriptTags}\n</body>`);

  let boundPort = 0;
  const hostOk = (host) => host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`;
  const originOk = (origin) => origin === `http://127.0.0.1:${boundPort}` || origin === `http://localhost:${boundPort}`;
  const handlers = { chat: null }; // POST /api/chat is registered by registerRelay below

  const server = createServer(async (req, res) => {
    const started = performance.now();
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://local').pathname; } catch { pathname = '/'; }
    res.on('close', () => {
      const safePath = pathname.replace(/[^\x21-\x7e]/g, '?').slice(0, 200);
      log(`${new Date().toISOString()} ${req.method} ${safePath} ${res.statusCode} ${Math.round(performance.now() - started)}ms`);
    });
    try {
      // Every request must address this server by its loopback name; this also stops DNS-rebinding
      // pages from reading the page (and with it the relay token).
      if (!hostOk(req.headers.host)) return send(res, 403, 'Forbidden');

      if (pathname === '/api/chat') {
        if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
        if (!handlers.chat) return send(res, 404, 'Not found');
        return await handlers.chat(req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      if (pathname === '/' || pathname === '/index.html') return send(res, 200, indexHtml, MIME['.html']);
      if (pathname === '/styles.css') return send(res, 200, stylesCss, MIME['.css']);
      if (Object.hasOwn(extraFiles, pathname)) {
        return send(res, 200, extraFiles[pathname], MIME[path.extname(pathname)] ?? 'text/plain; charset=utf-8');
      }
      const file = resolveStatic(pathname);
      if (!file) return send(res, 404, 'Not found');
      let content;
      try { content = await readFile(file); } catch { return send(res, 404, 'Not found'); }
      return send(res, 200, content, MIME[path.extname(file)]);
    } catch {
      if (!res.headersSent) send(res, 500, 'Internal error');
      else res.end();
    }
  });

  const listen = (p) => new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(p, '127.0.0.1');
  });
  try {
    await listen(port);
  } catch (error) {
    if (error.code === 'EADDRINUSE' && port !== 0) await listen(0); else throw error;
  }
  boundPort = server.address().port;

  const context = { token, timeoutMs, bodyLimit, answerLimit, hostOk, originOk, relayFetch, handlers };
  await registerRelay(context);

  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    token,
    address: server.address(),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/** Attaches POST /api/chat (relay.mjs). */
async function registerRelay(context) {
  context.handlers.chat = createChatHandler(context);
}

// Command-line entry point: a thin call to startServer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer({ port: Number(process.env.PORT) || 8787 });
  announce(server.url);
  process.on('SIGINT', async () => { await server.close(); process.exit(0); });
}
