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
export function getPlatformName(id: string): string;

export default class PlatformConfig {
  static get(platform: string): any;
  static list(): string[];
}

// ---- 发布间隔守卫 ----
export interface PublishFrequencyIntervals {
  /** 同一账号在同一平台两次发布的最小间隔 (ms)；0 = 该档关闭 */
  accountMinMs: number;
  /** 同一平台任意两次发布的最小间隔 (ms)，跨账号；0 = 该档关闭 */
  platformMinMs: number;
}

export interface PublishIntervalVerdict {
  allowed: boolean;
  remainingMs: number;
  bucket: 'account' | 'platform' | null;
}

export class PublishIntervalGuard {
  constructor(opts?: {
    minInterval?: number;
    policy?: (platform: string) => PublishFrequencyIntervals;
    store?: { get(key: string): number | null; set(key: string, value: number): void };
    now?: () => number;
  });
  /** accountId 缺席时跳过账号档、平台档仍生效 */
  check(platform: string, accountId?: string | null): PublishIntervalVerdict;
  canPublish(platform: string, accountId?: string | null): boolean;
  getRemainingWait(platform: string, accountId?: string | null): number;
  /** 必须在提交给执行器之前调用；两档同时占位 */
  recordPublish(platform: string, accountId?: string | null, timestamp?: number): void;
  static PLATFORM_BUCKET_ACCOUNT_ID: string;
  /** 默认存储实现：进程内 Map，不跨重启 */
  static InMemoryStore: new () => {
    get(key: string): number | null;
    set(key: string, value: number): void;
    keys(): string[];
  };
}

export const publishFrequencyPolicy: {
  resolveIntervals(
    platform: string,
    options?: { env?: Record<string, string | undefined>; warn?: (msg: string) => void }
  ): PublishFrequencyIntervals;
  PLATFORM_FREQUENCY_POLICY: Record<string, PublishFrequencyIntervals>;
  BASELINE_INTERVALS: PublishFrequencyIntervals;
  SUPPORTED_PLATFORMS: readonly string[];
  ENV_ACCOUNT_MIN_INTERVAL: string;
  ENV_PLATFORM_MIN_INTERVAL: string;
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
