# Security policy

## Reporting a vulnerability

Please **do not report security problems in a public issue.**

Use GitHub's private reporting instead: open the repository's **Security** tab
and click **Report a vulnerability**
(<https://github.com/jcam77/EXDA-dashboard/security/advisories/new>). Only the
maintainer sees the report. Please describe what you found, how to reproduce
it, and which EXDA version you used (shown at the bottom of the Home page).

You will get an answer through the same report on GitHub. There is no public
email address for EXDA; all contact goes through GitHub.

## Supported versions

Only the latest release on the `main` branch receives fixes. Please update
(`git pull` in the app folder, or download the latest ZIP) before reporting.

## Scope

EXDA is a local app: by default its backend listens on `127.0.0.1` (this
computer only; see `config/exda-defaults.env`), and it reads and writes project folders on your disk. Relevant reports include,
for example, ways to read or write files outside the selected project folders,
to reach the backend from another computer, or to run code through a project
file. Problems in third-party packages should also be reported to those
projects.
