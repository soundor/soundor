/** Public paths for the docs collection, including its standalone changelog. */
export function getContentUrl(slugs: string[]): string {
  return (
    '/' + (slugs[0] === 'changelog' ? slugs : ['docs', ...slugs]).join('/')
  );
}

export function getContentMarkdownUrl(slugs: string[]) {
  const segments = [...slugs];
  if (
    !segments.length ||
    (segments.length === 1 && segments[0] === 'changelog')
  )
    segments.push('index.md');
  else segments[segments.length - 1] += '.md';
  return { segments, url: getContentUrl(segments) };
}
