---
description: "为长时间运行的根 Agent 轮次提示进度，并对长时间前台 Bash 调用做不干预执行的监测。"
kind: "package-reference"
---

# @deepseek-ai/dsh-long-task-monitor

[English](README.md) | 中文

## 概述

挂载 `dsh-long-task-monitor` 后，运行中的根 Agent 达到设定时长会收到进度汇报提醒。前台 Bash 调用如果显式设置了较长超时，插件也会定期向服务日志记录监测点。后者绝不向模型排队那些只能在命令结束后才送达的过期提示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 的 base bundle 为所有预设挂载此插件。`enabled`、`startAfterMinutes`、`reportEveryMinutes`、`bashEnabled`、`bashStartAfterMinutes` 和 `bashReportEveryMinutes` 是易变字段，可在**插件 → 长任务进度**中无需重启地修改。默认运行 15 分钟后首次汇报对话进度，此后每 10 分钟一次；前台 Bash 运行 15 分钟后首次记录监测点，此后每 10 分钟一次。`rootOnly` 默认为 true，属于仅在启动时确定的组合设置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件监听 `agent/created` 和 `agent/status`，为每个根 Agent 挂载可释放的计时器。对话监测点到期时发送一条带插件来源的 steer，消费后记入会话日志。`tools/execute` 包装器仅在显式 `timeoutMs` 足够长时记录前台 Bash 监测间隔；它始终调用 `next()`，并在 `finally` 中清理计时器。同步前台 Bash 执行期间会暂停对话 steer，命令结束后至少再等一个汇报间隔才恢复。Loader 的易变配置更新会重新调度当前对话计时器。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 设置卡片](../../client/ui-settings-long-task-monitor/README.zh.md)——浏览器中的实时设置。
- [agent](../agent/README.zh.md)——生命周期和 steer 事件。
- [tools](../tools/README.zh.md)——执行包装 waterfall。

-----

<a id="model-experience"></a>
## 模型体验

### 进度监测点

#### 模型会看到什么

对话计时器触发后，下一个 Agent 步骤会收到一条短的 `long-task-monitor` 来源用户消息，要求简短汇报进度并继续执行。前台 Bash 监测点不会进入模型。

#### Token 影响

只有到期的对话监测点会增加 token。不会在每次请求中注入常驻目录或重复指令。

#### KV 缓存影响

只有到期的进度消息会增加活跃上下文；普通轮次和 Bash 日志监测点都不会增加。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **前台 Bash 是同步调用**——命令返回前模型无法检查输出。实际需要实时检查时使用 `run_in_background` 和 `job_output`；本插件不会自动转换命令。
- **运行时不变量：**不发布伴生入口。Agent 计时器与 Bash 执行包装器都有对应的清理回调，均不持久化独立状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
