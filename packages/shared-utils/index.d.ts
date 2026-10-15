/**
 * @multi-publish/shared-utils — 类型声明
 */

// ---- 任务队列 ----
export class TaskQueue {
  constructor(opts?: {
    maxConcurrent?: number;
    defaultRetry?: number;
    defaultTimeout?: number;
    /** 发布频率守卫；缺席则队列不做间隔检查 */
    publishIntervalGuard?: PublishIntervalGuard | null;
  });
  static resolveQueueMaxConcurrent(): number;
  add(task: any): string;
  addForOwner(task: any, ownerSubject: string): string;
  setOwnerSubjectProvider(provider: (() => string | null | undefined) | null): void;
  getPendingTasks(): any[];
  getStatus(): { pending: number; running: number; history: number; paused: boolean };
  getHistory(): any[];
  retry(taskId: string): string | null;
  cancel(taskId: string): boolean;
  clearPending(): number;
  serialize(): string;
  deserialize(json: string): number;
  getTasks(): any[];
  getActiveCount(): number;
  getQueueLength(): number;
  pause(): void;
  resume(): void;
  clear(): void;
}

// ---- 聚合桥接 ----
export class AggregatorBridge {
  constructor(opts?: any);
  connect(): Promise<void>;
  disconnect(): void;
  send(data: any): void;
  onMessage(cb: (msg: any) => void): void;
}

// ---- 分块上传 ----
export class ChunkedUploader {
  constructor(opts?: { chunkSize?: number });
  upload(file: string, dest: string): Promise<any>;
  cancel(): void;
  onProgress(cb: (pct: number) => void): void;
}

// ---- 代理池 ----
export class ProxyPool {
  constructor(proxies?: string[]);
  getNext(): string | null;
  add(proxy: string): void;
  remove(proxy: string): void;
  markBad(proxy: string): void;
}

// ---- 分析服务 ----
export class AnalyticsService {
  constructor(opts?: any);
  track(event: string, data?: any): void;
  getStats(): any;
}

// ---- 平台配置 ----
export const PLATFORM_LOGIN_URLS: Record<string, string>;
export const PLATFORM_NAMES: Record<string, string>;
export const PLATFORM_LOGIN_SUCCESS_SELECTORS: Record<string, string>;
export const PLATFORM_LOGIN_SUCCESS_PATTERNS: Record<string, string>;
export const QR_CODE_PLATFORMS: string[];
export const PLATFORM_DASHBOARD_URLS: Record<string, string>;
/** 素材来源 URL（采集页「去哪找素材」入口），与创作者后台语义独立 */
export const PLATFORM_SOURCE_URLS: Record<string, string>;
export function getPlatformName(id: string): string;

export default class PlatformConfig {
  static get(platform: string): any;
  static list(): string[];
}

// ---- 发布间隔守卫 ----
export interface PublishFrequencyIntervals {
  /** 档位名 long|clip|short；`_intervals()` 也回传它 —— 设置页「当前档位」按它分组（缺键会渲染成 undefined） */
  tier?: string;
  /** 同一账号在同一平台两次发布的最小间隔 (ms)；0 = 该档关闭 */
  accountMinMs: number;
  /** 同一平台任意两次发布的最小间隔 (ms)；账号档恒 ≥ 本档 ⇒ 同账号由账号档决定，跨账号由本档兜底 */
  platformMinMs: number;
  /** 同一账号在同一平台的每日提交上限（条）；0 = 关闭该维度 */
  accountDailyMax?: number;
  /** true = 平台未登记，数值来自 BASELINE_INTERVALS（守卫会按平台出声一次） */
  fallback?: boolean;
}

export interface PublishIntervalVerdict {
  allowed: boolean;
  remainingMs: number;
  /** daily = 日配额命中（"今天到此为止"，remainingMs 恒 0，等待时长改用 msUntilNextDay()） */
  bucket: 'account' | 'platform' | 'daily' | null;
  reason?: 'interval' | 'daily_quota' | null;
  daily?: { used: number; max: number; dayKey: string } | null;
}

export class PublishIntervalGuard {
  constructor(opts?: {
    minInterval?: number;
    policy?: (platform: string) => PublishFrequencyIntervals;
    store?: { get(key: string): number | null; set(key: string, value: number | null): void };
    /** 日计数存储（SQLite 实现由桌面端注入）；缺席时**整个日配额维度静默关闭** —— 装配必传 */
    dailyStore?: {
      getDay(key: string, dayKey: string): { count: number; rollback_count?: number; rollbackCount?: number } | null;
      incrDay(key: string, dayKey: string, field: string, delta: number): number;
      decrDay?(key: string, dayKey: string, field: string, delta: number): number;
    };
    now?: () => number;
    today?: () => string;
    random?: () => number;
    jitterRatio?: number;
    releaseGraceMs?: number;
    warn?: (msg: string) => void;
  });
  /** accountId 缺席时跳过账号档、平台档仍生效 */
  check(platform: string, accountId?: string | null): PublishIntervalVerdict;
  canPublish(platform: string, accountId?: string | null): boolean;
  getRemainingWait(platform: string, accountId?: string | null): number;
  /** 距下一个本机运营日边界（次日 00:00:05）的毫秒数，与 today() 同一注入时钟 */
  msUntilNextDay(): number;
  today(): string;
  /**
   * 必须在**提交给执行器之前**调用；两档同时占位 + 日计数递增。
   * 返回值必须保存并回传给 `release()` —— 它是"精确还原前值"的唯一凭据，丢掉就等于永久占窗。
   */
  recordPublish(
    platform: string,
    accountId?: string | null,
    timestamp?: number
  ): {
    at: number;
    accountKey: string | null;
    platformKey: string;
    accountPrev: number | null;
    platformPrev: number | null;
    dailyPrev: number | null;
    dayKey: string;
  };
  /** 回滚一次**未提交**尝试（乐观并发 + 每日许可有硬顶，不随日配额放大） */
  release(
    platform: string,
    accountId: string | null | undefined,
    hold: { at: number; accountKey?: string | null; accountPrev?: number | null; platformPrev?: number | null } | null | undefined
  ): { released: boolean; reason: null | 'prev_missing' | 'window_taken' | 'rollback_cap' };
  /** 紧急放行专用：同时清账号键与平台键（代价由每日上限 + 冷却 + 审计约束） */
  clearWindow(platform: string, accountId?: string | null): { cleared: boolean; clearedKeys: string[] };
  /** 解析某平台的完整策略（含 tier 与 fallback 标记） */
  _intervals(platform: string): PublishFrequencyIntervals;
  /** 运行期调整抖动比例（设置页保存即走这里，无需重启） */
  setJitterRatio(ratio: number): void;
  /** 运行期调整回滚后退避（下界 MIN_RELEASE_GRACE_MS 由策略模块钳位） */
  setReleaseGraceMs(ms: number): void;
  static PLATFORM_BUCKET_ACCOUNT_ID: string;
  /** 「未提交失败回滚」每账号每日许可数的硬顶；与日配额解耦（v3） */
  static MAX_ROLLBACK_PER_DAY: number;
  /** 默认存储实现：进程内 Map，不跨重启 */
  static InMemoryStore: new () => {
    get(key: string): number | null;
    set(key: string, value: number | null): void;
    keys(): string[];
  };
  /** 默认日计数实现（仅测试与无 DB 场景） */
  static InMemoryDailyStore: new () => {
    getDay(key: string, dayKey: string): { count: number; rollbackCount: number } | null;
    incrDay(key: string, dayKey: string, field: string, delta?: number): number;
    decrDay(key: string, dayKey: string, field: string, delta: number): number;
  };
  static buildKey(platform: string, accountId: string | null | undefined): string;
  /** accountId 归一（空白/非串 → null）；装配与测试都走这一份实现 */
  static normalizeAccountId(value: unknown): string | null;
  static TIMER_SAFE_MS: number;
  /** ⚠️ **计划了但从未接线**：全仓除本定义外零引用，平台级日配额维度当前不存在（PRD §10.2） */
  static PLATFORM_BUCKET_DAILY_KEY_PREFIX: string;
}

export const publishFrequencyPolicy: {
  resolveIntervals(
    platform: string,
    options?: { env?: Record<string, string | undefined>; warn?: (msg: string) => void; overrides?: object }
  ): PublishFrequencyIntervals;
  /** 抖动比例 [0,1)；0 = 关闭（严格退化为 v1 行为） */
  resolveJitterRatio(options?: { env?: object; warn?: Function; overrides?: object }): number;
  /** 回滚后最小退避（整数 ms，下界 MIN_RELEASE_GRACE_MS 钳位） */
  resolveReleaseGraceMs(options?: { env?: object; warn?: Function; overrides?: object }): number;
  /** 紧急放行每日每账号上限 [0,10] */
  resolveEmergencyMaxPerDay(options?: { env?: object; warn?: Function; overrides?: object }): number;
  /** 设置页覆盖：任一字段非法 ⇒ 整个对象作废（返回 null），不允许部分生效 */
  resolvePolicyOverrides(raw: unknown, options?: { warn?: (msg: string) => void }): object | null;
  isKnownPlatform(platform: unknown): boolean;
  /** 单个环境变量的解析（合法域 [0, MAX_INTERVAL_MS]；非法回落 + 出声） */
  parseEnvNumber(
    raw: string | number | undefined | null,
    envName: string,
    fallback: number,
    warn: (msg: string) => void,
    bounds?: { integer?: boolean; max?: number }
  ): number;
  PLATFORM_FREQUENCY_POLICY: Record<string, PublishFrequencyIntervals>;
  BASELINE_INTERVALS: PublishFrequencyIntervals;
  SUPPORTED_PLATFORMS: readonly string[];
  MAX_INTERVAL_MS: number;
  DEFAULT_JITTER_RATIO: number;
  DEFAULT_RELEASE_GRACE_MS: number;
  MIN_RELEASE_GRACE_MS: number;
  DEFAULT_EMERGENCY_MAX_PER_DAY: number;
  MAX_EMERGENCY_MAX_PER_DAY: number;
  TIER_LONG: string;
  TIER_CLIP: string;
  TIER_SHORT: string;
  ENV_ACCOUNT_MIN_INTERVAL: string;
  ENV_PLATFORM_MIN_INTERVAL: string;
  ENV_DAILY_MAX_LONG: string;
  ENV_DAILY_MAX_CLIP: string;
  ENV_DAILY_MAX_SHORT: string;
  ENV_ACCOUNT_DAILY_MAX: string;
  ENV_JITTER_RATIO: string;
  ENV_RELEASE_GRACE_MS: string;
  ENV_EMERGENCY_MAX_PER_DAY: string;
};

// ---- 定时发布 ----
export interface ScheduledTask {
  id: string;
  platform: string;
  article: Record<string, unknown>;
  status: 'pending' | 'dispatching' | 'executed' | 'failed' | 'cancelled';
  publishTime: string;
  createdAt?: string;
}

export interface Scheduler {
  setTaskQueue(taskQueue: {
    add?(task: unknown): unknown | Promise<unknown>;
    addForOwner?(task: unknown, ownerSubject: string): unknown | Promise<unknown>;
  }): void;
  setOwnerSubjectProvider(provider: (() => string | null | undefined) | null): void;
  create(schedule: {
    platform: string;
    article: Record<string, unknown>;
    publishTime: string;
    accountId?: string | null;
    owner_subject?: string;
  }): ScheduledTask;
  list(ownerSubject?: string): ScheduledTask[];
  cancel(id: string, ownerSubject?: string): boolean;
  restore(ownerSubject?: string): number;
  /** 强制按当前墙钟重算全部未到点任务的剩余延时（休眠唤醒 / 时钟跳变后调用） */
  rearm(ownerSubject?: string): number;
  stopAll(): Promise<unknown[]>;
}

export function createScheduler(dependencies: {
  app: { getPath(name: string): string };
  fs?: unknown;
  logger?: {
    error(scope: string, message: string): void;
    warn(scope: string, message: string): void;
  };
}): Scheduler;

// ---- 敏感词过滤 ----
export class SensitiveFilter {
  constructor(rules?: any[]);
  check(text: string): any;
  replace(text: string): any;
}

// ---- 标题优化 ----
export class TitleOptimizer {
  constructor();
  optimize(title: string, options?: any): string[];
}
