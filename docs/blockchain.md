# SQLite + 智能合约：中文运行与演示指南

## 1. 这次完成了什么

SQLite 继续负责账户资料、会话、私密文本、图片位置和快速查询。产品登记、转移、保修申请与维修完成都必须经过钱包签名交易，由 `ProductPassport` Solidity 合约执行。服务端核验回执后同步事件；直接调用旧的业务写入 API 会被拒绝，不能绕过链上权限。

这是真实的本地 Ethereum 交易：有区块、gas、交易哈希、状态和日志。网络是本机 Hardhat 开发链，不是公共测试网。

## 2. 启动顺序

进入 `F:\Project\Dapps\Dapp_proj-main`，确认 `node --version` 为 24.x。首次安装执行 `npm ci`。`.env.local` 保留本地路径，并配置：

```dotenv
CHAIN_ENABLED=1
CHAIN_DEPLOYMENT_FILE=./data/chain/deployment.json
LOCAL_DATABASE_PATH=./data/dapp.sqlite
LOCAL_UPLOAD_DIR=./data/uploads
```

`LOCAL_DATABASE_PATH` 只在纯数据库模式生效。链上模式根据部署清单选择独立 SQLite 文件。无需任何 Supabase 配置或私钥。

1. 终端 A 执行 `npm run chain:node`，保持运行，默认监听 `127.0.0.1:8545`。
2. 终端 B 执行 `npm run chain:compile`、`npm run chain:deploy`。
3. 终端 B 继续执行 `npm run dev -- --port 3001`，打开 `http://localhost:3001`。

已经运行的节点不用再启动。`chain:deploy` 遇到仍然有效的部署会复用；遇到已重置的节点会拒绝覆盖，需要明确执行 `npm run chain:deploy -- --new`。如果修改了合约代码，重新编译后也要 `--new` 才会部署新代码。

脚本默认使用上述路径；自定义时在终端设置 `CHAIN_DEPLOYMENT_FILE` / `CHAIN_RPC_URL`。Next 会读取 `.env.local`，独立 Node 脚本只读取终端环境变量和默认路径。

## 3. 钱包和角色

在 MetaMask 创建五个专门测试的账户，分别复制其公开地址。为每个账户执行：

```powershell
npm run chain:grant -- 0x实际公开地址 manufacturer
npm run chain:fund -- 0x实际公开地址
```

第一个参数必须是完整以太坊地址。按下表替换角色值：

| 页面角色 | 命令参数 | 功能 |
| --- | --- | --- |
| Manufacturer | manufacturer | 登记产品、交付零售商、更新公开图片 |
| Retailer | retailer | 接收产品、交付消费者 |
| Customer A / B | customer | 接收、转售、提交保修 |
| Service Center | service_center | 处理指定给自己的申请并记录维修 |

角色一经授权不可修改；应用资料选择必须与链上授权一致。界面不能通过自行选择 Manufacturer 获得制造商权限。管理员是部署节点的第 0 个开发账户，授权脚本通过本机 RPC 调用它；业务交易始终由用户自己的钱包签名。

部署脚本还会给 Hardhat 的第 1–5 个开发账户预授予这五个角色，公共地址记录在 `data/chain/deployment.json`。可使用节点终端显示的对应开发账户做演示；这些开发密钥公开且不安全，只能用于本地测试，不能存入真实资产。使用自己生成的测试账户加 `chain:grant` / `chain:fund` 更容易区分角色。

在 MetaMask 添加网络：名称任意，RPC `http://127.0.0.1:8545`，Chain ID `31337`，符号 `ETH`。工作区 **Connect local network** 也可请求添加/切换。每次操作前确认当前 MetaMask 账户与网页登录钱包一致。

## 4. 完整演示

先让五个钱包各自登录并完成资料，确保转移收件人和服务中心已注册。登录只签署消息，不扣 gas。下列业务操作都会出现交易确认：

1. 制造商进入 Register product，填写型号、唯一序列号、保修天数、最大维修次数。序列号只允许无空格的 ASCII 字母、数字、标点，大小写不区分唯一性；型号支持中文。确认钱包交易，等待产品页出现。
2. 产品页填写零售商钱包，Initiate transfer。零售商登录 Transfers，点击 Accept 并确认交易。此时保修尚未开始。
3. 零售商向消费者 A 发起转移；A 接受后，合约按该区块时间启动保修。
4. A 在 Warranty 选择服务中心，填写问题并提交。页面正文保存在 SQLite，链上只保存加盐哈希。
5. 服务中心打开 Warranty claims，Approve request；然后 Record completed repair，填写结果，Complete & record repair。只有完成才消耗一次额度。拒绝时必须填写原因且不扣额度。
6. A 转移给 B，B 接受。检查日期与已用次数保持不变，维修历史仍存在。未结束的保修申请和待处理转移会互相阻止。
7. 点击产品页 Blockchain record 中的哈希，查看实际回执、区块、gas、合约地址和事件。未登录也可在 Verify 页面查询产品或打开二维码。

同一浏览器的多个标签页共享登录会话。切换角色要先退出并切换 MetaMask 账户；或者使用多个独立浏览器配置文件。不要把“多开标签页”当作多个独立身份。

图片和账户名称不消耗链上 gas；图片是本地公开展示资源，没有做内容哈希存证，不应当作防篡改的链上证据。

## 5. 交易失败与恢复

| 现象 | 处理 |
| --- | --- |
| Local Ethereum unavailable | 检查节点终端、RPC 8545；Check connection 重试 |
| 角色尚未授权 | 运行对应 chain:grant，再提交资料；旧节点授权不会跨重置保留 |
| 余额不足 | 对当前地址运行 chain:fund；余额只存在本地链 |
| 钱包拒绝确认 | 不产生业务变更，重新提交即可 |
| 网络不对 | Connect local network，确认切换至 31337 |
| 交易已发送但浏览器报错 | 先看钱包交易状态，点击 Resume synchronization 核验并恢复 |
| 等待很久仍未广播 | 查钱包待确认弹窗；若确定取消，可 Forget browser request 后重试 |
| 合约或部署身份变化 | 节点已重置或部署不匹配，按下一节创建新部署 |

**Forget browser request 只清除浏览器保存的请求，不会取消已广播的交易。** 已确认事件后续仍会同步。浏览器关页、丢失响应不会使已成功的链上交易自动回滚。

恢复按钮验证登录用户、合约、调用数据、发送地址和回执。即使没有保存到交易哈希，也可通过钱包与操作 ID 对应的已确认事件恢复。待确认请求存储在当前标签页的 sessionStorage，不能跨浏览器恢复；链上成功状态仍会在读取业务页时同步。

## 6. 数据、重启和备份

- `data/dapp.sqlite`：旧纯 SQLite 数据，保留不动。
- `data/chain/deployment.json`：当前合约地址、部署 ID、区块哈希、RPC、对应数据库路径。
- `data/chain/passport-*.sqlite`：该部署的资料、私密文本、查询副本和同步游标。
- `data/uploads/`：产品图片。

重启 Next 网页会继续使用当前部署。**Hardhat 节点退出后，其内存区块链消失。** 重新启动节点后运行 `npm run chain:deploy -- --new`，会产生新部署和新的 SQLite 文件，旧文件保留。之前自己的钱包需要重新授权和领取测试 ETH；节点重置后 MetaMask 可能保留旧 nonce，可在开发账户的高级设置中清除活动记录，再重新连接。

部署清单包含绝对 SQLite 路径。以后再次移动项目，应先停止服务、搬走整个数据目录并修正清单的 databasePath；若同时重启了内存节点，使用 `--new` 创建新部署更明确。

停止应用后备份整个 data 目录（自定义路径需要一起备份）。SQLite 备份能保存私密文本和历史查询记录，不能恢复丢失的内存链；该原型不提供跨节点重启的链快照持久化。保留演示证据可录屏并保存回执截图。需要长期运行时应改用持久化 Ethereum 节点或公共测试网，并扩展配置及部署工具。

## 7. 技术边界与隐私

`prepare → 钱包签名 → 区块确认 → confirm → 事件同步` 是业务写入路径。prepare 先保存带随机盐的私密内容，再生成 calldata；服务器不会代签业务交易。同步器校验部署代码、部署 ID、部署区块和已索引区块哈希，将事件与同步游标放在同一 SQLite 事务中提交。检测到链重组会停止使用该副本，避免展示错误所有权。

直接通过合约调用也会被同步；若该调用没有本地私密文本，则显示“正文不可用”，而不是虚构维修详情。可以从事件重建产品与流转状态，但不能从哈希恢复私密正文。

区块链上的完整钱包地址、产品元数据、转移关系与时间公开。页面脱敏不是链上匿名化；任何能访问节点的人都能查看交易。SQLite 中的私密文本由文件系统和接口权限保护，未做数据库加密。图片公开，且可由制造商替换。

本地授权用于课程演示，管理员仍需线下核实组织身份。当前不支持角色撤销、合约升级、公共网络选择、多实例共享 SQLite、链重组自动回滚或长期持久节点；部署脚本仅允许本机链 31337。合约没有收款、托管或结算功能。

## 8. 测试与依赖

运行 README 中的完整验证命令。合约/接口测试使用独立 18545 节点并改变该测试链时间；不影响 8545 演示节点。浏览器测试使用合成 EIP-1193 入口，但执行真实钱包签名、真实 HTTP、真实 SQLite 和真实 Ethereum 交易，另包含取消签名与丢失确认响应的恢复测试。真实 MetaMask 扩展弹窗仍需在你的浏览器做一次人工演示验收。

2026-11-15 依赖检查：生产依赖 `npm audit --omit=dev` 无已报告漏洞。完整开发依赖审计仍报告 Hardhat 3 的 Zod 3 依赖链 3 个 high 条目（同一 GHSA-mrhx-c7xc-m3w5 来源）；上游兼容升级待跟进。已修复 solc 的 tmp 依赖版本。没有使用破坏兼容性的强制升级掩盖告警。节点只绑定本机，不对公网提供开发 RPC。

技术参考：[Hardhat 本地节点](https://hardhat.org/docs/guides/hardhat-node)、[Solidity 编译器接口](https://docs.soliditylang.org/en/latest/using-the-compiler.html)、[ethers v6](https://docs.ethers.org/v6/single-page/)。
