import { test } from "node:test";
import assert from "node:assert/strict";
import { findRule, splitFrontmatter, fillPlaceholders, mergeProps, appendBody, type Rule } from "../src/template";

const rules: Rule[] = [
  { base: "Books.base", view: "", template: "Templates/Book.md" },
  { base: "Books.base", view: "To read", template: "Templates/To read.md" },
  { base: "Films.base", view: "Watched", template: "Templates/Film.md" },
];

test("an exact view wins over the whole base", () => {
  assert.equal(findRule(rules, "Books.base", "To read")?.template, "Templates/To read.md");
  assert.equal(findRule(rules, "Books.base", "Finished")?.template, "Templates/Book.md");
});

test("no rule for this base or view means nothing happens", () => {
  assert.equal(findRule(rules, "Films.base", "Other"), null);
  assert.equal(findRule(rules, "Notes.base", ""), null);
  assert.equal(findRule([{ base: "A.base", view: "", template: "" }], "A.base", "x"), null);
});

test("frontmatter is split from the body", () => {
  assert.deepEqual(splitFrontmatter("---\ntags: [a]\n---\nHello"), { yaml: "tags: [a]", body: "Hello" });
  assert.deepEqual(splitFrontmatter("No frontmatter"), { yaml: null, body: "No frontmatter" });
  assert.deepEqual(splitFrontmatter("---\nx: 1\n---"), { yaml: "x: 1", body: "" });
  assert.deepEqual(splitFrontmatter("---\r\nx: 1\r\n---\r\nBody"), { yaml: "x: 1", body: "Body" });
});

test("placeholders fill like Obsidian's own Templates", () => {
  const fmt = (f: string) => `<${f}>`;
  assert.equal(fillPlaceholders("# {{title}}", "Dune", fmt), "# Dune");
  assert.equal(fillPlaceholders("{{date}} {{time}}", "x", fmt), "<YYYY-MM-DD> <HH:mm>");
  assert.equal(fillPlaceholders("{{date:dddd D MMMM}} {{ TIME:HH }}", "x", fmt), "<dddd D MMMM> <HH>");
  assert.equal(fillPlaceholders("{{date}}", "x", fmt, "DD/MM/YYYY"), "<DD/MM/YYYY>");
  assert.equal(fillPlaceholders("{{nothing}} and {single}", "x", fmt), "{{nothing}} and {single}");
});

test("the note's own values win, lists are joined without repeats", () => {
  assert.deepEqual(
    mergeProps({ status: "reading", tags: ["book"] }, { status: "to read", tags: ["book", "fiction"], rating: 0 }),
    { status: "reading", tags: ["book", "fiction"], rating: 0 },
  );
  assert.deepEqual(mergeProps({ status: "" }, { status: "to read" }), { status: "to read" });
  assert.deepEqual(mergeProps({ tags: "book" }, { tags: ["fiction"] }), { tags: ["book", "fiction"] });
  assert.deepEqual(mergeProps({}, {}), {});
});

test("the template body goes under the frontmatter of a new note", () => {
  assert.equal(appendBody("", "## Notes\n"), "## Notes\n");
  assert.equal(appendBody("---\nstatus: x\n---\n", "\n## Notes\n"), "---\nstatus: x\n---\n## Notes\n");
  assert.equal(appendBody("---\nstatus: x\n---\nAlready here", "## Notes"), "---\nstatus: x\n---\nAlready here\n\n## Notes");
});
