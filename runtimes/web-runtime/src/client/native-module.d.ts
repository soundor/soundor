// `soundor:native` for the host's own code (the playground hands it on). A
// project's generated declarations type its methods; the host cannot know
// them. Not part of the tests' tsconfig, which uses the fixture's.

declare module 'soundor:native' {
  const methods: Readonly<Record<string, unknown>>;
  export = methods;
}
