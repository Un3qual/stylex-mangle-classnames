import { expect, test } from "vitest";
import { findHtmlStartTags } from "../src/html.js";

test("parses a complete custom-element name ending in a hyphen", () => {
  expect(findHtmlStartTags('<x- class="value"></x->')[0]?.tagName).toBe("x-");
});
