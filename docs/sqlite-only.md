# Product Provenance & Warranty — SQLite local edition

> 历史纯 SQLite 模式说明，仅在 `CHAIN_ENABLED=0` 时适用。项目现已实现本地智能合约与交易，当前使用方式见 [README](../README.md) 和 [区块链指南](blockchain.md)。浏览器测试端口已调整为 3003。

COMP5565 的产品溯源与保修原型：Next.js、React、SQLite、本地图片存储和 MetaMask 签名登录。制造商、零售商、消费者、服务中心四种角色共同完成产品生命周期。

**当前业务记录保存在 SQLite，尚未接入区块链或智能合约。** 钱包签名用于验证身份，不产生链上交易。这一版本可用于本地业务演示；课程要求的链上实现仍需补充。

## 本地启动

需要 Node.js **24.x**、npm；登录需要安装 MetaMask 的浏览器。无需 Supabase 账户、密钥、Docker 或单独安装数据库服务。

在本项目目录执行：

```sh
npm ci
npm run dev
```

访问 <http://localhost:3000>。首次访问 API 会自动创建数据库和表；上传图片时会自动创建图片目录。浏览器只向本应用发送认证和业务请求。签名无需余额、支付或 RPC 查询；安装依赖以及钱包扩展自身的网络行为不属于应用的离线能力。

`.env.local` 可省略。需要更改数据位置时，将 `.env.example` 复制为 `.env.local` 并修改：

```dotenv
LOCAL_DATABASE_PATH=./data/dapp.sqlite
LOCAL_UPLOAD_DIR=./data/uploads
```

相对路径以项目启动目录为基准。默认数据位置：

| 内容                                   | 路径                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| 账户、会话、产品、转移、保修及维修记录 | `data/dapp.sqlite`                                                 |
| SQLite 工作文件                        | `data/dapp.sqlite-wal`、`data/dapp.sqlite-shm`（运行期间可能存在） |
| 已处理的产品图片                       | `data/uploads/products/<product-id>/<random-id>.webp`              |

数据保留到下次启动。`data/`、`.test-data/` 和真实环境文件均已加入忽略规则。不要提交或公开数据库，其中包含完整钱包地址、资料、会话摘要和私人维修文本。备份前停止应用，再备份整个 `data/` 目录；若使用自定义路径，数据库所在目录与图片目录都要备份。

Node 24 可能输出 `SQLite is an experimental feature` 提示；这是内置 `node:sqlite` 的状态提示。启动和测试仍应以退出码、页面和 API 实际结果判断。

## 登录与演示

连接 MetaMask，确认登录消息签名，然后填写角色和名称。组织角色还需组织名称。使用测试钱包演示；不需要导入任何项目提供的私钥。钱包与角色注册后不可通过资料修改接口更换。

登录使用五分钟有效、绑定浏览器和访问来源的一次性挑战；服务端验证真实以太坊签名。24 小时会话通过 HttpOnly、SameSite cookie 保存，数据库仅存会话令牌的 SHA-256 摘要。退出会撤销服务端会话，切换钱包账号后需要重新登录。

建议准备五个钱包，并先为每个钱包完成注册：

1. **Manufacturer** 登记产品，可上传图片。
2. 制造商填写 **Retailer** 钱包地址发起转移；零售商在 Transfers 接受。
3. 零售商交付给 **Customer A**；消费者接受后才启动保修。
4. Customer A 在产品 Warranty 页选择 **Service Center** 并提交问题。
5. 指定服务中心批准申请、填写维修结果并完成维修。只有完成时扣减一次额度；拒绝必须填写原因，且不扣额度。
6. Customer A 转售给 **Customer B**，后者接受。起止日期、已用额度和维修记录保留。
7. 无需登录，在 `/verify` 输入序列号、产品 ID，或打开二维码链接，查看公开信息及脱敏后的流转历史。

同一浏览器配置文件的标签页共享登录 cookie。演示多个身份时，可依次退出并切换 MetaMask 账户；同时演示可使用独立浏览器配置文件。

待接受转移与未结保修申请互斥。新申请在保修准确到期时或额度耗尽时被拒绝；到期前已受理的申请可在到期后完成。交易使用 SQLite `BEGIN IMMEDIATE`，并配合唯一索引、外键和状态检查。

角色自选是课堂原型的明确限制：签名能证明钱包控制权，不能证明制造商或服务中心资质。实际使用前需要组织授权机制。

## 图片

浏览器接受 JPEG、PNG、WebP，原图最多 10 MB / 25 MP。前端按比例压缩到最长边不超过 1600 像素，并转换为 WebP；上传硬上限 1 MB。服务端用 Sharp 再次解码、校验和重新编码，保存到本地目录。替换失败保留旧图片；并发替换通过旧路径比较避免覆盖。

图片由 `/api/images/<product-id>/<filename>` 公开读取，仅允许经过验证的 UUID 文件路径。产品展示图片是公开内容，不应上传私人文件。

## 验证

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

浏览器测试启动自己的端口 3000 服务，执行前请停止手动启动的服务。测试使用临时目录和 `.test-data/<随机目录>`，不修改 `data/dapp.sqlite`。

- 单元和集成测试使用真实 SQLite、真实 ethers 签名、真实路由以及 Sharp 文件处理，覆盖权限、重放/过期、状态边界、幂等性、隐私、回滚和重开数据库后的持久性。
- 浏览器完整生命周期使用合成 EIP-1193 钱包入口，但签名是真实的，认证、业务接口和磁盘存储均未伪造；同时断言应用没有发起外部请求。
- 另有 UI fixture 测试用于各角色页面和加载状态。自动化不替代真实 MetaMask 扩展弹窗的人工验收。

## 构建与部署

```sh
npm run build
npm start
```

此版本面向本机或具有持久可写磁盘的单实例 Node 服务。已移除旧的 Vercel 自动发布工作流；CI 对所有分支运行检查。不要将本地 SQLite 文件当作跨实例共享数据库。详见 [运行与部署说明](docs/deployment.md) 和 [API 与业务规则](docs/api.md)。

本次迁移未导入远端数据；默认数据库从空库开始。旧实现的本地备份位于被忽略的 `tmp/before-sqlite.zip`，不含环境文件。不要把该审查备份、依赖目录或运行数据打入课程源码提交包。
