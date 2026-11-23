/** Orbit's own site serves its web build alone for pages like this one. */
export const orbitEmbedUrl = 'https://orbit.soundor.dev/embed/index.html';

/** Orbit, playable: its web build in a frame with the host's Play bar. */
export function OrbitDemo() {
  return (
    <iframe
      src={orbitEmbedUrl}
      title="Orbit, playable in the browser"
      allow="autoplay; microphone"
      loading="lazy"
      className="block aspect-[8/7] max-h-[80vh] w-full rounded-xl border bg-black"
    />
  );
}
