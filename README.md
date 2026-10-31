# 小小记 · 账户云端版

手机网页记数工具。GitHub Pages 托管静态页面，Supabase Auth 和 PostgreSQL 保存各账户的账本。界面为中文，适合添加到手机主屏幕。

## 功能

- 销售、库存两个独立账本；加减、改数、管理物品、库存分项。
- 历史筛选及删除、北京时间统计、比例计算、固定目标。
- 每个账户独立云端记录；再次登录读取云端最新版本。
- 收到数据库提交确认后才更新数量。保存状态未知时暂停编辑，要求重新同步，避免重复加减。
- 数据库版本比较，防止两台设备静默覆盖；写入重试使用同一 mutation ID，保证幂等。
- 云端保留最近 5 个历史版本，另有按账户区分的本机副本和手动 JSON 导出。
- 登出清理当前界面与该账户的本机缓存，保留云端数据。
- 本机体验模式使用 `?local=1`，明确标示不含账户和云端同步，数据不会自动归入后来登录的账户。

## 登录方式

采用邮箱登录链接：首次登录自动创建账户，不在 GitHub Pages 上设置密码输入表单。官方 Supabase 客户端处理 PKCE 和会话刷新。用户在同一设备的同一浏览器中打开邮件链接。

上线前必须在 Supabase 设置：

1. Authentication → URL Configuration：把实际网站地址设为 Site URL，并加入 Redirect URLs 白名单。不要保留 localhost 作为正式站点地址。
2. Authentication → Email / SMTP：配置能发给实际使用者的 SMTP 服务。Supabase 默认发信只支持组织团队成员邮箱，**未配置 SMTP 不能当作多人可用的邮箱登录服务**。不要通过把网站使用者加入数据库管理员组织来绕过这个限制。
3. `dist/cloud-config.js` 只填写项目 URL、可公开的 publishable key 和可选 redirectUrl。绝不能填写 service_role、数据库密码或 SMTP 授权码。
4. 使用两个真实测试账户验证登录、写入、退出、重新登录和隔离，再正式交给其他人使用。

## 数据库

可复现迁移位于 `supabase/migrations/202610310001_accounts.sql`。迁移已在用户授权的新免费 Supabase 项目应用。

`public.tally_ledgers` 只允许登录用户读取自己的行。客户端无直接写入权限；只能调用内部使用 `auth.uid()` 的 `tally_save`。它不接受客户端提供的 user_id，并在同一事务内检查版本、保存旧副本和写入新状态。

`tally_private.backups` 不向匿名或登录客户端开放直接访问。恢复函数仅返回调用者自己的版本。

这不是跨平台容灾备份。5 个历史副本仍在同一个数据库，免费套餐也有容量、发信和闲置暂停限制。重要记录应额外导出，不能承诺任何单一服务永不丢失数据。

## 本次验证

执行 `npm test`：16 项账本测试、10 项 PostgreSQL 权限与事务测试、9 项云端客户端测试，共 35 项。PostgreSQL 测试使用 PGlite，显式模拟 `anon` 和 `authenticated` 角色。

此外，已在真实 Supabase 项目中用回滚事务验证：A 账户可以保存并读取自己的账本，B 看不到 A 的记录；测试身份和记录均已回滚，不留在生产数据库。

浏览器端界面和刷新恢复另行检查。真实邮箱登录和多人邮件投递必须在 SMTP、正式域名白名单设置完成后验证，不能用模拟测试代替。

## 发布

仓库含 GitHub Pages 工作流，安装依赖、测试、打包官方 SDK 后发布 `dist/`。GitHub 免费 Pages 需要公开仓库，仅上传代码，不上传个人账本或凭据。

```bash
npm ci
npm test
npm run build
```

`dist/vendor/supabase.js` 是由官方 npm 包构建的浏览器 SDK，构建后同源提供，无需使用者访问第三方 JavaScript CDN。

## 安全审查说明

Supabase advisor 会提示 3 个供登录用户调用的 SECURITY DEFINER RPC。它们是本项目有意设计的最小数据库写入／备份边界，均固定空 search_path、内部验证 auth.uid()、不接收目标用户 ID，并已测试跨账户与匿名拒绝；验证辅助函数和备份表不向客户端开放。

参考：https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

GitHub Pages 官方不建议处理密码等敏感交易，所以本实现选择托管邮件链接登录，不在网页中收集密码。

https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
https://supabase.com/docs/guides/auth/auth-smtp

## 当前上线状态

网站：https://gupcurie.github.io/little-tally-web/

GitHub Pages 已发布；数据库迁移及账户隔离验证完成。邮箱登录仍等待项目所有者在后台配置 URL 白名单和自定义 SMTP，因此 `cloudConfig.authEnabled` 暂设为 `false`。完成以上配置后，设为 `true` 并提交，部署后用两名真实使用者邮箱验证登录及再次登录数据恢复，再开放多人使用。密码或 SMTP 授权码仅在服务商后台填写。
