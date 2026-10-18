-- Marker for the baseline schema. The migrator executes database/schema.sql once on an empty
-- database and records 001_init in schema_migrations. This file is never executed.
-- Later files in this folder (002_..., 003_...) are applied once each, in order, on both new and
-- existing databases. See backend/src/db/migrate.js.
SELECT '001_init' AS migration_id;
