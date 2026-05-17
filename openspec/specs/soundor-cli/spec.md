## ADDED Requirements

### Requirement: soundor binary

The package SHALL register a `soundor` binary via the `bin` field in `package.json` pointing to `dist/index.js`.

#### Scenario: Binary is declared

- **WHEN** the package is installed
- **THEN** `soundor` is available as a command

### Requirement: Prompt cancellation handling

Any command that uses interactive prompts SHALL call `isCancel()` after each prompt and exit with code `0` when the user cancels (Ctrl+C) or when running in a non-TTY environment.

#### Scenario: User cancels a prompt

- **WHEN** a user hits Ctrl+C during an interactive prompt
- **THEN** the process exits with code `0` and no partial state is written

#### Scenario: Non-TTY environment

- **WHEN** a prompt-using command runs in a non-TTY context (CI, pipe)
- **THEN** the process exits cleanly without hanging

### Requirement: Prompt-using commands accept equivalent flags

Any command that uses interactive prompts SHALL also accept CLI flags covering the same inputs, so the command is fully scriptable without interaction.

#### Scenario: init runs non-interactively via flags

- **WHEN** `soundor init` is executed with all required flags supplied
- **THEN** the process completes without showing any prompts

### Requirement: init command

The CLI SHALL expose an `init` command that runs without required arguments.

#### Scenario: init runs without error (stub)

- **WHEN** `soundor init` is executed
- **THEN** the process exits with code `0`

### Requirement: gen command

The CLI SHALL expose a `gen` command that runs without required arguments.

#### Scenario: gen runs without error (stub)

- **WHEN** `soundor gen` is executed
- **THEN** the process exits with code `0`

### Requirement: dev command

The CLI SHALL expose a `dev` command that requires a `runtime` argument.

#### Scenario: dev with runtime argument runs without error (stub)

- **WHEN** `soundor dev <runtime>` is executed
- **THEN** the process exits with code `0`

#### Scenario: dev without runtime argument exits with non-zero code

- **WHEN** `soundor dev` is executed without a runtime argument
- **THEN** the process exits with a non-zero code and prints a clear error message

### Requirement: build command

The CLI SHALL expose a `build` command with an optional `runtime` argument.

#### Scenario: build with no runtime argument runs without error (stub)

- **WHEN** `soundor build` is executed without arguments
- **THEN** the process exits with code `0`

#### Scenario: build with runtime argument runs without error (stub)

- **WHEN** `soundor build <runtime>` is executed
- **THEN** the process exits with code `0`

### Requirement: doctor command

The CLI SHALL expose a `doctor` command that runs without required arguments.

#### Scenario: doctor runs without error (stub)

- **WHEN** `soundor doctor` is executed
- **THEN** the process exits with code `0`
