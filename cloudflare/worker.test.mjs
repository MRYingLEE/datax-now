import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

const content = new TextEncoder().encode("site");
const asset = {
  size: content.length,
  httpEtag: '"etag"',
  body: content,
  range: { offset: 0, length: content.length },
  writeHttpMetadata(headers) {
    headers.set("Content-Type", "text/html");
  },
};

test("revalidating an unchanged runtime avoids transferring its body", async () => {
  const env = { ASSETS: {
    async head() { return asset; },
    async get() { return asset; },
  } };
  const url = "https://example.com/xeus/kernel.wasm";
  const initial = await worker.fetch(new Request(url), env);
  assert.equal(initial.status, 200);
  for (const method of ["GET", "HEAD"]) {
    for (const validator of ['"etag"', 'W/"etag"', '"old", "etag"', "*"]) {
      const response = await worker.fetch(new Request(url, {
        method,
        headers: { "If-None-Match": validator },
      }), env);
      assert.equal(response.status, 304);
      assert.equal(await response.text(), "");
      assert.equal(response.headers.get("ETag"), initial.headers.get("ETag"));
      assert.equal(response.headers.get("Content-Length"), null);
      assert.equal(response.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
    }
  }
  const updated = await worker.fetch(new Request(url, {
    headers: { "If-None-Match": '"old"' },
  }), env);
  assert.equal(updated.status, 200);
  assert.equal(await updated.text(), "site");
});

test("serves index files with isolation headers and metadata", async () => {
  const keys = [];
  const env = { ASSETS: {
    async get(key) { keys.push(key); return asset; },
    async head(key) { keys.push(key); return asset; },
  } };

  const response = await worker.fetch(new Request("https://example.com/lab/"), env);
  assert.deepEqual(keys, ["lab/index.html"]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Range"), null);
  assert.equal(await response.text(), "site");
  assert.equal(response.headers.get("Content-Type"), "text/html");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=0, s-maxage=300");
  assert.equal(response.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
  assert.equal(response.headers.get("Cross-Origin-Opener-Policy"), "same-origin");

  const head = await worker.fetch(new Request("https://example.com/", { method: "HEAD" }), env);
  assert.deepEqual(keys, ["lab/index.html", "index.html"]);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "4");
  assert.equal(await head.text(), "");
});

test("serves byte ranges", async () => {
  const env = { ASSETS: { async get(key, options) {
    assert.equal(key, "datax-now.zip");
    assert.equal(options.range.get("Range"), "bytes=1-2");
    return { ...asset, body: content.slice(1, 3), range: { offset: 1, length: 2 } };
  } } };

  const response = await worker.fetch(new Request("https://example.com/datax-now.zip", {
    headers: { Range: "bytes=1-2" },
  }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 1-2/4");
  assert.equal(await response.text(), "it");
});

test("returns 404 for missing files and 405 for unsupported methods", async () => {
  const env = { ASSETS: { async get() { return null; } } };
  const missing = await worker.fetch(new Request("https://example.com/missing.js"), env);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("Cross-Origin-Opener-Policy"), "same-origin");

  const denied = await worker.fetch(new Request("https://example.com/", { method: "POST" }), env);
  assert.equal(denied.status, 405);
});