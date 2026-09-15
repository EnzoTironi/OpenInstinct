import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";
import { computerSessionKey, ComputerScopeError } from "./lib/computer-scope";

// Skills and scratch files use Eve's virtual filesystem on every host.
// Durable knowledge and host capabilities go through the authorized Executor.
// P19 pins just-bash; agentOS is a documented no-go (Eve 0.52 peer mismatch).
export default defineSandbox({
  backend: justbash({ autoInstall: false }),
  async onSession({ ctx, use: openSession }) {
    const sandbox = await openSession();
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller) {
      return;
    }
    try {
      await sandbox.writeTextFile({
        path: ".zoen/computer-scope",
        content: computerSessionKey(caller),
      });
    } catch (error) {
      if (error instanceof ComputerScopeError) {
        return;
      }
      throw error;
    }
  },
});
