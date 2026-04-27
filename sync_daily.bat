@echo off
setlocal
cd /d "C:\Users\Claudio De Giglio\OneDrive\Desktop\DASHBOARD CS"
set LOG=sync_daily.log

echo. >> %LOG%
echo ============================================ >> %LOG%
echo [%date% %time%] Avvio sync giacenze strumenti >> %LOG%
echo ============================================ >> %LOG%

python "C:\Users\Claudio De Giglio\OneDrive\Desktop\OSSEOTOUCH AI\cereda\sync_giacenze_strumenti.py" >> %LOG% 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERRORE: script Python fallito >> %LOG%
    exit /b 1
)

git add data/giacenze_strumenti.json >> %LOG% 2>&1
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Giacenze strumenti: sync automatico %date% %time%" >> %LOG% 2>&1
    git push >> %LOG% 2>&1
    if errorlevel 1 (
        echo [%date% %time%] ERRORE: git push fallito >> %LOG%
        exit /b 2
    )
    echo [%date% %time%] OK push completato >> %LOG%
) else (
    echo [%date% %time%] Nessun cambiamento da pushare >> %LOG%
)

echo [%date% %time%] Fine >> %LOG%
endlocal
