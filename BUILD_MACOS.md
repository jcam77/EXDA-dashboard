# macOS launcher workflow

macOS users should run EXDA through the browser-first launcher:

```bash
chmod +x ./Run-EXDA-MAC.command
./Run-EXDA-MAC.command
```

You can also double-click `Run-EXDA-MAC.command` in Finder.

The launcher checks for:

- `node`
- `npm`
- `python3` or `python`
- installed npm dependencies
- installed Python packages from `backend/requirements.txt`

If anything is missing, the launcher prints the missing items and stops gracefully.

For the full launcher-first workflow, see [RUN_EXDA.md](/Volumes/Sim_Back_Up/EXDA-dashboard/RUN_EXDA.md).

If you intentionally need a packaged desktop artifact instead, see [PACKAGING.md](/Volumes/Sim_Back_Up/EXDA-dashboard/PACKAGING.md).
