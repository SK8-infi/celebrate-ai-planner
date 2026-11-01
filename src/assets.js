import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * Serves the public folder from memory. Every file is read once at startup and pre-compressed
 * with Brotli and gzip, so requests cost no disk access or compression. Asset URLs in the HTML
 * and in JavaScript imports carry a content version, which lets browsers cache them for a year;
 * the HTML itself is always revalidated, and a new deployment changes every version.
 */

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
const ENCODINGS = /** @type {const} */ (['br', 'gzip']);
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** @param {string | Buffer} data */
const hash = (data) => createHash('sha256').update(data).digest('base64url').slice(0, 16);

/**
 * A file held in memory, as plain bytes and pre-compressed, with its content hash.
 * @typedef {{ type: string, identity: Bytes, br: Bytes, gzip: Bytes, etag: string }} Asset
 * @typedef {Buffer<ArrayBuffer>} Bytes
 */

/**
 * @param {string} text file contents
 * @param {string} url the file's URL path
 * @param {string} version build version appended to asset URLs
 */
function tagVersions(text, url, version) {
  if (url.endsWith('.html')) {
    return text.replace(/((?:href|src)=")(\/[^"]+\.(?:css|js|svg))"/g, `$1$2?v=${version}"`);
  }
  if (url.endsWith('.js')) return text.replace(/(from ')(\.\/[^']+\.js)'/g, `$1$2?v=${version}'`);
  return text;
}

/**
 * @param {string} dir folder to serve
 * @returns {{ version: string, files: Map<string, Asset> }}
 */
export function loadAssets(dir) {
  const sources = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TYPES[extname(entry.name)])
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [`/${relative(dir, path).split(sep).join('/')}`, readFileSync(path, 'utf8')];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const version = hash(JSON.stringify(sources));

  /** @type {Map<string, Asset>} */
  const files = new Map();
  for (const [url, text] of sources) {
    const identity = Buffer.from(tagVersions(text, url, version));
    files.set(url, {
      type: TYPES[extname(url)],
      identity,
      br: brotliCompressSync(identity, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
      gzip: gzipSync(identity, { level: 9 }),
      etag: hash(identity),
    });
  }
  const index = files.get('/index.html');
  if (!index) throw new Error(`No index.html to serve in ${dir}`);
  files.set('/', index);
  return { version, files };
}

/**
 * @param {string} coding
 * @param {string | undefined} header Accept-Encoding request header
 * @returns {number} the client's quality value for the coding (0 when not accepted)
 */
function quality(coding, header = '') {
  for (const part of header.split(',')) {
    const [name, ...params] = part.split(';').map((piece) => piece.trim());
    if (name.toLowerCase() !== coding) continue;
    const q = params.find((param) => param.startsWith('q='));
    return q ? Number(q.slice(2)) : 1;
  }
  return 0;
}

/**
 * Picks the best representation the client accepts: Brotli, then gzip, then plain bytes.
 * Each has its own validator, as RFC 9110 requires for strong ETags.
 * @param {Asset} file
 * @param {string | undefined} acceptEncoding
 */
function represent(file, acceptEncoding) {
  const encoding = ENCODINGS.find((coding) => quality(coding, acceptEncoding) > 0);
  if (!encoding) return { body: file.identity, etag: `"${file.etag}"` };
  return { body: file[encoding], etag: `"${file.etag}-${encoding}"`, encoding };
}

/**
 * @param {string} etag
 * @param {string | undefined} ifNoneMatch If-None-Match request header
 */
const isFresh = (etag, ifNoneMatch = '') =>
  ifNoneMatch.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*');

/**
 * Middleware that answers GET and HEAD requests for known files and passes everything else on.
 * Unknown paths never touch the file system, so there is nothing to traverse.
 * @param {ReturnType<typeof loadAssets>} assets
 * @returns {import('hono').MiddlewareHandler}
 */
export function serveAssets({ version, files }) {
  return async (c, next) => {
    const file = ['GET', 'HEAD'].includes(c.req.method) ? files.get(c.req.path) : undefined;
    if (!file) return next();

    const { body, etag, encoding } = represent(file, c.req.header('Accept-Encoding'));
    c.header('Content-Type', file.type);
    c.header('Cache-Control', c.req.query('v') === version ? IMMUTABLE : 'no-cache');
    c.header('Vary', 'Accept-Encoding');
    c.header('ETag', etag);
    if (isFresh(etag, c.req.header('If-None-Match'))) return c.body(null, 304);

    if (encoding) c.header('Content-Encoding', encoding);
    c.header('Content-Length', String(body.length));
    return c.req.method === 'HEAD' ? c.body(null) : c.body(body);
  };
}
