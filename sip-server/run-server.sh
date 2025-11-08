#!/bin/bash
set -euo pipefail

SERVER_CFG="/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/sip-server/server.cfg"
TINYLOG_CFG="/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/sip-server/tinylog.properties"

cd "/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/mjSIP-2.0.5/mjsip-server"

# Costruisci il classpath runtime (include provider SLF4J dichiarati in pom)
mvn -q -DincludeScope=runtime dependency:build-classpath -Dmdep.outputFile=/tmp/mjsip-server-cp.txt
CP=$(cat /tmp/mjsip-server-cp.txt):target/mjsip-server-2.0.5.jar

# Assicura la cartella log
mkdir -p "/Users/fede/Documents/Scuola/UniPr/Tirocinio/WebRTC-SIP_Gateway/sip-server/log"

exec java -Dtinylog.configuration="$TINYLOG_CFG" -cp "$CP" org.mjsip.server.Proxy \
  -f "$SERVER_CFG"