@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Avvio Client SIP 1
echo ========================================
echo.

REM Ottieni il percorso dello script (directory corrente)
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

echo [DEBUG] Script directory: %SCRIPT_DIR%
echo [DEBUG] Project root: %PROJECT_ROOT%
echo.

REM Percorsi relativi
set "CLIENT_CFG=%SCRIPT_DIR%client1.cfg"
set "TINYLOG_CFG=%SCRIPT_DIR%tinylog.properties"
set "EXAMPLES_DIR=%PROJECT_ROOT%\mjSIP-2.0.5\mjsip-examples"
set "LOG_DIR=%SCRIPT_DIR%log"

echo [DEBUG] Client config: %CLIENT_CFG%
echo [DEBUG] Tinylog config: %TINYLOG_CFG%
echo [DEBUG] Examples directory: %EXAMPLES_DIR%
echo.

REM Verifica che i file di configurazione esistano
if not exist "%CLIENT_CFG%" (
    echo ERRORE: File di configurazione non trovato: %CLIENT_CFG%
    pause
    exit /b 1
)

if not exist "%TINYLOG_CFG%" (
    echo ERRORE: File tinylog.properties non trovato: %TINYLOG_CFG%
    pause
    exit /b 1
)

REM Verifica che la directory degli examples esista
if not exist "%EXAMPLES_DIR%" (
    echo ERRORE: Directory degli examples non trovata: %EXAMPLES_DIR%
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

REM Vai alla directory degli examples
echo [INFO] Cambio directory in: %EXAMPLES_DIR%
cd /d "%EXAMPLES_DIR%"
if errorlevel 1 (
    echo ERRORE: Impossibile cambiare directory
    pause
    exit /b 1
)

echo [DEBUG] Directory corrente: %CD%
echo.

REM Verifica che il pom.xml esista
if not exist "pom.xml" (
    echo ERRORE: pom.xml non trovato nella directory: %EXAMPLES_DIR%
    pause
    exit /b 1
)

echo [DEBUG] pom.xml trovato

REM Verifica che il JAR esista
if not exist "target\mjsip-examples-2.0.5.jar" (
    echo [WARN] JAR non trovato in target. Tentativo di compilazione...
    call mvn clean package -DskipTests
    if errorlevel 1 (
        echo ERRORE: Compilazione fallita
        pause
        exit /b 1
    )
)

echo [INFO] Costruzione classpath...
set "TEMP_FILE=%TEMP%\mjsip-examples-cp.txt"
echo [DEBUG] File temporaneo: %TEMP_FILE%

REM Rimuovi il file temporaneo se esiste già
if exist "%TEMP_FILE%" del "%TEMP_FILE%"

echo [DEBUG] Esecuzione comando Maven...
echo [DEBUG] Comando: mvn -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile="%TEMP_FILE%"
mvn -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile="%TEMP_FILE%" 2>&1
set "MVN_EXIT=%ERRORLEVEL%"
echo [DEBUG] Maven exit code: %MVN_EXIT%

if %MVN_EXIT% neq 0 (
    echo.
    echo ERRORE: Impossibile costruire il classpath con Maven (exit code: %MVN_EXIT%)
    echo [DEBUG] Verifica che il progetto sia stato compilato con: mvn clean install
    pause
    exit /b 1
)

REM Verifica che il file sia stato creato
if not exist "%TEMP_FILE%" (
    echo ERRORE: File classpath non creato: %TEMP_FILE%
    pause
    exit /b 1
)

echo [DEBUG] File classpath creato, dimensione:
for %%A in ("%TEMP_FILE%") do echo   %%~zA bytes

REM Leggi il classpath e aggiungi il JAR
echo [DEBUG] Lettura classpath dal file...
set "CP="
set "FILE_READ=0"
for /f "usebackq delims=" %%a in ("%TEMP_FILE%") do (
    set "CP=%%a"
    set "FILE_READ=1"
    echo [DEBUG] Riga letta dal file
    if "!CP!" neq "" (
        echo [DEBUG] Classpath letto (primi 100 caratteri): !CP:~0,100!...
    ) else (
        echo [DEBUG] ATTENZIONE: Riga letta ma vuota
    )
)

if %FILE_READ%==0 (
    echo ERRORE: Impossibile leggere il file classpath
    echo [DEBUG] Contenuto del file:
    type "%TEMP_FILE%"
    pause
    exit /b 1
)

if "!CP!"=="" (
    echo ERRORE: Classpath vuoto dopo la lettura
    echo [DEBUG] Contenuto del file:
    type "%TEMP_FILE%"
    pause
    exit /b 1
)

set "CP=!CP!;target\mjsip-examples-2.0.5.jar"

echo [INFO] Classpath costruito (primi 200 caratteri):
echo !CP:~0,200!...
echo.

REM Verifica che il JAR esista nel classpath
if not exist "target\mjsip-examples-2.0.5.jar" (
    echo ERRORE: JAR non trovato: target\mjsip-examples-2.0.5.jar
    pause
    exit /b 1
)

echo [DEBUG] Verifica file di configurazione...
if not exist "%CLIENT_CFG%" (
    echo ERRORE: File di configurazione non trovato: %CLIENT_CFG%
    pause
    exit /b 1
)

if not exist "%TINYLOG_CFG%" (
    echo ERRORE: File tinylog.properties non trovato: %TINYLOG_CFG%
    pause
    exit /b 1
)

echo [INFO] Tutti i controlli superati. Avvio del client...
echo [DEBUG] Comando Java:
echo   java -Dtinylog.configuration="%TINYLOG_CFG%" -cp "!CP!" org.mjsip.examples.UserAgentCli -f "%CLIENT_CFG%"
echo.

REM Avvia il client
java -Dtinylog.configuration="%TINYLOG_CFG%" -cp "!CP!" org.mjsip.examples.UserAgentCli -f "%CLIENT_CFG%"

set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 (
    echo.
    echo ERRORE: Il client e' terminato con codice di errore: %EXIT_CODE%
    pause
    exit /b %EXIT_CODE%
) else (
    echo.
    echo [INFO] Client terminato correttamente
)

pause

