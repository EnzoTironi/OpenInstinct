import { describe, expect, it } from "vitest";
import {
  advisorConsultInstructions,
  childRoleContract,
  resolveChildRole,
} from "../child-role";

describe("Eve child role contracts", () => {
  it("uses researcher as the explicit minimum when the role is absent", () => {
    expect(resolveChildRole(undefined)).toEqual({
      kind: "resolved",
      role: "researcher",
    });
    expect(resolveChildRole("")).toEqual({
      kind: "resolved",
      role: "researcher",
    });
    expect(childRoleContract("researcher")).toEqual({
      role: "researcher",
      audience: "coordinator",
      mayApprove: false,
      isSentinel: false,
      writeEffects: false,
    });
  });

  it("does not widen unknown or legacy alias names into builder", () => {
    for (const requested of [
      "research",
      "consult",
      "coder",
      "worker",
      "default",
      "builder-full",
    ]) {
      expect(resolveChildRole(requested)).toEqual({
        kind: "unknown",
        requested,
      });
    }
  });

  it("keeps advisor as a coordinator-facing consult, not Sentinel or approver", () => {
    expect(resolveChildRole("advisor")).toEqual({
      kind: "resolved",
      role: "advisor",
    });
    expect(childRoleContract("advisor")).toEqual({
      role: "advisor",
      audience: "coordinator",
      mayApprove: false,
      isSentinel: false,
      writeEffects: false,
    });
    const instructions = advisorConsultInstructions();
    expect(instructions).toContain("Advise. Do not execute the task");
    expect(instructions).toContain("or act as Sentinel");
    expect(instructions).toContain(
      "Your output returns only to the coordinator."
    );
    expect(instructions).not.toContain("SOUL");
  });

  it("does not treat builder as Sentinel or as the user-facing approver", () => {
    expect(childRoleContract("builder")).toMatchObject({
      audience: "coordinator",
      mayApprove: false,
      isSentinel: false,
      writeEffects: true,
    });
    expect(childRoleContract("browser-agent")).toMatchObject({
      audience: "coordinator",
      mayApprove: false,
      isSentinel: false,
      writeEffects: true,
    });
  });
});
