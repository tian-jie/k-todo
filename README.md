# k-todo

面向越狱 Kindle 的家庭中控 Dashboard 应用，技术路线参考 KAnki。Todo 是核心功能之一，同时提供万年历与天气信息展示。

## 核心特性
- Dashboard 首页：日期、时间、周几、农历占位
- 天气信息：实时天气、24 小时、未来 14 天（含温度曲线）
- Todo 摘要 + 四象限详情页（紧急/重要）
- Kindle 端每 5 分钟轮询服务器同步
- Kindle 端可点击 done 回写服务器
- 后端管理页（Web）：Todo 增删改查

## SDD（需求优先）文档
请先阅读需求文档，再进入实现：

- docs/sdd/README.md
- docs/sdd/01-背景与目标.md
- docs/sdd/02-用户场景与用户流程.md
- docs/sdd/03-功能需求.md
- docs/sdd/04-非功能需求.md
- docs/sdd/05-约束风险与未竟事项.md
- docs/sdd/06-里程碑与验收.md

## 目录结构
```
docs/sdd/               # SDD 需求文档（中文）
backend/                # Rust 服务端 + PostgreSQL
src/                    # Kindle 扩展目录（config/menu/content）
```

## 本地运行（开发机）
1. 启动后端：
```
cd backend
cp .env.example .env
cargo run
```

天气接口参数（用于 `/api/v1/dashboard` 调和风 24 小时 API）：
- `QWEATHER_KEY`：和风 API Key（敏感）
- `QWEATHER_LOCATION`：地点 ID（建议放 `.env` 统一管理）

接口说明：
- `GET /api/v1/dashboard`：Dashboard 聚合数据（含 calendar/weather/todo_summary 等）
- `GET /api/v1/todos`：Todo 列表
- `POST /api/v1/todos/:id/done`：标记完成

2. 打开前端：
- 直接在浏览器打开 src/content/index.html
- 或通过静态服务器托管该目录

默认后端地址为 http://127.0.0.1:8080，可在 src/content/js/config.js 调整。

后端管理页（增删改查 Todo）：
- http://127.0.0.1:8080/admin

## Kindle 部署（与你截图一致）
目标结构：

- `/mnt/us/extensions/k-todo/config.xml`
- `/mnt/us/extensions/k-todo/menu.json`
- `/mnt/us/extensions/k-todo/content/index.html`
- `/mnt/us/extensions/k-todo/content/main.css`
- `/mnt/us/extensions/k-todo/content/main.js`
- `/mnt/us/extensions/k-todo/content/js/...`
- `/mnt/us/extensions/k-todo/content/assets/...`
- `/mnt/us/extensions/k-todo/content/start.sh`

复制方法：
1. 将 `src/config.xml` 复制到 `/mnt/us/extensions/k-todo/config.xml`
2. 将 `src/menu.json` 复制到 `/mnt/us/extensions/k-todo/menu.json`
3. 将 `src/content/` 目录内全部文件复制到 `/mnt/us/extensions/k-todo/content/`
4. 在 KUAL 中刷新后点击 `k-todo`

说明：当前菜单动作执行 `content/start.sh`，脚本会注册并启动 mesquite 应用。

## 当前实现状态
- Phase 1：已完成 Kindle 端基础界面、KUAL 启动链路与交互骨架
- Phase 2：已完成 Rust + PostgreSQL API、Dashboard 聚合接口、和风 24h 接入、轮询与回写
- Phase 3：登录/注册均未实现，作为后续计划
