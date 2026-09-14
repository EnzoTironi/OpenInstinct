# Third-party notices

The browser tool names and input contracts follow
[`kernel/kernel-mcp-server`](https://github.com/kernel/kernel-mcp-server),
licensed under the MIT License.

The repository-owned Oxlint anti-slop plugin vendors generic rules and shared
helpers from [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop),
copyright (c) 2026 Dillon Mulroy, licensed under the MIT License. The full
license text ships in `tools/oxlint/anti-slop/LICENSE`.

The fonts in `public/fonts/` are derived from
[Mona Sans](https://github.com/github/mona-sans), copyright (c) 2023 GitHub,
licensed under the SIL Open Font License 1.1. The full license text ships
alongside the font files in `public/fonts/OFL.txt`. The fonts are distributed
here under a different family name, as the license requires.

## Landing page reference assets

The reference illustrations and channel icons under `public/marketing/`
(`scattered-notes.avif`, `calendar.avif`, `companion-face.webp`, `office.webp`,
`park.webp`, `whatsapp.avif` and `telegram.avif`) reproduce assets from the
[Portuguese Memorae landing](https://memorae.ai/pt/) at the project owner's
request on 2026-09-12. They originate from `cdn.memorae.ai/l3/` and the public
Memorae image endpoint. They retain their original third-party ownership and
are not covered by this repository's original-code license. The landing's
Zoen copy and interactive examples are authored for this project.

The `sky-*.webp` images and the base phone mockups are AI-generated marketing
artwork created for this project. The `zoen-whatsapp.webp`,
`zoen-imessage.webp`, `zoen-telegram.webp`, `zoen-avatar.webp` and
`zoen-favicon.png` assets incorporate the mascot reference supplied by the
project owner on 2026-09-12. The phone screens illustrate the intended Zoen
experience; the messaging product names belong to their respective owners.

## PI OAuth protocol references

The device-code adapters in `server/models/oauth.ts` use protocol details from [PI](https://github.com/earendil-works/pi/tree/main/packages/ai/src/auth/oauth) (OpenAI Codex and xAI adapters). Zoen implements credential custody, workspace authorization and refresh serialization independently. Public OAuth client identifiers do not grant provider entitlement.

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
