# 贡献说明

欢迎提交问题或改进。请先说明 Obsidian 版本、插件版本、操作系统，以及最小复现步骤。

- 只提交虚构或脱敏后的笔记，不提交 API Key、真实聊天记录和附件缓存。
- 修改前运行 `pnpm install --frozen-lockfile`，然后运行 `pnpm build`、`pnpm test`。
- 保持桌面流式请求和移动端 requestUrl 路径都可用。
- 修改 Obsidian API 行为时，核对原生生命周期，避免仅靠宽松模拟通过测试。
- 功能变化请同步 README、使用说明和更新日志；发布时递增 package.json 版本并同步 versions.json。

提交代码即表示你有权提交该内容，并同意按本项目 MIT 许可证分发你的贡献。
