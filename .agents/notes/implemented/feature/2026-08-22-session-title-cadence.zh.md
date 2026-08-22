# Agent Note：可配置的会话命名节奏（every-nth-prompt）

状态：已实现

[English](2026-08-22-session-title-cadence.md) | 中文

## 问题

基于日志的标题服务（[log-backed session titles](../../implemented/feature/2026-07-21-log-backed-session-titles.zh.md)）提供两种由提供方声明的节奏：`first-prompt`（内置 LLM 提供方的模式——一次命名永不更新）和 `all-prompts`。想要周期性重命名的部署只能在"永不再改"和"每条提示词都改"之间二选一，没有中间档，而且设置界面里什么都调不了。

## 决策

1. **服务契约**（`dsh-session-title`）：自动模式联合类型新增 `'every-nth-prompt'`；`SessionTitleProvider` 新增可选 `promptInterval`，校验要求恰好在该模式下为正整数。调度按符合条件的用户提示词计数：第 1 条立即命名，此后每累计 N 条提示词调度一次修订。节奏仍由提供方声明——服务只解释已声明的模式，现有 `first-prompt`/`all-prompts` 提供方不受影响。
2. **部署壳**（保留历史包名 `session-title-first-prompt-llm`）：无条件地按组合条目先注册（没有设置服务的组合保持今天的行为），再叠加 `session-title` 设置命名空间（`mode: 'first' | 'every-nth'`、`everyNPrompts`）。已提交的变更会按服务"先排空再重注册"的契约注销上一个注册，然后安装下一个；first 模式只把首条消息纳入框架，every-nth 模式纳入全部符合条件历史。
3. **设置卡片**：ui-settings-plugins 提供以 `session-title` 命名空间为键的卡片，含节奏下拉与间隔字段，复用共享表单规格。

## 备选方案

- **在 `all-provids` 提供方内部节流。** 否决：提供方契约没有"跳过"路径，跳过意味着追加重复标题事件或滥用结果形状；节奏应当属于它的所有者。
- **新增第三个薄壳包**而不是原地扩展部署中的那个。否决：换挂载行会改变标题溯源 id 并搅动组合清单，却没有行为收益；README 已记录这个历史名称。

## 测试

- 服务：every-nth 规格固定了在第 1 / 1+N 条提示词的调度、间隔之间的跳过、全历史修订与注册校验失败；全部 first-prompt/all-prompts 既有规格原样保持绿色。
- 包装器：设置驱动的注册及实时 dispose→register 顺序、非正数间隔的写入拒绝、通过录制适配器验证各节奏的消息框选。
- 卡片：控制器投影/保存与组件渲染规格加入其他卡片之列。

## 后果

"轮"指符合条件的用户提示词——该领域本就据此派生标题的计数；agent 回复轮次不驱动重命名。默认值（`first`）完全保留变更前行为。
