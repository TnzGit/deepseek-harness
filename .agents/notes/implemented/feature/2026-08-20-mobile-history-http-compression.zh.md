# Agent Note: 移动端历史窗口与 HTTP 响应压缩

Status: implemented

## Problem

浏览器客户端此前无论视口大小，打开对话时都会先取相同的 50 条消息历史。手机首屏因此要为大量暂时看不到的 Conversation 事件与渲染节点付出成本，而长 assistant 流会让一条逻辑消息包含数百甚至数千个原始事件。Unary JSON API 响应即使浏览器声明支持 Brotli 或 gzip，也不会压缩发送。

更早的本地实现还需要额外防止 Host 在分页边界切断一条消息或工具调用。当前上游 paginator 已经拥有这条不变量：`session.history` 会选择完整的 append-origin 消息组，并把 assistant message 的 `sourceEventSeqs` 以及其后的 tool-call/result 尾部放在同一页。本次修改复用这个权威，不再新增第二套分页算法。

## Decision

桌面端继续使用现有 50 条消息的尾页与更早分页大小。紧凑移动端视口（`max-width: 767px`）首屏从最近三个完整消息组开始。移动端尾页还有一个软性的 1500-event 预算：如果完整的三条消息页超过该值，客户端会重新请求两条消息，必要时再请求一条。它绝不会在本地切片已返回的事件数组。因此，如果单条逻辑消息本身就超过 1500 个事件，它仍会完整保留；消息／工具完整性优先于软事件目标。向上加载更早历史始终回到普通的 50 条消息分页大小。

初次打开、重连重建和 gap repair 共用同一套移动端尾页策略，因此这些路径不会悄悄把手机首屏重新扩大成桌面尺寸。

在 node:http bridge 上，当请求的 `Accept-Encoding` 允许时，大于 1 KiB 的 JSON 响应会压缩。Brotli 的 quality 不低于 gzip 时优先 Brotli，否则使用 gzip。已有 `Content-Encoding` 会保留；压缩响应设置 `Content-Length` 并在 `Vary` 中加入 `Accept-Encoding`；小型 JSON 保持不压缩。非 JSON 与流式响应继续使用现有增量路径，因此 SSE 不会仅为了压缩而被整体缓冲。

## Verification

`packages/client/runtime/tests/mobile-history.client.spec.ts` 固定验证桌面首载 50 条、手机首载 3 条、3→2→1 的软事件预算回退、单条超大消息完整保留，以及向上分页仍为 50 条。`packages/host/apiproxy/tests/api-proxy-view.spec.ts` 固定 Host 不变量：一个只允许一条消息的页面如果包含 assistant 工具调用，就必须同时包含所有被引用的 assistant chunk、tool call 与 result，而更早消息留在页面外。`packages/client/connection/tests/http-bridge.host.spec.ts` 固定 Brotli 优先、gzip 回退、1 KiB 阈值与不压缩的流式路径。

## Consequences

手机对话在首次交互前需要组装和渲染的历史显著减少，桌面行为与向上历史加载吞吐保持不变。事件极多的单条消息仍可能超过 1500-event 软目标，因为可安全回放的完整消息比硬事件上限更重要。客户端支持压缩时，大型 unary JSON 响应会减少网络传输量，同时流式传输语义保持不变。
