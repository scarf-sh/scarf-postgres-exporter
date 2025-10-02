# Scarf -> PostgreSQL Exporter

This script pulls down your raw Scarf data and sends it into a PostgreSQL DB.

This script is intended to be run as a daily batch job. 

On an empty DB, the last 31 days of data will be backfilled, not including today. Subsequent runs of the script will import the most recent day of missing data through the end of yesterday. 

## Getting started

Ensure these environment variables are set:

```bash
SCARF_API_TOKEN=<your api token>
SCARF_ENTITY_NAME=<Scarf username or org name>
PSQL_CONN_STRING=<PSQL connection string>
```

You can optionally set:

```bash
BACKFILL_DAYS=31 #defaults to 31 if not set
```

Note, the `psql` command must be available in your environment separately.

Then run: 

```bash
$ npm i
$ npm run buildAndRun
```


### Docker

```bash
$ docker run \
    -e SCARF_API_TOKEN=<> \
    -e SCARF_ENTITY_NAME=<>\
    -e PSQL_CONN_STRING=<> \
    -e BACKFILL_DAYS=<> \
   scarf.docker.scarf.sh/scarf-sh/scarf-postgres-exporter
```

## Configuring on GitHub Actions

You can use GitHub Actions `cron` functionality to run this exporter periodically in your GitHub repo with an action like this:

```yaml
name: Export Scarf data
on:
  schedule:
    - cron: '0 12 * * *'

jobs:
  export-scarf-data:
    runs-on: ubuntu-latest
    steps:
      - uses: docker://scarf.docker.scarf.sh/scarf-sh/scarf-postgres-exporter:latest
        env:
          SCARF_API_TOKEN: ${{ secrets.SCARF_API_TOKEN }}
          SCARF_ENTITY_NAME: {Your Scarf user or org name}
          PSQL_CONN_STRING: ${{ secrets.PSQL_CONN_STRING }}
```

## Contributing

Code contributions are more than welcome! Please open an issue first to discuss your change before getting started. Feel free to jump into [Scarf's community Slack](https://tinyurl.com/scarf-community-slack) if you'd like to chat with us directly. 

### Publishing the Docker container

The container is published to GHCR and distriburted via the `scarf.docker.scarf.sh` endpoint. 

Ensure you are building the container for architechures besides your own like so:

```bash
$ docker buildx build --platform linux/amd64,linux/arm64 --push -t ghcr.io/scarf-sh/scarf-postgres-exporter .
```

## License

Apache 2.0

<img referrerpolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=7dec8cfe-8216-4bfa-bbb9-f23dd7794953" />
