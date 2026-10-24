# KOL 浮卡实施规划（上游计划目标 02）

> 状态：M1 已实现，M2/M3 规划中。
> 目标（来自上游 roadmap 02）：一看就知道这个 KOL 靠谱不 —— 鼠标停在 @handle 上 → 浮卡：账号年龄、原创比、主题集中度、交互质量。

## 一、交互设计

- 触发：`document` 级 `mouseover` 委托，命中 `[data-testid="User-Name"]` 内的 @handle 链接，450ms hover-intent 延迟后显示。
- 浮卡复用 `lib/ui.ts` popover 的交互骨架：顶层单例 overlay（规避 transformed 祖先的 fixed 定位问题）、视口翻转定位、rAF 跟随、120ms 延迟隐藏 + 卡片悬停保活、CSS 变量主题（明暗 + X 三主题）。
- 着色：白名单 = 绿；账号年龄 < 30 天 = 琥珀；其余品牌蓝。M2 引入综合可信分后细化为四档。

## 二、指标定义与数据源

| 指标 | 计算方式 | 数据源 | 阶段 |
| --- | --- | --- | --- |
| 账号年龄 | `now - accountCreatedAt` | fiber/bridge（`data-mxga-u`，`lib/x-user-bridge.ts`） | M1 ✅ 零 API |
| 互动效率（M1 近似） | 赞粉比 `favouritesCount/followersCount`、均赞/推 `favouritesCount/statusesCount` | 同上 | M1 ✅ 零 API |
| 原创比 | 原创推文 / 总采样推文（排除转推） | M2：scan 累积采样（`socialContext` 转推标记 + 作者比对）；M3：UserTweets GraphQL `legacy.retweeted` | M2/M3 |
| 主题集中度 | 最近 N 条推文文本关键词域聚类的集中度（本地分词 + 熵） | M2：Profile 页 `profileTweets()` 10 条文本；M3：UserTweets | M2/M3 |
| 精确交互质量 | 单条推文 reply/retweet/like 中位数 vs 粉丝数 | M3：UserTweets GraphQL | M3 |

关键事实：X 的 MAIN-world React fiber 里免费携带 `accountCreatedAt / followersCount / followingCount / statusesCount / favouritesCount`（`lib/detect.ts` readFiberUser），经 `entrypoints/x-bridge.content.ts` stamp 到 DOM 后，isolated world 零成本读取——M1 的全部指标因此零网络请求。

## 三、数据获取分层

- **L1 页面免费数据（M1 ✅）**：fiber/bridge 档案 + User-Name 显示名提取。桥未 stamp 的节点静默不显示（白名单账号除外——只报身份标识）。
- **L2 本地累积画像（M2）**：按作者聚合到 profile-signals 缓存（复用 `lib/cache.ts` 的 TTL 分级模式：key=userId，TTL 3 天，惰性过期）；scan 时累积转推标记与推文文本采样。
- **L3 GraphQL 精确增强（M3，默认关）**：UserTweets 拉最近 20 条 → 精确原创比 / 主题 / 交互；新建轻量读限速器（~400ms 间隔 + 429 冷却，独立于写操作的 1.2s 预算）；hover-intent 触发 + 缓存优先。

## 四、模块

| 模块 | 职责 | 状态 |
| --- | --- | --- |
| `lib/kol-card.ts` | 浮卡 UI（单例 overlay、定位、主题、行渲染） | M1 ✅ |
| `entrypoints/content.ts` | mouseover 委托 + 450ms hover-intent + 桥数据装配 | M1 ✅ |
| `lib/settings.ts` | `kolCardEnabled` 开关（默认开） | M1 ✅ |
| `lib/kol-signals.ts` | 画像缓存（TTL）+ 综合可信分 | M2 |
| `content.ts` scan 采样钩子 | 转推标记 / 推文文本累积 | M2 |
| `lib/x-graphql.ts` + `lib/read-limiter.ts` | UserTweets 读封装 + 读限速 | M3 |

## 五、风险与约束

1. X DOM/aria-label 数字格式随 locale 变化（"1.2万" / "12K"）——计数提取器需多语言解析（已有 `REPLYING_TO_RE` 多语言先例）。
2. GraphQL 读接口同样有配额——M3 必须默认关闭、缓存优先、hover-intent 触发。
3. 隐私红线：所有计算本地完成，不上传任何浏览数据（延续上游原则）；浮卡明确标注「本地数据 · 不联网查询」。
4. 性能：mouseover 委托保持轻量（closest 判断），采样只做 Map 计数，不触发布局。
