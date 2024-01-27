if status is-interactive
    # Commands to run in interactive sessions can go here
end
set PATH $HOME/.cargo/bin $PATH

# proxy
function proxy
    set ip (grep nameserver /etc/resolv.conf | cut -d " " -f 2)
    export all_proxy=http://$ip:7890
    git config --global http.proxy http://$ip:7890
    git config --global https.proxy http://$ip:7890
end

# kill the process of the specified port
function kp
    set port $argv[1]
    lsof -i:$port | awk "NR==2{print $2}" | xargs kill -9
end

alias py="python3"

# git commands
alias main="git checkout main"
alias cl="git clone"
alias gp="git push"
alias gd="git branch | grep -v main | xargs git branch -D"
alias gpf="git push --force"
alias gpl="git pull --rebase"
alias gnoe="git commit --amend --reset-author --no-edit"
alias gc="git checkout"
alias myip="curl ipinfo.io"

# Node.js @antfu/ni
alias d="nr dev"
alias lo="nr local"
