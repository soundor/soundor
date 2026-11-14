# npm trusted publishing

Use npm's official [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
command to configure all public workspace packages and the generated VST3 host
platform packages for `soundor/soundor`'s `release.yml` workflow and its
`npm-production` environment:

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
publishers first. A GitHub publisher for `soundor/soundor`, `release.yml`, the
`npm-production` environment, and direct publishing permission is skipped successfully.
If there are no publishers, it creates one. Conflicting publishers, inspection
failures, and unrecognized responses leave the package unchanged; the script
continues and exits unsuccessfully with the failed package names. Inspect those
with `npm trust list <package>` before deciding whether to revoke an obsolete
configuration yourself. Preview mode stays offline and only prints proposed
commands; it does not determine which packages already match.

Before releasing, create the `npm-production` environment in GitHub repository
Settings → Environments. Under deployment branches and tags, select only the
`main` branch. Required reviewers are optional if manual approval is desired.
The workflow's npm publishing job references this environment; the script grants
direct `npm publish` only for a publisher with the same environment name.

To migrate publishers created without an environment restriction, inspect them
with `npm trust list <package>` and remove the old unrestricted configuration
through npm's package settings or `npm trust revoke <package> --id <trust-id>`.
Then run `pnpm npm:trust --apply` (or pass individual package names). The script
reports an unrestricted publisher as a conflict and never revokes it itself.
Leaving an unrestricted publisher in place preserves that broader publishing path.

New trust configurations must complete their first publish within two days,
so run this near a release. This command only configures trust; it does not
publish packages or change token/2FA policies. Once OIDC publishing is verified,
remove the workflow's `NPM_TOKEN` references, revoke the token, and disallow
token-based publishing in each package's npm settings.
