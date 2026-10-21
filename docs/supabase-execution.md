# Supabase 增量 SQL 执行与撤销

这份操作单用于团队**原有 Supabase 项目**。不用执行到新注册的个人项目，也不用重跑初始建表 SQL。网站发布、SQL 执行和合约部署是独立步骤；本说明不会自动执行任何云端操作。

## 执行顺序

在 Supabase Dashboard 选择团队项目 → SQL Editor → New query。每个脚本都完整复制、单独运行，并保存结果。

1. 运行 [`preflight_demo_chain.sql`](../supabase/checks/preflight_demo_chain.sql)，返回 12 行对象清单。已有对象的 `object_type` 必须是 `table` 或 `function`，出现 `STOP` 立即停止（同名视图、分区表等不能当作尚未安装）。六行 `base` 必须全部 `present=true`。六行 `demo` 全为 false 才是全新安装；若全部为 true，先直接做第 4 步，验收通过就不用重装。若部分存在或基础表缺失，停止并把清单发回 issue #5，先查明现状。
2. 可选：全新安装时先演练。复制正式安装 SQL，将**末尾唯一的 `commit;` 改为 `rollback;`**，完整运行；它只验证本次 SQL 能否执行，不保留修改。重新运行第 1 步，确认对象清单与演练前一致。演练过程中也会短暂占用数据库锁，请选空闲时间。
3. 正式运行 [`202610160001_demo_chain.sql`](../supabase/migrations/202610160001_demo_chain.sql)。保留开头 `begin;` 和结尾 `commit;`，整份一次运行，不要逐条选中执行。新增四张表、两个 RPC、索引和权限；不改原有六张业务表。若执行前已有同名对象，不要把重跑当成恢复方案：`create or replace function` 会替换函数定义，需要先核对现有版本并备份。
4. 运行 [`verify_demo_chain.sql`](../supabase/checks/verify_demo_chain.sql)，必须 **7 行全部 `ok=true`**。它只检查结构和权限，不读取私密售后正文。失败时保留结果，不要删表或放开客户端权限来绕过检查。
5. 在 [issue #5](https://github.com/Wenbin-Feng/Dapp_proj/issues/5) 回复项目确认、脚本版本及七行验收结果，不贴任何密钥或私密正文。完成其他联调前保留 `PRODUCT_BACKEND=database`，由组长合并 PR 并验证网站部署。

安装脚本目前是已发布的原迁移。本次仅增加检查、卸载和操作说明，不会自动启用链上模式。

## 出错后怎么撤销

**尚未提交：**安装脚本自带事务。中途报错时不会提交一半；在同一 SQL Editor 会话执行 `rollback;` 结束失败事务，再检查对象清单。若编辑器已自动结束事务，出现“没有活动事务”的提示也无需重跑安装。事务提交前可以取消全部修改，提交后单独运行 `rollback;` 无法撤销已提交操作。[PostgreSQL 事务说明](https://www.postgresql.org/docs/current/tutorial-transactions.html)

**已经提交且模块尚未使用：**确认目标对象就是本次安装的演示模块，四张表仍全部为空，并停止网站的演示写入、同步任务及相关 DDL。若已启用链上模式，先由组长把 `PRODUCT_BACKEND` 改回 `database` 并重新部署，再运行 [`rollback/202610160001_demo_chain.sql`](../supabase/rollback/202610160001_demo_chain.sql)。

卸载脚本在一个事务中先锁定四张目标表，再检查数据；任一表非空就报 `UNINSTALL_REFUSED`，不删除任何对象。只删除这两个**精确签名**的 RPC 和四张 `dapp_demo_*` 表及其自身索引；使用 `RESTRICT`，外部视图等依赖会使整笔卸载失败并回退，不递归删除其他对象。[PostgreSQL DROP TABLE 说明](https://www.postgresql.org/docs/current/sql-droptable.html)

成功卸载后重新运行第 1 步：六行 `base` 仍为 true、六行 `demo` 为 false。允许未安装或已经卸载时重复运行。原六张业务表和组员的 `dapp_chain_*` 对象不在删除范围内；测试链合约、代币、交易和 Storage 文件也不会被删除。

**模块已有数据或执行前已有对象：**先停止写入并备份结构、函数定义和数据，确认可恢复，再单独制定删除/恢复步骤。不要清空表来绕过保护，也不要加 `CASCADE`。事件通常能重新索引，但私密售后正文、随机盐和图片路径不能只靠链上数据恢复；删表后的重建也不会自动找回它们。本卸载脚本不恢复安装前的旧函数、权限或历史状态。

任何安装或卸载脚本报错后，先执行 `rollback;` 再检查；不确定错误原因时，把报错和只读检查结果发到 issue #5，暂不继续变更。

## 本地验证范围

PGlite 实际执行原业务迁移及完整产品/交接/维修流程，验证空模块卸载不改原表、数据、RPC 和权限；四张表分别有数据时均拒绝；外部依赖失败整笔回退；重复卸载安全；重新安装后七项验收通过。该结果不替代团队 Supabase 云端验收。
