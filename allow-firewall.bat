@echo off
chcp 65001 >nul
cd /d "%~dp0"
if "%PORT%"=="" set PORT=5000

net session >nul 2>&1
if errorlevel 1 (
  echo Нужны права администратора, сейчас Windows спросит разрешение...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="DnD Toolkit" >nul 2>&1
netsh advfirewall firewall add rule name="DnD Toolkit" dir=in action=allow protocol=TCP localport=%PORT% profile=any
if errorlevel 1 goto failed
echo.
echo Готово: брандмауэр Windows пропускает друзей на порт %PORT%.
pause
exit /b 0

:failed
echo Не удалось добавить правило брандмауэра.
pause
exit /b 1
