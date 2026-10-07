# 仓库改名（rename）对 GitHub Pages / Actions 的影响：官方文档取证

> **项目：** images-viewer（React + Vite + TypeScript，Pages Source = GitHub Actions）
> **问题：** 把 `KimHoLau/images-viewer` 改名成别的名字（例如 `raw-images-studio`）后，
> Pages 站点、旧 URL、`github-pages` 环境、Pages 配置、工作流会怎样？
> **日期：** 2026-10-07
> **研究员：** AI Agent
> **取证方法：** 只采信一手来源 —— `docs.github.com` 的**原文 markdown**（`github/docs` 仓库
> `main` 分支 content 目录）、`github.blog`、GitHub 官方 CLI 手册与**源码**、GitHub 官方
> Action 仓库 README；外加对线上 URL / API 的**实测**。
> 所有引用都在文末「来源清单」给出精确 URL。凡文档没写的，一律标注「**文档未写明**」，
> 不做推测性断言。

---

## 0. 结论速览

| # | 问题 | 结论 | 文档是否明确 |
|---|------|------|--------------|
| 1a | Pages 站点 URL 是否自动变成新仓库名 | 站点 URL **由仓库名推导**（默认位置表），改名后新 URL 为 `https://<user>.github.io/<new-name>/`；但「改名后无需重新部署即在新 URL 生效」**没有**任何文档明确写 | 推导（表格式定义）+ 其余**未写明** |
| 1b | 旧 Pages URL 怎么办 | **不重定向**。改名文档把「project site URLs」明确列为重定向的**唯一例外**；2013 官方博客同一句话：Pages 站点在仓库改名时不会被自动重定向，旧链接会失效 | **明确**（不重定向）；返回码/旧内容是否短暂可用 **未写明** |
| 1b | 重定向持续多久 | 文档**没有**给时限；唯一写明会失效的条件是「以后又用原名字建了新仓库」 | **明确**（终止条件）；时限 **未写明** |
| 1b | 用户/组织页 vs 项目页有无差别 | 改名文档的例外只写了「project site URLs」；用户/组织页仓库必须叫 `<owner>.github.io`，其默认 URL 不含仓库名。**两者在改名重定向上的差异，文档没有单独说明** | **未写明** |
| 1c | 仓库级重定向覆盖页面 / git 远端 / API 吗 | 页面流量：明确重定向；`git clone/fetch/push`：明确「继续照常工作」；**`api.github.com/repos/<old>` 文档完全没提**（实测 = 301 到 `https://api.github.com/repositories/<id>`） | 页面/git = **明确**，API = **未写明**（仅实测） |
| 2a | Actions 运行记录 / `github-pages` 环境 | 文档**没有**任何关于改名对环境、环境 URL、Required reviewers 影响的一句话 | **未写明** |
| 2b | Pages 配置本身（是否仍启用 / `build_type` / CNAME） | 文档**没有**任何关于改名对 Pages 配置影响的一句话；`build_type` 只出现在 REST 自动生成的 OpenAPI 数据里，正文文档没有 | **未写明**（实测当前配置见 §4） |
| 2c | 引用仓库名的工作流文件 / `deploy-pages` | 文档明确：**不改名重定向「被改名仓库托管的 action」**，用了它的工作流会以 `repository not found` 失败。仓库自己工作流里硬编码仓库名（如 Vite `base`）文档没写，但实测本仓库确有硬编码 | action 部分 **明确**；硬编码路径 **未写明** |
| 3 | 保留 issue/star/历史的改名方式 | Web UI：Settings → Repository Name → Rename；CLI：`gh repo rename <new-name>`。改名后 Issue/Wiki/Star/Followers 自动重定向 | **明确** |
| 3 | 要不要跑 `gh repo set-default` / 改 git remote / 重新部署 | remote：文档建议自己 `git remote set-url`，而 `gh repo rename` **源码显示它会自动帮你改本地 remote**。`gh repo set-default`：手册**没有**提到改名后需要跑。重新部署：文档没写 | remote 部分 **明确**；`set-default` **未写明** |
| 4 | 是否必须「删除再重新启用 Pages」 | 文档**没有**这个要求，也没有任何「改名前/后要重新启用 Pages」的说法。文档只在「**取消发布**（unpublish）」语境下写：一次成功的工作流运行即产生新部署 | 无此要求（=**未写明**，但无此要求） |
| 5 | 改名后的缓存 / DNS 坑 | 文档只在**自定义域名**语境下写缓存/DNS：浏览器缓存要清、HTTPS 最长 1 小时生效、改路由路径**不会**触发重建。改名专属的缓存/DNS 说明：**没有** | **未写明**（改名专属部分） |

---

## 1. 一手原文（关键句）

### 1.1 改名文档（唯一直接相关的一页）

`docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository`
（原文：`github/docs` → `content/repositories/creating-and-managing-repositories/renaming-a-repository.md`）

开头第一句就是本项目最关心的那句：

> "When you rename a repository, all existing information, **with the exception of project site URLs**,
> is automatically redirected to the new name, including:
> * Issues
> * Wikis
> * Stars
> * Followers"

git 远端：

> "In addition to redirecting web traffic, all `git clone`, `git fetch`, or `git push` operations
> targeting the previous location will continue to function as if made on the new location.
> However, to reduce confusion, we strongly recommend updating any existing local clones to point
> to the new repository URL."

对「有 Pages 的仓库要改名」的官方建议：

> "If you plan to rename a repository that has a GitHub Pages site, we recommend using a custom domain
> for your site. This ensures that the site's URL isn't impacted by renaming the repository."

关于被改名仓库托管的 action（对工作流的直接影响）：

> "GitHub will not redirect calls to an action hosted by a renamed repository. Any workflow that uses
> that action will fail with the error `repository not found`."

关于重定向的失效条件（文档中唯一的「有效期」说法）：

> "If you create a new repository under your account in the future, do not reuse the original name of
> the renamed repository. If you do, redirects to the renamed repository will no longer work."

改名步骤（Web UI，无其他前置步骤）：

> "1. In the **Repository Name** field, type the new name of your repository.
>  2. Click **Rename**."

### 1.2 Pages 站点 URL 是怎么定义的

`docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages`

| Property | User and organization sites | Project sites |
|---|---|---|
| Source files | "Must be stored in a repository named `<owner>.github.io`" | 仓库内某个文件夹 |
| Default site location | `http(s)://<owner>.github.io` | `http(s)://<owner>.github.io/<repositoryname>` |

**注意**：这是全文唯一说明「站点 URL 从哪来」的地方。它写的是
`<repositoryname>`，但**没有**任何一句说「改名后 URL 会自动切换」。

### 1.3 官方博客（2013，重定向功能上线时）

`github.blog/news-insights/product-news/repository-redirects-are-here/`

> "we'll automatically redirect all requests for previous repository locations to their new home"

> "As a special bonus, we'll also be servicing all Git clone, fetch, and push requests from previous
> repository locations."

> "There is one caveat with the new redirect support worth noting: **GitHub Pages sites are not
> automatically redirected when their repositories are renamed at this time.** Renaming a Pages
> repository will continue to break any existing links to content hosted on the **github.io** domain
> or custom domains."

### 1.4 转仓库（transfer）文档：同一件事的另一处措辞

`docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository`

> "If the transferred repository contains a GitHub Pages site, then links to the Git repository on the
> Web and through Git activity are redirected. However, **we don't redirect GitHub Pages associated
> with the repository**."

> "If you create a new repository or fork at the previous repository location, the redirects to the
> transferred repository will be **permanently deleted**."

### 1.5 Pages 配置 / 部署相关（没有任何一句提到 «rename»）

`content/pages/...` 全目录代码检索结果：`renamed` 命中 **0** 次；`rename` 命中 **1** 次，
且只出现在 `what-is-github-pages.md` 的 `redirect_from` 历史 slug 里（`/articles/should-i-rename-usernamegithubcom-repositories-to-usernamegithubio`），**不是正文**。
也就是说：**Pages 文档正文完全没有覆盖「仓库改名」这个场景。**

工作流模板与 `github-pages` 环境（`configuring-a-publishing-source-for-your-github-pages-site.md`）：

> "The workflow templates use a deployment environment called `github-pages`. If your repository does
> not already include an environment called `github-pages`, the environment will be created
> automatically."

> "GitHub Pages does not associate a specific workflow to the GitHub Pages settings. However, the
> GitHub Pages settings will link to the workflow run that most recently deployed your site."

CNAME 的真相（对本仓库 CNAME 为 null 的情况有意义）：

> "A `CNAME` file in your repository file does not automatically add or remove a custom domain.
> Instead, you must configure the custom domain through your repository settings or through the API."

`using-custom-workflows-with-github-pages.md`：

> "An `environment` must be established to enforce branch/deployment protection rules. The default
> environment is `github-pages`."
> "To specify the URL of the page as an output, utilize the `url:` field."

`unpublishing-a-github-pages-site.md`（**这是「重新发布」唯一有文档的场景，但不是改名场景**）：

> "A successful workflow run in the repository for your site will create a new deployment.
> Trigger a workflow run to redeploy your site."

### 1.6 缓存 / DNS 相关的全部官方说法

`troubleshooting-404-errors-for-github-pages-sites.md`：

> "Switching the repository's visibility from public to private or vice versa **will change the URL** of
> your GitHub Pages site, which will result in broken links until the site is rebuilt."

> "If you are able to access your landing page, but encounter broken links throughout, it is likely
> because you either didn't have a custom domain name before or are reverting back from having a custom
> domain name. In such cases, **changing the routing path does not initiate a rebuild of the page**."

`troubleshooting-custom-domains-and-github-pages.md`：

> "It can take up to an hour for your site to become available over HTTPS after you configure your
> custom domain."

> "If you've recently changed or removed your custom domain and can't access the new URL in your
> browser, you may need to clear your browser's cache to reach the new URL."

> "If you are publishing from a custom GitHub Actions workflow, any CNAME file is ignored and is not
> required."

### 1.7 CLI 侧

`gh repo rename`（手册 `cli.github.com/manual/gh_repo_rename`）：

```
gh repo rename [<new-name>] [flags]
Rename a GitHub repository.
```

**源码**（`cli/cli` → `pkg/cmd/repo/rename/rename.go`）显示它不只是调 API：改名成功后
`renameRun` 会调用 `updateRemote(...)` → `opts.GitClient.UpdateRemoteURL(...)`，并在终端打印
`Updated the "origin" remote`。即 **`gh repo rename`（不带 `-R`）会自动把本地 remote 改到新名字**；
用 `-R` 指定别的仓库时才跳过（源码里 `if opts.HasRepoOverride { return nil }`）。

`gh repo set-default` 手册（`cli.github.com/manual/gh_repo_set-default`）通篇**没有**提到
rename 后需要重设，只说明它决定 gh 查询 API 时用哪个仓库。

---

## 2. 逐题回答

### 1a. 改名后新 Pages URL 会自动生效吗？

- **文档明确的部分**：项目页的默认位置定义就是 `http(s)://<owner>.github.io/<repositoryname>`
  （§1.2）。所以仓库改名后，新 URL 是 `https://<user>.github.io/<new-name>/`，旧名字那段路径不再是
  这个仓库的默认位置。
- **文档未写明**：没有任何一句说「改名后站点会立刻在新 URL 提供服务」或「不需要重新部署」。
  对比 §1.6 那句 visibility 改动「will change the URL … until the site is rebuilt」，可见 GitHub 在
  别的 URL 变更场景里是会写明「需要重建」的，而**改名场景没写**——这是文档的空白，不是证据。

### 1b. 旧 Pages URL 会怎样？

- **明确：不重定向。** 改名文档把 `project site URLs` 列为重定向的唯一例外；2013 官方博客把话说得更直：
  "GitHub Pages sites are not automatically redirected when their repositories are renamed"，
  旧链接（`github.io` 域名上的、或自定义域名上的）会一直坏（"will continue to break any existing links"）。
- **未写明**：具体返回码是 404 还是别的、旧内容是否会被短暂提供、CDN 缓存是否还会命中——文档都没有写。
- **重定向时长**：文档**不给时限**。唯一写明的终止条件是：以后又用回原仓库名（改名文档
  "redirects to the renamed repository will no longer work"；转仓库文档 "permanently deleted"）。
  可理解为「只要不复用旧名就一直有效」，但这是对文档措辞的归纳，文档没有写「永久」二字。
- **用户/组织页 vs 项目页**：改名文档的例外只针对 "project site URLs"，**没有**单独说明用户/组织页。
  唯一相关的是 §1.2 的约束：用户/组织页的源文件「必须存放在名为 `<owner>.github.io` 的仓库里」，
  而它的默认 URL 是 `http(s)://<owner>.github.io`，本身不含仓库名。
  把 `<owner>.github.io` 这个仓库改名成别的名字会发生什么，**文档未写明**（可推知它不再满足用户页的命名要求，
  但请按「未写明」处理）。

### 1c. 仓库级重定向覆盖到哪些面？

| 面 | 文档说法 | 实测 |
|---|---|---|
| 网页流量（github.com 旧路径） | 明确重定向（§1.1 第一句；§1.3） | 本次网络下 `github.com` 连接超时，**未能实测**（网络问题，不是结论） |
| `git clone/fetch/push`（含远端 URL） | 明确：「will continue to function as if made on the new location」 | 未实测（文档已足够明确） |
| `api.github.com/repos/<old>` | **未写明** —— 改名文档、REST 文档正文、博客都没提 API | **实测 301**：`api.github.com/repos/vuejs/vue-next` → `301`，`Location: https://api.github.com/repositories/137078487`；`api.github.com/repos/zeit/next.js` → `301`，`Location: https://api.github.com/repositories/70107786` |
| 被改名仓库托管的 Action | 明确**不**重定向：工作流报 `repository not found` | — |

实测细节：两个样例（`vuejs/vue-next`→`vuejs/core` 属同组织内纯改名；`zeit/next.js`→`vercel/next.js`
属组织改名）都返回 **301**，且 `Location` 指向**按数字 ID 的规范地址**
`https://api.github.com/repositories/<id>`，而不是新名字的 URL。另外
`api.github.com/repos/Microsoft/vscode` 直接返回 **200**（大小写不同不触发重定向）。
这些都是 GitHub 线上 API 的行为观测，**不是文档承诺**。

### 2a. 对 Actions 运行记录 / `github-pages` 环境的影响

- **文档未写明。** 改名文档、`manage-environments`、`deployments-and-environments` 三处都没有一句
  提到 rename 对 environment、environment URL 或 Required reviewers 的影响。
- 可引用的相关事实（仍在环境语境下，非改名语境）：环境是仓库级设置；`github-pages` 环境在缺失时
  会被自动创建（§1.5）；Required reviewers 最多 6 个（`deployments-and-environments.md`:
  "You can list up to six users or teams as reviewers."）。
  **能不能顺推出「改名不影响它们」？文档没写，这里不做断言。**
- 本仓库的 `deploy` job 把环境 URL 写成 `${{ steps.deployment.outputs.page_url }}`
  （`.github/workflows/deploy.yml:49-51`）。`deploy-pages` README 把 `page_url` 定义为
  "The URL of the deployed Pages site"。**因此下一次部署写入的环境 URL 理应是新 URL** ——
  但「改名后环境 URL 会不会被自动修正 / 历史 deployment 记录会不会改」**文档未写明**。

### 2b. 对 Pages 配置本身的影响

- **文档未写明。** 没有任何一句说明改名前启用的 Pages 是否保持启用、`build_type` 是否保持
  `workflow`、CNAME / 自定义域名设置是否保留。
- 能拿到的官方事实：`build_type`、`cname`、`html_url`、`custom_404`、`https_enforced` 等都是
  **仓库级 Pages 设置**（REST Pages 端点暴露这些字段）；自定义域名必须在仓库设置或 API 里配置，
  仓库里的 `CNAME` 文件不会自动加/删域名（§1.5）。
- 文档给出的**间接建议**是：本来有 Pages 的仓库要改名，就用自定义域名，这样 URL 不受改名影响（§1.1）。
  本仓库当前 `cname: null`（无自定义域名，见 §4），所以这条建议对本仓库**不适用**，
  改名就会真真切切换 URL。

### 2c. 对引用仓库名的工作流文件 / `deploy-pages` 的影响

- **文档明确的一条**：被改名仓库托管的 action 不会被重定向，引用它的工作流会失败（`repository not found`）。
  ⚠️ 这条**不影响本仓库**：`deploy.yml` 引用的都是 `actions/*` 官方 action，不引用本仓库自己发布的 action。
- **文档未写明**：仓库自己的工作流里硬编码仓库名（例如 Vite 的 `base` 路径、README 里的站点链接）
  改不改、怎么改。若工作流把站点 URL 写死，属于「应用侧配置」，不在 GitHub 文档范围内。
- `deploy-pages` 本身的机制（官方 README）：部署到 `github-pages` 环境、`page_url` 输出部署后的站点 URL、
  推荐保护该环境；`configure-pages` README 的定位是 "enable Pages and extract various metadata about a site"。
  这些都与仓库名无关，**文档未写明**改名会改变其行为。

### 3. 保留 issue / star / 历史的改名方式与注意事项

**官方步骤（两条路，等价）**

1. Web UI：仓库 → **Settings** → **Repository Name** 字段填新名字 → **Rename**（§1.1 步骤原文）。
2. CLI：`gh repo rename <new-name>`（当前仓库），或 `gh repo rename -R owner/repo <new-name>`；
   `-y/--yes` 跳过确认。不带 `-R` 时 gh **会自动更新本地 remote**（§1.7 源码证据）。

**改名保留什么（明确）**：Issue、Wiki、Star、Followers 都会自动重定向到新名字（§1.1）。

**文档写明的注意事项**

- 别再用旧名字建新仓库，否则重定向失效（§1.1 WARNING）。
- 文档**强烈建议**自己更新本地 clone 的 remote（`git remote set-url origin NEW_URL`）；
  但 `gh repo rename` 已经自动做了这件事（§1.7）。
- 有 Pages 的仓库改名，推荐改用自定义域名（§1.1）。
- 被改名仓库托管的 action 不会重定向（§1.1）。

**文档没有写的**（不要当成要求，也不要当成反面结论）

- 改名后是否要跑 `gh repo set-default`：手册没提。
- 改名后是否要重新部署 Pages、是否要重新启用 Pages：没提。
- 改名后是否需要动 Pages 的 `Source` 设置：没提。

### 4. 是否必须「删除再重新启用 Pages」？

- **文档没有这个要求。** 全站 Pages 文档正文里 `renamed` 命中 0 次（§1.5），自然也没有
  「改名后要重新启用」的说明。
- 唯一有文档的「重新发布」场景是 **unpublish（取消发布）**：文档说一次成功的工作流运行就会创建新部署
  （§1.5）。把这条**迁移**到改名场景是一种类推，文档并未这样写。
- 另一条已知的自动重建触发条件是 **visibility 变更**：「will change the URL … until the site is rebuilt」
  （§1.6）——这反过来证明 GitHub 在需要重建时是会写出来的；改名场景没写，属于空白。

### 5. 改名后的缓存 / DNS 坑

- **改名专属的缓存/DNS 说明：没有。**
- 能引用的只有自定义域名语境的官方说法：清浏览器缓存、HTTPS 最长 1 小时生效、
  「changing the routing path does not initiate a rebuild of the page」、DNS 配置错误排查（§1.6）。
- 由于旧 Pages URL 本来就不做重定向（§1.3），**旧 URL 上的 CDN/浏览器缓存会不会短暂继续提供旧内容，
  文档未写明**。

---

## 3. 实测记录（2026-10-07，本机网络）

### 3.1 站点可用性

| 请求 URL | HTTP 状态 | `<title>` |
|---|---|---|
| `https://kimholau.github.io/images-viewer/` | **200 OK** | `Images Viewer` |
| `https://kimholau.github.io/raw-images-studio/` | **404 Not Found** | （无） |
| `https://kimholau.github.io/` | **404 Not Found** | （无） |

结论：目前站点仍在**旧名字**下正常服务；`raw-images-studio` 在 Pages 上不存在；
该账号**没有**用户页仓库 `KimHoLau.github.io`（根路径 404）。
另外 `https://api.github.com/repos/kimholau/raw-images-studio` → **404**，
`https://api.github.com/repos/kimholau/images-viewer` → **200**，
说明这次改名**尚未发生**。

### 3.2 本仓库实时 Pages 配置（`gh api repos/KimHoLau/images-viewer/pages`）

```json
{
  "html_url": "https://kimholau.github.io/images-viewer/",
  "build_type": "workflow",
  "cname": null,
  "custom_404": false,
  "status": null,
  "source": { "branch": "main", "path": "/" },
  "public": true,
  "https_enforced": true,
  "protected_domain_state": null,
  "pending_domain_unverified_at": null
}
```

要点：`build_type` 已是 `workflow`（Source = GitHub Actions）；**没有自定义域名**（`cname: null`），
所以一旦改名，`html_url` 里那一段 `images-viewer` 一定会变，且按文档旧 URL 不会重定向。

### 3.3 重定向行为实测

| 请求 | 状态 | `Location` |
|---|---|---|
| `https://api.github.com/repos/vuejs/vue-next`（纯改名 → `vuejs/core`） | **301** | `https://api.github.com/repositories/137078487` |
| `https://api.github.com/repos/zeit/next.js`（组织改名 → `vercel/next.js`） | **301** | `https://api.github.com/repositories/70107786` |
| `https://api.github.com/repos/Microsoft/vscode`（仅大小写不同） | **200** | — |
| `https://github.com/zeit/next.js` | 连接超时 | 本机网络问题，**非结论** |

### 3.4 本仓库内硬编码了旧仓库名的地方（改名后必须处理）

| 位置 | 内容 | 改名后影响 |
|---|---|---|
| `vite.config.ts:11` | `const base = process.env.GITHUB_ACTIONS ? '/images-viewer/' : '/';` | **必须改**。否则构建产物引用 `/images-viewer/assets/...`，在新 URL 下 JS/WASM/Worker 全部 404（文件注释里已写明这个理由） |
| `README.md:259-262` | 写着 Pages 部署在 `/images-viewer/` 下、站点地址 `https://kimholau.github.io/images-viewer/` | 文档性描述，需同步更新 |
| `package.json:2`、`package-lock.json` | `"name": "images-viewer"` | 与 Pages 无关（npm 包名），可选改 |
| `src/services/thumbnail-cache.ts:29` | `DB_NAME = 'images-viewer'` | 仅本地 IndexedDB 名，与 URL 无关；改名会换个新库名（缓存「变空」但不报错） |
| `.github/workflows/deploy.yml` | 触发 `push: [main]` + `workflow_dispatch`；`environment: github-pages`；`url: ${{ steps.deployment.outputs.page_url }}`；`actions/upload-pages-artifact@v3` | 工作流本身不含仓库名，改完**理论上**只需重跑一次 `workflow_dispatch` 让 `page_url` 写入新 URL；另外文档对 github.com 推荐 `upload-pages-artifact@v4`，这里用的是 `@v3`（与改名无关的独立小问题） |

---

## 4. 文档「没有写」的清单（重要，不要当结论）

1. 改名后 Pages 是否**自动**在新 URL 提供服务、是否**需要**重新部署或重新启用 Pages。
2. 旧 `github.io/<old-name>/` 的**具体返回码**、旧内容/缓存是否会短暂可用。
3. 重定向的**时长**（只写了「复用旧名就失效」这一终止条件）。
4. 用户/组织页（`<owner>.github.io`）被改名后会发生什么，以及它与项目页在重定向上的差异。
5. `api.github.com/repos/<old>` 的重定向（文档零提及；只有实测 301）。
6. 改名对 `github-pages` 环境本身、环境 URL、历史 deployment 记录、Required reviewers 的任何影响。
7. 改名后 `build_type` / Pages 启用状态 / `cname` / 自定义域名设置是否原样保留。
8. 是否需要跑 `gh repo set-default`。
9. 改名专属的 CDN / 浏览器缓存 / DNS 注意事项。
10. 仓库自己工作流里硬编码仓库名的处理（非 GitHub 文档职责范围）。

---

## 5. 可以得到文档支撑的操作建议（供改名前后的 checklist 用）

1. **先决定是否要自定义域名**：文档明确建议「计划改名的 Pages 仓库用自定义域名」，这样 URL 不受影响
   （§1.1）。本仓库目前没有自定义域名。
2. **改名操作**：Web UI Settings → Rename，或 `gh repo rename <new-name>`。
   `gh repo rename` 会自动更新本地 remote；若用 Web UI 或 `-R`，按文档自己跑
   `git remote set-url origin <NEW_URL>`。
3. **不要再用旧名字建仓库**，否则重定向失效（§1.1）。
4. **改 `vite.config.ts:11` 的 `base`**（以及 README 里的站点 URL），这是本仓库改名后**最可能直接把站点搞挂**的一点。
5. **重跑一次 Pages 部署**（`deploy.yml` 已支持 `workflow_dispatch`），让 `page_url` 输出/环境 URL 落到新 URL。
   注意：第 5 步是**工程上的稳妥做法**，不是文档要求——文档对改名场景什么都没写。
6. **不要**删除/重新创建仓库来「改名」：那会丢掉 issue/star/历史，而 rename 本身就会保留它们（§1.1）。

---

## 6. 来源清单

### docs.github.com 正文（人类可读页面）

- 仓库改名：<https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository>
- 什么是 GitHub Pages（站点类型 / 默认 URL 表）：<https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>
- 配置发布源（`github-pages` 环境、`build_type`、CNAME 说明）：<https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>
- 使用自定义工作流（`deploy-pages` 要求、环境、`url:` 输出）：<https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- 取消发布 Pages 站点（重新发布的唯一文档场景）：<https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site>
- 排查 Pages 404（visibility 改 URL、浏览器缓存、custom domain 不触发重建）：<https://docs.github.com/en/pages/getting-started-with-github-pages/troubleshooting-404-errors-for-github-pages-sites>
- 自定义域名与 Pages：<https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages>
- 排查自定义域名与 HTTPS（1 小时、清缓存、CNAME 被忽略）：<https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages>
- 转移仓库（Pages 不重定向的另一处措辞）：<https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository>
- 用户名变更（重定向与失效条件，作为对照）：<https://docs.github.com/en/account-and-profile/concepts/username-changes>
- 管理部署环境：<https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- 部署与环境参考（Required reviewers 等）：<https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- REST：Pages 端点：<https://docs.github.com/en/rest/pages>

### 以上页面的原文 markdown（`github/docs`，逐句引用的出处）

- <https://raw.githubusercontent.com/github/docs/main/content/repositories/creating-and-managing-repositories/renaming-a-repository.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/getting-started-with-github-pages/what-is-github-pages.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/getting-started-with-github-pages/troubleshooting-404-errors-for-github-pages-sites.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages.md>
- <https://raw.githubusercontent.com/github/docs/main/content/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages.md>
- <https://raw.githubusercontent.com/github/docs/main/content/repositories/creating-and-managing-repositories/transferring-a-repository.md>
- <https://raw.githubusercontent.com/github/docs/main/content/account-and-profile/concepts/username-changes.md>
- <https://raw.githubusercontent.com/github/docs/main/content/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.md>
- <https://raw.githubusercontent.com/github/docs/main/content/actions/reference/workflows-and-actions/deployments-and-environments.md>

### GitHub 官方博客

- Repository redirects are here!（2013-05-16，Pages 不重定向的原始出处）：
  <https://github.blog/news-insights/product-news/repository-redirects-are-here/>
  （正文 JSON：<https://github.blog/wp-json/wp/v2/posts?slug=repository-redirects-are-here>）

### GitHub CLI（手册 + 源码）

- `gh repo rename`：<https://cli.github.com/manual/gh_repo_rename>
- `gh repo set-default`：<https://cli.github.com/manual/gh_repo_set-default>
- 实现源码（自动更新本地 remote 的证据）：<https://github.com/cli/cli/blob/trunk/pkg/cmd/repo/rename/rename.go>
  （原文：<https://raw.githubusercontent.com/cli/cli/trunk/pkg/cmd/repo/rename/rename.go>）

### GitHub 官方 Action 仓库

- `actions/deploy-pages` README（`page_url`、`github-pages` 环境）：<https://github.com/actions/deploy-pages>
- `actions/configure-pages` README：<https://github.com/actions/configure-pages>

### 本次实测请求（非文档，行为观测）

- <https://kimholau.github.io/images-viewer/> → 200，`<title>Images Viewer</title>`
- <https://kimholau.github.io/raw-images-studio/> → 404
- <https://kimholau.github.io/> → 404
- <https://api.github.com/repos/kimholau/images-viewer> → 200
- <https://api.github.com/repos/kimholau/raw-images-studio> → 404
- `gh api repos/KimHoLau/images-viewer/pages` → `build_type: workflow`、`cname: null`
- <https://api.github.com/repos/vuejs/vue-next> → 301 → <https://api.github.com/repositories/137078487>
- <https://api.github.com/repos/zeit/next.js> → 301 → <https://api.github.com/repositories/70107786>
- <https://api.github.com/repos/Microsoft/vscode> → 200
