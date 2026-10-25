# PHIF Orders Local Snapshot

- Location: IndexedDB `phif-orders-local-v1`, object store `snapshots`, in the current browser profile and application origin.
- Scope: pharmacy plus Tracker user. Another device, browser profile, user, preview domain or pharmacy has a separate snapshot.
- Data: a complete, server-signed order report only; no PHIF credentials, Bridge session identifiers, patient data, financial costs or cookies.
- At rest: AES-256-GCM ciphertext, random IV, optimistic revision and scoped identifier. The encryption key is NOT saved in IndexedDB or localStorage.
- Key delivery: a POST/no-store Tracker endpoint checks the existing `inventory_read` permission and derives a pharmacy/user-specific key from the stable server `SESSION_SECRET`. The key lives only in application memory and its cache is purged on logout or session/permission changes.
- Access: a valid Tracker session and access to its server remain required. A PHIF session is NOT required to open or export the saved report. This is not unauthenticated offline access.
- Refresh: only the explicit Update button contacts PHIF. A complete validated response is signed, encrypted, and committed with one IndexedDB transaction before replacing the displayed snapshot.
- Protection: failed/partial reads, duplicate identities, missing previous order IDs, empty replacements, older responses, storage/quota errors and competing tab revisions cannot overwrite a correct saved snapshot.
- Exports: current server-side permissions and the snapshot's HMAC are verified again, without contacting PHIF. Files state the last successful synchronization timestamp and that their data is a saved snapshot.
- Expiry: the last snapshot remains intact after PHIF expiry. A lightweight Tracker read checks the saved Bridge-session expiry; actual upstream failures are not falsely reported as expiry without evidence.
- Retention: no automatic expiry or deletion on PHIF logout. A best-effort persistent-storage request reduces browser eviction risk. Clearing site data, private browsing and browser/OS eviction can still remove it; it is not a cross-device backup.
- Operations: use HTTPS and a secure, stable `SESSION_SECRET` of at least 32 characters. Changing that secret invalidates old signatures and decryption keys; do not rotate it without a recovery plan. After a reset, a fresh PHIF read is needed to initialize this browser's snapshot.
- No Cloud schema, Cloud writes, PHIF receipt/write actions or automatic PHIF synchronization are introduced.
