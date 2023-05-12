#!/usr/bin/env fish

alias -s py="python3"
alias -s gnoe="git commit --amend --reset-author --no-edit"
alias -s dcu="docker compose pull && docker compose up -d --remove-orphans"

# git commands
alias gp='git push'
alias gpf='git push --force'
alias gpl='git pull --rebase'
alias gd="git branch -a | grep -v \"main\" | xargs git branch -D"

# proxy
function proxy
    set ip (grep nameserver /etc/resolv.conf | cut -d ' ' -f 2)
    export all_proxy=http://$ip:7890
    git config --global http.proxy http://$ip:7890
    git config --global https.proxy http://$ip:7890
end

# kill the process of the specified port
function kp
    set port $argv[1]
    lsof -i:$port | awk 'NR==2{print $2}' | xargs kill -9
end

# frontend
alias d="nr dev"