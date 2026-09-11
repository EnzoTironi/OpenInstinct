"use client";

import { serializeContactVaultPayload } from "@shared/vault/schema";
import { Button } from "@web/components/ui/button";
import { DialogFooter } from "@web/components/ui/dialog";
import { FieldGroup } from "@web/components/ui/field";
import { useCallback, useState } from "react";
import { z } from "zod";

import { FormField } from "../field";
import {
  patchVaultForm,
  useVaultFormSubmit,
  useVaultItemCreate,
  vaultFormErrors,
} from "../use-vault-form";

const contactFormSchema = z
  .object({
    email: z.string().trim(),
    fullName: z.string().trim(),
    nickname: z
      .string()
      .trim()
      .min(1, "Enter a name for this contact.")
      .max(120),
    phone: z.string().trim(),
  })
  .superRefine((form, context) => {
    if (form.email && !z.email().safeParse(form.email).success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid email address.",
        path: ["email"],
      });
    }
  })
  .refine((form) => [form.email, form.fullName, form.phone].some(Boolean), {
    message: "Enter at least one contact value.",
    path: ["fullName"],
  });

interface ContactFormState {
  email: string;
  fullName: string;
  nickname: string;
  phone: string;
}

function optionalText(value: string) {
  if (value.length) return value;

  return undefined;
}

function createContactPayload(data: z.output<typeof contactFormSchema>) {
  return {
    account: "",
    kind: "contact" as const,
    label: data.nickname,
    secret: serializeContactVaultPayload({
      email: optionalText(data.email),
      fullName: optionalText(data.fullName),
      kind: "contact",
      phone: optionalText(data.phone),
      version: 1,
    }),
  };
}

function useContactForm(initialLabel: string, onSaved: () => void) {
  const create = useVaultItemCreate(onSaved);
  const [attempted, setAttempted] = useState(false);

  const [form, setForm] = useState<ContactFormState>({
    email: "",
    fullName: "",
    nickname: initialLabel,
    phone: "",
  });

  const result = contactFormSchema.safeParse(form);
  const errors = vaultFormErrors(attempted, result);

  const onNicknameChange = useCallback((nickname: string) => {
    patchVaultForm(setForm, "nickname", nickname);
  }, []);

  const onFullNameChange = useCallback((fullName: string) => {
    patchVaultForm(setForm, "fullName", fullName);
  }, []);

  const onEmailChange = useCallback((email: string) => {
    patchVaultForm(setForm, "email", email);
  }, []);

  const onPhoneChange = useCallback((phone: string) => {
    patchVaultForm(setForm, "phone", phone);
  }, []);

  const submit = useVaultFormSubmit(
    setAttempted,
    result,
    create.mutate,
    createContactPayload
  );

  return {
    create,
    errors,
    form,
    onEmailChange,
    onFullNameChange,
    onNicknameChange,
    onPhoneChange,
    submit,
  };
}

export function ContactForm({
  initialLabel = "",
  onSaved,
}: {
  readonly initialLabel?: string;
  readonly onSaved: () => void;
}) {
  const {
    create,
    errors,
    form,
    onEmailChange,
    onFullNameChange,
    onNicknameChange,
    onPhoneChange,
    submit,
  } = useContactForm(initialLabel, onSaved);

  return (
    <form noValidate onSubmit={submit}>
      <FieldGroup>
        <FormField
          error={errors.nickname?.[0]}
          id="vault-contact-label"
          label="Name"
          onChange={onNicknameChange}
          placeholder="Checkout"
          value={form.nickname}
        />
        <FormField
          autoComplete="name"
          error={errors.fullName?.[0]}
          id="vault-contact-name"
          label="Full name (optional)"
          onChange={onFullNameChange}
          value={form.fullName}
        />
        <FormField
          autoComplete="email"
          error={errors.email?.[0]}
          id="vault-contact-email"
          label="Email (optional)"
          onChange={onEmailChange}
          type="email"
          value={form.email}
        />
        <FormField
          autoComplete="tel"
          error={errors.phone?.[0]}
          id="vault-contact-phone"
          label="Phone (optional)"
          onChange={onPhoneChange}
          type="tel"
          value={form.phone}
        />
      </FieldGroup>
      <DialogFooter>
        <Button disabled={create.isPending} type="submit">
          Save contact
        </Button>
      </DialogFooter>
    </form>
  );
}
