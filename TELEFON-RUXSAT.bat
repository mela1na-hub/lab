@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Telefon uchun Windows ruxsati kerak. Yes ni bosing.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="TTATI Lab 3000" >nul 2>&1
netsh advfirewall firewall add rule name="TTATI Lab 3000" dir=in action=allow protocol=TCP localport=3000
echo.
echo Tayyor. Endi SAYT-LINK.txt yoki http://PC-IP:3000/ ni oching.
echo Kompyuter va telefon BIR XIL Wi-Fi da bolsin (mobil internet emas).
echo Production uchun HTTPS va PUBLIC_URL kerak. docs\DEPLOY.md
echo.
pause
