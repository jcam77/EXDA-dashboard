# BASHRC_SETUP.md

## Auto-activate Python Virtual Environment for EXDA-dashboard

This guide helps you set up your `~/.bashrc` so that the `.venv` for this project is automatically activated whenever you enter the EXDA-dashboard directory in a new terminal.

---

## 1. Open your `~/.bashrc`

You can use your preferred editor:

- With nano:
  ```bash
  nano ~/.bashrc
  ```
- With VS Code:
  ```bash
  code ~/.bashrc
  ```

---

## 2. Add the following snippet at the end of your `~/.bashrc`

```
# >>> EXDA-dashboard auto-activate venv >>>
exda_dir="/media/psf/Sim_Back_Up/EXDA-dashboard"
venv_dir="$exda_dir/.venv"

if [[ "$PWD" == "$exda_dir"* ]] && [ -d "$venv_dir" ] && [ -z "$VIRTUAL_ENV" ]; then
    source "$venv_dir/bin/activate"
fi
# <<< EXDA-dashboard auto-activate venv <<<
```

- This will auto-activate the `.venv` whenever you `cd` into the EXDA-dashboard directory or any of its subfolders.
- If you rename or move the project, update the `exda_dir` path accordingly.

---

## 3. Save and Reload

- Save the file and either restart your terminal or run:
  ```bash
  source ~/.bashrc
  ```

---

## 4. Test

- Open a new terminal and `cd` into your project directory:
  ```bash
  cd /media/psf/Sim_Back_Up/EXDA-dashboard
  ```
- The prompt should indicate that the `.venv` is activated (usually by showing the environment name).

---

## 5. Notes

- This setup is safe: it only activates the venv if you are in the project directory (or subfolders), the `.venv` exists, and no other venv is active.
- If you have other auto-activation logic in your `~/.bashrc`, ensure there are no conflicts.
- To deactivate, simply run `deactivate` or leave the project directory.

---

## 6. Troubleshooting

- If the venv does not activate, check:
  - The path in `exda_dir` matches your project location.
  - The `.venv` folder exists and is valid.
  - There are no typos in the snippet.

---

## 7. Uninstall

- To remove this feature, simply delete or comment out the snippet from your `~/.bashrc`.

---

**For more details, see the main README.md.**
