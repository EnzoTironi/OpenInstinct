import type { AutofillClaim } from "./protocol";

export const nativeLoginAutofillTokens = [
  "username",
  "email",
  "tel",
  "current-password",
] as const;

export interface NativeLoginControlDescriptor {
  readonly autocomplete: string;
  readonly focused: boolean;
  readonly formIndex: number | null;
  readonly index: number;
  readonly label: string;
  readonly name: string;
  readonly type: string;
}

export interface ClassifiedNativeLoginControl extends NativeLoginControlDescriptor {
  readonly score: number;
  readonly token: (typeof nativeLoginAutofillTokens)[number];
}

const blockedAutocompleteTokens = new Set(["new-password", "one-time-code"]);

const hasBlockedAutocomplete = (tokens: readonly string[]) =>
  tokens.some((token) => blockedAutocompleteTokens.has(token));

const classifyFromAutocomplete = (
  descriptor: NativeLoginControlDescriptor,
  autocompleteTokens: readonly string[]
): ClassifiedNativeLoginControl | null => {
  for (const token of nativeLoginAutofillTokens) {
    if (autocompleteTokens.includes(token)) {
      return { ...descriptor, score: 100, token };
    }
  }

  return null;
};

const classifyFromType = (
  descriptor: NativeLoginControlDescriptor
): ClassifiedNativeLoginControl | null => {
  if (descriptor.type === "password") {
    return { ...descriptor, score: 90, token: "current-password" };
  }

  if (descriptor.type === "email") {
    return { ...descriptor, score: 85, token: "email" };
  }

  if (descriptor.type === "tel") {
    return { ...descriptor, score: 85, token: "tel" };
  }

  return null;
};

const classifyFromSearchable = (
  descriptor: NativeLoginControlDescriptor,
  searchable: string
): ClassifiedNativeLoginControl | null => {
  if (/\b(?:e-?mail|email address)\b/u.test(searchable)) {
    return { ...descriptor, score: 75, token: "email" };
  }

  if (/\b(?:phone|telephone|mobile)\b/u.test(searchable)) {
    return { ...descriptor, score: 75, token: "tel" };
  }

  if (
    /\b(?:user\s*name|username|login|account|member|membership|mileageplus)\b/u.test(
      searchable
    )
  ) {
    return { ...descriptor, score: 70, token: "username" };
  }

  return null;
};

export function classifyNativeLoginControl(
  descriptor: NativeLoginControlDescriptor
): ClassifiedNativeLoginControl | null {
  const autocompleteTokens = descriptor.autocomplete
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);

  if (hasBlockedAutocomplete(autocompleteTokens)) return null;

  const fromAutocomplete = classifyFromAutocomplete(
    descriptor,
    autocompleteTokens
  );

  if (fromAutocomplete) return fromAutocomplete;

  const searchable = normalizeText(
    [descriptor.name, descriptor.label].filter(Boolean).join(" ")
  );

  if (/\b(?:new|confirm|create|repeat)\s*password\b/u.test(searchable)) {
    return null;
  }

  return (
    classifyFromType(descriptor) ??
    classifyFromSearchable(descriptor, searchable)
  );
}

const claimValues = (
  claims: readonly Pick<AutofillClaim, "token" | "value">[]
) => new Map(claims.map(({ token, value }) => [token, value]));

const controlIsFocused = (control: { readonly focused: boolean }) =>
  control.focused;

const sameFormAsFocused = (focused: { readonly formIndex: number | null }) => {
  return (control: { readonly formIndex: number | null }) =>
    control.formIndex === focused.formIndex;
};

const isIdentifierControl = (
  control: ClassifiedNativeLoginControl,
  values: ReadonlyMap<string, string>
) => {
  if (control.token === "current-password") return false;

  if (values.has(control.token)) return true;

  return values.has("username");
};

const isPasswordControl = (
  control: ClassifiedNativeLoginControl,
  values: ReadonlyMap<string, string>
) => {
  if (control.token !== "current-password") return false;

  return values.has(control.token);
};

const identifierValue = (
  values: ReadonlyMap<string, string>,
  token: ClassifiedNativeLoginControl["token"]
) => {
  const exact = values.get(token);

  if (exact !== undefined) return exact;

  return values.get("username");
};

const pushFillIfPresent = <T extends ClassifiedNativeLoginControl>(
  selected: { readonly control: T; readonly value: string }[],
  control: T | undefined,
  value: string | undefined
) => {
  if (!control) return;

  if (value === undefined) return;
  selected.push({ control, value });
};

export function selectNativeLoginFills<T extends ClassifiedNativeLoginControl>(
  controls: readonly T[],
  claims: readonly Pick<AutofillClaim, "token" | "value">[]
) {
  const focused = controls.find(controlIsFocused);

  if (!focused) return [];

  const sameSurface = controls
    .filter(sameFormAsFocused(focused))
    .toSorted(compareLoginControls);

  const values = claimValues(claims);
  const selected: { readonly control: T; readonly value: string }[] = [];

  const identifier = sameSurface.find((control) =>
    isIdentifierControl(control, values)
  );

  pushFillIfPresent(
    selected,
    identifier,
    identifier ? identifierValue(values, identifier.token) : undefined
  );

  const password = sameSurface.find((control) =>
    isPasswordControl(control, values)
  );

  pushFillIfPresent(
    selected,
    password,
    password ? values.get(password.token) : undefined
  );

  return selected;
}

export const nativeLoginControlInspectionExpression = `(() => {
  const elements = Array.from(document.querySelectorAll("input"));
  const forms = Array.from(document.forms);
  return elements.flatMap((element, index) => {
    if (element.disabled || element.readOnly) return [];
    if (["hidden", "submit", "button", "reset", "file", "image", "checkbox", "radio"].includes(element.type)) return [];
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return [];
    const labels = element.labels ? Array.from(element.labels, (label) => label.textContent || "") : [];
    const ariaText = (element.getAttribute("aria-labelledby") || "")
      .split(/\\s+/u)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
    const resolvedFormIndex = element.form ? forms.indexOf(element.form) : -1;
    return [{
      autocomplete: element.autocomplete || "",
      focused: document.activeElement === element,
      formIndex: resolvedFormIndex >= 0 ? resolvedFormIndex : null,
      index,
      label: [
        ...labels,
        element.getAttribute("aria-label") || "",
        ariaText,
        element.getAttribute("placeholder") || "",
        element.getAttribute("title") || "",
      ].join(" "),
      name: [element.name, element.id].join(" "),
      type: element.type || "",
    }];
  });
})()`;

// Evaluated inside a frame's isolated world. `self.origin` is the origin of the
// document that would receive a value, so it also rejects sandboxed documents.
export const frameOriginExpression = "self.origin";

export const nativeLoginFillFunctionDeclaration = `function(value, expectedOrigin) {
  if (self.origin !== expectedOrigin) return false;
  if (!(this instanceof HTMLInputElement)) return false;
  this.dataset.vaultSecret = "true";
  this.click();
  this.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) return false;
  setter.call(this, value);
  this.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return this.value.length > 0;
}`;

function compareLoginControls(
  left: ClassifiedNativeLoginControl,
  right: ClassifiedNativeLoginControl
) {
  if (left.focused !== right.focused) return left.focused ? -1 : 1;

  if (left.score !== right.score) return right.score - left.score;

  return left.index - right.index;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}
