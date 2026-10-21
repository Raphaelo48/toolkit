@echo off
chcp 65001 >nul
title D^&D Toolkit - сервер
cd /d "%~dp0"
if "%PORT%"=="" set PORT=5000

where node >nul 2>nul
if errorlevel 1 goto no_node

if exist "backend\node_modules\" goto run
echo Первый запуск: устанавливаю нужные библиотеки, это займёт минуту...
pushd backend
call npm install --omit=dev --no-audit --no-fund
popd
if not exist "backend\node_modules\" goto npm_failed

:run
echo.
echo Сервер запускается. Это окно не закрывайте, пока идёт игра.
echo Чтобы остановить сервер, закройте окно или нажмите Ctrl+C.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"
cd backend
node src\server.js
echo.
echo Сервер остановлен.
pause
exit /b 0

:no_node
echo Не найден Node.js. Сейчас откроется сайт nodejs.org:
echo скачайте версию LTS, установите её и снова запустите этот файл.
start "" https://nodejs.org/
pause
exit /b 1

:npm_failed
echo Не удалось установить библиотеки. Проверьте интернет и запустите файл ещё раз.
pause
exit /b 1
