import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountPlanSection } from "../_components/plan-section";

describe("account plan section", () => {
  it("marks Free personal as current and clarifies org seats", () => {
    const html = renderToStaticMarkup(createElement(AccountPlanSection));
    expect(html).toContain('id="plan"');
    expect(html).toContain("Plan and billing");
    expect(html).toContain("Free");
    expect(html).toContain("Personal");
    expect(html).toContain("Current");
    expect(html).toContain("Organization seats");
    expect(html).toContain("Pro");
    expect(html).toContain("Org");
  });
});
