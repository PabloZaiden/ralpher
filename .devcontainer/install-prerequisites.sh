#!/usr/bin/env bash

set -e

# if bun is not installed, install it
if ! command -v bun &> /dev/null
then
    echo "Bun not found, installing..."
    
    curl -fsSL https://bun.com/install | bash

    # manual fix for missing package.json issue
    if [ ! -f "$HOME/.bun/install/global/package.json" ]; then
        echo "Creating missing package.json for bun global..."
        mkdir -p "$HOME/.bun/install/global"
        echo '{}' > "$HOME/.bun/install/global/package.json"
    fi


    # add bun to PATH
    export PATH="$HOME/.bun/bin:$PATH"
fi

# if there is no symlink for node, create it
if ! command -v node &> /dev/null
then
    # discover the bun binary location
    bunBinary=$(which bun)
    echo "Bun binary located at: $bunBinary"
    echo "Creating symlink for node to bun..."
    mkdir -p $HOME/.local/bin
    ln -sf "$bunBinary" "$HOME/.local/bin/node"
fi

export BUN_INSTALL_BIN=$HOME/.bun/bin
export BUN_INSTALL_GLOBAL_DIR=$HOME/.bun/global

# Ensure dirs exist and are owned by the current user
mkdir -p "$BUN_INSTALL_BIN" "$BUN_INSTALL_GLOBAL_DIR"
export PATH="$HOME/.bun/bin:$HOME/.bun/global/bin:${PATH}"

# add the paths to bashrc and zshrc
echo 'export PATH="$HOME/.bun/bin:$HOME/.bun/global/bin:${PATH}" ' >> $HOME/.bashrc
echo 'export PATH="$HOME/.bun/bin:$HOME/.bun/global/bin:${PATH}" '>> $HOME/.zshrc

# ensure $HOME/.local/bin is in PATH for current session and future shells
export PATH="$HOME/.local/bin:$PATH"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"

# install opencode
curl -fsSL https://opencode.ai/install | bash
