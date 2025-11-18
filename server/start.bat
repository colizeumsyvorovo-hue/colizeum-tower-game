@echo off
echo Starting Colizeum Tower Game Server...
echo.

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting server...
node server.js

pause



