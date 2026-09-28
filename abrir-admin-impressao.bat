@echo off
set "URL=https://guiasysstudio.github.io/Delivery-Pizzaria/admin/"
start "" msedge.exe --kiosk-printing "%URL%"
if errorlevel 1 start "" chrome.exe --kiosk-printing "%URL%"
