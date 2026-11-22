# Product Provenance & Warranty — SQLite + Ethereum

COMP5565 产品溯源与保修项目。Next.js / React 提供界面，SQLite 保存登录、私密维修文本、图片索引和链上事件的查询副本；Solidity 合约负责产品登记、所有权转移、保修期限、审批与维修次数。MetaMask 对业务交易签名，Hardhat 本地 Ethereum 节点执行交易并返回真实回执。无需 Supabase。

**完整中文操作步骤见 [区块链运行与演示指南](docs/blockchain.md)。** 旧 Supabase 教程不适用于当前运行模式。

本次验证结果见 [链上集成验证记录](docs/blockchain-validation.md)：91 项自动化测试及生产构建通过。

## 启动

需要 Node.js **24.x**、npm、MetaMask。以下命令均在项目目录执行；保持节点和网页终端运行。

```powershell
cd F:\Project\Dapps\Dapp_proj-main
npm ci
```

首次配置：复制 `.env.example` 为 `.env.local`（已有文件时只补充缺少项），保持 `CHAIN_ENABLED=1`。

终端 1：

```powershell
npm run chain:node
```

终端 2：

```powershell
npm run chain:compile
npm run chain:deploy
npm run dev -- --port 3001
```

打开 <http://localhost:3001>。MetaMask 本地网络 RPC 为 `http://127.0.0.1:8545`，Chain ID 为 **31337**，币种为 ETH；工作区的 **Connect local network** 可协助添加/切换。

## 首次选择演示角色

用 MetaMask 登录，在资料页选择制造商、零售商、消费者或服务中心。提交后，服务端给已签名的钱包授予所选角色；首次授权时余额为零的钱包会收到 0.05 枚演示 ETH。已有链上角色的钱包会自动选中原角色。之后可以在 My profile 的 Account role 中切换，保存后同一钱包使用新角色。

## 演示顺序

1. 五个钱包分别登录，填写与链上授权一致的角色和资料。
2. 制造商登记产品，配置保修天数、维修次数，可上传公开图片。
3. 制造商发起转移，零售商接受；零售商发起转移，消费者 A 接受。首次零售交付开始保修。
4. 消费者 A 提交保修申请；指定服务中心批准、填写结果、完成维修。完成才扣减一次额度。
5. A 转售给 B，B 接受；保修日期、已用次数和维修历史保留。
6. 产品页的 **Blockchain record** 可打开实际交易回执；`/verify` 和二维码供未登录用户查询。

同一浏览器标签页共享登录 cookie。切换身份时先退出、切换 MetaMask 账户、重新签名登录；并排演示使用不同浏览器配置文件。

## 数据与节点重启

旧数据库 `data/dapp.sqlite` 保留。链上模式每次新部署使用独立的 `data/chain/passport-*.sqlite`，路径记录在 `data/chain/deployment.json` 中；旧产品没有自动伪装成链上产品，需要在新部署登记。

**Hardhat 开发链是内存链。** 仅重启网页不丢链上状态；关闭节点后重启会重置链。此时执行 `npm run chain:deploy -- --new` 创建新合约和新 SQLite 副本，再刷新网页、重新授权钱包并登录。旧数据库不会被删除。仅备份 SQLite 无法恢复已经重置的区块链，演示期间应保持节点运行。

`CHAIN_ENABLED=0` 可回到旧的纯 SQLite 模式，该模式不产生链上交易。见 [纯 SQLite 操作记录](docs/sqlite-only.md)。两种模式的数据不自动合并。

## 验证

```powershell
npm run typecheck
npm test
npm run test:chain
npx playwright install chromium
npm run test:e2e
npm run test:chain:e2e
npm run build
npm audit --omit=dev
```

普通浏览器测试使用 3003 端口，链上浏览器测试使用 3002 端口，独立测试节点使用 18545。测试目录 `.test-data/` 与演示数据隔离。浏览器两套测试应依次运行，避免共用 Next 开发构建目录。链上测试包含真实交易、权限、额度、到期、私密文本、事件重放、回执恢复和链重组检测。

## 实现与范围

| 文件 | 用途 |
| --- | --- |
| `contracts/ProductPassport.sol` | 链上角色、产品、交接、保修和维修状态机 |
| `src/lib/chain-server.ts` | 交易准备、回执核验、事件同步 |
| `src/lib/chain-projection.ts` | 链上事件写入 SQLite 查询副本 |
| `src/lib/chain-client.ts` | MetaMask 发送交易、等待确认、失败恢复 |
| `scripts/chain-*.mjs` | 编译、部署、授权、测试资金、隔离测试 |
| `docs/blockchain.md` | 中文使用指南、故障处理、设计与限制 |

此版本完成本地 Ethereum 集成，尚未部署公共测试网或主网，也未接受独立合约安全审计。钱包地址、产品元数据及交易关系在链上公开；维修正文仅在 SQLite，链上为加盐承诺哈希。演示身份由用户首次登录时自行选择。不要将本地节点暴露到公网。

真实环境文件、数据库、节点日志和运行产物均在忽略规则中。当前项目文件夹没有 Git 元数据；没有创建提交或写入 Git 历史。
