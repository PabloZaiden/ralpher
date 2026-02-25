#!/usr/bin/env bash

set -e

# install opencode
curl -fsSL https://opencode.ai/install | bash

# install copilot-cli
curl -fsSL https://gh.io/copilot-install | bash

# install sshpass
apt-get update && apt-get install -y sshpass

