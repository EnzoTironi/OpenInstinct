"use client";

import {
  paymentCardBrand,
  paymentCardType,
  serializePaymentCard,
} from "@shared/vault/schema";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { DialogFooter } from "@web/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@web/components/ui/field";
import { Input } from "@web/components/ui/input";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import { z } from "zod";

import {
  patchVaultForm,
  useVaultFormSubmit,
  useVaultItemCreate,
  vaultFormErrors,
} from "../use-vault-form";

const paymentCardFormSchema = z.object({
  billingPostalCode: z.string().trim().min(1, "Enter the billing postal code."),
  cardNumber: z
    .string()
    .transform((value) => value.replaceAll(/\D/gu, ""))
    .pipe(z.string().regex(/^\d{12,19}$/u, "Enter a valid card number."))
    .refine(passesLuhnCheck, "Check the card number."),
  cardholderName: z.string().trim().min(1, "Enter the name on the card."),
  cvc: z
    .string()
    .transform((value) => value.replaceAll(/\D/gu, ""))
    .pipe(z.string().regex(/^\d{3,4}$/u, "Enter a valid CVC.")),
  expiration: z
    .string()
    .regex(/^(0[1-9]|1[0-2]) \/ \d{2}$/u, "Use MM / YY.")
    .refine(isCurrentExpiration, "Use a current expiration date."),
  nickname: z.string().trim().max(120),
});

interface CardFormState {
  billingPostalCode: string;
  cardNumber: string;
  cardholderName: string;
  cvc: string;
  expiration: string;
  nickname: string;
}

function createCardPayload(data: z.output<typeof paymentCardFormSchema>) {
  const [month, shortYear] = data.expiration.split(" / ");

  if (month === undefined || shortYear === undefined) return undefined;

  const brand = paymentCardBrand(data.cardNumber);
  const lastFour = data.cardNumber.slice(-4);

  return {
    account: `${brand} · •••• ${lastFour}`,
    kind: "payment" as const,
    label: data.nickname || `${brand} ${lastFour}`,
    secret: serializePaymentCard({
      billingPostalCode: data.billingPostalCode,
      cardholderName: data.cardholderName,
      expirationMonth: Number(month),
      expirationYear: 2000 + Number(shortYear),
      kind: "payment-card",
      number: data.cardNumber,
      securityCode: data.cvc,
      version: 1,
    }),
  };
}

function useCardIdentityHandlers(
  setForm: Dispatch<SetStateAction<CardFormState>>
) {
  const onCardholderNameChange = useCallback(
    (cardholderName: string) => {
      patchVaultForm(setForm, "cardholderName", cardholderName);
    },
    [setForm]
  );

  const onNicknameChange = useCallback(
    (nickname: string) => {
      patchVaultForm(setForm, "nickname", nickname);
    },
    [setForm]
  );

  const onCardNumberChange = useCallback(
    (value: string) => {
      patchVaultForm(setForm, "cardNumber", formatCardNumber(value));
    },
    [setForm]
  );

  return {
    onCardNumberChange,
    onCardholderNameChange,
    onNicknameChange,
  };
}

function useCardSecurityHandlers(
  setForm: Dispatch<SetStateAction<CardFormState>>
) {
  const onExpirationChange = useCallback(
    (value: string) => {
      patchVaultForm(setForm, "expiration", formatExpiration(value));
    },
    [setForm]
  );

  const onCvcChange = useCallback(
    (value: string) => {
      patchVaultForm(setForm, "cvc", value.replaceAll(/\D/gu, "").slice(0, 4));
    },
    [setForm]
  );

  const onBillingPostalCodeChange = useCallback(
    (billingPostalCode: string) => {
      patchVaultForm(setForm, "billingPostalCode", billingPostalCode);
    },
    [setForm]
  );

  return {
    onBillingPostalCodeChange,
    onCvcChange,
    onExpirationChange,
  };
}

function useCardForm(initialLabel: string, onSaved: () => void) {
  const create = useVaultItemCreate(onSaved);
  const [attempted, setAttempted] = useState(false);

  const [form, setForm] = useState<CardFormState>({
    billingPostalCode: "",
    cardNumber: "",
    cardholderName: "",
    cvc: "",
    expiration: "",
    nickname: initialLabel,
  });

  const cardType = paymentCardType(form.cardNumber);
  const result = paymentCardFormSchema.safeParse(form);
  const errors = vaultFormErrors(attempted, result);
  const identity = useCardIdentityHandlers(setForm);
  const security = useCardSecurityHandlers(setForm);

  const submit = useVaultFormSubmit(
    setAttempted,
    result,
    create.mutate,
    createCardPayload
  );

  return {
    cardType,
    create,
    errors,
    form,
    submit,
    ...identity,
    ...security,
  };
}

export function CardForm({
  initialLabel = "",
  onSaved,
}: {
  readonly initialLabel?: string;
  readonly onSaved: () => void;
}) {
  const {
    cardType,
    create,
    errors,
    form,
    onBillingPostalCodeChange,
    onCardNumberChange,
    onCardholderNameChange,
    onCvcChange,
    onExpirationChange,
    onNicknameChange,
    submit,
  } = useCardForm(initialLabel, onSaved);

  return (
    <form noValidate onSubmit={submit}>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <CardField
            autoComplete="cc-name"
            error={errors.cardholderName?.[0]}
            id="vault-payment-cardholder"
            label="Name on card"
            name="cc-name"
            onChange={onCardholderNameChange}
            value={form.cardholderName}
          />
          <CardField
            autoComplete="off"
            error={errors.nickname?.[0]}
            id="vault-payment-nickname"
            label="Nickname (optional)"
            name="card-nickname"
            onChange={onNicknameChange}
            placeholder="Personal"
            value={form.nickname}
          />
        </div>

        <CardField
          autoComplete="cc-number"
          error={errors.cardNumber?.[0]}
          id="vault-payment-number"
          inputMode="numeric"
          label="Card number"
          maxLength={23}
          name="cc-number"
          onChange={onCardNumberChange}
          placeholder="1234 5678 9012 3456"
          trailingLabel={cardType?.niceType}
          value={form.cardNumber}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
          <CardField
            autoComplete="cc-exp"
            error={errors.expiration?.[0]}
            id="vault-payment-expiration"
            inputMode="numeric"
            label="Expiration"
            maxLength={7}
            name="cc-exp"
            onChange={onExpirationChange}
            placeholder="MM / YY"
            value={form.expiration}
          />
          <CardField
            autoComplete="cc-csc"
            error={errors.cvc?.[0]}
            id="vault-payment-cvc"
            inputMode="numeric"
            label="CVC"
            maxLength={4}
            name="cc-csc"
            onChange={onCvcChange}
            placeholder="123"
            value={form.cvc}
          />
          <CardField
            autoComplete="postal-code"
            className="col-span-2 sm:col-span-1"
            error={errors.billingPostalCode?.[0]}
            id="vault-payment-postal-code"
            label="Billing ZIP / postal"
            maxLength={20}
            name="postal-code"
            onChange={onBillingPostalCodeChange}
            value={form.billingPostalCode}
          />
        </div>
      </FieldGroup>

      <DialogFooter>
        <Button disabled={create.isPending} type="submit">
          Save card
        </Button>
      </DialogFooter>
    </form>
  );
}

function CardField({
  className,
  error,
  id,
  label,
  onChange,
  trailingLabel,
  ...inputProps
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  readonly error?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly trailingLabel?: string;
}) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
    },
    [onChange]
  );

  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <TrailingBadge label={trailingLabel} />
      </div>
      <Input
        {...inputProps}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={handleChange}
      />
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}

function TrailingBadge({ label }: { readonly label?: string }) {
  if (!label) return null;

  return (
    <Badge aria-live="polite" variant="outline">
      {label}
    </Badge>
  );
}

function formatCardNumber(value: string) {
  const digits = value.replaceAll(/\D/gu, "").slice(0, 19);
  const gaps = new Set(paymentCardType(digits)?.gaps ?? [4, 8, 12]);

  return digits
    .split("")
    .map((digit, index) => (gaps.has(index) ? ` ${digit}` : digit))
    .join("");
}

function formatExpiration(value: string) {
  const digits = value.replaceAll(/\D/gu, "").slice(0, 4);

  if (digits.length <= 2) return digits;

  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

function passesLuhnCheck(number: string) {
  let sum = 0;
  let doubleDigit = false;

  for (const character of number.split("").toReversed()) {
    let digit = Number(character);

    if (doubleDigit) {
      digit *= 2;

      if (digit > 9) digit -= 9;
    }

    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function isCurrentExpiration(value: string) {
  const [month, shortYear] = value.split(" / ");

  if (month === undefined || shortYear === undefined) return false;

  const expirationYear = 2000 + Number(shortYear);
  const today = new Date();

  if (expirationYear > today.getFullYear()) return true;

  if (expirationYear !== today.getFullYear()) return false;

  return Number(month) >= today.getMonth() + 1;
}
