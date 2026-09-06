import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StateHint } from "../state-hint";

describe("StateHint rendering", () => {
  it("renders informational status without an action", () => {
    const html = renderToStaticMarkup(createElement(StateHint, { text: "Choose a clip" }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
  });
  it("keeps a disabled action disabled", () => {
    const html = renderToStaticMarkup(
      createElement(StateHint, {
        text: "Importing",
        action: { label: "Import", disabled: true, onClick: () => {} },
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("Import</button>");
  });
  it("preserves a long filename with wrapping and announces errors", () => {
    const text = `${"한글".repeat(200)}.mov`;
    const html = renderToStaticMarkup(createElement(StateHint, { text, tone: "error" }));
    expect(html).toContain(text);
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain('role="alert"');
    expect(html).toContain("border-red-400/40");
  });
});
