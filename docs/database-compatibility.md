# 数据库迁移兼容性与组长执行说明

本 PR 是已合并 MR #4 的数据库验收补充。代币发行、普通转账、AMM 和 LP 的余额与交易在链上；新增数据库依赖来自商品结算的事件查询及私密售后数据。

## 实际更新范围

执行 `supabase/migrations/202610160001_demo_chain.sql`，新增：

| 对象 | 用途 |
| --- | --- |
| `dapp_demo_chain_events` | 经服务端核验的链上事件 |
| `dapp_demo_chain_sync` | 同步游标和区块锚点 |
| `dapp_demo_private_payloads` | 私密售后文字、随机盐及上下文绑定承诺 |
| `dapp_demo_product_images` | 指定链/合约中的产品图片路径 |
| `dapp_demo_ingest_events` / `dapp_demo_reset_index` | 原子同步与重组恢复，限服务角色执行 |

这份迁移不修改原有六张业务表、它们的事务函数、RLS 或数据。重复执行不会清库，也不会把旧产品自动变成链上产品。网站发布与数据库执行是两件独立的事。

## 与 issue #1 的边界

[Issue #1](https://github.com/Wenbin-Feng/Dapp_proj/issues/1) 描述了另一方案：给原有六张表增加可空链 ID，新增 `dapp_chain_events`、`dapp_chain_sync` 和 `dapp_chain_apply_event`。截至 2026-10-17，本仓库没有它声明的 `202610140002_chain_read_model.sql`、合约分支或对应 MR，因此不能声称已合并或验证那份实际实现。

现有隔离规则是：

- 本功能保留 `dapp_demo_*` 命名，避免覆盖 issue #1 声明的对象。不要把两套事件表或应用函数改成相同名字来消除表面重复。
- 当前 `PRODUCT_BACKEND=chain` 绑定 `DemoProducts` 的 ABI、部署地址和这套演示事件索引。它不是任意产品合约的通用适配器。
- 同一产品的归属只由选定合约决定。另一套合约/索引器不能直接共用本功能的商品事件或把另一套产品当成相同产品。切换实现之前必须对齐 ABI、产品 ID、权限及支付事件，再提交集成变更。
- `database` 模式使用原有六张表；`chain` 模式使用独立商品数据集并复用登录资料。保留旧模式直到 SQL、合约和钱包联调全部通过。

兼容性测试使用**已发布对象名的占位对象**和六张表的可空 `chain_id` 列，验证两种安装顺序、重复执行、旧数据/列/函数/索引/RLS/权限不被覆盖，并重跑实际旧业务流程。占位对象不代表组员真实 SQL、ABI 或事件语义；拿到实际分支后仍需做一次联合测试。

## 组长执行顺序

1. 确认 Supabase 已执行初始迁移 `202610140001_initial.sql`。不要重建或删除已有表。
2. 在 [issue #5](https://github.com/Wenbin-Feng/Dapp_proj/issues/5) 核对完整增量 SQL 与仓库迁移一致，由指定人员在 Supabase SQL Editor 执行。若已经执行成功，可直接检查，不必为本 PR 重复创建对象。
3. 执行仓库 `supabase/checks/verify_demo_chain.sql` 的完整内容。它是只读查询，应返回 **7 行，所有 `ok=true`**：基础表存在；演示表所需列存在、RLS 开启、客户端无表权限、服务角色分别具备四种 DML 权限；两个函数签名/搜索路径/执行权限正确。
4. 若出现 `ok=false`，按 `check_name` 检查对应对象并把结果留在 issue #5。不要删表、合并两套事件表或直接授予客户端权限。该检查不会自动修复或读取私密正文。
5. 在 issue #5 回复执行结果和 PR/commit；不贴密钥或私密售后内容。只有完成数据库检查、部署核对、真实钱包及云端联调后才启用链上模式。

本 PR 不新增第二份 DDL，不改写已发布迁移，也不会自动执行云端 SQL、切换网站模式或部署合约。
