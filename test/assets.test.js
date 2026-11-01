import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { loadAssets, serveAssets } from '../src/assets.js';

const dir = mkdtempSync(join(tmpdir(), 'celebrate-assets-'));
mkdirSync(join(dir, 'js'));
writeFileSync(
  join(dir, 'index.html'),
  '<link rel="stylesheet" href="/styles.css"><script type="module" src="/js/main.js"></script>',
);
writeFileSync(join(dir, 'styles.css'), 'body { color: red; }');
writeFileSync(join(dir, 'js', 'main.js'), "import { a } from './lib.js';\nconsole.log(a);");
writeFileSync(join(dir, 'js', 'lib.js'), 'export const a = 1;');
writeFileSync(join(dir, 'notes.txt'), 'not served');
after(() => rmSync(dir, { recursive: true, force: true }));

const assets = loadAssets(dir);
const app = new Hono().use('*', serveAssets(assets));
app.post('/', (c) => c.text('handled by the next route'));
const get = (path, headers = {}, method = 'GET') => app.request(path, { method, headers });
const versioned = (path) => `${path}?v=${assets.version}`;

describe('loadAssets', () => {
  it('versions asset URLs in HTML and JavaScript imports', async () => {
    const html = await (await get('/')).text();
    assert.ok(html.includes(`href="${versioned('/styles.css')}"`), html);
    assert.ok(html.includes(`src="${versioned('/js/main.js')}"`), html);
    const js = await (await get('/js/main.js')).text();
    assert.ok(js.includes(`from '${versioned('./lib.js')}'`), js);
  });

  it('only loads file types it knows how to serve', () => {
    assert.deepEqual([...assets.files.keys()].sort(), [
      '/',
      '/index.html',
      '/js/lib.js',
      '/js/main.js',
      '/styles.css',
    ]);
  });

  it('derives the version from the content, so it changes when a file changes', () => {
    assert.equal(loadAssets(dir).version, assets.version);
    writeFileSync(join(dir, 'js', 'lib.js'), 'export const a = 2;');
    assert.notEqual(loadAssets(dir).version, assets.version);
  });
});

describe('serveAssets', () => {
  it('prefers Brotli, falls back to gzip, and sends plain bytes otherwise', async () => {
    const br = await get('/styles.css', { 'accept-encoding': 'gzip, br' });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.equal(
      brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString(),
      'body { color: red; }',
    );

    const gzip = await get('/styles.css', { 'accept-encoding': 'gzip, br;q=0' });
    assert.equal(gzip.headers.get('content-encoding'), 'gzip');
    assert.equal(
      gunzipSync(Buffer.from(await gzip.arrayBuffer())).toString(),
      'body { color: red; }',
    );

    const plain = await get('/styles.css');
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(plain.headers.get('content-length'), '20');
    assert.equal(plain.headers.get('content-type'), 'text/css; charset=utf-8');
  });

  it('lets browsers cache versioned URLs forever and revalidate everything else', async () => {
    assert.equal(
      (await get(versioned('/styles.css'))).headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    assert.equal((await get('/styles.css?v=old')).headers.get('cache-control'), 'no-cache');
    assert.equal((await get('/')).headers.get('cache-control'), 'no-cache');
  });

  it('answers revalidation with 304 using a validator per encoding', async () => {
    const first = await get('/', { 'accept-encoding': 'br' });
    const etag = first.headers.get('etag');
    assert.match(etag, /-br"$/);
    assert.equal(first.headers.get('vary'), 'Accept-Encoding');
    assert.equal((await get('/', { 'accept-encoding': 'br', 'if-none-match': etag })).status, 304);
    assert.equal((await get('/', { 'if-none-match': `"other", ${etag}` })).status, 200);
    assert.equal((await get('/', { 'if-none-match': '*' })).status, 304);
  });

  it('answers HEAD with headers only', async () => {
    const response = await get('/styles.css', {}, 'HEAD');
    assert.equal(response.headers.get('content-length'), '20');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  it('passes unknown paths and other methods to the next handler', async () => {
    assert.equal((await get('/notes.txt')).status, 404);
    assert.equal((await get('/js')).status, 404);
    assert.equal(await (await get('/', {}, 'POST')).text(), 'handled by the next route');
  });
});
