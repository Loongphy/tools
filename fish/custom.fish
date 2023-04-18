#!/usr/bin/env fish
alias -s py="python3"
alias -s gnoe="git commit --amend --reset-author --no-edit"
alias -s dcu="docker compose pull && docker compose up -d --remove-orphans"
alias -s gf="git push -f"
alias -s gd="git branch -r | grep -v \"main\" | xargs -n 1 git branch -D"

# 杀死运行在指定端口的程序
function kp
    set port $argv[1]
    lsof -i:$port | awk 'NR==2{print $2}' | xargs kill -9
end