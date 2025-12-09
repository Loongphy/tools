# 开发工具集

这是一个用于存放日常开发脚本的工具集仓库。

## Fish Shell 开发工具

**文件**: [devtools.fish](./devtools.fish)

### Git 别名
- `main` - 切换到 main 分支
- `cl` - git clone 的简写
- `gp` - git push 的简写
- `gd` - 删除所有非 main 分支
- `gpl` - git pull --rebase 的简写
- `gnoe` - git commit --amend --reset-author --no-edit 的简写
- `gc` - git checkout 的简写
- `gda` - 获取最新分支并删除所有非 main 分支

### Node.js 工具
- `node-lts` - 安装并配置最新的 Node.js LTS 版本（使用 fnm），同时自动安装：
  - `@antfu/ni` - 统一的包管理器运行器
  - `@openai/codex` - OpenAI Codex CLI 工具

### 其他工具
- `kp <port>` - 杀死指定端口的进程
- `py` - python3 的别名
- `myip` - 检查代理是否工作（显示 IP 信息）
- `d` - `nr dev` 的别名（需要 @antfu/ni）
- `e` - `edit.exe` 的别名（Windows 编辑器）

## 工具列表

| 工具 | 描述 | 文件 |
|------|------|------|
| **YouTube 视频截图** | 视频截图当前时间戳，保存、复制截图 | [youtube-screenshot.user.js](./youtube-screenshot.user.js) |
| **ARM64 PostgreSQL 构建** | 构建 ARM64 PostgreSQL 12.6 的 Docker 配置和 CI 流程 | [Dockerfile](./Dockerfile)<br>[build_postgresql.yml](./.github/workflows/build_postgresql.yml) |
| **ARM64 Nginx 静态构建** | 构建 musl 静态链接的 Nginx aarch64 免安装包（Nginx 1.26.2 + OpenSSL 3.0.14 + PCRE2 10.43） 的 CI | [Dockerfile.nginx](./Dockerfile.nginx)<br>[build_nginx.yml](./.github/workflows/build_nginx.yml) |
| **中英文空格排版** | 中英/数字混排的视觉留白（不改文本）；跳过输入框、代码块和可编辑区域。 | [cjk-latin-autospace.user.js](./cjk-latin-autospace.user.js) |

