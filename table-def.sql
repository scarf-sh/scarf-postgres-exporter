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

-- id,type,package,pixel,version,time,referer,user_agent,platform,variables,origin_id,origin_latitude,origin_longitude,origin_country,origin_city,origin_postal,origin_connection_type,origin_company,origin_domain,dnt,confidence,endpoint_id,origin_state,mtc_quota_exceeded
