"use client";

import {
  loginIdentifierSchema,
  loginIdentifierTypeSchema,
  loginOriginSchema,
  serializeLoginVaultPayload,
} from "@shared/vault/schema";
import { Button } from "@web/components/ui/button";
import { DialogFooter } from "@web/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@web/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import { z } from "zod";

import { FormField } from "../field";
import {
  patchVaultForm,
  useVaultFormSubmit,
  useVaultItemCreate,
  vaultFormErrors,
} from "../use-vault-form";

const loginFormSchema = z
  .object({
    identifier: z.string().trim(),
    identifierType: loginIdentifierTypeSchema,
    nickname: z.string().trim().min(1, "Enter a name for this login.").max(120),
    origin: z
      .string()
      .trim()
      .transform(normalizeLoginOrigin)
      .pipe(loginOriginSchema),
    password: z.string().max(20_000),
  })
  .superRefine((form, context) => {
    const identifier = loginIdentifierSchema.safeParse({
      type: form.identifierType,
      value: form.identifier,
    });

    if (!identifier.success) {
      for (const issue of identifier.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: ["identifier"],
        });
      }
    }

    if (form.identifierType === "username" && !form.password) {
      context.addIssue({
        code: "custom",
        message: "Username logins require a password.",
        path: ["password"],
      });
    }
  });

type LoginFormState = z.input<typeof loginFormSchema>;

type IdentifierType = z.infer<typeof loginIdentifierTypeSchema>;

function createLoginPayload(data: z.output<typeof loginFormSchema>) {
  return {
    account: "",
    kind: "login" as const,
    label: data.nickname,
    secret: serializeLoginVaultPayload({
      authentication: loginAuthentication(data),
      identifier: {
        type: data.identifierType,
        value: data.identifier,
      },
      kind: "login",
      origin: data.origin,
      version: 2,
    }),
  };
}

function useLoginIdentityHandlers(
  setForm: Dispatch<SetStateAction<LoginFormState>>
) {
  const onNicknameChange = useCallback(
    (nickname: string) => {
      patchVaultForm(setForm, "nickname", nickname);
    },
    [setForm]
  );

  const onOriginChange = useCallback(
    (origin: string) => {
      patchVaultForm(setForm, "origin", origin);
    },
    [setForm]
  );

  const onIdentifierChange = useCallback(
    (identifier: string) => {
      patchVaultForm(setForm, "identifier", identifier);
    },
    [setForm]
  );

  const onPasswordChange = useCallback(
    (password: string) => {
      patchVaultForm(setForm, "password", password);
    },
    [setForm]
  );

  return {
    onIdentifierChange,
    onNicknameChange,
    onOriginChange,
    onPasswordChange,
  };
}

function useLoginIdentifierTypeHandler(
  setForm: Dispatch<SetStateAction<LoginFormState>>
) {
  return useCallback(
    (value: string | null) => {
      if (value === null) return;
      const identifierType = loginIdentifierTypeSchema.parse(value);
      patchVaultForm(setForm, "identifierType", identifierType);
    },
    [setForm]
  );
}

function useLoginForm(
  initialIdentifierType: IdentifierType | undefined,
  initialLabel: string,
  initialOrigin: string,
  onSaved: () => void
) {
  const create = useVaultItemCreate(onSaved);
  const [attempted, setAttempted] = useState(false);

  const [form, setForm] = useState<LoginFormState>({
    identifier: "",
    identifierType: initialIdentifierType ?? "email",
    nickname: initialLabel,
    origin: initialOrigin,
    password: "",
  });

  const result = loginFormSchema.safeParse(form);
  const errors = vaultFormErrors(attempted, result);
  const handlers = useLoginIdentityHandlers(setForm);
  const onIdentifierTypeChange = useLoginIdentifierTypeHandler(setForm);

  const submit = useVaultFormSubmit(
    setAttempted,
    result,
    create.mutate,
    createLoginPayload
  );

  return {
    create,
    errors,
    form,
    onIdentifierTypeChange,
    passwordOptional: form.identifierType !== "username",
    submit,
    ...handlers,
  };
}

export function LoginForm({
  initialIdentifierType,
  initialLabel = "",
  initialOrigin = "",
  onSaved,
}: {
  readonly initialIdentifierType?: IdentifierType;
  readonly initialLabel?: string;
  readonly initialOrigin?: string;
  readonly onSaved: () => void;
}) {
  const form = useLoginForm(
    initialIdentifierType,
    initialLabel,
    initialOrigin,
    onSaved
  );

  return (
    <form noValidate onSubmit={form.submit}>
      <FieldGroup>
        <LoginNicknameField
          error={form.errors.nickname?.[0]}
          hidden={Boolean(initialLabel)}
          onChange={form.onNicknameChange}
          value={form.form.nickname}
        />
        <FormField
          autoComplete="url"
          error={form.errors.origin?.[0]}
          id="vault-login-origin"
          inputMode="url"
          label="Website"
          onChange={form.onOriginChange}
          placeholder="https://www.ubereats.com"
          type="url"
          value={form.form.origin}
        />
        <LoginIdentifierSection
          error={form.errors.identifier?.[0]}
          identifierType={form.form.identifierType}
          lockType={Boolean(initialIdentifierType)}
          onIdentifierChange={form.onIdentifierChange}
          onIdentifierTypeChange={form.onIdentifierTypeChange}
          value={form.form.identifier}
        />
        <FormField
          autoComplete="new-password"
          description={passwordDescription(form.passwordOptional)}
          error={form.errors.password?.[0]}
          id="vault-login-password"
          label={passwordLabel(form.passwordOptional)}
          onChange={form.onPasswordChange}
          type="password"
          value={form.form.password}
        />
      </FieldGroup>
      <DialogFooter>
        <Button disabled={form.create.isPending} type="submit">
          Save login
        </Button>
      </DialogFooter>
    </form>
  );
}

function LoginNicknameField({
  error,
  hidden,
  onChange,
  value,
}: {
  readonly error?: string;
  readonly hidden: boolean;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  if (hidden) return null;

  return (
    <FormField
      error={error}
      id="vault-login-label"
      label="Name"
      onChange={onChange}
      placeholder="GitHub"
      value={value}
    />
  );
}

function LoginIdentifierSection({
  error,
  identifierType,
  lockType,
  onIdentifierChange,
  onIdentifierTypeChange,
  value,
}: {
  readonly error?: string;
  readonly identifierType: IdentifierType;
  readonly lockType: boolean;
  readonly onIdentifierChange: (value: string) => void;
  readonly onIdentifierTypeChange: (value: string | null) => void;
  readonly value: string;
}) {
  return (
    <div className={identifierSectionClass(lockType)}>
      <LoginIdentifierTypeSelect
        hidden={lockType}
        onValueChange={onIdentifierTypeChange}
        value={identifierType}
      />
      <FormField
        autoComplete="username"
        error={error}
        id="vault-login-identifier"
        label={identifierLabel(identifierType)}
        onChange={onIdentifierChange}
        placeholder={identifierPlaceholder(identifierType)}
        value={value}
      />
    </div>
  );
}

function LoginIdentifierTypeSelect({
  hidden,
  onValueChange,
  value,
}: {
  readonly hidden: boolean;
  readonly onValueChange: (value: string | null) => void;
  readonly value: IdentifierType;
}) {
  if (hidden) return null;

  return (
    <Field>
      <FieldLabel htmlFor="vault-login-identifier-type">
        Sign in with
      </FieldLabel>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger className="w-full" id="vault-login-identifier-type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="email">Email</SelectItem>
          <SelectItem value="phone">Phone</SelectItem>
          <SelectItem value="username">Username</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function identifierSectionClass(lockType: boolean) {
  if (lockType) return undefined;

  return "grid gap-3 sm:grid-cols-[0.8fr_1.4fr]";
}

function passwordDescription(passwordOptional: boolean) {
  if (passwordOptional) {
    return "Leave blank if you sign in with a one-time code.";
  }

  return undefined;
}

function passwordLabel(passwordOptional: boolean) {
  if (passwordOptional) return "Password (optional)";

  return "Password";
}

function identifierPlaceholder(type: IdentifierType) {
  if (type === "email") return "name@example.com";

  if (type === "phone") return "+1 555 555 5555";

  return "username";
}

function identifierLabel(type: IdentifierType) {
  if (type === "email") return "Email";

  if (type === "phone") return "Phone number";

  return "Username";
}

function loginAuthentication(form: z.output<typeof loginFormSchema>) {
  if (form.password) {
    return { password: form.password, type: "password" as const };
  }

  if (form.identifierType === "email") return { type: "email_otp" as const };

  if (form.identifierType === "phone") return { type: "sms_otp" as const };
  throw new Error("Username logins require a password.");
}

function normalizeLoginOrigin(value: string) {
  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return value;
  }
}
