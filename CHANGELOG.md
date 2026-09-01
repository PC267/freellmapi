# 更新日志

本文件记录对该 FreeLLMAPI 部署实例所做的**运维/配置变更**（区别于上游 `feat(catalog)` 代码目录变更）。

## 2026-09-01 — 模型清单整理（基于运行数据）

对运行中的网关（容器 `freellmapi-freellmapi-1`，数据卷 `freeapi.db`）做了一次基于真实请求数据的模型整理。共 6485 条历史请求记录。

### 1. 禁用 27 个「成功率 < 90%」的模型

**判断口径**：近 30 天有请求记录、且成功率 < 90%。

| 类别 | 模型 |
|---|---|
| 成功率 40–70% | `zhipu/glm-4.7-flash`(62.1%)、`openrouter/nvidia/nemotron-nano-12b-v2-vl:free`(42.9%) |
| 0%（上游已下架/取消免费） | `ollama/qwen3-coder:480b`、`ollama/qwen3-coder-next`、`ollama/glm-4.7`、`ollama/devstral-2:123b`、`ollama/cogito-2.1:671b`、`nvidia/deepseek-ai/deepseek-v4-pro`、`nvidia/deepseek-ai/deepseek-v4-flash`、`nvidia/moonshotai/kimi-k2.6`、`nvidia/z-ai/glm-5.1`、`nvidia/minimaxai/minimax-m2.7`、`nvidia/meta/llama-4-maverick-17b-128e-instruct`、`nvidia/qwen/qwen3-coder-480b-a35b-instruct`、`nvidia/mistralai/mistral-large-3-675b-instruct-2512`、`nvidia/meta/llama-3.3-70b-instruct`、`openrouter/moonshotai/kimi-k2.6:free`、`openrouter/z-ai/glm-4.5-air:free`、`openrouter/openai/gpt-oss-120b:free`、`openrouter/openai/gpt-oss-20b:free`、`openrouter/qwen/qwen3-coder:free`、`openrouter/qwen/qwen3-next-80b-a3b-instruct:free`、`openrouter/meta-llama/llama-3.3-70b-instruct:free`、`openrouter/poolside/laguna-m.1:free`、`openrouter/google/gemma-4-31b-it:free`、`openrouter/openrouter/owl-alpha`、`zhipu/glm-4.6v-flash`（`max_tokens` 参数越界） |

**处理方式**：同时将 `fallback_config.enabled` 与 `models.enabled` 置为 0（从路由链彻底移除，且不会被启动迁移逻辑重新启用）。

**保留**：近 30 天零流量模型按用户要求原样保留（无成功率数据，不作判断）。

### 2. 重排 fallback 链优先级（priority → 1..74 连续）

**排序标准**：实测表现优先 —— 充分样本（≥5 次）按成功率降序、延迟升序；小样本（1–4 次）次之；零流量模型按能力层级 `Frontier > Large > Medium > Small` → `intelligence_rank` 排后。

前 6 名（均为实测成功率 ≥91% 的主力）：

| 优先级 | 模型 | 成功率 | 平均延迟 |
|---|---|---|---|
| 1 | `nvidia/nvidia/nemotron-3-super-120b-a12b` | 99.3% | ~36s |
| 2 | `ollama/gpt-oss:120b` | 97.3% | ~7s |
| 3 | `openrouter/nvidia/nemotron-3-super-120b-a12b:free` | 97.3% | ~22s |
| 4 | `ollama/gpt-oss:20b` | 94.4% | ~6s |
| 5 | `zhipu/glm-4.5-flash` | 92.7% | ~13s |
| 6 | `nvidia/meta/llama-3.1-70b-instruct` | 91.2% | ~39s |

### 3. 修复 4 个残留链开关

发现并关闭了 4 个「模型已禁用、但 fallback 链开关仍启用」的残留行（制造 priority 冲突，本就不参与路由）：

- `google/gemini-2.5-pro`
- `cerebras/qwen-3-235b-a22b-instruct-2507`
- `google/gemini-3.1-pro-preview`
- `cerebras/llama3.1-8b`

### 未变更项

- **路由策略保持 `reliable`**（bandit 自动模式：可靠性 70% + 速度 15% + 智能 15%，统计窗口 7 天、半衰期 2 天）。priority 仅作为分数接近时的备用顺序（tiebreaker）。
- 未改动任何代码文件。

### 备份

- `server/data/freeapi.db.bak-2026-09-01-00-13-24`（禁用前）
- `server/data/freeapi.db.bak-2026-09-01-00-20-14-reorder`（重排前）

> 备份位于 Docker 数据卷 `freellmapi-data` 内，路径为容器内 `/app/server/data/`。回滚方式：`docker cp` 取出对应 `.db` 备份覆盖 `freeapi.db` 后重启容器。

### 验证

- `/v1/models` 已同步（返回 72 个去重后的模型）。
- 实际 `auto` 路由请求返回 `200 OK`，未命中任何已禁用模型。
- 改动即时生效，无需重启。

---

## 2026-09-01 — 版本库同步与 Git 环境修复

将上述变更提交并推送到 GitHub，同时修复了本机 Git 推送链路。

### 提交记录（推送至 `origin/main`）

| 提交 | 类型 | 说明 |
|---|---|---|
| `9220ff1` | docs | 新增 `CHANGELOG.md`，记录模型清单整理 |
| `51bf6ea` | chore | 提交 `reasonix.toml`、`reasonix_1.toml` 本地配置 |

远程仓库：`https://github.com/PC267/freellmapi.git`

### 问题与修复

- **现象**：`git push` 一直卡死（超时 > 2 分钟）。
- **根因**：`~/.gitconfig` 中有一条 `insteadOf` 规则（`git@github.com:` → `https://github.com/`），把 SSH 强制改写为 HTTPS；而本机 **HTTPS(443) 访问 GitHub 被阻断**，SSH(22) 正常且密钥已认证 `PC267`。
- **处理**：
  1. 用显式 `ssh://git@github.com/PC267/freellmapi.git` URL 推送（绕过 `insteadOf` 改写，直接走 SSH）——成功。
  2. 删除全局规则 `url.https://github.com/.insteadOf`，使 `origin`（SSH URL）恢复直连 SSH。
- **结果**：`git push` / `git fetch` 现已直接走 SSH，正常工作，无需手动指定 URL。

### 验证

- `git ls-remote origin` 走 SSH 正常返回远程分支。
- `git status -sb` 显示 `## main...origin/main`，本地与远程完全同步。
- 后续 `git push` 返回 `Everything up-to-date`。
