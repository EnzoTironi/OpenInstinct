# Unmodified mautrix-whatsapp is a separate AGPL-3.0 service.
# Source: https://github.com/mautrix/whatsapp/tree/v0.2608.0
FROM dock.mau.dev/mautrix/whatsapp:v0.2608.0@sha256:f9d46d55655670518fc5c6843c8344263128b7625ff08a914e9f87453b1cad0f
USER 0
RUN apk add --no-cache python3
COPY entrypoint.sh /zoen-whatsapp-entrypoint.sh
RUN chmod 755 /zoen-whatsapp-entrypoint.sh
ENTRYPOINT ["/zoen-whatsapp-entrypoint.sh"]
