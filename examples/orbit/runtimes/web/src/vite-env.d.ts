/** Vite bundles the AudioWorklet as an independent ES module. */
declare module '*?worker&url' {
  const url: string;
  export default url;
}
