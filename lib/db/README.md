# Database

Database-facing code should live here as the persistence layer grows.

The current dashboard still uses the existing `lib/db.ts` and `lib/snapdb.ts` entry points to avoid a wide import churn. New snapshot/versioning code for GEX states, premium flow, and replay data should be added here first, then the older entry points can be folded in once callers are ready.
