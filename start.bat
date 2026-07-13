@echo off
cd /d "%~dp0"
echo Iniciando o validador de Duel Commander 500...
start "Validador DC500 - nao feche esta janela" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:5173/
