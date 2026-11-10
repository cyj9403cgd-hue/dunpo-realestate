@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 내집멘토부동산 둔포 대시보드 서버를 시작합니다...
start "" http://localhost:8787
node server.mjs
pause
