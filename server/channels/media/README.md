# Native incoming media

`loadChannelContent(identity, payload)` replaces the blanket attachment rejection
at `agent/lib/channel-session.ts`. It uses the existing Telegram/Kapso services
and channel authority. Downloads and transcription happen outside authority
transactions. Current identity/membership is checked before each download,
before transcription and again before the Eve handoff; the inbox lease is also
rechecked before acceptance. The media budget is 90 seconds inside a 150-second
inbox lease, leaving room for the existing 25-second Eve handoff.

Supported input:

| Input                                   | Limit                            | Agent receives                                                       |
| --------------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| PNG/JPEG                                | 3 MiB each                       | Explicit model-unavailable response                                  |
| PDF                                     | Within the 10 MiB message budget | Explicit model-unavailable response                                  |
| UTF-8 plain text, CSV, JSON             | 64 KiB each                      | Decoded text with the attachment name                                |
| Ogg/Opus or WAV PCM 16-bit, mono/stereo | 3 MiB and 120 seconds each       | Actual transcription text, also sent back to the user for correction |

There are at most three attachments and 10 MiB total. File content is untrusted
user input. MIME declarations must agree with recognized byte signatures; unknown
types and invalid UTF-8 are rejected. Other audio formats, video, archives and
office documents remain unsupported, with a text alternative. Images/PDFs are currently rejected before Eve handoff: Spark and the configured
free model are text-only, and the gateway model resolver exposes no verified
input-capability contract. Unknown models fail closed as well. Enabling binary
input requires that contract and live model verification; no captions are fabricated.

Provider downloads use only references from the verified durable inbox:

- Telegram uses the existing bot configuration and the official `getFile` /
  `file/bot…` flow. File paths are validated before constructing the fixed-origin
  URL. See [Telegram File API](https://core.telegram.org/bots/api#file).
- Kapso resolves the media with the current installation's `phone_number_id`,
  then accepts only its signed `https://api.kapso.ai/meta/whatsapp/media_download`
  URL. The API key is not forwarded to that URL. See
  [Kapso media URL](https://docs.kapso.ai/api/meta/whatsapp/media/get-media-url).

HTTP follows no redirects, bounds declared and streamed lengths, closes responses
on failure/cancellation and suppresses URL/header tracing. Raw URLs, credentials
and provider exceptions are not included in domain errors or agent input.

## Optional voice profile

No model or paid provider is selected implicitly. Root configuration must supply:

- `COMPANION_TRANSCRIPTION_MODEL`: an explicitly authorized transcription model
  on the already-installed AI Gateway provider.
- `AI_GATEWAY_API_KEY`: the existing Gateway credential.
- `ffprobe` on PATH, or `COMPANION_FFPROBE_PATH` pointing to the installed binary.

Missing prerequisites produce an explicit unavailable response. There is no
fallback provider or fabricated transcript. `ffprobe` checks actual codec,
channels and duration in a private temporary file, which is removed on scope
exit. Probing is limited to five seconds, with forced process termination after
one additional second. Gateway receives bounded bytes, an abort signal and zero
automatic retries. No new credential, dependency, runtime service or migration
is installed by this slice.

The generated transcript is limited to 3,000 characters and returned to the chat
with a correction prompt. Original provider references remain in the inbox;
transcripts/text follow Eve's existing history/sandbox lifetime.
This slice does not add account deletion or a separate retention store.

## Focused evidence

```sh
pnpm exec vitest run server/channels/media server/channels/telegram.test.ts server/channels/kapso.test.ts
pnpm exec vitest run --config vitest.runtime.config.ts tests/runtime/native-media.integration.ts
```

The first command covers pure validation and real loopback HTTP file transfer,
including oversized bodies, redirects and cancellation. It does not emulate a
messaging or transcription provider. The second uses the installed `ffprobe`
against real generated WAV bytes; it does not access PostgreSQL. Live verified
provider downloads, model image/PDF consumption and actual voice transcription
remain separate installation checks; these local tests do not establish them.
