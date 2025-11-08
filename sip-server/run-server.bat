@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Avvio Server SIP
echo ========================================
echo.

REM Ottieni il percorso dello script (directory corrente)
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

echo [DEBUG] Script directory: %SCRIPT_DIR%
echo [DEBUG] Project root: %PROJECT_ROOT%
echo.

REM Percorsi relativi
set "SERVER_CFG=%SCRIPT_DIR%server.cfg"
set "TINYLOG_CFG=%SCRIPT_DIR%tinylog.properties"
set "SERVER_DIR=%PROJECT_ROOT%\mjSIP-2.0.5\mjsip-server"
set "LOG_DIR=%SCRIPT_DIR%log"

echo [DEBUG] Server config: %SERVER_CFG%
echo [DEBUG] Tinylog config: %TINYLOG_CFG%
echo [DEBUG] Server directory: %SERVER_DIR%
echo.

REM Verifica che i file di configurazione esistano
if not exist "%SERVER_CFG%" (
    echo ERRORE: File di configurazione non trovato: %SERVER_CFG%
    pause
    exit /b 1
)

if not exist "%TINYLOG_CFG%" (
    echo ERRORE: File tinylog.properties non trovato: %TINYLOG_CFG%
    pause
    exit /b 1
)

REM Verifica che la directory del server esista
if not exist "%SERVER_DIR%" (
    echo ERRORE: Directory del server non trovata: %SERVER_DIR%
    pause
    exit /b 1
)

REM Crea la cartella log se non esiste
if not exist "%LOG_DIR%" (
    echo [INFO] Creazione directory log: %LOG_DIR%
    mkdir "%LOG_DIR%"
)

REM Verifica che Java sia disponibile
where java >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Java non trovato nel PATH. Assicurati che Java sia installato e nel PATH.
    pause
    exit /b 1
)

echo [INFO] Java trovato:
java -version
echo.

REM Verifica che Maven sia disponibile
where mvn >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Maven non trovato nel PATH. Assicurati che Maven sia installato e nel PATH.
    pause
    exit /b 1
)

echo [INFO] Maven trovato:
mvn -version
echo.

REM Vai alla directory del server
echo [INFO] Cambio directory in: %SERVER_DIR%
cd /d "%SERVER_DIR%"
if errorlevel 1 (
    echo ERRORE: Impossibile cambiare directory
    pause
    exit /b 1
)

REM Verifica che il JAR esista
if not exist "target\mjsip-server-2.0.5.jar" (
    echo [WARN] JAR non trovato in target. Tentativo di compilazione...
    call mvn clean package -DskipTests
    if errorlevel 1 (
        echo ERRORE: Compilazione fallita
        pause
        exit /b 1
    )
)

echo [INFO] Costruzione classpath...
mvn -q -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile=%TEMP%\mjsip-server-cp.txt
if errorlevel 1 (
    echo ERRORE: Impossibile costruire il classpath con Maven
    pause
    exit /b 1
)

REM Leggi il classpath e aggiungi il JAR
set "CP="
for /f "usebackq delims=" %%a in ("%TEMP%\mjsip-server-cp.txt") do set "CP=%%a"
if "!CP!"=="" (
    echo ERRORE: Classpath vuoto
    pause
    exit /b 1
)

set "CP=!CP!;target\mjsip-server-2.0.5.jar"

echo [INFO] Classpath costruito (primi 200 caratteri):
echo !CP:~0,200!...
echo.

echo [INFO] Avvio del server...
echo.

REM Avvia il server
java -Dtinylog.configuration="%TINYLOG_CFG%" -cp "!CP!" org.mjsip.server.Proxy -f "%SERVER_CFG%"

set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 (
    echo.
    echo ERRORE: Il server e' terminato con codice di errore: %EXIT_CODE%
    pause
    exit /b %EXIT_CODE%
) else (
    echo.
    echo [INFO] Server terminato correttamente
)

pause

