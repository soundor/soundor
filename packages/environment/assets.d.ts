// Image and font imports: what Soundor's bundler turns
// `import logo from './logo.png'` into, the asset's id (soundor:ui's Asset, a
// string). Apart from the globals, so that a library whose own bundler
// declares these (as strings too) can leave this file out.

declare module '*.png' {
  const asset: string;
  export default asset;
}
declare module '*.jpg' {
  const asset: string;
  export default asset;
}
declare module '*.jpeg' {
  const asset: string;
  export default asset;
}
declare module '*.webp' {
  const asset: string;
  export default asset;
}
declare module '*.svg' {
  const asset: string;
  export default asset;
}
declare module '*.ttf' {
  const asset: string;
  export default asset;
}
declare module '*.otf' {
  const asset: string;
  export default asset;
}
