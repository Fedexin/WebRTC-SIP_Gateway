@echo off
setlocal enabledelayedexpansion

REM Assicura che siamo nella directory corretta
cd /d "%~dp0\..\mjSIP-2.0.5\mjsip-server"

REM Path assoluti (adatta se necessario)
set SERVER_CFG=%~dp0server.cfg
set TINYLOG_CFG=%~dp0tinylog.properties
set LOG_DIR=%~dp0log

REM Costruisci il classpath runtime
mvn -q -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile=%TEMP%\mjsip-server-cp.txt
if errorlevel 1 (
    echo Errore nella generazione del classpath
    exit /b 1
)

REM Leggi il classpath e aggiungi il jar del server
set /p CP=<%TEMP%\mjsip-server-cp.txt
set CP=!CP!;target\mjsip-server-2.0.5.jar

REM Crea la cartella log se non esiste
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Avvia il server
java -Dtinylog.configuration="%TINYLOG_CFG%" -cp "!CP!" org.mjsip.server.Proxy -f "%SERVER_CFG%"

endlocal

