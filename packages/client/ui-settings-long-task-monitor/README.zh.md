---
description: "Web 插件设置页：实时调整长对话汇报和前台 Bash 监测间隔。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-long-task-monitor

[English](README.md) | 中文

## 概述

打开**插件 → 长任务进度**，无需重启 DSH 即可调整长对话进度汇报和前台 Bash 监测时间。Host 服务 `long-task-monitor` 条目时才会显示这一页。修改在点击**保存**前只作为草稿。

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

对话控制项可启停进度提醒，设置首次汇报等待时间和后续间隔。Bash 控制项可对显式超时超过阈值的前台调用开启服务端监测。监测点只写日志，不会在同步命令结束后向 Agent 排队过期提示。需要 Agent 在命令运行中检查进度时，请使用后台任务和 `job_output`。易变配置字段的修改会在当前进程内生效。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 半侧是一个空的 Loader 条目，负责提供本包的浏览器半侧。浏览器通过 `ctx.configForms.get` 绑定 `long-task-monitor`，用 `SettingsFormModel` 暂存修改，并且仅在该命名空间被服务时把卡片注册到 `plugins.item`。页面文案属于 `settings.longTaskMonitor`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [long-task-monitor](../../core/long-task-monitor/README.zh.md)——Host 计时器与前台 Bash 行为。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页及其 `plugins.item` slot。
- [ui-primitives](../ui-primitives/README.zh.md)——暂存式设置表单。

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器设置卡片

#### 模型会看到什么

`plugins.item` 页面本身不发送模型请求。保存设置可能改变 Host 日后发出一条插件来源进度消息的时机。

#### Token 影响

打开或编辑页面不会增加模型 token。只有后来到期的 Host 进度消息才会进入上下文。

#### KV 缓存影响

页面没有直接的 KV 缓存影响。只有后续计时器触发时，进度消息才会扩展上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **前台 Bash 执行期间，受阻塞的 Agent 无法检查它**——监测点仅写入服务日志，不在命令结束后补发提醒。
- **运行时不变量：**不发布伴生入口。卡片内容来自设置镜像，每次写入都由 Host 校验。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
