# CS 道具战术本

CS 道具战术本是一款面向 Windows 的 CS2 道具笔记桌面应用。使用 React、TypeScript 与 Tauri 2 构建，支持记录、整理和查找战术道具，并将截图和标注保存到笔记中。

> 当前版本：`0.1.4-beta`。项目处于测试阶段，功能和数据结构可能继续调整。重要数据请定期备份。

## 功能

- 按地图、阵营、道具类型和投掷方式整理道具笔记。
- 记录站位、目标位置、文字说明和标签，并通过搜索与筛选快速查找。
- 截图并附加到笔记，使用标注工具补充战术信息。
- 通过全局快捷键快速截图；默认快捷键为 `Alt+Q`，可在设置中调整。
- 使用本地 SQLite 保存笔记，管理截图图片，并支持备份导入与导出。
- 自定义数据目录、截图行为以及关闭窗口时隐藏到系统托盘等设置。

<img src="images/UI.png" />

## 环境要求

- Windows
- Node.js 22.18 或更高版本，以及 npm
- Rust 工具链
- Tauri 2 在 Windows 上所需的原生构建环境（包括 Microsoft C++ Build Tools 和 WebView2）

首次运行桌面开发或构建前，请按 [Tauri 官方 Windows 前置要求](https://v2.tauri.app/start/prerequisites/#windows) 配置 Rust 和 Windows 原生构建环境。

## 开始使用

在项目根目录安装前端依赖：

```powershell
npm ci
```

启动桌面开发版：

```powershell
npm run tauri dev
```

这会启动 Vite 开发服务器并运行 Tauri 桌面应用。若只需要运行前端开发服务器：

```powershell
npm run dev
```

单独运行前端服务器适合界面开发预览；数据库、全局快捷键、系统截图、托盘等原生能力需要在 Tauri 桌面应用中使用。

## 构建与测试

构建前端（包含 TypeScript 类型检查）：

```powershell
npm run build
```

构建 Windows 桌面安装包（NSIS）：

```powershell
npm run tauri build
```

运行前端逻辑测试：

```powershell
npm test
```

运行 Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 数据与备份

笔记数据库和截图保存在应用数据目录中；设置保存在应用配置目录中。数据目录可以在应用设置中更改。备份功能用于导出或导入笔记数据及相关图片。

更改数据目录、迁移设备或重新安装应用前，建议先从设置中导出备份，并确认备份文件可用。请勿在应用运行时手动移动或修改数据库文件。

## 项目结构

```text
src/                 React 界面、组件、服务和 TypeScript 类型
src-tauri/           Tauri 配置与 Rust 桌面端实现
tests/               前端逻辑测试
```

## 技术栈

- 前端：React 19、TypeScript、Vite
- 桌面应用：Tauri 2、Rust
- 本地存储：SQLite
