@echo off
setlocal
title Desinstalar Delivery Pizzaria Print Agent
set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"

echo.
echo Desinstalando Delivery Pizzaria Print Agent...
taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "DeliveryPizzariaPrintAgent" /f >nul 2>nul
reg delete "HKCU\Software\DeliveryPizzaria\PrintAgent" /f >nul 2>nul
if exist "%TARGET%" rmdir /S /Q "%TARGET%"

echo.
echo Desinstalacao concluida.
pause
