# Hosted user WhatsApp bridge

This image extends unmodified, digest-pinned
[mautrix-whatsapp v0.2608.0](https://github.com/mautrix/whatsapp/tree/v0.2608.0)
(AGPL-3.0). The original branding, licenses and source links stay intact. Zoen's
wrapper writes the private Synapse appservice registration, PostgreSQL connection
and provisioning secret. It does not vendor the bridge and does not pair a live
phone from CI.

## Boundaries

Pairing a person's WhatsApp is not Kapso login and is not talking to the Zoen
bot. The hosted candidate is this mautrix-whatsapp appservice on Zoen's Synapse.
`beeper/bridge-manager` targets Beeper's homeserver and is not used.
`channel/chat-sdk-beeper` is not installed.

`zoen_whatsapp` is a separate PostgreSQL login and database; the app runtime
cannot read it. The bridge listens on private HTTP port 29318. Encryption is
off in the hosted config: WhatsApp plaintext still crosses the bridge process
(BR08). Do not treat Matrix E2EE as covering that hop.

Alchemy retains appservice tokens and the provisioning secret. Confirm and send
fail closed when the URL, secret, ready check or a live WhatsApp login is
missing. GitHub Checks do not start this image; there is no paired phone in CI.

## Rotation

Rotate `ZOEN_WHATSAPP_AS_TOKEN` / `ZOEN_WHATSAPP_HS_TOKEN` together on the
bridge, Synapse registration and the web sender. Rotate the provisioning secret
on the bridge and web. Rotate the database password through the postgres
bootstrap before restarting the bridge. No production publish is claimed here.
