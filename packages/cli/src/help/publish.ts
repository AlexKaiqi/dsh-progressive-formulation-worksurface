export const PUBLISH_HELP = `WORKSURFACE FILE PUBLICATION

PURPOSE
Confirm the current Surface's files for downstream readers and later continuation.

USE WHEN
An active Surface Turn has new or updated files worth retaining as a confirmed result, including final deliverables. Unpublished files remain drafts. This operation is available even when the Turn's business outputs list is empty.

DO
1. Read the current WORKSURFACE_VIEW_DIR/turn-brief.json and its filePublication entry.
2. Review the current WORKSURFACE_SURFACE_DIR files. Preserve useful drafts, evidence, and calculation records alongside final deliverables.
3. Choose a stable key for this publication, then run:
   ws publish --key findings-v1 --summary "Reviewed findings and supporting evidence"
4. Confirm success before emitting a business Event that needs readers to see these files. See ws help emit.

RETRY AND SCOPE
- Reuse the same key only to retry that same publication after an uncertain response. A successful retry does not publish files edited afterward; a new file snapshot needs a new key.
- The command targets only the Surface bound to the active Turn. It does not accept a Surface id and cannot publish from an ordinary Session.
- The key is scoped to the current Session and Turn. After a restart or new Turn, first reconcile existing files and confirmed results as described in ws help recover.
- Publication confirms files; it does not emit a business fact or prove acceptance. A successful business emit does not publish files. Do not emit runtime revision Events yourself.
`
