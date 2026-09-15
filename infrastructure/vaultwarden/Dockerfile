FROM vaultwarden/server:1.37.3-alpine@sha256:9a905c5cf5df61bb827da3805e160170741c0b53b0c63bb07e1afd3d2e21b1c8
RUN apk add --no-cache bash postgresql17-client restic python3
COPY entrypoint.sh backup.sh restore.sh backup-health.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/backup-health.sh \
    && chmod 600 /etc/crontabs/root
ENV ROCKET_PORT=8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
