# Bases Templates

Press **New** in a base and get a note made from your template, not a blank one.

This is the behaviour asked for in the forum thread [Bases: New With Template (for 'New' Button)](https://forum.obsidian.md/t/bases-new-with-template-for-new-button/102639).

## Use it

1. Open a base and pick the view you add notes from.
2. Open the command palette and run **Bases Templates: Choose the template for this base view**.
3. Pick a template note. That's it: **New** in that view now makes the note from it.

To set it for every view in a base at once, or to change it later, go to **Settings → Bases Templates**. Each line is a base, a view (leave it empty for every view) and a template. A line for one view wins over a line for the whole base.

## What goes into the new note

- The template's properties are added to the note.
- The values the base fills in for its filters always win. If a view only shows `status: finished`, a new note there keeps `status: finished` even when the template says `to read`, so it stays in the view.
- Lists are joined without repeats: a base's `tags: [book]` plus a template's `tags: [book, fiction]` gives `[book, fiction]`.
- The template's text goes under the properties.
- `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and `{{time:FORMAT}}` are filled in, as in Obsidian's own Templates.
- If the template uses Templater (`<% ... %>`) and Templater is installed, Templater fills it in, and the base's values are kept.
- Views made by the Split Groups plugin are left alone, since Split Groups sets its own template per view.

Only notes made with a base's **New** are touched. Notes made any other way are left alone. It does not rely on the new note being called "Untitled", so it works in every language.

## Settings

- **Templates folder**: where the template lists look first. Leave it empty to list every note.

## Build

```
npm install
npm run build
npm test
npm run lint
```

## Licence

MIT
