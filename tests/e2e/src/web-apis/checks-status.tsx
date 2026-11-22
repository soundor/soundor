import { Text } from '@soundor/react';
import { useEffect, useState } from 'react';

import { text } from '../ui/theme';
import { checks, runChecks } from './checks';

/** Runs the checks once the UI starts, and says how they went. */
export function ChecksStatus() {
  const [failures, setFailures] = useState<string[] | null>(null);
  useEffect(() => {
    void runChecks().then(setFailures);
  }, []);
  return (
    <Text debugId="checks" style={text.body}>
      {failures === null
        ? 'JavaScript: running'
        : failures.length === 0
          ? `JavaScript: ${checks.length} of ${checks.length} passed`
          : `JavaScript failed: ${failures.join('; ')}`}
    </Text>
  );
}
