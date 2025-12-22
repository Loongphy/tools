# ~/.config/fish/conf.d/devtools.fish
# git commands
alias main="git checkout main"
alias cl="git clone"
alias gp="git push"
alias gd="git branch | grep -v main | xargs git branch -D"
alias gpl="git pull --rebase"
alias gnoe="git commit --amend --reset-author --no-edit"
alias gc="git checkout"

alias py="python3"

# Check if the proxy is working
alias myip="curl ipinfo.io"

# require @antfu/ni npm
alias d="nr dev"

alias e="edit.exe"

alias codex-update "npm install -g @openai/codex@latest"
alias gemini-update "npm install -g @google/gemini-cli@latest"


# ~/.config/fish/functions/codex-install.fish
function codex-install --description 'Install OpenAI Codex CLI (Linux only: Stable via NPM or Pre-release via GitHub)'
    # ---- 平台限制 ----
    set -l os_name (uname -s | string lower)
    if test "$os_name" != "linux"
        echo "❌ 此脚本仅支持 Linux 平台"
        return 1
    end

    # ---- 参数解析 ----
    set -l mode "latest"
    for a in $argv
        switch $a
            case --pre
                if test "$mode" = "pre"
                    echo "错误: 重复指定参数"
                    return 2
                end
                set mode "pre"
            case --latest
                if test "$mode" = "pre"
                    echo "错误: --latest 与 --pre 互斥"
                    return 2
                end
                set mode "latest"
            case '*'
                echo "未知参数: $a"
                echo "用法: codex-install [--latest|--pre]"
                return 2
        end
    end

    # ---- 依赖检查 ----
    if not command -sq curl
        echo "错误: 需要安装 curl"
        return 1
    end

    if not command -sq jq
        echo "⚠️  建议安装 jq 以便更精准地解析版本信息"
    end

    # =========================================================================
    # 模式 A: Stable (NPM)
    # =========================================================================
    if test "$mode" = "latest"
        if not command -sq npm
            echo "错误: --latest 模式需要安装 Node.js 和 npm"
            return 1
        end

        echo "正在检查 npm registry 上的最新版本..."

        set -l remote_version (npm view @openai/codex dist-tags.latest 2>/dev/null | string trim)
        if test $status -ne 0 -o -z "$remote_version"
            echo "❌ 无法获取 npm 版本信息"
            return 1
        end

        # 读取本地 NPM 安装版本（避免受 --pre 影响）
        set -l local_version ""
        set -l npm_list_out (npm list -g --depth=0 @openai/codex 2>/dev/null)
        if test $status -eq 0
            set local_version (string match -r '@openai/codex@[^ ]+' -- $npm_list_out | head -n1 | string replace -r '.*@openai/codex@' '')
        end

        if test -n "$local_version"
            if test "$local_version" = "$remote_version"
                echo "✅ 无更新，当前已是最新版本: v$local_version"
                return 0
            else
                echo "发现新版本: v$local_version -> v$remote_version"
            end
        else
            echo "将安装最新版本: v$remote_version"
        end

        echo "正在执行: npm install -g @openai/codex@latest"
        npm install -g @openai/codex@latest
        if test $status -ne 0
            echo "❌ 安装失败"
            return 1
        end

        set -l installed_version ""
        set -l npm_list_after (npm list -g --depth=0 @openai/codex 2>/dev/null)
        if test $status -eq 0
            set installed_version (string match -r '@openai/codex@[^ ]+' -- $npm_list_after | head -n1 | string replace -r '.*@openai/codex@' '')
        end
        if test -z "$installed_version"
            set installed_version "$remote_version"
        end

        echo "✅ 更新成功: v$installed_version"
        echo "Release URL: https://github.com/openai/codex/releases/tag/rust-v$installed_version"
    end

    # =========================================================================
    # 模式 B: Pre-release (GitHub Binary)
    # =========================================================================
    if test "$mode" = "pre"
        if not command -sq jq
            echo "错误: --pre 模式需要安装 jq 以解析 GitHub Release"
            return 1
        end
        if not command -sq tar
            echo "错误: --pre 模式需要安装 tar"
            return 1
        end

        # 1. 系统/架构探测 (仅限 Linux)
        set -l arch_name (uname -m)
        set -l libc_type "gnu"

        switch $arch_name
            case x86_64 amd64
                set arch_name "x86_64"
            case arm64 aarch64
                set arch_name "aarch64"
            case '*'
                echo "❌ 不支持的架构: $arch_name"
                return 1
        end

        if command -sq ldd
            if ldd --version 2>&1 | string match -qi '*musl*'
                set libc_type "musl"
            end
        end

        set -l target_tuple "$arch_name-unknown-linux-$libc_type"
        set -l asset_name "codex-$target_tuple.tar.gz"

        # 2. 获取 GitHub Releases 信息
        echo "正在获取 GitHub Pre-release 信息..."
        set -l api_url "https://api.github.com/repos/openai/codex/releases?per_page=20"

        set -l curl_args -sL
        if set -q GITHUB_TOKEN
            set -a curl_args -H "Authorization: Bearer $GITHUB_TOKEN"
        end
        set -a curl_args -H "Accept: application/vnd.github+json"

        set -l json_resp (curl $curl_args "$api_url")
        if test -z "$json_resp"
            echo "❌ 无法连接 GitHub API"
            return 1
        end

        # 3. 解析最新的 Pre-release
        set -l pre_release (echo $json_resp | jq -c '[.[] | select(.prerelease==true)][0]')
        if test -z "$pre_release" -o "$pre_release" = "null"
            echo "❌ 未找到任何 Pre-release 版本"
            return 1
        end

        set -l tag_name (echo $pre_release | jq -r '.tag_name')
        set -l download_url (echo $pre_release | jq -r --arg name "$asset_name" '.assets[] | select(.name == $name) | .browser_download_url')
        set -l asset_digest (echo $pre_release | jq -r --arg name "$asset_name" '.assets[] | select(.name == $name) | .digest // empty')

        if test -z "$download_url"
            echo "❌ 未找到适配平台 ($asset_name) 的预发布安装包"
            return 1
        end

        set -l version_clean (echo $tag_name | string replace "rust-v" "")
        echo "📥 发现版本: $tag_name (v$version_clean)"
        echo "下载地址: $download_url"

        # 4. 下载
        set -l tmp_dir (mktemp -d)
        set -l archive_file "$tmp_dir/$asset_name"

        curl -sL "$download_url" -o "$archive_file"
        if test $status -ne 0
            echo "❌ 下载失败"
            rm -rf $tmp_dir
            return 1
        end

        # 5. SHA256 校验（如果 release asset 提供 digest）
        set -l checksum ""
        if test -n "$asset_digest"
            set checksum (string replace -r '^sha256:' '' -- $asset_digest)
        end

        if test -n "$checksum"
            if not command -sq sha256sum
                echo "⚠️  找到 SHA256 校验值，但未安装 sha256sum，跳过校验"
            else
                echo "正在校验 SHA256..."
                set -l actual (sha256sum "$archive_file" | string split -f1 ' ')
                if test "$actual" != "$checksum"
                    echo "❌ SHA256 校验失败"
                    rm -rf $tmp_dir
                    return 1
                end
                echo "✅ SHA256 校验通过"
            end
        else
            echo "⚠️  未找到 $asset_name 的 SHA256 校验值，跳过校验"
        end

        # 6. 解压并安装到 ~/.local/bin/codex-pre
        set -l bin_dir "$HOME/.local/bin"
        mkdir -p "$bin_dir"

        echo "开始解压并安装..."
        tar -xzf "$archive_file" -C "$tmp_dir"
        if test $status -ne 0
            echo "❌ 解压失败"
            rm -rf $tmp_dir
            return 1
        end

        set -l binary_found ""
        set -l candidates (find "$tmp_dir" -type f \( -name "codex" -o -name "codex-*" \))
        if test (count $candidates) -gt 0
            set binary_found $candidates[1]
        end
        if test -z "$binary_found"
            echo "❌ 解压后未找到可执行文件 'codex'"
            rm -rf $tmp_dir
            return 1
        end

        set -l pre_bin_path "$bin_dir/codex-pre"
        mv -f "$binary_found" "$pre_bin_path"
        chmod +x "$pre_bin_path"

        rm -rf $tmp_dir

        if not contains "$bin_dir" $PATH
            echo "⚠️  注意: $bin_dir 不在您的 PATH 中。"
            echo "   请运行: fish_add_path $bin_dir"
        end

        echo "✅ 预发布版本安装完成!"
        echo "Release URL: https://github.com/openai/codex/releases/tag/$tag_name"
        echo "安装位置: $pre_bin_path"
        set -l usage_color (set_color --bold cyan)
        set -l usage_reset (set_color normal)
        printf "%s\n" "$usage_color▶️ 使用方式: codex-pre$usage_reset"

        set -l new_ver ($pre_bin_path --version 2>/dev/null)
        if test -n "$new_ver"
            echo "当前版本: $new_ver"
        end
    end
end


# ~/.config/fish/functions/gda.fish
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


# ~/.config/fish/functions/kp.fish
function kp
    set -l port $argv[1]

    set -l pids (lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null)

    if test (count $pids) -eq 0
        echo "No process is listening on port $port"
        return 0
    end

    kill -9 $pids
end


# ~/.config/fish/functions/node-lts.fish
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

    # Install global packages concurrently
    set -l packages @antfu/ni@latest @openai/codex@latest @google/gemini-cli

    echo "Installing global packages: $packages..."
    if not npm install -g $packages
        echo $red"Error: Failed to install some global packages"$normal
        return 1
    end
    echo $green"✓ Successfully installed global packages"$normal

    echo "Package versions:"
    npm list -g @openai/codex @google/gemini-cli --depth=0
end


