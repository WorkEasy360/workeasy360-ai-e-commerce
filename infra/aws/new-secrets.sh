#!/usr/bin/env bash
# Prints fresh random values for the GENERATE fields of infra/aws/env.example.
# Run it once, on any machine with openssl, and paste the values into the
# settings secret. Database passwords are hex, so they need no URL escaping.
set -euo pipefail
hex() { openssl rand -hex "$1"; }
echo "wec_owner password:  $(hex 24)"
echo "wec_api password:    $(hex 24)"
echo "wec_worker password: $(hex 24)"
echo "wec_public password: $(hex 24)"
echo "SESSION_SECRET=$(hex 32)"
echo "SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)"
