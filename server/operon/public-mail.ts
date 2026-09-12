import { Option, Schema } from "effect";

const EMAIL_PATTERN = /^[^\s@]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;

export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "aol.com",
  "bol.com.br",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "icloud.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "outlook.com.br",
  "proton.me",
  "protonmail.com",
  "terra.com.br",
  "uol.com.br",
  "yahoo.com",
  "yahoo.com.br",
  "ymail.com",
]);

export const EmailAddress = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isLowercased(),
    Schema.isPattern(EMAIL_PATTERN)
  ),
  Schema.brand("EmailAddress")
);

export type EmailAddress = typeof EmailAddress.Type;

const decodeEmailAddress = Schema.decodeUnknownOption(EmailAddress);

export function normalizeEmailAddress(
  raw: string
): Option.Option<EmailAddress> {
  return decodeEmailAddress(raw.trim().toLowerCase());
}

export function isPublicMailDomain(domain: string) {
  return PUBLIC_MAIL_DOMAINS.has(domain);
}

export function domainOf(email: EmailAddress) {
  return email.slice(email.lastIndexOf("@") + 1);
}

export const OrganizationDerivation = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("derived"),
    key: Schema.Struct({
      kind: Schema.Literal("domain"),
      value: Schema.String,
    }),
    confidence: Schema.Number,
  }),
  Schema.Struct({
    status: Schema.Literal("suppressed"),
    domain: Schema.String,
  }),
]);

export type OrganizationDerivation = typeof OrganizationDerivation.Type;

export const EmailIdentityKeys = Schema.Struct({
  person: Schema.Struct({
    key: Schema.Struct({
      kind: Schema.Literal("email"),
      value: EmailAddress,
    }),
    confidence: Schema.Number,
  }),
  organization: OrganizationDerivation,
});

export type EmailIdentityKeys = typeof EmailIdentityKeys.Type;

export function deriveEmailIdentityKeys(
  raw: string
): Option.Option<EmailIdentityKeys> {
  return Option.map(normalizeEmailAddress(raw), keysForEmail);
}

function keysForEmail(email: EmailAddress): EmailIdentityKeys {
  const domain = domainOf(email);
  return {
    person: {
      confidence: 1,
      key: { kind: "email", value: email },
    },
    organization: organizationOf(domain),
  };
}

function organizationOf(domain: string): OrganizationDerivation {
  if (isPublicMailDomain(domain)) {
    return { domain, status: "suppressed" };
  }
  return {
    confidence: 0.95,
    key: { kind: "domain", value: domain },
    status: "derived",
  };
}
