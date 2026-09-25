const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function installRuntimeCache(hashes) {
  const original = maybeFromCache;
  const scope = new URL('./', self.location.href);
  const enabled = new URL(self.location.href).searchParams.get('enableCache') === 'true';
  const cacheName = 'datax-runtime-sha256-v1';
  const pending = new Map();
  maybeFromCache = async function(event) {
    const request = event.request;
    const url = new URL(request.url);
    const relative = url.pathname.slice(scope.pathname.length);
    const hash = url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
      ? hashes[relative] : null;
    if (!hash || request.method !== 'GET' || request.headers.has('Range') || !enabled) {
      return original(event);
    }
    const key = new URL(relative, scope);
    key.searchParams.set('sha256', hash);
    let cache;
    try {
      cache = await caches.open(cacheName);
      const cached = await cache.match(key.href);
      if (cached) return cached;
    } catch {
      return fetch(request);
    }
    if (!pending.has(key.href)) {
      const download = (async () => {
        const response = await fetch(request);
        if (response.ok && response.status !== 206) {
          try {
            await cache.put(key.href, response.clone());
            const keys = await cache.keys();
            await Promise.all(keys.filter(entry => {
              const previous = new URL(entry.url);
              return previous.pathname === key.pathname && previous.href !== key.href;
            }).map(entry => cache.delete(entry)));
          } catch {}
        }
        return response;
      })();
      pending.set(key.href, download);
      event.waitUntil(download.then(() => {}, () => {}).finally(() => pending.delete(key.href)));
    }
    return (await pending.get(key.href)).clone();
  };
}

function fingerprintRuntime(directory) {
  const runtime = path.join(directory, 'xeus');
  const worker = path.join(directory, 'service-worker.js');
  const marker = '\n;/* datax-runtime-fingerprints */\n';
  if (!fs.existsSync(runtime)) throw new Error('Missing xeus runtime: cannot fingerprint an incomplete build');
  const hashes = {};
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) {
        const relative = path.relative(directory, filename).split(path.sep).map(encodeURIComponent).join('/');
        hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
      }
    }
  }
  visit(runtime);
  const source = fs.readFileSync(worker, 'utf8').split(marker)[0];
  fs.writeFileSync(worker, source + marker + `(${installRuntimeCache.toString()})(${JSON.stringify(hashes)});\n`);
  console.log(`Fingerprinted ${Object.keys(hashes).length} runtime files for cache-first reuse`);
  return hashes;
}

module.exports = { fingerprintRuntime, installRuntimeCache };
if (require.main === module) fingerprintRuntime(process.argv[2] || 'dist');