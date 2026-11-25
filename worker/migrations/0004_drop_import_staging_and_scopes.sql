-- All users are equal. Removes two things that implied special handling:
--  * import_staging: the owner-approval import table added in 0003 (never needed; seed data is loaded directly).
--  * sessions.scopes: per-credential read/write scopes that every session had anyway.
DROP TABLE IF EXISTS import_staging;
ALTER TABLE sessions DROP COLUMN scopes;
