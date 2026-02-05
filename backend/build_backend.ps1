# Build a Windows backend executable for Electron packaging.
# Run this from EXDA-dashboard-v0.3 on a Windows machine.

python -m pip install --upgrade pip pyinstaller
python -m pip install -r requirements.txt

python -m PyInstaller --noconfirm --onefile --name exda-backend `
  --add-data "routes;routes" `
  --add-data "modules;modules" `
  app.py

# Output: backend/dist/exda-backend.exe
