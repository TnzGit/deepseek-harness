# Agent Note：上下文窗口拒绝的自适应输出上限重试

状态：已实现

[English](2026-08-22-context-adapt-retry.md) | 中文

## 问题

一次请求可能不是因为对话本身、而是因为申请的补全预留撞上提供方的上下文窗口检查：95233 提示词 token 加 32768 输出上限，对 128000 的窗口只溢出 1 个 token。`CONTEXT_WINDOW_EXCEEDED` 的既有恢复手段是压缩（[compaction-basic 的溢出路径](../../../packages/compaction/compaction-basic/README.md)）——对这种形态是杀鸡用牛刀，慢，而且当压缩压得不够或重试耗尽时依旧硬失败。

## 决策

两条 LLM 适配器栈（DeepSeek fetch 管线与 pi-ai 事件流）都在各自的溢出归类点拦截：当拒绝文本写明窗口大小与提示词 token 数（vLLM/OpenAI 兼容措辞）时，以 `limit − input − margin` 钳制后的输出上限重试。边距取 `max(2048, ceil(limit × 0.02))`，足以吸收已观察到的 tokenizer 与包装层重新计数漂移：

- **每次适配器调用至多进行三次单调自适配**——每次尝试都解析提供方最新拒绝，且只能缩小上限；第四次溢出交给既有的压缩恢复。
- **有用性下限**：钳制结果低于 2048 输出 token 时放弃，拒绝原样抛出。
- **未显式设置上限也参与自适配**：提供方预留了自己的默认值，钳制值直接替换它。
- **length 判定保持真实**：DeepSeek 适配器的 length-stop 预算改用适配后的上限，因为那才是重试请求实际携带的值。
- **恢复使用同一余量**：若拒绝还报告了输出预留，只有 token meter 重新计量证明至少释放 `input + output − limit + margin` 时，compaction-basic 才允许重试。

共享的解析与决策放在 `dsh-llm`（`parseContextOverflowNumbers`、`adaptMaxTokensForContextOverflow`）；各适配器只拥有自己的拦截点——DeepSeek 请求循环重建载荷，pi-ai 生成器经每次尝试各自的 watchdog/finally 拆掉失败尝试，再以全新控制器重启。

## 备选方案

- **依据配置窗口减输入估算做预防性预钳制。** 暂缓：需要可信的预检 token 估算；而提供方自己的拒绝文本免费给出精确数字。
- **在 compaction-basic 的重试瀑布里做适配。** 否决：那一 seam 能编排重试却无法重塑失败请求的选项；上限属于适配器派发层。

## 测试

- `dsh-llm`：数字抽取（vLLM 措辞、缺数字）与钳制决策（放行、无上限、已放得下、窗口拥挤、无法解析）。
- DeepSeek：脚本化拒绝链固定请求上限（`32768 → 30207 → 27440`），并证明每次重试都采用提供方最新的重新计数。
- pi-ai：经真实 OpenAI-completions 客户端对本地 mock 服务器运行同一拒绝链，按该路由的 compat 键断言每个自适配上限。

## 后果

自适配是刻意无声的：成功的重试与任何其他响应无异，被拒绝的退化行为与引入压缩之前完全一致。尝试次数上限、边距规则与有用性下限是共享安全常量，不是部署配置项。
