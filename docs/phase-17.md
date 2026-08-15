# Phase 17 - Performance optimization

## Measured production-shell results

Chrome DevTools traced the locally served production build on 2026-08-15 with no CPU or network
throttling. These are lab measurements, not field data:

| Metric                                |                   Before |                   After |
| ------------------------------------- | -----------------------: | ----------------------: |
| LCP                                   |                   182 ms |                  167 ms |
| CLS                                   |                    0.081 |                   0.000 |
| Initial JavaScript                    | 336.9 kB / 106.1 kB gzip | 314.8 kB / 98.0 kB gzip |
| Render-blocking estimated LCP savings |                     0 ms |                    0 ms |

The layout shift came from inserting the install button after `beforeinstallprompt`; a reserved hidden
slot removes it. QR generation is now a dynamic import, saving about 22 kB from the initial bundle.
The receiver also avoids a redundant copy of every already-detached 64 KiB transfer chunk.

The checked-in bundle gate caps initial JavaScript at 330 KiB and CSS at 30 KiB. Run:

```bash
npm run check:bundle
npm run benchmark:transfer
```

On the current development machine, the repeatable 64 MiB/64 KiB Node microbenchmark measured
162.2 MiB/s incremental SHA-256 and 29.9 MiB/s pure-JavaScript AES-GCM. It is a comparison baseline,
not a browser/network promise.

Device, LAN, Internet, TURN, Android, and iOS throughput still require the real-device matrix in
Phase 20. Current receiving retains partial chunks in memory so it can resume across a WebRTC
reconnection; multi-gigabyte acceptance needs memory testing on every supported browser.
