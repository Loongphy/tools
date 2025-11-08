# ~/.config/fish/conf.d/devtools.fish

# kill the process of the specified port
function kp
    set port $argv[1]
    lsof -i:$port | awk "NR==2{print $2}" | xargs kill -9
end

# git commands
alias main="git checkout main"
alias cl="git clone"
alias gp="git push"
alias gd="git branch | grep -v main | xargs git branch -D"
alias gpl="git pull --rebase"
alias gnoe="git commit --amend --reset-author --no-edit"
alias gc="git checkout"

function gda
    # Fetch latest branches
    git fetch --prune

    # Loop through all branches except 'main' and delete them
    for branch in (git branch | string replace '*' '' | string trim)
        if test $branch != "main"
            echo "Deleting branch: $branch"
            git branch -D $branch
        end
    end
end

alias py="python3"

# Check if the proxy is working
alias myip="curl ipinfo.io"

# require @antfu/ni npm
alias d="nr dev"

alias e="edit.exe"

function node-lts --description "Install and configure the latest Node.js LTS version"
    # Set color variables for output
    set -l green (set_color green)
    set -l red (set_color red)
    set -l blue (set_color blue)
    set -l normal (set_color normal)

    # Display welcome message
    echo $blue"🚀 Node.js LTS Installation Assistant"$normal
    echo "--------------------------------"

    # Check if fnm is installed
    if not command -v fnm >/dev/null
        echo $red"Error: fnm is not installed"$normal
        echo "Please install fnm first: https://github.com/Schniz/fnm#installation"
        echo "Recommended installation command:"
        echo "  curl -fsSL https://fnm.vercel.app/install | bash"
        return 1
    end

    echo $blue"✓ fnm is installed"$normal

    # Update fnm's remote version list
    echo "Updating available Node.js versions list..."
    if not fnm list-remote >/dev/null
        echo $red"Error: Unable to fetch remote version list, please check your network connection"$normal
        return 1
    end

    # Backup current version info (if exists)
    if command -v node >/dev/null
        set -l current_version (node --version)
        echo "Current Node.js version: $current_version"
        echo "Backing up current configuration..."
    end

    echo "Starting installation of latest Node.js LTS version..."
    
    # Install the latest LTS version
    if not fnm install --lts
        echo $red"Error: Failed to install Node.js LTS version"$normal
        return 1
    end

    # Get the latest installed version number
    set -l LATEST_VERSION (fnm list | string match -r 'v\d+\.\d+\.\d+' | tail -n 1 | string replace -a '*' '' | string trim)

    if test -z "$LATEST_VERSION"
        echo $red"Error: Unable to get the latest installed Node.js version"$normal
        return 1
    end

    echo $green"✓ Successfully installed Node.js $LATEST_VERSION"$normal

    echo "Configuring default version..."
    
    # Set as default version
    if not fnm default $LATEST_VERSION
        echo $red"Error: Unable to set default version"$normal
        return 1
    end

    # Use the new version
    if not fnm use $LATEST_VERSION
        echo $red"Error: Unable to switch to new version"$normal
        return 1
    end

    echo $green"✓ Successfully set $LATEST_VERSION as default version"$normal

    # Verify installation
    echo "Verifying installation:"
    echo "----------------------"
    echo "Node.js version: "(node --version)
    echo "npm version: "(npm --version)

    # Install @antfu/ni (Unified package manager runner)
    echo "Installing @antfu/ni..."
    if not npm install -g @antfu/ni@latest
        echo $red"Error: Failed to install @antfu/ni"$normal
        return 1
    end
    echo $green"✓ Successfully installed @antfu/ni"$normal

    # Install @openai/codex
    echo "Installing @openai/codex..."
    if not npm install -g @openai/codex@latest
        echo $red"Error: Failed to install @openai/codex"$normal
        return 1
    end
    echo $green"✓ Successfully installed @openai/codex"$normal
end