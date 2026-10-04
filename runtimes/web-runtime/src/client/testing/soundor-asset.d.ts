// What soundor:ui's declaration needs from Soundor's globals (which clash
// with the DOM's, so the tests do not include them).
type SoundorAsset = string & { readonly __soundorAsset: true };
