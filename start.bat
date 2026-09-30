@echo off
REM Double-click to start CraftLanee on this computer.
cd /d "%~dp0"
if not exist .venv (
  echo Setting up Python for the first time...
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install -r requirements.txt
)
if not exist frontend\dist\index.html (
  echo Building the React interface for the first time ^(needs Node.js^)...
  pushd frontend
  call npm install
  call npm run build
  popd
)
start "" http://127.0.0.1:8080
.venv\Scripts\python.exe serve.py
