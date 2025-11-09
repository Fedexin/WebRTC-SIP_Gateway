#!/bin/bash
set -euo pipefail

CLIENT_CFG="/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/sip-client/client1.cfg"
TINYLOG_CFG="/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/sip-client/tinylog.properties"

cd "/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/mjSIP-2.0.5/mjsip-examples"

# Classpath runtime per gli examples (include tinylog runtime già dichiarati)
mvn -q -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile=/tmp/mjsip-examples-cp.txt
CP=$(cat /tmp/mjsip-examples-cp.txt):target/mjsip-examples-2.0.5.jar

mkdir -p "/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/sip-client/log"

# Se passi un argomento, viene usato come URI per chiamare automaticamente
# Esempio: ./run-client1.sh "sip:client2@192.168.1.212"
CALL_TO="${1:-}"

if [ -n "$CALL_TO" ]; then
  exec java -Dtinylog.configuration="$TINYLOG_CFG" -cp "$CP" org.mjsip.examples.UserAgentCli \
    -f "$CLIENT_CFG" --call-to "$CALL_TO"
else
  exec java -Dtinylog.configuration="$TINYLOG_CFG" -cp "$CP" org.mjsip.examples.UserAgentCli \
    -f "$CLIENT_CFG"
fi

