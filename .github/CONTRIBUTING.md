# Contributing to EXDA

Thank you for helping. EXDA is a small research tool, maintained by one person,
so the process is light.

## Ways to help

- **Report a bug or a missing feature:** open an issue with the
  [issue forms](https://github.com/jcam77/EXDA-dashboard/issues/new/choose). They
  ask for what we need (EXDA version, operating system, steps, screenshot).
- **Report a security problem:** never in a public issue; see
  [SECURITY.md](SECURITY.md).
- **Change code or documentation:** open a pull request; please discuss larger
  changes in an issue first.

All contact goes through GitHub; there is no public email address.

## Never commit

- **Project or experiment data** (anything from `EXDA-Projects`, raw DAQ files,
  plans of real campaigns). The repository is public. Use the synthetic demo
  projects instead (`docs/EXDA-User-Guide/tools/make_demo_project.py`).
- Python environments (`.venv`, `.venv-mac`, `.venv-win`), `node_modules`,
  shortcuts (`EXDA.lnk`) or local settings.

## Set up and check

Install and start EXDA as described in [RUN_EXDA.md](../RUN_EXDA.md). Before a
pull request, run from the repository root:

```bash
python3 -m unittest discover -s backend/tests      # backend tests
npx vitest run --config frontend/vitest.config.js  # frontend tests
npx eslint --config frontend/eslint.config.js frontend
```

All three must pass. Add tests for new behaviour, especially for anything that
calculates, reads files or saves data.

## Rules that matter most

- **Recorded data is never changed** by the app, and nothing is guessed: no
  silent default values, no unit guessing (see the design rules in the
  [Developer Overview](../docs/EXDA-Developer-Overview/EXDA-Developer-Overview.md)).
- **Saving is safe:** every save keeps the previous version in `History/`; keep
  it that way.
- **Look and feel:** follow the [design guide](../docs/EXDA-Design-Guide.md):
  theme tokens only (no fixed colours), 11 px minimum text, and a screenshot of
  changed screens in both light and dark themes in the pull request.
- **Windows, macOS and Linux:** paths can use `/` or `\`; test with both.
- **Documentation:** update the [user guide](../docs/EXDA-User-Guide/EXDA-UserGuide.md)
  when a screen or workflow changes.

## Releases

Releases are made by the maintainer with `./versioning.sh` (see
[VERSIONING.md](../VERSIONING.md)); please do not change version numbers in a
pull request.

## AI-assisted development

EXDA is developed with the help of AI coding tools (see the README). AI-assisted
contributions are welcome under the same rules: you are responsible for every
line, it must pass the checks, and you should say in the pull request that AI
tools were used.

## Code of conduct

Please follow the [code of conduct](CODE_OF_CONDUCT.md).
