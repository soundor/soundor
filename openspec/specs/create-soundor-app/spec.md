## ADDED Requirements

### Requirement: Project name input

The CLI SHALL accept an optional positional argument for the project name. If not provided, the CLI SHALL prompt the user interactively.

#### Scenario: Name provided as argument

- **WHEN** user runs `npx create-soundor-app my-app`
- **THEN** the CLI skips the name prompt and uses `my-app` as the project name

#### Scenario: Name not provided

- **WHEN** user runs `npx create-soundor-app` with no arguments
- **THEN** the CLI prompts for a project name before proceeding

#### Scenario: User cancels name prompt

- **WHEN** user cancels the name prompt (e.g. Ctrl+C)
- **THEN** the CLI exits cleanly with a cancellation message and non-zero exit code

### Requirement: Runtime selection

The CLI SHALL present a single-select list of available runtimes. The user SHALL select exactly one runtime. The runtime list SHALL be hardcoded in the CLI source.

#### Scenario: Single runtime selected

- **WHEN** user selects a runtime from the prompt
- **THEN** the selected runtime is used for scaffolding and passed to `soundor init`

#### Scenario: User cancels runtime prompt

- **WHEN** user cancels the runtime selection
- **THEN** the CLI exits cleanly with a cancellation message and non-zero exit code

### Requirement: Package manager selection

The CLI SHALL detect the package manager used to invoke it via `npm_config_user_agent`. Supported package managers are: pnpm, yarn, npm, bun. If detection fails, the CLI SHALL prompt the user to select one of the four supported options.

#### Scenario: Package manager detected

- **WHEN** `npm_config_user_agent` is present and identifies pnpm, yarn, npm, or bun
- **THEN** the CLI uses the detected package manager without prompting

#### Scenario: Package manager not detected

- **WHEN** `npm_config_user_agent` is absent or unrecognizable
- **THEN** the CLI prompts the user to select from pnpm, yarn, npm, or bun

### Requirement: Project scaffolding

The CLI SHALL copy the bundled `templates/base/` directory to a new directory named after the project in the current working directory. The CLI SHALL perform token replacement on `package.json` and `soundor.config.ts`. The CLI SHALL rename `_gitignore` to `.gitignore`.

#### Scenario: Scaffold creates project directory

- **WHEN** scaffolding runs with project name `my-app`
- **THEN** a `my-app/` directory is created in the current working directory containing all template files

#### Scenario: Token replacement in package.json

- **WHEN** scaffolding completes
- **THEN** `package.json` in the new project has `"name"` set to the project name

#### Scenario: Token replacement in soundor.config.ts

- **WHEN** scaffolding completes
- **THEN** `soundor.config.ts` has `__PROJECT_NAME__` replaced with the project name and `__RUNTIME__` replaced with the selected runtime

#### Scenario: .gitignore is present

- **WHEN** scaffolding completes
- **THEN** the new project contains `.gitignore` (not `_gitignore`)

#### Scenario: Target directory already exists

- **WHEN** a directory with the project name already exists in the current working directory
- **THEN** the CLI exits with an error message and does not overwrite

### Requirement: Dependency installation

After scaffolding, the CLI SHALL run the selected package manager's install command inside the new project directory.

#### Scenario: Dependencies installed

- **WHEN** scaffolding completes successfully
- **THEN** the CLI runs `<pm> install` in the new project directory and waits for it to complete

#### Scenario: Install fails

- **WHEN** the install command exits with a non-zero code
- **THEN** the CLI reports the failure and exits with a non-zero code

### Requirement: Runtime initialization

After dependency installation, the CLI SHALL run `soundor init <runtime>` inside the new project directory using the selected package manager's exec mechanism.

#### Scenario: soundor init called

- **WHEN** dependencies are installed successfully
- **THEN** the CLI spawns `soundor init <runtime>` in the new project directory

#### Scenario: soundor init fails

- **WHEN** `soundor init` exits with a non-zero code
- **THEN** the CLI reports the failure and exits with a non-zero code

### Requirement: Success output

After all steps complete, the CLI SHALL display next steps to the user.

#### Scenario: Next steps shown

- **WHEN** all steps complete successfully
- **THEN** the CLI prints `cd <project-name>` and the dev command (e.g. `pnpm dev`) as next steps
