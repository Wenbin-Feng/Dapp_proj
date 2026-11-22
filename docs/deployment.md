# SQLite 本地运行与持久化部署

> 当前默认演示为 **SQLite + Ethereum**，启动、角色授权与节点重启步骤见 [区块链运行指南](blockchain.md)。下面“无需节点/余额”等说明只适用于 `CHAIN_ENABLED=0` 的旧纯数据库模式。链上模式应同时运行本机 Hardhat 节点，网页建议使用 3001 端口。

此版本不使用云端认证、数据库或对象存储。使用 Node.js 24.x 启动单个 Next.js 服务，由应用自动创建 SQLite 表及图片目录。

## 开发与演示

```sh
npm ci
npm run dev
```

在安装 MetaMask 的浏览器打开 <http://localhost:3000>。数据库为空时，各演示钱包需要先注册角色。账户身份来自钱包签名；不用测试网余额，也不用部署区块链节点。二维码链接使用当前浏览器的访问来源，因此演示时保持访问域名一致。

同一浏览器的多个标签页共享会话。切换角色前退出应用，并切换 MetaMask 账户；要并排演示多个角色，可使用独立浏览器配置文件。

`.env.example` 提供可选路径：

```dotenv
LOCAL_DATABASE_PATH=./data/dapp.sqlite
LOCAL_UPLOAD_DIR=./data/uploads
```

路径按服务启动目录解析。停止再启动服务会复用原数据，不会自动清空。移动数据库前停止所有访问它的进程；同时保存同目录的 SQLite 工作文件和图片目录。数据库仅靠文件系统权限保护，不是加密文件。共享电脑上请限制数据目录访问。

## 生产模式在本机运行

```sh
npm run build
npm start
```

端口默认为 3000。开发服务和生产服务不要同时占用同一个端口。保留 `.next/`、运行所需依赖、配置和持久数据目录。`npm ci` 只安装依赖，不会重置业务数据。

需要远程托管时，应先选用有持久磁盘的 Node 主机，设置稳定的绝对数据路径，再验证 HTTPS 反向代理下的 Host、Origin 和 cookie 行为。当前验收覆盖本机 HTTP 环境，尚未验证远程代理部署。不要直接把数据库复制到多个独立实例：它们不会自动共享更新。

旧的 GitHub Actions → Vercel 自动发布工作流已移除；现有 `vercel.json` 继续关闭 Git 自动部署。本地 SQLite 与本地图片需要持久化存储，不能沿用先前云数据库架构的无状态部署方式。此改动没有发布或修改任何远端网站。

## CI 与复验

GitHub CI 对所有分支 push、目标为 main/release 的 PR 运行 TypeScript、单元/数据库测试、Chromium 浏览器测试和生产构建。使用 Node 24，不需要数据库或云服务 secrets。

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

E2E 会启动独立应用并占用 3000；若手动服务正在运行，请先停止它。每次 E2E 使用 `.test-data/<随机目录>` 的数据库和图片，退出后保留用于失败排查；它不会连接日常 `data/`。可在停止测试后按需清理确认不再需要的测试目录。

## 交付前仍需完成

本地业务测试通过不代表课程区块链要求已完成。仍需补充智能合约、链上集成、部署脚本与合约测试，按要求提交设计报告和演示材料。角色资质审批、远程 HTTPS 部署、备份恢复演练和高并发容量验证也尚未完成。
