from alpine:3.17

RUN apk --no-cache add --update bash postgresql-client git npm busybox-extras

CMD git clone https://github.com/scarf-sh/scarf-postgres-exporter && cd scarf-postgres-exporter && npm i && npm run buildAndRun




