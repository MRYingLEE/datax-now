# JupyterLite on Read the Docs

This repository builds a browser-based JupyterLite site and publishes it as
static documentation with Read the Docs. The build uses the checked-in wheel
and WebAssembly runtime inputs, so the Read the Docs project does not need a
second application host.

## Read the Docs setup

1. Create or import this repository in Read the Docs.
2. Use the checked-in `.readthedocs.yaml` configuration.
3. Build the `latest` version.
4. Open the JupyterLite application from the documentation page at
   `/_static/lab/`.

The RTD build runs `./build.sh -c` before Sphinx builds the documentation. The
generated site is copied under the documentation `_static/` directory.

## Customize the site

- Put notebooks and data files in `notebooks/`.
- Change the first-visit notebook in `jupyter-lite.json` and `overrides.json`.
- Adjust application settings in `jupyter-lite.json`.
- Add or remove runtime packages in `environment-wasm-host.yml`.
- Keep the wheel filenames in `environment-deploy.yml` synchronized with
  `built-in-wheels/` using `built-in-wheels/update_wheel_references.py`.

The `built-in-wheels/` and `built-in-conda/` directories are deployment inputs,
not build output. Keep them in the repository so a clean RTD build is
self-contained.

## Local verification

The build script targets Linux x86-64 and downloads Micromamba on its first
run. To reproduce the RTD build locally:

```bash
./build.sh -c
```

The static result is written to `dist/`. A local server must provide the
cross-origin isolation headers required by the WebAssembly runtime; Read the
Docs, Vercel, and Cloudflare deployments provide them.

### Browser caching

Service-worker caching is enabled in `jupyter-lite.json`. After all runtime
patches, the build fingerprints every file under `dist/xeus/` with SHA-256 and
embeds the manifest in the service worker. Runtime files use content-addressed
Cache Storage keys: unchanged files are served locally without background
downloads or revalidation, and changed files are fetched on their next request.
Simultaneous kernel requests share a download. Existing runtime URLs stay stable;
fingerprints are local cache keys, not renamed server files. Other assets retain
background ETag revalidation. URL alias rewrites preserve these validators and
accept `304` responses without retrying.
Runtime cache misses revalidate the HTTP cache and require fetch integrity to
match the build's SHA-256 digest before returning or storing a response. A
deployment mismatch fails the download and can be retried; it is not cached
under the expected hash. Previously unverified runtime cache entries are not
reused, so this upgrade requires an initial runtime download. Byte-range requests
bypass service-worker caches and retain the server's partial-response behavior.
The Cloudflare Worker also handles conditional requests with body-free `304`
responses. Stable runtime URLs are not marked immutable.

The service worker leaves cross-origin requests (including Google Fonts) to the
browser and does not cache unsuccessful same-origin responses, such as a host's
`429` for the web manifest. A cached asset can still be served while background
revalidation fails; the host must recover before uncached requests can succeed.

`%%js` runs in a kernel worker, where browser window APIs such as `alert()` are
not portable. The Quick Start example uses console output instead. A preload
warning for a service-worker-controlled bundle does not by itself indicate a
kernel initialization failure.

Run the focused regression checks with:

```bash
node --test scripts/service-worker-cache.test.mjs cloudflare/worker.test.mjs
```

After rebuilding and deploying, allow one initial load to populate the cache.
With DevTools **Disable cache** unchecked, refresh and inspect **Transferred**,
not the decoded resource size: unchanged runtime assets should come from the
service worker or revalidate with `304`, without another full body download.
Cache eviction, cleared site data, and private browsing can require downloads
again. PWA installation alone does not guarantee offline availability.

### Read the Docs 429 responses

`429 Too Many Requests (from service worker)` can be an upstream response
forwarded by the worker. A direct check of the reported runtime URL returned
`429` with `cf-mitigated: challenge`: Read the Docs' Cloudflare protection was
serving a challenge instead of the runtime file. This is not HTTP 419.
A background runtime fetch cannot complete an interactive HTML challenge.

The build prevents alias retries for 429 responses, Cloudflare challenges,
server errors, and network/integrity failures. Only ordinary 403/404 responses
try alternate extensions. This avoids amplifying blocked requests; it does
not remove the hosting provider's protection. Rebuild and redeploy to apply
the change, then close all tabs for this site and reopen it so the updated
service worker can take over.

- Stop repeated reloads or simultaneous kernel starts while blocked. Wait for
  `Retry-After` when supplied; otherwise allow a cooldown before trying again.
- Open the documentation page normally and complete any challenge presented.
  Keep browser caching enabled and avoid clearing site data as a routine fix:
  doing so forces runtime downloads again.
- If blocking persists, use the existing application deployment at
  <https://datax.now/lab/> or <https://datax-now.helloway.workers.dev/lab/>.
  Browser notebooks and storage are origin-specific, so export important work
  before switching hosts; it will not appear there automatically.
- Ask Read the Docs support to review the block, supplying the failing URL,
  timestamp, HTTP status, and `cf-ray` response header. Do not share cookies.
  There is no repository build setting that disables their Cloudflare challenge.

Read the Docs documents its protection and automated-access guidance at
<https://docs.readthedocs.com/platform/stable/automated-access.html>.
Its API rate limits are separate from documentation asset hosting limits.

## Vercel deployment

Vercel can build the same static JupyterLite site using the checked-in
`vercel.json` configuration. It runs `./build.sh`, publishes `dist/`, and
applies the cross-origin isolation headers required by the WebAssembly runtime.
The `.vercelignore` file excludes local environments and generated output while
keeping the wheel, conda, runtime-wheel, and notebook inputs available to the
build.

The Vercel project `datax-now-readthedocs` uses staged production deployments:
automatic custom-domain assignment is disabled (`autoAssignCustomDomains: false`).
Builds from the production branch are available at deployment-specific URLs for
review, while the production domain remains on the previously promoted build.
If Deployment Protection is enabled, an unauthenticated manifest request on a
staged URL redirects to Vercel SSO. Browsers report that cross-origin redirect
as a manifest CORS error; sign in to the deployment before testing its assets.
After checking a staged deployment, promote that exact deployment without a
rebuild:

```bash
vercel promote <reviewed-deployment-url>
```

For a manually initiated build, stage it explicitly with
`vercel --prod --skip-domain` before reviewing and promoting it. The production
domains `datax.now` and `www.datax.now` are assigned to this project; do not use
either production domain to test an unpromoted deployment.

## GitHub Pages deployment

The `.github/workflows/deploy-github-pages.yml` workflow builds and publishes
the complete `dist/` directory to GitHub Pages when `master` changes. It can
also be started manually with **Run workflow**. In the repository settings,
set **Pages > Build and deployment > Source** to **GitHub Actions**.

The workflow also places a ZIP of the complete deployment at the site root:

```text
https://<owner>.github.io/<repository>/datax-now.zip
```

The exact Pages URL and ZIP URL are printed in the deployment job summary after
each successful run. Vercel publishes the same archive at `/datax-now.zip`, and
Read the Docs publishes it at `/_static/datax-now.zip`. GitHub Pages does not
support the custom COOP/COEP response headers used by `vercel.json`; use the
Read the Docs, Vercel, or Cloudflare deployment when the WebAssembly runtime
requires cross-origin isolation.

## Cloudflare deployment

Cloudflare Pages cannot host the complete build: `dist/datax-now.zip` and some
WebAssembly runtime files exceed its 25 MiB per-asset limit. Instead, the
`deploy-cloudflare.yml` workflow uploads `dist/` to an R2 bucket and deploys a
Worker that serves it at the same paths, including `/datax-now.zip`. The Worker
adds the COOP/COEP headers required by the browser runtime.

1. Create an R2 bucket named `datax-now` in your Cloudflare account.
2. Create an R2 API token with object read/write access to that bucket. Store
  its access key ID and secret access key as GitHub Actions secrets
  `CLOUDFLARE_R2_ACCESS_KEY_ID` and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`.
3. Create a Cloudflare API token with Workers Scripts edit and R2 bucket read
  permissions. Store it as `CLOUDFLARE_API_TOKEN`, and store the account ID as
  `CLOUDFLARE_ACCOUNT_ID`.
4. Run **Deploy JupyterLite to Cloudflare** from **Actions > Run workflow**.
  Open the deployed Worker URL reported by Wrangler (or attach a domain to the
  Worker in Cloudflare) and check `/lab/` and `/datax-now.zip`.

Deployment is manual so an unreviewed build cannot replace the live Worker.
The R2 bucket is not public: the Worker reads it through its bucket binding.
Uploads synchronize and remove files no longer present in `dist/`; do not use
the bucket for other content. Cloudflare R2 storage, operations, and Worker
requests may incur charges.

The live Worker is available at https://datax-now.helloway.workers.dev/.

## Repository layout

| Path | Purpose |
| --- | --- |
| `.readthedocs.yaml` | Read the Docs build configuration |
| `build.sh` | Clean or incremental JupyterLite build |
| `docs/` | Minimal RTD documentation shell |
| `notebooks/` | Content published into JupyterLite |
| `environment-deploy.yml` | Build-time Python and JupyterLite dependencies |
| `environment-wasm-host.yml` | Browser kernel runtime packages |
| `built-in-wheels/` | Checked-in Python wheels used by the build |
| `built-in-conda/` | Checked-in WebAssembly conda packages |
| `cloudflare/` | R2-backed Worker and Wrangler configuration |
