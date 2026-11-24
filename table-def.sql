create table if not exists
  scarf_events_raw
  (
    id text,
    type text,
    package text,
    pixel text,
    version text,
    time timestamp,
    referer text,
    user_agent text,
    platform text,
    variables text,
    origin_id text,
    origin_latitude numeric,
    origin_longitude numeric,
    origin_country text,
    origin_city text,
    origin_postal text,
    origin_connection_type text,
    origin_company text,
    origin_domain text,
    dnt boolean,
    confidence numeric,
    endpoint_id text,
    origin_state text,
    mtc_quota_exceeded boolean
  );

-- Legacy CSV records have unknown multiplicity until re-imported.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'scarf_events_raw'::regclass
      AND attname = 'num_events'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE scarf_events_raw ADD COLUMN IF NOT EXISTS num_events bigint;
  END IF;
END $$;
