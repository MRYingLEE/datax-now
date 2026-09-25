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

Service-worker caching is enabled in `jupyter-lite.json`. The build patches the
worker to retain that setting across worker restarts, use its versioned cache,
and send cached ETags when refreshing same-origin assets. Unchanged runtime
files are reused locally while changed files are fetched in the background.
The Cloudflare Worker also handles conditional requests with body-free `304`
responses. Stable runtime URLs are not marked immutable.

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
