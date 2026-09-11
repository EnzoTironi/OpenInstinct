"use client";

import { serializeAddressVaultPayload } from "@shared/vault/schema";
import { Button } from "@web/components/ui/button";
import { DialogFooter } from "@web/components/ui/dialog";
import { FieldGroup } from "@web/components/ui/field";
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

const addressFormSchema = z.object({
  city: z.string().trim().min(1, "Enter the city."),
  countryCode: z.string().trim().length(2, "Use a two-letter country code."),
  line1: z.string().trim().min(1, "Enter the street address."),
  line2: z.string().trim(),
  nickname: z.string().trim().min(1, "Enter a name for this address.").max(120),
  postalCode: z.string().trim().min(1, "Enter the postal code."),
  recipientName: z.string().trim().min(1, "Enter the recipient name."),
  region: z.string().trim().min(1, "Enter the state, province, or region."),
});

interface AddressFormState {
  city: string;
  countryCode: string;
  line1: string;
  line2: string;
  nickname: string;
  postalCode: string;
  recipientName: string;
  region: string;
}

function createAddressPayload(data: z.output<typeof addressFormSchema>) {
  return {
    account: "",
    kind: "address" as const,
    label: data.nickname,
    secret: serializeAddressVaultPayload({
      ...data,
      kind: "address",
      version: 1,
    }),
  };
}

function useAddressIdentityHandlers(
  setForm: Dispatch<SetStateAction<AddressFormState>>
) {
  const onNicknameChange = useCallback(
    (nickname: string) => {
      patchVaultForm(setForm, "nickname", nickname);
    },
    [setForm]
  );

  const onRecipientNameChange = useCallback(
    (recipientName: string) => {
      patchVaultForm(setForm, "recipientName", recipientName);
    },
    [setForm]
  );

  const onLine1Change = useCallback(
    (line1: string) => {
      patchVaultForm(setForm, "line1", line1);
    },
    [setForm]
  );

  const onLine2Change = useCallback(
    (line2: string) => {
      patchVaultForm(setForm, "line2", line2);
    },
    [setForm]
  );

  return {
    onLine1Change,
    onLine2Change,
    onNicknameChange,
    onRecipientNameChange,
  };
}

function useAddressLocalityHandlers(
  setForm: Dispatch<SetStateAction<AddressFormState>>
) {
  const onCityChange = useCallback(
    (city: string) => {
      patchVaultForm(setForm, "city", city);
    },
    [setForm]
  );

  const onRegionChange = useCallback(
    (region: string) => {
      patchVaultForm(setForm, "region", region);
    },
    [setForm]
  );

  const onPostalCodeChange = useCallback(
    (postalCode: string) => {
      patchVaultForm(setForm, "postalCode", postalCode);
    },
    [setForm]
  );

  const onCountryCodeChange = useCallback(
    (value: string) => {
      patchVaultForm(setForm, "countryCode", value.toUpperCase());
    },
    [setForm]
  );

  return {
    onCityChange,
    onCountryCodeChange,
    onPostalCodeChange,
    onRegionChange,
  };
}

function useAddressForm(initialLabel: string, onSaved: () => void) {
  const create = useVaultItemCreate(onSaved);
  const [attempted, setAttempted] = useState(false);

  const [form, setForm] = useState<AddressFormState>({
    city: "",
    countryCode: "US",
    line1: "",
    line2: "",
    nickname: initialLabel,
    postalCode: "",
    recipientName: "",
    region: "",
  });

  const result = addressFormSchema.safeParse(form);
  const errors = vaultFormErrors(attempted, result);
  const identity = useAddressIdentityHandlers(setForm);
  const locality = useAddressLocalityHandlers(setForm);

  const submit = useVaultFormSubmit(
    setAttempted,
    result,
    create.mutate,
    createAddressPayload
  );

  return {
    create,
    errors,
    form,
    submit,
    ...identity,
    ...locality,
  };
}

export function AddressForm({
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
    onCityChange,
    onCountryCodeChange,
    onLine1Change,
    onLine2Change,
    onNicknameChange,
    onPostalCodeChange,
    onRecipientNameChange,
    onRegionChange,
    submit,
  } = useAddressForm(initialLabel, onSaved);

  return (
    <form noValidate onSubmit={submit}>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            error={errors.nickname?.[0]}
            id="vault-address-label"
            label="Name"
            onChange={onNicknameChange}
            placeholder="Home"
            value={form.nickname}
          />
          <FormField
            autoComplete="name"
            error={errors.recipientName?.[0]}
            id="vault-address-recipient"
            label="Recipient name"
            onChange={onRecipientNameChange}
            value={form.recipientName}
          />
        </div>
        <FormField
          autoComplete="address-line1"
          error={errors.line1?.[0]}
          id="vault-address-line1"
          label="Address line 1"
          onChange={onLine1Change}
          value={form.line1}
        />
        <FormField
          autoComplete="address-line2"
          error={errors.line2?.[0]}
          id="vault-address-line2"
          label="Address line 2 (optional)"
          onChange={onLine2Change}
          value={form.line2}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            autoComplete="address-level2"
            error={errors.city?.[0]}
            id="vault-address-city"
            label="City"
            onChange={onCityChange}
            value={form.city}
          />
          <FormField
            autoComplete="address-level1"
            error={errors.region?.[0]}
            id="vault-address-region"
            label="State / province / region"
            onChange={onRegionChange}
            value={form.region}
          />
        </div>
        <div className="grid grid-cols-[1fr_0.6fr] gap-3">
          <FormField
            autoComplete="postal-code"
            error={errors.postalCode?.[0]}
            id="vault-address-postal"
            label="ZIP / postal code"
            onChange={onPostalCodeChange}
            value={form.postalCode}
          />
          <FormField
            autoComplete="country"
            error={errors.countryCode?.[0]}
            id="vault-address-country"
            label="Country"
            maxLength={2}
            onChange={onCountryCodeChange}
            value={form.countryCode}
          />
        </div>
      </FieldGroup>
      <DialogFooter>
        <Button disabled={create.isPending} type="submit">
          Save address
        </Button>
      </DialogFooter>
    </form>
  );
}
