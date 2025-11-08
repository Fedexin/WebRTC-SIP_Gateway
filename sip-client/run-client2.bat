@echo off
setlocal enabledelayedexpansion

REM Assicura che siamo nella directory corretta
cd /d "%~dp0\..\mjSIP-2.0.5\mjsip-examples"

REM Path assoluti (adatta se necessario)
set CLIENT_CFG=%~dp0client2.cfg
set TINYLOG_CFG=%~dp0tinylog.properties
set LOG_DIR=%~dp0log

REM Costruisci il classpath runtime
mvn -q -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile=%TEMP%\mjsip-examples-cp.txt
if errorlevel 1 (
    echo Errore nella generazione del classpath
    exit /b 1
)

REM Leggi il classpath e aggiungi il jar degli examples
set /p CP=<%TEMP%\mjsip-examples-cp.txt
set CP=!CP!;target\mjsip-examples-2.0.5.jar

REM Crea la cartella log se non esiste
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Avvia il client
java -Dtinylog.configuration="%TINYLOG_CFG%" -cp "!CP!" org.mjsip.examples.UserAgentCli -f "%CLIENT_CFG%"

endlocal

