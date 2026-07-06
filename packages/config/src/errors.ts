/** A single, actionable problem found while loading or validating a config. */
export interface ConfigIssue {
  /** Location of the problem, e.g. `parameters[0].max`. Empty for whole-file issues. */
  path: string;
  /** What is wrong and, where useful, how to fix it. */
  message: string;
}

/** What stage of loading failed. */
export type ConfigErrorKind = 'not-found' | 'load' | 'validation';

/**
 * Thrown by {@link parseConfig} for every failure mode. Carries structured
 * {@link ConfigIssue}s so a CLI can render them and exit non-zero.
 */
export class ConfigError extends Error {
  readonly kind: ConfigErrorKind;
  readonly issues: ConfigIssue[];

  constructor(
    kind: ConfigErrorKind,
    message: string,
    issues: ConfigIssue[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
    this.kind = kind;
    this.issues = issues;
  }

  /** Human-readable summary with one line per issue. */
  format(): string {
    if (this.issues.length === 0) return this.message;
    const lines = this.issues.map((issue) =>
      issue.path
        ? `  • ${issue.path}: ${issue.message}`
        : `  • ${issue.message}`,
    );
    return [this.message, ...lines].join('\n');
  }
}
