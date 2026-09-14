ALTER TABLE world_slots ADD COLUMN publication_scope TEXT NOT NULL DEFAULT 'latest' CONSTRAINT world_publication_scope CHECK(publication_scope IN ('latest','all_archives'));
