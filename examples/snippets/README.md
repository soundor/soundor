# snippets

The plugin the documentation's live snippets run in: one parameter of every
type, a gain on the audio, and one small UI per file in `src/snippets/`.
`soundor dev web` shows them all, with a picker.

A snippet is one file whose default export is a component. It may import
only `react`, `@soundor/react`, `soundor:*`, and images from `src/assets/`
(`import cover from '../assets/cover.png'`): readers edit it in the page,
where nothing else exists. Add it to `src/snippets/index.ts`;
a docs page shows it with `<Snippet name="<file name>" />`.

- [Documentation](https://soundor.dev/docs)
