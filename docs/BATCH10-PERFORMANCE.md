# Batch 10 picker-engine measurements

Measured October 29, 2026. [Implementation and recovery](BATCH10-DIRECTORY-AND-PICKER.md). [Raw results and query plans](benchmarks/batch10-directory.json).

These results support the shared picker's **indexed read path**. They do not establish full mixed-library import, taxonomy traversal, cold-machine startup, concurrent playback or complete application memory budgets.

## Reproduction and environment

Run `npm.cmd run benchmark:information-directory`. It creates and removes a disposable fixture, performs no media or model work, and writes `.cache/batch10-benchmark.json`. Dataset seed: `directory-v1-sequential-20261029`.

- CPU: 11th Gen Intel(R) Core(TM) i7-11700KF @ 3.60GHz; 16 logical CPUs; 31.87 GiB RAM.
- OS: Windows_NT 10.0.26300 x64; Node v24.21.0; SQLite 3.53.4.
- Storage: workspace drive; SSD/HDD type was not independently verified. Other fixture tests ran during portions of this measurement. Treat these as local engineering measurements, not an isolated hardware certification.
- Forty samples per timing case, sorted to report p50/p95/p99. The OS file cache was not flushed. First read after reopening SQLite is reported separately and must not be called a cold-machine measurement.

## What was actually populated

| Profile | Synthetic logical value labels | Synthetic file rows | Actual retained work resources | Recording resources | Canonical file resources | Directory entries after edit sample | Association rows after edit sample |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 40,000 | 40,000 | 1 | 0 | 0 | 40,002 | 1 |
| Scale | 500,000 | 500,000 | 1 | 0 | 0 | 500,002 | 5,000,001 |

The large directory/file rows are synthetic projection inputs, seeded directly rather than imported through the entire module pipeline. File rows are identifiers/references in a benchmark table, not real files or complete Core file descriptors. The dense scale case has 5,000 context keys associated with 1,000 directory entries each, plus the separately measured work's association. These are **context associations**, not five million taxonomy assignments. One real generic publication is repeatedly edited to measure incremental projection/read work.

This supplies the planned vocabulary sizes and a dense association stress case; it does not substitute for the broader shared-resource contract's complete catalog, taxonomy-assignment, source-import or resource-total profiles.

## Query timings

All times are milliseconds for up to 20 returned items. `latePrefix` finds the late-alphabet fixture; `shortCommonPrefix` uses one character; `contains` searches Legacy; `commonContains` searches a common internal substring; `unicode` searches Jose against preserved accented values.

| Directory labels | Case | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| 40,000 | latePrefix | 12.64 | 16.16 | 16.79 |
| 40,000 | shortCommonPrefix | 0.24 | 0.58 | 6.91 |
| 40,000 | contains | 17.71 | 20.52 | 20.97 |
| 40,000 | commonContains | 3.22 | 4.26 | 4.60 |
| 40,000 | unicode | 6.54 | 8.22 | 11.75 |
| 500,000 | latePrefix | 31.55 | 41.03 | 42.61 |
| 500,000 | shortCommonPrefix | 0.32 | 0.65 | 0.90 |
| 500,000 | contains | 97.14 | 158.11 | 168.79 |
| 500,000 | commonContains | 19.80 | 24.54 | 30.94 |
| 500,000 | unicode | 0.53 | 2.55 | 2.78 |

The measured prefix and contains cases meet the proposed picker budgets: baseline p95 below 100/200 ms, scale below 200/350 ms respectively. This comparison covers engine calls, without browser/network/rendering latency. Correctness tests separately cover lookup past 100 values, stable paging, accent/equality separation and supplementary Unicode prefixes.

Dense contextual recommendations measured p50 **1.78 ms**, p95 **9.26 ms**, p99 **20.50 ms**. The baseline context fixture was not populated for that particular query, so its empty-result timing is not presented as a contextual-search result.

The generic publication → directory projection → exact read loop measured p95 **33.81 ms** at baseline and **112.55 ms** at scale. It includes the authoritative generic publication transaction, but not the entire audiobook Save/source-outbox/RPC/UI path. API tests validate that full save path's correctness, not a large-library end-to-end latency budget.

The first read after SQLite reopen took **16.06 ms** / **45.97 ms**. The OS cache remained warm; this is not whole-app startup time.

## Work bounds, storage and memory

Prefix reads use the covering provider/field/search/key index. Contains uses the FTS5 trigram virtual index, provider scope and row-ID continuation; the raw plan's virtual-table SCAN label is not a scan of project JSON. Contains reads at most 201 indexed candidates per call, and broad queries may need continuation. Empty-query contexts and candidate pools have explicit bounds. No query probes media or deserializes every source project.

Checkpointed index sizes were **32.39 MiB** at baseline and **1.56 GiB** for the dense scale fixture. The latter includes the large association table/index and synthetic file rows. That storage cost is a real tradeoff; it is not a prediction that every 500,000-file library will use exactly that amount.

Benchmark-process RSS at the checkpoints was **93.57 MiB** / **128.49 MiB**. Four consecutive windows of 250 warm queries, with explicit GC between windows, retained approximately **8.38, 8.37, 8.37, 8.37 MiB** of JS heap at scale. This shows no continuing growth in that short query exercise; it is not a long-running app/worker/browser memory guarantee. SQLite/OS caches and full application memory need their own budgets.

Seeding time in the raw output includes synthetic loading, sampling and maintenance. It is not module import throughput. Publication/term/history receipt logs are unpruned; compaction and total authoritative-store growth remain separate maintenance work.

## Evidence still needed for wider acceptance

Measure real large-library imports and edits, HTTP/UI p95/p99, true cold start, simultaneous playback/indexing/bulk operations, hierarchical taxonomy filtering and complete app/worker memory before claiming those gates. This batch enables none of the new storage in the maintainer's collection and keeps the pilot opt-in.
