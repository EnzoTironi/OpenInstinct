import { replaceUserProfile } from "../db/services/user-profile";
import { ensureScope } from "../db/services/scope";
import { saveVaultItem } from "../db/services/vault";
import { accessScopeForUser } from "../shared/identity/access-scope";
import { serializePaymentCard } from "../shared/vault/schema";
import { serverRuntime } from "../server/runtime";

const scope = accessScopeForUser("better-auth:browser-benchmark");
await ensureScope(scope);
await serverRuntime.runPromise(
  replaceUserProfile(scope, {
    addressLine1: "123 Test Street",
    addressLine2: "Apartment 4B",
    city: "Brooklyn",
    countryCode: "US",
    dateOfBirth: "1990-01-01",
    email: "browser-benchmark@example.com",
    firstName: "John",
    lastName: "Smith",
    phone: "+12025550100",
    postalCode: "11201",
    region: "NY",
  })
);

await saveVaultItem(scope, {
  account: "Visa · •••• 4242",
  kind: "payment",
  label: "Benchmark test card",
  secret: serializePaymentCard({
    billingPostalCode: "11201",
    cardholderName: "John Smith",
    expirationMonth: 12,
    expirationYear: 2034,
    kind: "payment-card",
    number: "4242424242424242",
    securityCode: "123",
    version: 1,
  }),
});
