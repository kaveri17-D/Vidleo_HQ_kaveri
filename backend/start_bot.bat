@echo off
title NEXUS Discord Bot Terminal
color 0B
echo ===================================================
echo [!] STARTING NEXUS DISCORD BOT INTEGRATION
echo ===================================================
cd /d "%~dp0.."
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
if exist ".venv\Scripts\python.exe" (
    .venv\Scripts\python.exe -m backend.bots.discord_bot
) else (
    python -m backend.bots.discord_bot
)
pause
