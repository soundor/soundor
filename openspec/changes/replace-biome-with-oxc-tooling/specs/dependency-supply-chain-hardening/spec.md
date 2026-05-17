## MODIFIED Requirements

### Requirement: Existing verification workflows continue to pass
The workspace SHALL continue to support dependency install, Oxc-based format and lint checks, build, and test workflows after the Biome-to-Oxc tooling migration.

#### Scenario: CI-equivalent checks run after migration
- **WHEN** the Biome-to-Oxc tooling migration is complete
- **THEN** dependency install, Oxc format checks, Oxc lint checks, build, and test commands complete successfully
