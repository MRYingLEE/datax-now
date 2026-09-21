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
cross-origin isolation headers required by the WebAssembly runtime; RTD is the
supported hosted deployment for this repository.

## Vercel deployment

Vercel can build the same static JupyterLite site using the checked-in
`vercel.json` configuration. It runs `./build.sh`, publishes `dist/`, and
applies the cross-origin isolation headers required by the WebAssembly runtime.
The `.vercelignore` file excludes local environments and generated output while
keeping the wheel, conda, runtime-wheel, and notebook inputs available to the
build.

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