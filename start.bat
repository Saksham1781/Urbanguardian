@echo off
title Urban Guardians Startup
echo.
echo  === Urban Guardians Startup ===
echo.

echo  Stopping old processes...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo  Starting AI Service  (port 8003)...
start "AI Service :8003" cmd /k "cd /d E:\vizilare\urban-gaurdian\services\ai-service && python -m uvicorn app.main:app --host 0.0.0.0 --port 8003 --reload"

echo  Starting Backend     (port 5001)...
start "Backend :5001" cmd /k "cd /d E:\vizilare\urban-gaurdian\services\backend && node src/server.js"

echo  Starting Frontend    (port 3000)...
start "Frontend :3000" cmd /k "cd /d E:\vizilare\urban-gaurdian\apps\web && npm run dev"

echo.
echo  Done! Wait for "Ready" in Frontend window then open:
echo  http://localhost:3000
echo.
pause
