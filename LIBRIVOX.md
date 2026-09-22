# Importing from LibriVox

Choose **Add audio → Import Options → LibriVox**. Folder and YouTube imports remain available and do not depend on the LibriVox service.

1. Search by **Title** (default), **Author**, or **Genre**, then press Enter or Search. Matches begin with your search text, using the API's documented `^` prefix syntax. Author search uses the author's **last name**. Try the opening words of the catalog title: it may list “Time Machine, The” instead of “The Time Machine.”
2. Browse 20 books at a time with Previous / Page / Next. Open **View details** to inspect the description, readers, and ordered recording sections before downloading. Missing covers use a placeholder.
3. Choose whether to replace existing metadata. By default, only empty fields are filled; existing values and metadata drafts are preserved. The replacement checkbox explicitly allows available LibriVox values to replace them. Missing catalog values never erase existing fields.
4. Select **Import audiobook**. Replacing existing source audio requires confirmation. The previous source files are kept. FFprobe must be ready to verify downloads; browsing does not require transcription models, Python, or yt-dlp.
5. Follow section number, title, and downloaded bytes, or choose **Cancel import**. After completion, use the normal preparation, chapter detection, review, metadata, and export steps.

LibriVox recordings are public domain in the United States. Check the rules in your country before downloading or using them; this is not a claim of worldwide public-domain status. See [LibriVox's explanation](https://librivox.org/pages/about-librivox/).

## Catalog requests and limits

SwissMouse uses the [official JSON API](https://librivox.org/api/info), never website scraping:

- `GET https://librivox.org/api/feed/audiobooks/`: search with `title`, `author`, or `genre` prefixed by `^`; `format=json`, `limit=20`, and `offset=(page-1)*20`. The `fields` projection requests card metadata; `extended=1` enables genres and `coverart=1` requests covers, without requesting section bodies in search results.
- The same endpoint with `id`, `extended=1`, `coverart=1`, and `limit=1` retrieves selected-book details, sections, and readers.
- `GET https://librivox.org/api/feed/audiotracks?project_id=...&format=json` is a fallback when extended sections are missing or incomplete. Only the selected project is requested. The live tracks endpoint does not honor `limit`/`offset` in the checked response; SwissMouse does not iterate through tracks pages.

One shared catalog queue spaces requests at least three seconds apart; it does not prefetch pages or crawl the catalog. Duplicate in-flight queries are shared. Results are cached in memory for ten minutes, up to 100 entries or approximately 32 MiB of serialized data, and disappear when the server restarts. A full page enables Next because the API does not provide a reliable total count; the final Next may return no matches, with Previous still available.

LibriVox's [September 16, 2026 API notice](https://librivox.org/2026/09/16/librivox-api-update/) asks clients to leave several seconds between requests and announces a future 500-result maximum. SwissMouse's 20-result searches stay well below that maximum. HTTP 429 respects `Retry-After` and reports a cooldown instead of automatically retrying. Temporary network/server failures get at most one spaced retry. Each catalog attempt times out after 25 seconds; responses are capped at 8 MiB and pending requests at 30. Search terms are limited to 200 characters and pages to 1–1000.

## Audio, metadata, and chapter mapping

Sections are downloaded sequentially into a newly allocated `output/imports/librivox/book-*` directory. Generated, padded filenames preserve the API's section order through the existing natural-sort pipeline; remote filenames and titles never become filesystem paths. Each section is verified with FFprobe before it becomes an input file. Files keep the detected container extension. Duplicate audio links/order values, incomplete section lists, missing links, invalid audio, and incomplete transfers fail the import rather than creating a partial audiobook.

All parts must succeed before source replacement is committed and saved. Failures and cancellation remove only the newly allocated import directory and retain the previous project source/settings. Import progress is kept in memory and can be reattached after navigating back to the tab. One LibriVox import runs at a time. Editing/deleting the same project, starting another source import, or processing/exporting it is blocked while source replacement is active.

The normal processing pipeline receives `parts`, `discoveredFiles`, the source folder, and measured durations. Default chapter detection is unchanged; downloaded sections are **not automatically final chapters**. The existing explicit files-and-folders chapter workflow remains available. `job.librivox` stores the project ID, trusted project URL, title, description, authors, language, genres, cover URL, every reader, and ordered sections. Each section retains its original download URL, HTTPS download URL, title, generated filename, measured duration, and cumulative source start/end hints. These are provenance/source-boundary hints, not manually approved chapter timestamps.

Available metadata fills title, author, narrator (all distinct readers), description, genres, and cover. Common catalog language names map to ISO language codes; unrecognized names are retained in provenance for manual selection. A single-file LibriVox source does not overwrite the selected metadata with embedded audio tags during preparation.

## Errors and safety

Catalog and audio URLs must use HTTP(S), have no embedded credentials or custom port, and belong to LibriVox or Internet Archive. Audio and cover links are restricted to Internet Archive hosts; downloads upgrade HTTP to HTTPS and validate every redirect. API strings are bounded, stripped of HTML, and rendered as React text. No raw HTML is injected.

Audio transfer stops after 30 seconds without data, 30 minutes per section, 1 GiB per section, or 20 GiB per book. Section transfers do not resume or automatically repeat; retry the import after a failure. Logs report searches/result counts, selected project IDs, section starts, completion, and errors without dumping API payloads.

Known limitations: unusual third-party audio hosts, missing/inconsistent catalog data, very large books, and unavailable Internet Archive files may prevent importing. Reader names unavailable from both official responses cannot be reconstructed. Covers remain remote URLs and require network access when displayed/exported. A process crash or forced shutdown cannot execute cancellation cleanup; interrupted imports are not resumable and may leave an unused `book-*` directory. Normal cancellation and handled failures clean up automatically.

## Development and verification

Local routes are `GET /api/librivox/search`, `GET /api/librivox/books/:id`, `POST /api/librivox/import/:jobId`, `GET /api/librivox/import/:jobId`, and `POST /api/librivox/import/:jobId/cancel`. Clients submit only a catalog project ID, not arbitrary download URLs.

Run `npm run lint`, `npm run build`, and `npm run test:audio`. `tools/librivox.test.ts` covers rendering all three import tabs, official query parameters, pagination/cache/spacing, malformed/empty responses, 429 and network failures, normalization/Unicode/authors/readers, redirects, ordered downloads, cancellation/cleanup (including a stalled catalog request), metadata preservation, HTTP transaction rollback, and feeding imported files through the existing PCM preparation/preview pipeline. Network responses are mocked.

For browser QA, build and run `node --import tsx tools/preview-librivox.mjs`, then open `http://127.0.0.1:3110`. This isolated fixture uses no saved projects and downloads no real books. Search `none` for no matches or `error` for a rate-limit error; other terms exercise results/details and simulated import/cancellation. Stop the fixture when finished.
