# Browser Stockfish builds and operation

Analysis opens interactive **Stockfish 19 Full** by default, with depth 25 and a
15-second limit (first reached wins). Settings offers **Stockfish 19 Lite** as a
lower-download/memory option. The engine choice and requested thread count are
browser preferences, including for imported/blank analysis; no account setting or
database data is added. Other search controls keep their existing session behavior.

Full downloads only when an uncached interactive search starts in Analysis. Home,
ordinary live play, and cached positions do not start a download. The upstream
download MessagePort drives a real progress bar; compilation/initialization can
continue after 100%. A load/runtime failure or 120-second initialization timeout
switches this analysis session to clearly labeled Lite. **Retry Full** is explicit;
the saved Full preference is not silently replaced. Stop/close cancels the worker,
download and progress channel. There is no background preload or service worker.

## Assets and deployment

`npm ci` installs the integrity-pinned `stockfish@19.0.0` development dependency.
Dev/build lifecycle scripts copy its four Full files, unmodified, into ignored
`apps/web/public/engine/stockfish-19.0.0/`. Deploy **all** files in `apps/web/dist`,
including both Full alternatives, Lite, COPYING and NOTICE. Generated WASM files
are not stored in Git. Each Full WASM is roughly 99 MB before HTTP compression;
the browser fetches one variant, not both, unless capability or choice changes.
The release's asset hashes, authors, GPLv3 and exact corresponding-source links
are in the [distributed notice](../apps/web/public/engine/NOTICE.md).

Vite development and production preview send these headers on documents/assets:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The `chess-analysis-isolation` Vite plugin sets these **before** the built-in
HTML, module and static-file handlers. Vite 8.3.1 can return a matching ETag's
304 before applying `server.headers` / `preview.headers`; declaring those settings
alone therefore leaves conditional responses without the policies. Tests cover
both 200 and 304 documents (including `/challenge/...`), scripts and WASM.
An injected `chess-isolation-policy` HTML marker changes the old document's ETag
once, so a previously unisolated cached representation gets a fresh 200. Engine
asset URLs and caching are unchanged. Increment the marker when changing the
document policy, and rebuild preview assets after pulling changes.

The eventual production static host/reverse proxy must preserve these policies,
serve WASM as `application/wasm` and JS as JavaScript, and use HTTPS outside local
loopback. Do not block `cross-origin-isolated` via Permissions-Policy. All engine
and pthread worker files must be same-origin. See
[browser isolation requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).
COOP separates cross-origin popup relationships; the application currently does
not depend on them. Keep this in mind before adding OAuth popups or external embeds.

### Diagnosing a local single-thread fallback

Use **Engine settings → Thread diagnostics**. This reports the actual document's
secure-context and isolation flags, whether it is top-level, the exposed
Permissions-Policy decision, SharedArrayBuffer and a small shared-WASM allocation
probe. Failure text names the failing prerequisite; it never enables threads by
overriding a browser check. A browser without a policy-inspection API reports
`Not reported`, rather than assuming permission was denied.

In Chrome Network, inspect the **document** navigation, its final origin/URL and
redirect chain, and both a fresh 200 and conditional 304. A missing header on an
asset or raw 304 alone does not identify the cached document's effective policy.
Reload the document after changing the server policy; HMR cannot turn an existing
unisolated document into an isolated one. If headers still differ, verify the
process on the actual browser port and its checkout. A Vite process from another
clone will not receive this checkout's edits until that clone is updated/restarted.
Never share request Cookie headers, reset URLs or tokens while collecting evidence.

The runtime regression also executes the exact unmodified Full WASM under Node,
observing pthread launches for `Threads=1` versus `Threads=2`. This confirms that
the UCI setting changes the engine's worker pool; it does **not** verify browser
isolation or prove that an individual Chrome session uses multiple threads.

No special cache-busting query or forced reload is used for engine fetches.
Normal HTTP caches/validators avoid repeated network bodies; Vite revalidates with
ETags/304. For production, configure `Cache-Control: public, max-age=31536000,
immutable` for the versioned Full directory and these unchanged Lite 19 assets.
Keep HTML revalidatable. Never replace bytes at an immutable URL; a future build
needs a new versioned URL and evaluation-cache identity. Actual remote hosting is
not configured here; Vite preview verifies built assets, not a deployed reverse proxy.

## CPU, settings and review separation

Full multithreading requires cross-origin isolation, SharedArrayBuffer and shared
WASM memory. Otherwise **Full single-threaded** is selected, and Threads is absent.
Lite is always single-threaded. Threads starts at **1** and is capped at
`max(1, min(4, floor(hardwareConcurrency) - 2))`; unavailable core data uses one.
The cap reserves capacity for the UI and the one-thread review on larger devices.
Hardware concurrency is a browser hint, not guaranteed dedicated CPU capacity.
Both controllers keep Hash at 16 MB; the Full neural network/runtime additionally
uses substantially more memory than Lite. A higher thread count may reduce
responsiveness or battery life; mobile users can select Lite and stop searches.

**Computer Analysis remains Stockfish 19 Lite, one thread, depth 14 / 1.2 seconds
per position**, with its existing pause, cancellation, watchdog, CPL/accuracy method
and cache. Its panel explicitly names this build even if interactive Full is running.
There are at most two engine instances per Analysis workspace: interactive (1–4
search threads) and the bounded one-thread Lite review. Changing engine or Threads
replaces only the interactive worker, retaining search limits/lines and review state.
Review start/cancel/finish does not stop the interactive engine. Concurrent work can
still saturate low-core devices; Stop and Cancel remain independent controls.

Interactive caches separate exact build variant, effective thread count, FEN,
MultiPV count and depth/time profile. Full, Full single-threaded, and Lite never
reuse each other's scores. The previous Lite cache remains valid for review.
Evaluation records identify their engine, including in the evaluation-bar tooltip
when it uses a review result. Unlimited searches are not completed-result caches.

Run `npm run check` for all unit/HTTP tests, type checks and production builds.
The tests verify capability selection, preference storage, CPU limits, cache
separation, loading progress/cancellation/failures, UCI options, and development /
production-preview headers. Real browser smoke tests are still needed after
changes to the distributed workers or production host configuration.
