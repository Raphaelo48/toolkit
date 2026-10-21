@echo off
chcp 65001 >nul
title D^&D Toolkit - туннель Cloudflare
cd /d "%~dp0"
if "%PORT%"=="" set PORT=5000

if exist "tools\cloudflared.exe" goto run
echo Скачиваю cloudflared (один раз, около 20 МБ)...
if not exist tools mkdir tools
curl -L --fail -o "tools\cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
if errorlevel 1 goto download_failed

:run
echo.
echo Сначала должен быть запущен start-game.bat.
echo Через несколько секунд ниже появится адрес вида https://....trycloudflare.com
echo Отправьте его друзьям. Адрес меняется при каждом запуске туннеля.
echo Если у друзей сайт не открывается или открывается частично, используйте Radmin VPN - см. README.md
echo.
"tools\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:%PORT%
pause
exit /b 0

:download_failed
echo Не удалось скачать cloudflared. Скачайте вручную файл cloudflared-windows-amd64.exe:
echo https://github.com/cloudflare/cloudflared/releases/latest
echo переименуйте в cloudflared.exe и положите в папку tools рядом с этим файлом.
pause
exit /b 1
