# Codex subscription launch profile

The launch profile uses `gpt-5.3-codex-spark` for the coordinator and `gpt-5.6-luna` with `reasoning: low` for the browser worker. Both use Eve's existing ChatGPT authentication adapter. This configuration is identical in Alchemy and the native evaluation workflow.

A live probe on 2026-09-14 used synthetic arithmetic and the existing Zoen avatar. Spark answered the text request in 2.04 s but rejected the image request. Luna answered the text request in 1.63 s and identified the green character in 2.25 s. These are individual capability probes, not comparative quality benchmarks. The account's model catalog reports 128,000 tokens for Spark and 272,000 for Luna. The full native launch suite remains the publication gate.

The installation setting `COMPANION_CODEX_MODEL` is independent of `COMPANION_BROWSER_MODEL`. Invalid provider/model pairs fail closed. No automatic fallback changes the selected provider or charges another account. The existing OpenRouter profile still enforces its own 4,096-token request cap.

Sources: [OpenAI authentication](https://learn.chatgpt.com/docs/auth), [Codex models](https://learn.chatgpt.com/docs/models). Credentials are never committed to this repository or included in benchmark receipts.

## Subsequent product work

Connecting a user's model provider is separate from authenticating that user to Zoen. Provider grants need per-workspace encrypted custody, explicit team ownership, serialized refresh, revocation checks at each call, and no fallback to another user's credentials. PI's and Hermes's device-code implementations are useful protocol references; their local credential files are not a multi-tenant authorization model.

Application observability needs tenant-scoped usage and latency, provider and tool failures, client errors, operational health, explicit feedback, and a consented review queue. Conversation contents and credentials must not be copied into general-purpose logs. Those additions are a separate, tested release from the model change that unblocks the existing launch work.
