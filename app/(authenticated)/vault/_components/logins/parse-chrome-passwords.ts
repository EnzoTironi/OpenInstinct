import {
  loginIdentifierSchema,
  serializeLoginVaultPayload,
  type VaultImportItems,
} from "@shared/vault/schema";

import { parseCsv } from "./parse-csv";

interface ChromeColumnIndexes {
  name: number;
  password: number;
  url: number;
  username: number;
}

function normalizeHeaders(row: string[] | undefined) {
  return row?.map((header) =>
    header
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
  );
}

function columnIndexes(headers: string[]): ChromeColumnIndexes {
  return {
    name: headers.indexOf("name"),
    password: headers.indexOf("password"),
    url: headers.indexOf("url"),
    username: headers.indexOf("username"),
  };
}

function assertRequiredColumns(indexes: ChromeColumnIndexes) {
  if (indexes.url < 0 || indexes.username < 0 || indexes.password < 0) {
    throw new Error(
      "This CSV needs url, username, and password columns. Export it from Google Password Manager and try again."
    );
  }
}

function labelFromUrl(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value);

    return url.hostname.replace(/^www\./, "") || value;
  } catch {
    return value.slice(0, 120);
  }
}

function originFromUrl(value: string) {
  try {
    const url = new URL(value);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function identifierTypeForAccount(account: string) {
  const parsed = loginIdentifierSchema.safeParse({
    type: "email",
    value: account,
  });

  if (parsed.success) return "email" as const;

  return "username" as const;
}

function isEmptyRow(row: string[]) {
  return row.every((value) => value.length === 0);
}

function rowLabel(
  indexes: ChromeColumnIndexes,
  row: string[],
  url: string
): string | undefined {
  const name = indexes.name >= 0 ? row[indexes.name]?.trim() : undefined;

  if (name?.length) return name;

  return labelFromUrl(url) || undefined;
}

function isInvalidLoginRow(input: {
  account: string;
  label: string | undefined;
  origin: string | undefined;
  password: string;
}) {
  if (!input.label) return true;

  if (!input.origin) return true;

  if (input.account.length === 0) return true;

  if (input.password.length === 0) return true;

  if (input.account.length > 300) return true;

  if (input.label.length > 120) return true;

  return input.password.length > 20_000;
}

function loginItemFromRow(
  indexes: ChromeColumnIndexes,
  row: string[]
): VaultImportItems[number] | undefined {
  const account = row[indexes.username]?.trim() ?? "";
  const password = row[indexes.password] ?? "";
  const url = row[indexes.url]?.trim() ?? "";
  const origin = originFromUrl(url);
  const label = rowLabel(indexes, row, url);

  if (label === undefined || origin === undefined) {
    return undefined;
  }

  if (isInvalidLoginRow({ account, label, origin, password })) {
    return undefined;
  }

  return {
    account: "",
    kind: "login",
    label,
    secret: serializeLoginVaultPayload({
      authentication: { password, type: "password" },
      identifier: {
        type: identifierTypeForAccount(account),
        value: account,
      },
      kind: "login",
      origin,
      version: 2,
    }),
  };
}

function assertImportLimits(items: VaultImportItems) {
  if (items.length === 0) {
    throw new Error("No valid saved passwords were found in this CSV.");
  }

  if (items.length > 3_000) {
    throw new Error(
      `This file contains ${items.length.toLocaleString()} passwords. Import up to 3,000 at a time.`
    );
  }
}

export function parseChromePasswordsCsv(csv: string) {
  const rows = parseCsv(csv);
  const headers = normalizeHeaders(rows.shift());

  if (!headers) throw new Error("Choose a Chrome passwords CSV file.");

  const indexes = columnIndexes(headers);
  assertRequiredColumns(indexes);

  const items: VaultImportItems = [];
  let skipped = 0;

  for (const row of rows) {
    if (isEmptyRow(row)) continue;

    const item = loginItemFromRow(indexes, row);

    if (!item) {
      skipped += 1;
      continue;
    }

    items.push(item);
  }

  assertImportLimits(items);

  return { items, skipped };
}
