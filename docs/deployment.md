# GitHub Actions → Vercel deployment

`release` 是生产发布分支。开发时切换到 `main` 或功能分支，完成修改后合并到 `release` 并推送。**远端 `release` 的每次更新都会触发生产流水线**，不要求必须通过 GitHub PR 合并。

开发分支的 push，以及目标为 `main` / `release` 的 PR，运行 TypeScript、单元/数据库测试、Chromium 浏览器测试和生产构建。生产流水线先复用同样的测试，再使用真实的 Vercel Production 配置构建并发布；生产产物只构建一次。测试使用本地占位 Supabase 配置和隔离数据库，不读取或修改云端业务数据。

## 1. 创建 Vercel 项目

在 [Vercel Dashboard](https://vercel.com/dashboard) 创建项目，可导入 `Wenbin-Feng/Dapp_proj`。使用以下设置：

| 设置 | 值 |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `./` |
| Node.js Version | `24.x` |
| Production Branch | `release` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | 保持 Next.js 默认值 |

导入页面显示 `main` 时，可先保持该分支完成项目创建，再到项目 **Settings → Environments → Production → Branch Tracking**，将分支名设为 `release` 并点击 **Save**。Node.js 位于 **Settings → Build and Deployment**。本仓库的 `vercel.json` 使用 `git.deploymentEnabled: false` 关闭 Git 集成的自动部署，后续发布统一由 GitHub Actions 驱动，确保测试通过后才上线。如果导入项目的流程执行了首次部署，仍需要完成下面的配置并运行一次 Actions，以验证生产流水线。

## 2. 配置 Vercel Production 环境变量

项目 **Settings → Environment Variables** 添加以下五项，并选择 **Production** 环境。配置值从本地私有环境文件或 Supabase Dashboard 获取；不要提交到 Git，也不要粘贴到公开 issue、日志或文档。

| 名称 | 值 | Vercel 类型 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 HTTPS URL | Config |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | Config |
| `SUPABASE_SECRET_KEY` | Supabase 服务端 secret key | Secret |
| `SUPABASE_STORAGE_BUCKET` | `dapp` | Config |
| `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` | `dapp` | Config |

`NEXT_PUBLIC_` 的两项认证配置在构建时进入客户端包，必须在执行生产构建前配置正确。`SUPABASE_SECRET_KEY` 仅由生产服务端读取，不使用 `NEXT_PUBLIC_` 前缀，也不需要重复保存到 GitHub。它可以作为 Vercel 的 Secret 类型保存，生产函数运行时会得到该值。流水线不会打印拉取的环境变量，也不会上传 `.vercel/` 或环境文件作为 artifact。

通过 `.env` 导入时，检查三项 `NEXT_PUBLIC_*` 变量均为 **Config**，避免被标记为 Sensitive Secret 后无法供 CLI 的预构建读取。`SUPABASE_SECRET_KEY` 保持 Sensitive Secret，部署时由 Vercel 注入服务端运行环境。

本地 `.env.prod` 仅用于手动导入变量。Git 的忽略规则不替代 Vercel CLI 上传规则；仓库的 `.vercelignore` 单独排除真实环境文件和本地测试产物，只保留不含凭据的 `.env.example`。线上构建使用 Vercel 项目配置的变量。

当前代码不读取 `NEXT_PUBLIC_APP_URL` 或 `SUPABASE_JWKS_URL`，两者不是部署必填项。二维码链接和 MetaMask 登录消息使用用户实际访问的域名。修改 Vercel 环境变量后，需要重新部署才能生效。

首次上线使用 Supabase 新创建或轮换后的服务端 secret key，更新本地私有环境文件及 Vercel Production；凭据不应从聊天记录复制到仓库。

## 3. 配置 GitHub Actions Secrets

打开 [仓库的 Actions Secrets 设置](https://github.com/Wenbin-Feng/Dapp_proj/settings/secrets/actions)，选择 **New repository secret**，添加：

| Secret | 获取方式 |
| --- | --- |
| `VERCEL_TOKEN` | [Vercel 账号 Tokens](https://vercel.com/account/tokens) 创建 token，选择能访问该项目的账号/团队范围 |
| `VERCEL_ORG_ID` | Vercel 团队 **Settings → General → Team ID**；个人范围也可通过下面的 `vercel link` 获取准确的 `orgId` |
| `VERCEL_PROJECT_ID` | Vercel 项目 **Settings → General → Project ID** |

也可以在本地通过固定版本 CLI 关联现有项目，读取生成文件中的 `orgId` 和 `projectId`：

```sh
npx --yes vercel@64.0.2 login
npx --yes vercel@64.0.2 link
```

选择已经创建的项目，然后查看 `.vercel/project.json`。`link` 只关联项目，不执行部署；`.vercel/` 不能提交。GitHub Secrets 必须放在 **Repository secrets**，这样部署配置检查 job 和生产 job 都能访问。

没有配置齐这三项时，流水线仍运行应用检查，输出 `Deployment skipped` 提示，并跳过部署。**检查通过不代表已经上线。** 配置齐后，部署失败会使流水线失败。

## 4. 完成 Supabase 登录与数据库配置

在 Supabase SQL Editor 运行 `supabase/migrations/202610140001_initial.sql`，并启用 **Authentication → Sign In / Providers → Web3 / Ethereum**。

在 **Authentication → URL Configuration**：

- Site URL 使用 Vercel 项目的正式 HTTPS 域名，例如 `https://<your-project>.vercel.app`。
- Redirect URLs 添加正式域名及路径，例如 `https://<your-project>.vercel.app/**`。
- 本地开发保留 `http://localhost:3000/**`；如果使用 `127.0.0.1`，单独添加相应 URL。

使用 `dapp` public Storage bucket，建议限制 1 MB，允许 `image/webp`、`image/jpeg`、`image/png`，保持匿名写入关闭。应用上传前自动压缩，服务端再次验证并以 WebP 保存。

## 5. 首次运行与日常发布

GitHub **Actions → Deploy production → Run workflow**，选择 **release** 分支运行。手动触发仅允许 `release`；其他分支不会执行测试或部署。所有检查通过后，生产 job 执行 `vercel pull --environment=production`、`vercel build --prod`、`vercel deploy --prebuilt --prod --no-wait`，提交的发布 URL 和 commit 会显示在 run Summary。随后最多等待 5 分钟，并通过 Vercel API 确认状态为 `READY` 且生产域名已分配；未就绪时流水线失败并输出经过字段筛选的状态和构建日志。仅提交成功或等待超时都不算上线成功。

日常流程：

```sh
git fetch origin
git switch release
git pull --ff-only origin release
git switch -c dev/your-change
# 修改、提交并完成本地检查。
git push -u origin dev/your-change
# 在 GitHub 提交目标为 release 的 PR，由团队在 CI 通过后合并。
```

按团队约定使用 `dev/<功能点>` 并提交目标为 `release` 的 PR。流水线按生产环境串行运行，不取消正在执行的部署，最多保留 100 个等待任务。需要重新部署已有版本时，在 Actions 手动选择 `release`；需要回退代码时，将回退提交通过 PR 合入 `release`。

生产发布后，用真实 MetaMask 钱包检查登录、首次资料填写、产品登记、图片上传、转让和保修。CI 浏览器测试使用接口 fixtures，不替代真实钱包及 Supabase 联调。

代币和商品合约的发布独立于网站 CI；网站更新不会重新发行代币。可选链上模式的部署、SQL 手工交付、索引恢复和验收步骤见 [商品结算与运维](product-settlement.md)。云端 SQL 由指定团队成员在 issue 中核对完整语句后执行；默认保留 `PRODUCT_BACKEND=database`，全部准备好再切换。

## 已部署 Sepolia 合约的网站接入

`config/demo-chain.sepolia.json` 记录 2026-10-18 已部署并核验的公开合约地址、起始区块和公共 RPC。PDC/PDQ 各发行 100 万，池子初始各 10 万；六个部署合约及 Pair 的代码、25 笔成功回执和五个演示钱包分发已独立核对。完整部署 journal 仍由团队另外备份，勿删除后重发。

生产流水线在 `vercel pull` 后运行 `scripts/prepare-demo-production.mjs`：追加公开链配置供构建使用，并通过部署的 `--env` 参数提供相同运行时配置。复用已有三项 Vercel Secrets；开发同学无需单独登录 Vercel。团队原 Supabase 项目、服务端密钥和 Storage 配置继续从原 Vercel 项目拉取，不需要新建 Supabase 数据库。

默认 `PRODUCT_BACKEND=database`，合并到 `release` 后先开放已配置的代币钱包、AMM 兑换和 LP。部署完成后检查 `/api/chain/config` 应返回 Sepolia 与本次合约地址，而不是 `data: null`。

商品链上模式仍需原 Supabase 项目完成 [issue #5](https://github.com/Wenbin-Feng/Dapp_proj/issues/5) 的增量 SQL 和七项只读验收。准备完成后，在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 设置 `PRODUCT_BACKEND=chain`，再手动运行 `release` 的生产流水线；无需修改 Vercel Dashboard。回到数据库商品模式则设为 `database` 后重新运行。切换使用独立商品数据集，旧数据库产品不会自动迁移上链。

## 官方资料

- [Vercel：GitHub Actions 部署](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)
- [Vercel：设置生产分支](https://vercel.com/kb/guide/can-i-use-a-non-default-branch-for-production)
- [GitHub：部署并发与排队](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Vercel：关闭 Git 自动部署](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel：环境变量](https://vercel.com/docs/environment-variables)
- [Vercel：Config 与 Secret 类型](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Supabase：Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
