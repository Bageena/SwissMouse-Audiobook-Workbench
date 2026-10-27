# Alpha 5 interface conventions

Use established containers and semantic `--sm-*` theme tokens. Keep audiobook screens familiar; introduce new patterns only when existing controls cannot express the task.

| State or interaction | Standard |
| --- | --- |
| First load | Name the work in progress, use a status announcement, and avoid fabricated percentages. `AsyncState` provides a shared loading/error/empty presentation. |
| Background work | Keep useful loaded content visible. Mark the affected region busy and disable only conflicting actions. Bound catalog reads; do not fetch entire libraries to show a count. |
| Empty view | Distinguish an empty library, an empty collection and zero search results. Offer the relevant import, selection or filter action. Do not show an empty-state success message after a failed request. |
| Recoverable error | Explain what failed and how to retry. Use `role="alert"`, retain the user's draft, and disclose technical details through logs when needed. Startup errors must replace the spinner with a retry action. |
| Success | Use a concise status message. Do not interrupt routine saves with a modal. |
| Settings | Group by user task, explain effects and scope, show whether changes are immediate or require Save, and surface failed saves. Keep technical details progressively disclosed. |
| Keyboard | Native buttons/inputs first. Tab order follows the reading order; visible focus remains. Enter/Space activate controls. Dialogs need labelled titles, appropriate initial focus, focus containment and return to the trigger. Escape dismisses only when safe. |
| Icons | Give icon-only controls both an accessible name and a tooltip. Labels remain visible until narrow layouts require icons. |
| Cancellation | Say when cancellation waits for a safe boundary. Keep conflicting work locked until the active step actually finishes. Never label ongoing writes as finished. |
| Container editing | Shared sticker headings and toolbar controls; a visible page reset; preserve drafts when moving/resizing. Provide keyboard controls for layout choices and a usable narrow-screen fallback. |
| Destructive actions | Name the affected scope and preserve source media by default. Require confirmation for explicit moves/deletions where the workflow calls for it; do not make ordinary navigation destructive. |

Apply these rules to current main workflows as they are touched. This is not a claim that every legacy dialog or control has completed an accessibility audit. Alpha 5 verification should cover startup, Library, Book Files, the five processing screens, settings/requirements and container reset. Browser-local layout persistence is expected; portable workspace export is deferred.

Settings and System Setup use `useDialogFocus` for initial focus, Tab containment, Escape and focus restoration. Settings keeps failed-save drafts visible and asks before discarding changed settings; it cannot close while saving. Closing System Setup does not cancel its background task.
