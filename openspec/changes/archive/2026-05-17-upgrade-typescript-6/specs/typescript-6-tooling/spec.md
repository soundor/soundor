## ADDED Requirements

### Requirement: Workspace uses TypeScript 6

The workspace SHALL use TypeScript 6 as the catalog-managed compiler version for TypeScript-aware package builds and example type-checking.

#### Scenario: TypeScript catalog resolves to version 6

- **WHEN** dependencies are installed from the workspace catalog
- **THEN** the resolved `typescript` package version is a TypeScript 6 release

### Requirement: Existing package build outputs remain valid

The React package build SHALL continue producing its JavaScript and declaration entrypoints with TypeScript 6.

#### Scenario: React package builds with declarations

- **WHEN** the React package build command runs after the TypeScript 6 upgrade
- **THEN** the package emits `dist/index.js` and `dist/index.d.ts` matching its package export contract

### Requirement: Example application remains buildable

The basic example application SHALL continue to type-check and build with TypeScript 6.

#### Scenario: Basic example build succeeds

- **WHEN** the basic example build command runs after the TypeScript 6 upgrade
- **THEN** `tsc -b` completes and the Vite production build succeeds

### Requirement: Workspace validation remains green

The workspace SHALL pass its standard validation commands after the TypeScript 6 upgrade.

#### Scenario: Standard checks pass

- **WHEN** the workspace build, test, lint check, and format check commands run after the upgrade
- **THEN** each command completes successfully without new TypeScript 6 compatibility failures

### Requirement: TS6-sensitive configuration is explicit where required

TypeScript configuration SHALL explicitly define settings where TS6 default changes would otherwise alter workspace behavior.

#### Scenario: Ambient types remain available

- **WHEN** TypeScript checks app, node, package, and test sources under TS6
- **THEN** required ambient types such as Vite client, Node, and test-related types are available without relying on unintended defaults

#### Scenario: Deprecation handling is intentional

- **WHEN** TS6 reports deprecated or removed compiler options
- **THEN** the implementation removes or replaces those options unless a temporary suppression is documented as a blocker workaround
