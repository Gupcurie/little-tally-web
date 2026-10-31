# 小小记网页版

手机记数与库存工具：用户名密码注册登录，销售和库存独立，支持时间记录、历史筛选、比例计算、JSON 导入导出和主屏幕安装。密码 6–128 位，允许纯数字、纯字母或其他组合；目前没有自助密码找回。

## 访问地址

- GitHub 直开试用：https://gupcurie.github.io/little-tally-web/
- 原用户名密码版：https://little-tally-pocket-455b.sharp-wave-4678.chatgpt.site/

两个入口使用同一 Supabase 项目 `pinztkcvnaswsiorhaun`，同一用户名映射到同一账户 UID。浏览器登录状态和本机体验数据按网站来源保存，不会自动跨来源迁移。本机体验记录可以在设置中导出，再在另一入口导入。GitHub 入口现在直接提供完整程序，不再跳转到其他网站。

GitHub 和数据库仍属于海外服务。此部署用于验证国内不使用代理时的实际连通性，尚未完成中国大陆多运营商实测，不能承诺国内网络稳定可用。登录页的“检查连接”分别检测网页、登录、数据和注册接口，不提交账户凭据，不创建账户。所有检查通过只代表接口连通，实际保存仍需登录后确认。

## 本地构建与验证

使用 Node.js 24：

```sh
npm ci
npm test
npm run build
node scripts/github-entry.mjs
```

GitHub Actions 构建并发布 `dist-github/`；独立站点发布 `dist/`。Supabase 官方 SDK 打包到本站，页面不依赖第三方字体或脚本 CDN。GitHub 入口声明 CSP，仅允许本站资源和指定 Supabase 接口。

## 账户与数据隔离

注册接口为 `supabase/functions/tally-accounts/index.ts`，由 `scripts/build-accounts.mjs` 从共享校验和 `src/registration.js` 打包。用户名统一小写，SHA-256 映射到内部 `.invalid` 标识，不代表真实邮箱，不发送确认邮件。密码交由 Supabase Auth 存储散列，前端不保存明文密码。

注册函数保留网关 JWT 校验，前端提供权限仅为 anon 的公开 JWT 作为网关标识。服务端从环境读取管理密钥，不向浏览器返回。它执行来源白名单、请求大小限制、输入校验和数据库持久限流；限流 RPC 仅 service_role 可调用。`TALLY_ALLOWED_ORIGINS` 可覆盖默认的两个入口 origin。

浏览器只保存公开项目配置，绝不能填写管理员密钥、数据库密码或 SMTP 授权码。

`public.tally_ledgers` 开启 RLS，只允许读取 `auth.uid()` 所属账本，没有客户端直接写入权限。保存通过 `tally_save`，服务端推导 UID，使用版本比较及 mutation UUID 防止多端覆盖和重试重复记数。私有备份保留最近 5 个历史版本，恢复接口按当前 UID 限定。重要记录仍需定期另行导出。

客户端先确认云端保存再显示新数量；保存结果不明会冻结编辑，避免重复加减。切换账户和退出时清除旧账户的显示与本机备用副本。退出登录保留云端记录。

## 数据库部署

按顺序应用 `supabase/migrations/` 的两个 SQL 文件。先检查现有表，避免重复创建。所有私有表同样启用 RLS，客户端没有 schema/table 权限。

安全检查中三个已登录用户可调用的 SECURITY DEFINER 函数是有意设计的账户 API；函数固定 search_path、检查 auth.uid()，权限和跨账户行为经过测试。相关检查说明：https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable 。免费项目的泄漏密码保护功能目前未启用。

## 迁移与验证范围

原安卓/iOS 账本 JSON 可以导入。实际云端已验证用户名注册、密码登录、再次登录恢复数量、账户隔离、幂等保存、拒绝直接写入和错误密码。模拟浏览器原生 fetch 的接收者检查覆盖注册、读取和保存，避免 Illegal invocation。前端浏览器连通性检查另行验证；中国大陆直连效果必须由实际网络确认。
