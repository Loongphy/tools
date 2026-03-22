# 开发工具集

这是一个用于存放日常开发脚本的工具集仓库。

## Codex 全局 AGENTS.md `~/.codex/AGENTS.md`

**文件**: [Codex-AGENTS.md](./Codex-AGENTS.md)

**背景与用途**：
这份配置文件是专门针对 **WSL2 + Windows 混合开发场景** 而优化的 Agent 提示词引导。

在我的日常开发工作流中，即使是针对 Windows APP 的开发，我也会倾向于在 WSL2 环境下完成。具体的做法是：将项目文件存放在 Windows 原生文件系统中，然后通过 WSL2 的 `/mnt/` 挂载路径去访问、编辑。

由于这种“在 Linux 环境开发 Windows 宿主机文件”的开发模式相对特殊，常规的 AI Agent 可能会在文件路径识别或系统环境假设上产生混淆。因此，这份引导文件的核心作用是：

1. **统一开发约定**：让 Agent 明确当前正处于 WSL2 环境中，理解 `/mnt/` 下的 Windows 文件隔离与映射关系。
2. **提供跨系统调用指南**：当遇到需要对 Windows 进行直接调用的任务时，引导 Agent 采用正确的桥接方式（如通过 `pwsh.exe` 调用 Windows PowerShell）执行。

## 终端工具

**文件**: [windows-terminal.json](./windows-terminal.json) | [starship.toml](./starship.toml)

- **windows-terminal.json** - Windows Terminal 的配置文件，包含主题、快捷键、终端配置等设置
- **starship.toml** - Starship 跨平台 shell 提示符的配置文件，支持 Fish/Bash/Zsh 等多种 shell

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
| **中英文空格排版** | 中英/数字混排的视觉留白（不改文本）；跳过输入框、代码块和可编辑区域。 | [cjk-latin-autospace.user.js](./cjk-latin-autospace.user.js) |
| **x.user.js** | 树状结构标记 X 左侧栏相关页面元素 | [x.user.js](./x.user.js) |

### x.user.js

- 隐藏不必要的营销按钮
- 右侧边栏快捷搜索
- 马赛克 DEMO 模式

```text
header[role="banner"]  (width=88 via CSS)
└─ div (header 内第一个/唯一 div, width=88 via CSS)
   └─ div (top-parent, width=88 via JS；flex column; justify-content: space-between)
      ├─ div (top)
      │  ├─ div (logo)
      │  ├─ div (left-top)
      │  │  └─ nav[role="navigation"]
      │  │     ├─ a[href="/home"] ...
      │  │     ├─ a[href="/notifications"] ...
      │  │     └─ ...
      │  └─ div (left-middle)
      │     └─ a[href="/compose/post"]  (发帖按钮)
      └─ div (account)
         └─ div (account-inner / wrapper)
            └─ button[data-testid="SideNav_AccountSwitcher_Button"] avatar
               ├─ div (userAvatar-parent)
               │  └─ div[data-testid="UserAvatar-Container-<username>"] userAvatar
               ├─ div (extra-1, 宽度变小时会隐藏)
               └─ div (extra-2, 宽度变小时会隐藏)
```
