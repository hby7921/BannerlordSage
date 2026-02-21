# BannerlordSage — Bannerlord Source MCP Server

[![Bannerlord](https://img.shields.io/badge/Game-Bannerlord_II-8B0000?style=flat&logo=target)](https://www.taleworlds.com/en/Games/Bannerlord)
[![ILSpy](https://img.shields.io/badge/Tool-ILSpy-blue?style=flat&logo=c-sharp)](https://github.com/icsharpcode/ILSpy)
[![bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.com/) 
[![ripgrep](https://img.shields.io/badge/ripgrep-%23000000.svg?style=flat&logo=rust&logoColor=white)](https://github.com/BurntSushi/ripgrep)

一个提供《骑马与砍杀2：霸主》源代码搜索和数据浏览功能的 MCP 服务器。

## 📖 前言

本项目受 [RimSage](https://github.com/realloon/rimsage) 启发，针对《骑马与砍杀 2：霸主》的源码结构、XML 数据以及 Harmony 补丁开发需求进行了重构与定制。

## 🛠️ 可用工具

服务器提供以下工具，可供 AI 自动调用：

- `search_source` - 搜索霸主源代码。
- `read_file` - 读取特定文件内容。
- `list_directory` - 列出目录结构。
- `search_xml` - 搜索 XML 数据文件。
- `get_item_stats` - 获取装备与物品的属性数据。
- `read_csharp_type` - 读取 C# 类/结构体/接口定义。
- `generate_harmony_patch` - 生成 Harmony 补丁代码模板。
- `trace_troop_tree` - 追踪兵种升级树与基础属性。
- `read_gauntlet_ui` - 解析 UI 界面与 ViewModel 的绑定关系。

> **示例指令：** “请调用 `read_csharp_type` 工具查一下 `MobileParty` 类，看看它里面有没有和移动速度 (Speed) 相关的属性？”

---

## 🚀 本地部署

### 1. 安装底层环境 (Windows)

在终端（PowerShell）中运行以下命令安装必要组件：

- **安装 Bun 运行时：**
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
- **安装 Ripgrep ：**
  ```powershell
  winget install BurntSushi.ripgrep.MSVC
  ```
（安装完后可以在终端输入 bun -v 和 rg --version 测试一下是否成功）。
### 2. 初始化项目

在项目根目录下运行：
```bash
bun install
```

### 3. 准备数据结构 

请在项目根目录下手动创建以下文件夹：
- `dist/assets/Source/`
- `dist/assets/Xmls/`

### 4. 导入游戏数据

- **C# 源代码**：使用 ILSpy 反编译游戏 DLL，将生成的“C# project (*.csproj)”项目文件放入 `dist/assets/Source/`。
- **XML 数据**：将游戏 `Modules` 目录（如 `Native/ModuleData` 等）下的 XML 配置文件放入 `dist/assets/Xmls/`。

### 5. 构建索引

数据准备就绪后，运行以下命令生成本地 SQLite 数据库：
```bash
bun run src/scripts/index-csharp.ts
bun run src/scripts/index-xml.ts
```
> **💡 测试提示：** 索引完成后，你可以先在终端里单独输入 `bun run start` 测试一下服务器能不能正常启动。

## 🤖 接入 AI (以 VS Code + Cline 为例)

1. 打开 VS Code 中的 Cline 插件。
2. 点击底部的 **Manage MCP Servers**。
3. 在 `cline_mcp_settings.json` 中添加配置（**请根据你的实际存放路径修改**）：

```json
{
  "mcpServers": {
    "bannerlord-sage": {
      "command": "bun",
      "args": ["run", "D:/BannerlordSage/src/stdio.ts"]
    }
  }
}
```
如果显示

<img width="357" height="85" alt="image" src="https://github.com/user-attachments/assets/8a43f91f-2cb3-42fb-9e14-f66a54fedc82" />

则配置完成

---

## ⚠️ 免责声明 (Disclaimer)

本项目及配套工具仅供个人学习、研究《骑马与砍杀2：霸主》游戏机制以及 Mod 开发交流使用。

1. 本项目**不包含、不提供**任何 TaleWorlds  官方的原始代码或数据文件。
2. 请用户在拥有正版游戏的前提下使用本工具，并严格遵守官方的最终用户许可协议（EULA）。
3. 请勿将通过本工具反编译或提取的游戏资产用于任何形式的商业牟利或侵权用途。
4. 任何因不当使用游戏原始数据而引发的法律纠纷，均由使用者自行承担，与本项目及原作者无关。
