# 笔答 · NoteReply

**让笔记成为你的对话伙伴。**

笔答是一个开源 Obsidian AI 助手。选中笔记内容，或通过 `@` 引用文件，与 DeepSeek 对话，再把回答以 Markdown 插入或替换回笔记。

当前版本：**0.1.17** · 许可证：**MIT** · 要求：**Obsidian 1.11.4+**

## 功能

- 笔记划词提问、回答划词追问、多轮上下文和独立话题。
- `@` 搜索库内文件，插入可整体删除的引用标签；发送时读取文件内容。
- 上传图片、DOCX、PDF，以及读取 drawio 节点与连线结构。
- DeepSeek 深度思考；桌面端流式显示，移动端使用兼容请求。
- Markdown、表格和 Mermaid 渲染，复制或将内容写回当前笔记。
- 逐话题重命名与删除、整轮删除、不满意标记，以及可恢复的本地对话草稿。
- 对话区悬停或点击展开历史问答目录，快速定位并高亮对应气泡；不改变模型上下文。
- 桌面独立阅读窗口；移动端应用内阅读。

## 安装

本项目尚未提交 Obsidian 社区插件目录，当前使用手动安装。

1. 在本仓库 **Releases** 页面下载发布包。不要将 GitHub 自动生成的 Source code 压缩包当作可运行插件。
2. 在笔记库配置目录中创建 `.obsidian/plugins/jeanmk-obsidian-ai/`。
3. 将发布包中的 `main.js`、`manifest.json`、`styles.css`、`pdf.mjs`、`pdf.worker.mjs` 放入该目录，同时保留许可证文件。
4. 重启 Obsidian，在 **设置 → 第三方插件** 中启用 **笔答 · NoteReply**。
5. 打开插件设置，填写自己的 DeepSeek API Key，再点击“测试连接”。测试会发出模型请求，可能计费。

升级到 0.1.17 前，请先停用各设备上的旧版插件并做好备份。覆盖程序文件后启用，新版会自动把旧话题和附件迁到笔记库 `NoteReply/` 目录；迁移完成前不要删除旧文件。多设备应更新到同一版本，等待整个 NoteReply 目录同步完成后再启用。

内部插件 ID 暂时保留 `jeanmk-obsidian-ai`，用于兼容旧版数据；产品和仓库名称为 NoteReply。

## 平台差异

| 环境 | 回答显示 | 阅读 | 截图 |
| --- | --- | --- | --- |
| Windows / macOS / Linux 桌面端 | 流式输出 | 独立窗口 | 系统截图或粘贴图片 |
| 安卓 / 鸿蒙兼容的 Obsidian 客户端 | 生成完成后显示 | 应用内页面 | 系统截图后选择图片附件 |

移动端的 Obsidian `requestUrl` 不提供流式读取和取消接口。“停止”会结束等待并忽略迟到结果，但服务端请求可能继续执行和计费。

移动端已在禁用 Node / Electron / Buffer 的模拟环境中验证基础流程，**尚未在真实安卓或鸿蒙设备上实测**。

## 数据与隐私

- API Key 使用 Obsidian SecretStorage 保存，不写入聊天历史。
- 插件 `data.json` 仅保存设置、SecretStorage 的随机标识和数据目录配置。
- 话题、问答、思考、草稿及附件引用保存在 `NoteReply/topics/<话题ID>.json`；附件保存在 `NoteReply/attachments/`，索引为 `NoteReply/index.json`。
- `NoteReply/backups/` 保留完整旧版迁移备份；删除话题进入 `NoteReply/trash/`，同步冲突的本地副本保存在 `NoteReply/conflicts/`。这些目录也包含私人对话，请不要上传公开仓库。
- 启动只加载索引和当前话题，草稿仅保存对应话题；流式输出只刷新当前回复，图表在生成完成后渲染。
- 点击发送时，问题、上下文、所选引用及附件会发给 DeepSeek；不自动扫描整个笔记库。
- 不自动获取外部网页，不含遥测或独立服务端。
- 不要在 Issue、截图或公开仓库中提交密钥、真实笔记、`data.json` 和附件缓存。

备份或迁移个人数据时，请同时保存插件设置和整个 `NoteReply/` 目录。清除记录会保留迁移备份。

完整功能和限制见 [使用说明](使用说明.md)。

## 开发

需要 Node.js 22+ 和 pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

构建产物包含 `main.js`、`manifest.json`、`styles.css`、`pdf.mjs`、`pdf.worker.mjs`。`package.json` 是版本号来源，构建时同步 `manifest.json`。

Windows 下可运行 `./打包.ps1` 生成安装包，输出到 `dist/`。

测试使用虚构输入、本地 HTTP 服务和 Obsidian API 模拟层，不使用真实 API Key；自动化通过不等于所有真实设备已验证。

## 贡献与许可

欢迎提交 Issue 和 Pull Request，见 [贡献说明](CONTRIBUTING.md)。

本项目源码采用 [MIT License](LICENSE)。第三方依赖保留各自许可证，见 [第三方依赖说明](第三方依赖说明.md) 和 `licenses/`。
