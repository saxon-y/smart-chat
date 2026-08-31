# Existing database upgrade

`prisma/migrations/20260828120000_agent_orchestration` is the baseline for new databases because this repository previously used `prisma db push` and had no migration history.

For an existing database, back it up and apply `20260828_existing_database_agent_orchestration.sql` instead. The script adds orchestration tables and columns, backfills `AiRun.roomId` and historical direct targets from each trigger message, verifies that no room ID remains null, and only then adds the required constraint. After it succeeds, baseline the migration:

```bash
npx prisma db execute --file prisma/manual-upgrades/20260828_existing_database_agent_orchestration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260828120000_agent_orchestration
```
