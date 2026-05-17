## ADDED Requirements

### Requirement: Major dependency refresh preserves manual build approvals

The workspace SHALL keep dependency build-script approval decisions under human control during the Vite 8 dependency refresh.

#### Scenario: Build approval is required during install

- **WHEN** pnpm reports new or changed dependency build scripts during the Vite 8 migration
- **THEN** implementation pauses for a human to review and run the appropriate approval workflow

#### Scenario: Build approvals are not auto-granted

- **WHEN** dependency metadata is updated for the Vite 8 migration
- **THEN** build-script approval state is not automatically granted without human review
