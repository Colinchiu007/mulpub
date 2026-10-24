import { describe, it, expect, vi } from 'vitest'
import {
  planLabelOf,
  featureLabelOf,
  quotaLabelOf,
  quotaValueText,
  graceState,
  resolveMemberErrorKey,
} from './labels'

// t 的测试替身：直接回传 key，便于断言「走到了哪个键」。
// 带插值的调用（{ plan }）会被记录，用于验证调用形状。
const t = vi.fn((key) => key)

describe('member-center/labels 纯函数', () => {
  // ── planLabelOf：三档 + 未知 + 缺失 ──────────────────────────────
  describe('planLabelOf', () => {
    it('pro → planPro', () => {
      expect(planLabelOf(t, 'pro')).toBe('memberCenter.planPro')
    })
    it('standard → planStandard（P0-3：不再落入 planCustom）', () => {
      expect(planLabelOf(t, 'standard')).toBe('memberCenter.planStandard')
    })
    it('free → planFree', () => {
      expect(planLabelOf(t, 'free')).toBe('memberCenter.planFree')
    })
    it('trial → planTrial（防御性死分支，保留）', () => {
      expect(planLabelOf(t, 'trial')).toBe('memberCenter.planTrial')
    })
    it('未知档位（pro_max）→ planCustom', () => {
      expect(planLabelOf(t, 'pro_max')).toBe('memberCenter.planCustom')
    })
    it('undefined/null/空串 → planUnknown（MISS-4：不再兜底成 free）', () => {
      expect(planLabelOf(t, undefined)).toBe('memberCenter.planUnknown')
      expect(planLabelOf(t, null)).toBe('memberCenter.planUnknown')
      expect(planLabelOf(t, '')).toBe('memberCenter.planUnknown')
    })
  })

  // ── featureLabelOf：本地化 + 未知回退 ────────────────────────────
  describe('featureLabelOf', () => {
    it('已知 feature → 本地化键', () => {
      expect(featureLabelOf(t, 'cloud_publish')).toBe('memberCenter.feature.cloud_publish')
      expect(featureLabelOf(t, 'ai_write')).toBe('memberCenter.feature.ai_write')
      expect(featureLabelOf(t, 'video_create')).toBe('memberCenter.feature.video_create')
      expect(featureLabelOf(t, 'schedule_batch')).toBe('memberCenter.feature.schedule_batch')
      expect(featureLabelOf(t, 'dashboard_full')).toBe('memberCenter.feature.dashboard_full')
    })
    it('未知 feature → 回退原文（服务端加新 feature 不开天窗）', () => {
      expect(featureLabelOf(t, 'future_feature')).toBe('future_feature')
    })
    it('空值 → 空串', () => {
      expect(featureLabelOf(t, '')).toBe('')
      expect(featureLabelOf(t, null)).toBe('')
      expect(featureLabelOf(t, undefined)).toBe('')
    })
  })

  // ── quotaLabelOf / quotaValueText：${feature}_monthly 键形 ───────
  describe('quotaLabelOf', () => {
    it('已知 quota 键 → 本地化键（C1-09：真实键形 ${feature}_monthly）', () => {
      expect(quotaLabelOf(t, 'cloud_publish_monthly')).toBe('memberCenter.quota.cloud_publish_monthly')
      expect(quotaLabelOf(t, 'ai_write_monthly')).toBe('memberCenter.quota.ai_write_monthly')
      expect(quotaLabelOf(t, 'video_create_monthly')).toBe('memberCenter.quota.video_create_monthly')
      expect(quotaLabelOf(t, 'official_credit_monthly')).toBe('memberCenter.quota.official_credit_monthly')
    })
    it('未知 quota 键 → 回退原文', () => {
      expect(quotaLabelOf(t, 'some_new_quota')).toBe('some_new_quota')
    })
  })

  describe('quotaValueText', () => {
    it('-1 → 不限（plan-matrix UNLIMITED 语义）', () => {
      expect(quotaValueText(t, -1)).toBe('memberCenter.quotaUnlimited')
    })
    it('有限数字 → 字符串', () => {
      expect(quotaValueText(t, 100)).toBe('100')
      expect(quotaValueText(t, 0)).toBe('0')
    })
    it('对象 → JSON（兼容既有形状，不猜结构）', () => {
      expect(quotaValueText(t, { a: 1 })).toBe('{"a":1}')
    })
    it('null/undefined → —', () => {
      expect(quotaValueText(t, null)).toBe('—')
      expect(quotaValueText(t, undefined)).toBe('—')
    })
  })

  // ── graceState：宽限期三态 ──────────────────────────────────────
  describe('graceState', () => {
    it('graceUntil 有效 ISO → inGrace=true + 日期文本', () => {
      const state = graceState(t, { graceUntil: '2026-11-01T00:00:00Z', previousPlan: 'pro' })
      expect(state.inGrace).toBe(true)
      expect(state.untilText).toBeTruthy()
      expect(state.previousPlanLabel).toBe('memberCenter.planPro')
    })
    it('graceUntil 缺失 → inGrace=false', () => {
      expect(graceState(t, { expiresAt: 1893456000 }).inGrace).toBe(false)
    })
    it('graceUntil 非法 ISO → inGrace=false（不崩，退化普通到期）', () => {
      expect(graceState(t, { graceUntil: 'not-a-date' }).inGrace).toBe(false)
    })
    it('entitlement 为 null → inGrace=false', () => {
      expect(graceState(t, null).inGrace).toBe(false)
    })
  })

  // ── resolveMemberErrorKey：白名单 + 未知兜底 ─────────────────────
  describe('resolveMemberErrorKey', () => {
    it('MEMBER_PERMISSION_REQUIRED → memberPermissionRequired', () => {
      expect(resolveMemberErrorKey('MEMBER_PERMISSION_REQUIRED')).toBe('memberCenter.memberPermissionRequired')
    })
    it('MEMBER_REQUEST_FAILED → memberRequestFailed', () => {
      expect(resolveMemberErrorKey('MEMBER_REQUEST_FAILED')).toBe('memberCenter.memberRequestFailed')
    })
    it('未知码 → memberRequestFailed（不把裸码透给用户）', () => {
      expect(resolveMemberErrorKey('SOMETHING_ELSE')).toBe('memberCenter.memberRequestFailed')
    })
    it('空值 → memberRequestFailed', () => {
      expect(resolveMemberErrorKey(null)).toBe('memberCenter.memberRequestFailed')
      expect(resolveMemberErrorKey(undefined)).toBe('memberCenter.memberRequestFailed')
    })
  })
})
