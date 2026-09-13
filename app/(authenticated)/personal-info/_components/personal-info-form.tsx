"use client";

import { type SubmitEvent, useState } from "react";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Label } from "@web/components/ui/label";
import {
  userProfileSchema,
  type UserProfile,
} from "@shared/user-profile/schema";
import { api } from "@web/trpc/client";

export function PersonalInfoForm({
  initialProfile,
}: {
  readonly initialProfile: UserProfile;
}) {
  const updateProfile = api.userProfile.update.useMutation();
  const [status, setStatus] = useState<"error" | "saved">();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(undefined);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = userProfileSchema.safeParse({
      addressLine1: nullableFormValue(values.addressLine1),
      addressLine2: nullableFormValue(values.addressLine2),
      city: nullableFormValue(values.city),
      countryCode: nullableFormValue(values.countryCode),
      dateOfBirth: nullableFormValue(values.dateOfBirth),
      email: nullableFormValue(values.email),
      firstName: nullableFormValue(values.firstName),
      lastName: nullableFormValue(values.lastName),
      phone: nullableFormValue(values.phone),
      postalCode: nullableFormValue(values.postalCode),
      region: nullableFormValue(values.region),
    });
    if (!parsed.success) {
      setStatus("error");
      return;
    }

    updateProfile.mutate(parsed.data, {
      onError: () => {
        setStatus("error");
      },
      onSuccess: () => {
        setStatus("saved");
      },
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-2">
        <h1 className="type-page-title">Sobre você.</h1>
        <p className="type-body max-w-2xl text-muted-foreground">
          Os detalhes que ajudam o Zoen a preencher formulários para você.
          Guarde senhas e dados de pagamento no Cofre.
        </p>
      </div>

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t save personal info</AlertTitle>
          <AlertDescription>
            Check the email, birth date, and two-letter country code, then try
            again.
          </AlertDescription>
        </Alert>
      ) : null}

      <form className="space-y-10" onSubmit={submit}>
        <section aria-labelledby="identity-heading" className="space-y-4">
          <h2 className="type-label" id="identity-heading">
            Identidade e contato
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <ProfileField
              autoComplete="given-name"
              defaultValue={initialProfile.firstName}
              label="Nome"
              name="firstName"
            />
            <ProfileField
              autoComplete="family-name"
              defaultValue={initialProfile.lastName}
              label="Sobrenome"
              name="lastName"
            />
            <ProfileField
              autoComplete="email"
              defaultValue={initialProfile.email}
              label="Email"
              name="email"
              type="email"
            />
            <ProfileField
              autoComplete="tel"
              defaultValue={initialProfile.phone}
              label="Telefone"
              name="phone"
              type="tel"
            />
            <ProfileField
              autoComplete="bday"
              defaultValue={initialProfile.dateOfBirth}
              label="Data de nascimento"
              name="dateOfBirth"
              type="date"
            />
          </div>
        </section>

        <section aria-labelledby="address-heading" className="space-y-4">
          <h2 className="type-label" id="address-heading">
            Endereço
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <ProfileField
              autoComplete="address-line1"
              className="sm:col-span-2"
              defaultValue={initialProfile.addressLine1}
              label="Endereço"
              name="addressLine1"
            />
            <ProfileField
              autoComplete="address-line2"
              className="sm:col-span-2"
              defaultValue={initialProfile.addressLine2}
              label="Complemento"
              name="addressLine2"
            />
            <ProfileField
              autoComplete="address-level2"
              defaultValue={initialProfile.city}
              label="Cidade"
              name="city"
            />
            <ProfileField
              autoComplete="address-level1"
              defaultValue={initialProfile.region}
              label="State / region"
              name="region"
            />
            <ProfileField
              autoComplete="postal-code"
              defaultValue={initialProfile.postalCode}
              label="CEP"
              name="postalCode"
            />
            <ProfileField
              autoComplete="country"
              defaultValue={initialProfile.countryCode}
              label="Código do país"
              maxLength={2}
              name="countryCode"
              placeholder="US"
            />
          </div>
        </section>

        <div className="flex items-center gap-3 border-t border-border/50 pt-6">
          <Button disabled={updateProfile.isPending} type="submit">
            {updateProfile.isPending ? "Salvando…" : "Salvar meus dados"}
          </Button>
          <p
            aria-live="polite"
            className="type-supporting-body text-muted-foreground"
          >
            {status === "saved" ? "Saved." : null}
          </p>
        </div>
      </form>
    </div>
  );
}

function ProfileField({
  className,
  defaultValue,
  label,
  name,
  ...inputProps
}: Omit<React.ComponentProps<typeof Input>, "defaultValue" | "id"> & {
  readonly defaultValue: string | null;
  readonly label: string;
  readonly name: keyof UserProfile;
}) {
  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
      <Label htmlFor={`personal-info-${name}`}>{label}</Label>
      <Input
        defaultValue={defaultValue ?? ""}
        id={`personal-info-${name}`}
        name={name}
        {...inputProps}
      />
    </div>
  );
}

function nullableFormValue(value: FormDataEntryValue | undefined) {
  const parsed = z.string().trim().min(1).safeParse(value);
  return parsed.success ? parsed.data : null;
}
