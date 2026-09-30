@echo off
set "URL=https://pizzaria.guiasys.online/admin/"
start "" msedge.exe "%URL%"
if errorlevel 1 start "" chrome.exe "%URL%"
