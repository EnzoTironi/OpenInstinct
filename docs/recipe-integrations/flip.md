# Flip: messages, actionable recaps and login handoff

Added 2026-09-08 from the user's reference. Sources are public product claims and examples, not a live product evaluation. This extends the research package; it does not approve financial providers or expand Companion's implementation scope.

## Useful product patterns

The [homepage](https://fliptexts.com/) positions Flip as a money assistant inside iMessage, with examples spanning recurring charges, budgeting, shared expenses and investing. It names Plaid and SnapTrade for connected financial accounts. The competing apps in its comparison carousel are positioning targets, not evidence that Flip integrates with those apps. Its illustrated conversations and adoption figures are not execution or reliability evidence.

The [money-by-text article](https://fliptexts.com/articles/manage-money-by-text) describes starting with a real question, connecting a small number of accounts, then surfacing findings in the same conversation. It also reserves detailed annual reviews and comparisons for a larger view. For Companion, the useful inference is a short path from question to evidence-backed answer, with richer artifacts available when the question needs them. A hidden workflow builder does not mean every result must fit in a chat bubble.

[Budget automation](https://fliptexts.com/articles/automate-your-budget) separates background collection/categorization from the short recurring check-in delivered to the user. Adapt the pattern to other domains: collect and reconcile quietly, report what changed, explain what matters, and offer a concrete next action. Corrections should update the owning rule or preference rather than merely producing a reassuring conversational response.

The [reminder article](https://fliptexts.com/articles/bill-and-money-reminders) distinguishes dated obligations from periodic reviews and renewal alerts. For Companion, use explicit event dates and lead times, source context and an actionable reply. An alert should identify the obligation, why it needs attention, and the permitted next step. Do not infer that a bill was paid from an alert being delivered or dismissed.

The public [Morning Paper](https://fliptexts.com/paper) groups pending decisions, upcoming charges and supporting inbox evidence, with actions returning to chat. Treat its figures as example content. This is a useful companion to our animated preview: a compact report showing completed work, pending decisions and monitored items, with links to evidence and conversational continuation. Those states must come from persisted results, not a generated narrative that asserts completion.

## Integration and login evidence

The [privacy policy](https://fliptexts.com/privacy), dated September 8, names Dwolla for transfers/ACH and Spinwheel for credit/liability data. These are declared service relationships; no endpoint catalog or operational test was obtained.

It also describes a cloud-browser login handoff: a text link opens the website's own sign-in in an iOS app or App Clip; after confirmation, that site's session cookies return to the cloud browser. The policy says passwords, passkeys and one-time codes stay with the website, and sessions can persist as saved logins. This is architectural evidence from a policy, not inspected implementation.

For a future Companion investigation, prove support in the actual browser and mobile environment first. Bind any handoff to the authenticated user, intended origin and pending run; prevent replay or substitution; protect and revoke saved sessions. Session cookies are credentials even when passwords are not copied. Do not assume an App Clip flow or arbitrary cookie transfer is available in the current stack. The declared browser worker remains the execution owner.

## Unresolved claims

The homepage describes paying friends and settling group tabs, while the July [money-by-text article](https://fliptexts.com/articles/manage-money-by-text) explicitly excludes sending Venmo, Zelle or Cash App payments for users. The newer privacy policy identifies ACH infrastructure, but that does not establish a particular peer-to-peer app integration. Pricing and onboarding claims also differ between the homepage and that article. Possible product evolution is an inference; the discrepancies remain unresolved here.

Do not import those payment capabilities as verified recipes. The catalog marks financial effects as unqualified claims. Read-only summaries and reminders can be evaluated independently of transfers and trades; financial execution needs its own explicit scope, provider contracts and evidence before implementation.

## Coverage

Reviewed the homepage, [article index](https://fliptexts.com/articles), three articles linked above, privacy policy and Morning Paper. The linked [CLI page](https://fliptexts.com/cli) exposed only an introductory screen to the text reader, so no CLI/API contract is inferred. The wider article collection contains educational/comparison content; it is not a recipe or integration registry and was not exhaustively read. Recipe titles added to our inventory are our descriptive labels for observed patterns, not names of installable templates.
