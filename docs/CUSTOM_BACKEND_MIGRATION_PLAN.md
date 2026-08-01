# Canact custom-backend migration

## Target architecture

- API: versioned HTTPS endpoints plus WebSocket/SSE subscriptions; Firebase ID tokens remain the temporary identity boundary during migration.
- Data: PostgreSQL for users, relationships, content, votes, cards, chat metadata, and audit records; PostGIS for radius queries.
- Realtime: Redis-backed presence and fan-out; durable chat/content events remain in PostgreSQL.
- Media: retain object storage, with signed upload intents issued by the API.
- Jobs: queue workers for notifications, expiry, score recalculation, moderation, and migration reconciliation.
- Clients: replace direct database imports inside `src/lib/services/*` with a single typed transport layer. UI components must not depend on the storage provider.

## Required contracts

1. Identity/profile: `GET/PATCH /v1/me`, `GET /v1/users/:id`, KYC initiation and provider callback endpoints.
2. Connections: request, accept, decline, block, favourite, and contact-match endpoints with bilateral authorization.
3. Content: posts, stories, reels, polls, Rate Me, comments, reactions, expiry, and cursor-based feeds.
4. Messaging: accepted-connection thread creation, message pagination, receipts, attachments, and realtime events.
5. Location/help: PostGIS radius queries with accuracy/freshness validation and audience enforcement.
6. Trust: idempotent vote/card commands, append-only audit events, and deterministic score projections.
7. Notifications/widgets: a compact authenticated activity summary endpoint suitable for Android/iOS widgets without exposing the full profile record.

## Delivery phases

1. Freeze schemas and add contract tests around existing Firebase services.
2. Introduce the typed transport interface; keep Firebase as its first adapter so UI behavior is unchanged.
3. Build identity, profile, connection, and messaging services first because they define authorization boundaries.
4. Backfill PostgreSQL from an export, verify counts/checksums, then enable idempotent dual writes through server routes.
5. Shadow-read the custom backend and compare results for feeds, scores, relationships, and proximity queries.
6. Move reads feature-by-feature behind remote flags; retain Firebase rollback until error and divergence budgets remain clean for two release cycles.
7. Stop Firebase writes, archive the final export, remove client database permissions/imports, and rotate obsolete credentials.

## Release gates

- No client can write another user's identity, thread, vote, card, or notification data.
- Migration reconciliation reports zero unexplained record divergence.
- P95 feed/profile reads and message-send latency meet the current production baseline.
- Backups, point-in-time recovery, rate limits, audit logs, privacy deletion, and incident rollback are tested before cutover.

Native widgets should begin only after the summary contract and final widget design are approved; they must render cached data and never embed long-lived credentials.
