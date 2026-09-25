import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";
import fingerprints from "./fingerprint-runtime.cjs";

const root = new URL("../", import.meta.url);
const build = readFileSync(new URL("build.sh", root), "utf8");
const patch = build.split('echo "Patching service worker cache version..."')[1]
  .split("python3 << 'EOFPATCH'\n")[1].split("\nEOFPATCH")[0];
const upstream = `const CACHE="precache";let enableCache=!1;
function onActivate(e){enableCache="true"===new URL(location.href).searchParams.get("enableCache"),e.waitUntil(self.clients.claim())}
async function openCache(){return await caches.open("precache")}
async function fromCache(request){return (await openCache()).match(request)}
async function updateCache(request,response){return (await openCache()).put(request,response)}
async function refetch(e){let a=await fetch(e);return await updateCache(e,a),a}`;

test("fingerprints reuse runtime bodies after restart and invalidate binary-only changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "datax-fingerprints-"));
  const stored = new Map();
  let downloads = 0;
  let fallbackCalls = 0;
  const cache = {
    async match(key) { return stored.get(key)?.clone(); },
    async put(key, response) { stored.set(key, response.clone()); },
    async keys() { return [...stored.keys()].map(key => new Request(key)); },
    async delete(request) { return stored.delete(request.url); },
  };
  function startWorker() {
    const context = vm.createContext({
      URL, Request, Response,
      enableCache: false,
      self: { location: { href: "https://example.com/_static/service-worker.js?enableCache=true" } },
      caches: { async open() { return cache; } },
      async maybeFromCache() { fallbackCalls++; return new Response("fallback"); },
      async fetch() { downloads++; return new Response("runtime body"); },
    });
    vm.runInContext(readFileSync(join(directory, "service-worker.js"), "utf8"), context);
    return context;
  }
  async function load(context, pathname = "xeus/runtime.wasm", options) {
    const tasks = [];
    const response = await context.maybeFromCache({
      request: new Request(`https://example.com/_static/${pathname}`, options),
      waitUntil(task) { tasks.push(task); },
    });
    const body = await response.text();
    await Promise.all(tasks);
    return body;
  }
  try {
    mkdirSync(join(directory, "xeus"));
    writeFileSync(join(directory, "xeus/runtime.wasm"), "binary-v1");
    writeFileSync(join(directory, "xeus/runtime.js"), "unchanged loader");
    writeFileSync(join(directory, "service-worker.js"), "");
    const first = fingerprints.fingerprintRuntime(directory);
    assert.match(first["xeus/runtime.wasm"], /^[a-f0-9]{64}$/);
    const worker = startWorker();
    assert.deepEqual(await Promise.all([load(worker), load(worker)]), ["runtime body", "runtime body"]);
    assert.equal(downloads, 1, "parallel kernels must share the first download");
    assert.equal(await load(startWorker()), "runtime body");
    assert.equal(downloads, 1, "reload must transfer no runtime body");
    assert.equal(await load(worker, "xeus/runtime.wasm", { headers: { Range: "bytes=0-3" } }), "fallback");
    assert.equal(await load(worker, "jupyter-lite.json"), "fallback");
    assert.equal(fallbackCalls, 2);
    writeFileSync(join(directory, "xeus/runtime.wasm"), "binary-v2");
    const second = fingerprints.fingerprintRuntime(directory);
    assert.notEqual(first["xeus/runtime.wasm"], second["xeus/runtime.wasm"]);
    assert.equal(first["xeus/runtime.js"], second["xeus/runtime.js"]);
    assert.equal(await load(startWorker()), "runtime body");
    assert.equal(downloads, 2, "changed binary must download once");
    assert.equal(stored.size, 1, "superseded versions of this file must be removed");
    const failing = startWorker();
    failing.caches.open = async () => { throw new Error("Storage unavailable"); };
    assert.equal(await load(failing), "runtime body");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime URL rewrites preserve validators and accept 304 without retrying", async () => {
  const directory = mkdtempSync(join(tmpdir(), "datax-rewrite-"));
  try {
    mkdirSync(join(directory, "dist"));
    writeFileSync(join(directory, "dist/service-worker.js"), "");
    for (const label of ["safe file extension conversion", "conda package URL extension fallback"]) {
      const section = build.split(`echo "Patching service worker for ${label}..."`)[1];
      const script = section.split("<< 'EOFPATCH'\n")[1].split("\nEOFPATCH")[0];
      const result = spawnSync("python3", ["-c", script], { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const requests = [];
    const context = vm.createContext({
      URL, Request,
      location: { href: "https://example.com/service-worker.js" },
      async fetch(input, init) {
        const request = new Request(input, init);
        requests.push(request);
        return new Response(null, { status: 304 });
      },
    });
    context.self = context;
    vm.runInContext(readFileSync(join(directory, "dist/service-worker.js"), "utf8"), context);
    for (const [source, target] of [
      ["/xeus/library.so", "/xeus/library.so.asm"],
      ["/xeus/library.so.asm", "/xeus/library.so.asm"],
      ["/xeus/package.whl", "/xeus/package.whl.asm"],
      ["/emscripten-wasm32/package.tar.gz", "/emscripten-wasm32/package.tar.bz2"],
    ]) {
      requests.length = 0;
      const response = await context.fetch(new Request(`https://example.com${source}`, {
        headers: { "If-None-Match": '"runtime-v1"', Range: "bytes=0-9" },
        credentials: "include",
      }));
      assert.equal(requests.length, 1, "304 must not trigger alias retries");
      assert.equal(new URL(requests[0].url).pathname, target);
      assert.equal(requests[0].headers.get("If-None-Match"), '"runtime-v1"');
      assert.equal(requests[0].headers.get("Range"), "bytes=0-9");
      assert.equal(requests[0].credentials, "include");
      assert.equal(response.status, 304);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("service worker caches across restarts and revalidates without runtime bodies", async () => {
  const config = JSON.parse(readFileSync(new URL("jupyter-lite.json", root)));
  assert.equal(config["jupyter-config-data"].enableServiceWorkerCache, true);
  const directory = mkdtempSync(join(tmpdir(), "datax-cache-"));
  try {
    mkdirSync(join(directory, "dist/xeus/xeus-python-wasm-host"), { recursive: true });
    writeFileSync(join(directory, "dist/xeus/xeus-python-wasm-host/xpython.js"), "runtime");
    writeFileSync(join(directory, "dist/service-worker.js"), upstream);
    const result = spawnSync("python3", ["-c", patch], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const generated = readFileSync(join(directory, "dist/service-worker.js"), "utf8");
    let cached = new Response("runtime", { headers: { ETag: '"runtime-v1"' } });
    let changed = false;
    const opened = [];
    const context = vm.createContext({
      URL, Request, Response, Headers,
      location: { href: "https://example.com/service-worker.js?enableCache=true", origin: "https://example.com" },
      self: { clients: { async claim() {} } },
      caches: {
        async open(name) {
          opened.push(name);
          return {
            async match() { return cached.clone(); },
            async put(request, response) { cached = response.clone(); },
          };
        },
      },
      async fetch(request) {
        assert.equal(request.headers.get("If-None-Match"), '"runtime-v1"');
        return changed
          ? new Response("updated", { headers: { ETag: '"runtime-v2"' } })
          : new Response(null, { status: 304 });
      },
    });
    vm.runInContext(generated, context);
    assert.equal(vm.runInContext("enableCache", context), true);
    const request = new Request("https://example.com/xeus/xpython.wasm");
    assert.equal(await (await context.refetch(request)).text(), "runtime");
    assert.ok(opened.every(name => /^precache-[a-f0-9]+$/.test(name)));
    changed = true;
    assert.equal(await (await context.refetch(request)).text(), "updated");
    assert.equal(await cached.text(), "updated");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});