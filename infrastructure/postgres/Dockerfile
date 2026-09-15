FROM postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 AS build
RUN apk add --no-cache build-base curl
WORKDIR /build
RUN curl -fsSL https://codeload.github.com/pgvector/pgvector/tar.gz/8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c -o pgvector.tar.gz \
    && echo 'd076a3098010905fd60256649327809651f6288327db6413f0938305f62ea299  pgvector.tar.gz' | sha256sum -c - \
    && tar xzf pgvector.tar.gz --strip-components=1 \
    && make -j2 OPTFLAGS="" with_llvm=no \
    && make install with_llvm=no

FROM postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 AS backup-tools
# Copy only pgBackRest: Alpine's package also installs its default PG major.
RUN apk add --no-cache pgbackrest=2.58.0-r0

FROM postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
RUN apk add --no-cache libbz2 libssh2 jq
COPY --from=build /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/
COPY --from=build /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
COPY --from=backup-tools /usr/bin/pgbackrest /usr/local/bin/pgbackrest
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY entrypoint.sh verify-restore.sh backup.sh backup-health.sh bootstrap-memory.sh bootstrap-application.sh bootstrap-matrix.sh bootstrap-vaultwarden.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod 755 /usr/local/bin/*.sh \
    && chmod 600 /etc/crontabs/root \
    && mkdir -p /data \
    && chown postgres:postgres /data \
    && chmod 700 /data \
    && pgbackrest version \
    && postgres --version | grep 'PostgreSQL) 17\.'
ENV PGDATA=/data/pgdata
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD pg_isready -U postgres
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["postgres"]
