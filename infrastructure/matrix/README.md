# Private Matrix service

Zoen runs unmodified Synapse 1.160.0 in a separate container. `configure.py` writes
the private deployment configuration and application-service registration; it
does not patch Synapse. PostgreSQL stores durable homeserver state. Alchemy retains
the signing seed and service tokens in Fly secrets.

- Source: [element-hq/synapse v1.160.0](https://github.com/element-hq/synapse/tree/v1.160.0).
- License: [GNU AGPL-3.0](https://github.com/element-hq/synapse/blob/v1.160.0/LICENSE-AGPL-3.0).
- Image: `matrixdotorg/synapse:v1.160.0@sha256:78de1d10bef02e375f861d1cc99f8bedd9381d4f9083ea8b2c22a053477b205f`.

Synapse retains its upstream license. The Zoen application and deployment files
retain the repository's MIT license. Keep the upstream source and license links
with redistributed service images.

The application-service adapter uses durable Synapse transaction IDs, native Eve
input receipts, explicit room bindings and membership epochs. The generic Chat
SDK adapter does not expose that complete application-service receipt/recovery
boundary; this transport delegates execution to Eve instead of adding an agent
loop or separate scheduler.

Runtime and browser proofs cover joined history, membership removal, duplicate
transaction delivery, mentions, scoped tools, answer publication and room closure.
The service is private: registration, federation, media and guest access are off.
