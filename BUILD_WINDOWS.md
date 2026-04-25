# Windows launcher workflow

Windows users should run EXDA through the browser-first launcher:

```bat
Run-EXDA-WIN.bat
```

You can run it from File Explorer or a terminal.

The launcher checks for:

- `node`
- `npm`
- Python 3
- installed npm dependencies
- installed Python packages from `backend\requirements.txt`

If anything is missing, the launcher prints the missing items and stops gracefully.

For the full launcher-first workflow, see [RUN_EXDA.md](/Volumes/Sim_Back_Up/EXDA-dashboard/RUN_EXDA.md).

If you intentionally need a packaged desktop artifact instead, see [PACKAGING.md](/Volumes/Sim_Back_Up/EXDA-dashboard/PACKAGING.md).
