const isolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    let key;
    try {
      key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!key || key.endsWith("/")) key += "index.html";
    const prefix = (env.ASSET_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
    if (prefix) key = `${prefix}/${key}`;

    const validator = request.headers.get("If-None-Match");
    let object = request.method === "HEAD" || validator
      ? await env.ASSETS.head(key)
      : await env.ASSETS.get(key, { range: request.headers });
    const notModified = object && validator && (
      validator.trim() === "*" ||
      (validator.match(/(?:W\/)?"[^"]*"/g) || []).some(
        tag => tag.replace(/^W\//, "") === object.httpEtag,
      )
    );
    if (object && validator && !notModified && request.method === "GET") {
      object = await env.ASSETS.get(key, { range: request.headers });
    }
    if (!object) {
      return new Response("Not found", { status: 404, headers: isolationHeaders });
    }

    const headers = new Headers(isolationHeaders);
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=0, s-maxage=300");
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");

    if (notModified) return new Response(null, { status: 304, headers });

    const partial = request.method === "GET" && request.headers.has("Range") && object.range;
    if (partial) {
      headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
      headers.set("Content-Length", String(object.range.length));
    } else {
      headers.set("Content-Length", String(object.size));
    }
    return new Response(request.method === "HEAD" ? null : object.body, {
      status: partial ? 206 : 200,
      headers,
    });
  },
};