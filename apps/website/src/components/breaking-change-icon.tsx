import { TriangleAlert } from 'lucide-react';

/** A release warning with a tooltip and an accessible name. */
export function BreakingChangeIcon() {
  return (
    <TriangleAlert
      className="release-breaking"
      size="1em"
      role="img"
      aria-label="Breaking changes"
    >
      <title>Contains breaking changes</title>
    </TriangleAlert>
  );
}
