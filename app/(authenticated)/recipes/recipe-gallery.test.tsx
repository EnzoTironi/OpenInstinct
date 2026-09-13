import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatStarters } from "../_lib/chat-starters";
import { RecipeGallery } from "./recipe-gallery";

describe("recipe entry points", () => {
  it("featured recipes open known, nonempty editable chat starters", () => {
    const html = renderToStaticMarkup(<RecipeGallery />);
    expect(new Set(chatStarters.map(({ id }) => id)).size).toBe(
      chatStarters.length
    );
    const destinations = [
      ...html.matchAll(/href="\/chat\?starter=([^"]+)"/g),
    ].map((match) => match[1]);
    expect(destinations).toHaveLength(3);
    for (const id of destinations) {
      const recipe = chatStarters.find((item) => item.id === id);
      expect(recipe?.text.trim().length).toBeGreaterThan(0);
    }
    expect(html).not.toContain('target="_blank"');
  });
});
