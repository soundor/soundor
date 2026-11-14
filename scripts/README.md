# npm trusted publishing

Use npm's official [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
command to configure all public workspace packages and the generated VST3 host
platform packages for `soundor/soundor`'s `release.yml` workflow:

```sh
pnpm npm:trust                       # preview; no npm requests
pnpm npm:trust --apply               # configure every package
pnpm npm:trust --apply @soundor/react # configure one package, e.g. for a retry
```

Run locally with npm >=11.15.0, after `npm login`, using an account with package
write access and 2FA enabled. npm handles authentication and the 2FA prompt;
the script does not collect credentials. npm offers a five-minute 2FA skip
window for bulk configuration. Calls are spaced two seconds apart.

Packages must already exist on npm. In apply mode the script inspects existing
publishers first. A GitHub publisher for `soundor/soundor`, `release.yml`, no
environment restriction, and direct publishing permission is skipped successfully.
If there are no publishers, it creates one. Conflicting publishers, inspection
failures, and unrecognized responses leave the package unchanged; the script
continues and exits unsuccessfully with the failed package names. Inspect those
with `npm trust list <package>` before deciding whether to revoke an obsolete
configuration yourself. Preview mode stays offline and only prints proposed
commands; it does not determine which packages already match.

The script grants direct `npm publish`, as used by the current release workflow,
with no GitHub environment restriction. If you add an environment to the workflow,
also add the matching `--environment` option to the script before configuring npm.
New trust configurations must complete their first publish within two days,
so run this near a release. This command only configures trust; it does not
publish packages or change token/2FA policies. Once OIDC publishing is verified,
remove the workflow's `NPM_TOKEN` references, revoke the token, and disallow
token-based publishing in each package's npm settings.
