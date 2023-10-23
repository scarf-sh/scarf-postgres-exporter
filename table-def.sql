create table if not exists
  scarf_events_raw
  (
    id text,
    type text,
    package text,
    version text,
    time timestamp,
    referer text,
    user_agent text,
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
    endpoint_id text
  );
