# Scarf PostgreSQL Exporter

This script pulls down your raw Scarf data and sends it into a PostgreSQL DB.

## Getting started

Ensure these environment variables are set:

```
SCARF_API_TOKEN=<your api token>
SCARF_ENTITY_NAME=<Scarf username or org name>
PSQL_CONN_STRING=<PSQL connection string>
```

Then run: 

```bash
$ npm i
$ npm buildAndRun
```

# License

Apache 2.0

<img referrerpolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=7dec8cfe-8216-4bfa-bbb9-f23dd7794953" />
