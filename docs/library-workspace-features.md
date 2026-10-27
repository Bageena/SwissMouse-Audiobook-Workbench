# Library workspace features

## Returning to work

The library remembers location, view, search, structured filters, sorting,
pagination, collection, selection, page scroll, and continuous-list scroll in
session storage. Open-book navigation flushes the current snapshot before
leaving. Large selection snapshots are debounced while scrolling. All-mode
windowing and full-catalog filtering remain in place.

Each book remembers its last workflow step, file-review/workflow view, and page
scroll. Chapter review remembers the selected stable chapter ID, bulk selection,
transcript search/page, and both pane scroll positions. Deleted chapter IDs are
ignored and transcript pagination is bounded to the available words. File Manager
remembers its directory, view, filters, sort, selection, and per-directory scroll.
Restoring a directory uses the existing authorized, read-only browsing endpoint;
an unavailable remembered directory falls back to the normal book root.

## Navigation and organization

The collapsible library sidebar provides Inbox, Library, Workbench projects,
collections, and saved searches. Collections are explicit lists of book IDs across
locations. Adding or removing collection membership never changes file location
or processing membership. Missing book references remain recoverable in the saved
collection. Removing a collection removes only that list.

Collections, named searches, and sidebar collapse preference use local browser
storage. They survive app reloads but are not synced between browsers or devices.
Navigation/editor positions use session storage. Invalid or unavailable storage
falls back safely; failed collection/search writes show a session-only warning.

## Search and selection

Search includes title, folder/name, subtitle, creator aliases, narrator aliases,
series, description, genres, tags, and formats. Expanded filters combine creator,
narrator, series, tag/genre, and format with the existing availability selector.
Matching normalizes case, compatibility characters, punctuation, and accents.
Filtering happens before sorting/windowing. Chips remove individual filters;
Clear Filters returns to normal Available results in the current location.

Named searches capture location/collection, query, filters, availability, and sort.
Saving an existing name updates its definition. The selection bar explicitly
distinguishes a bounded page or loaded virtual rows from every matching result.
Select-all captures concrete IDs; it does not automatically include later arrivals.
The bar reports hidden selections and offers bulk editing, collection membership,
clear, and existing guarded deletion. Merged-representation deletion stays disabled.

## Activity

The header Activity control opens an inline panel showing current scan, import,
processing, export, and validation state, with recent events behind a disclosure
and technical logs one level deeper. Processing status comes from the existing
server progress endpoint. Determinate progress is shown only when advertised.
Cancellation appears only when the server marks processing cancellable and uses
the established cancellation endpoint. Review/retry links open existing settings
instead of silently rerunning jobs. No new export/scan cancellation mechanism is
invented. Activity status polling runs only while the panel is open.
