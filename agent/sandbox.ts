import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Skills and scratch files use Eve's virtual filesystem on every host.
// Durable knowledge and host capabilities go through the authorized Executor.
export default defineSandbox({ backend: justbash({ autoInstall: false }) });
