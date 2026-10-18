import { describe, expect, it } from 'vitest'
import { getPageGuide } from '../src/pageGuides'

const operationsPages = [
  'Dashboard', 'SceneContextRules', 'FeatureFlags', 'Projects', 'Secrets', 'Platforms',
  'UsageDashboard', 'Diagnostics', 'PublishDashboard', 'SystemHealth', 'Licenses',
  'KeywordWatchlist', 'PipelineDeps', 'RedemptionCodes', 'Announcements', 'UpdatePolicy',
  'ContentPolicy', 'ModelPresets', 'RateLimitVerifier', 'PlatformDefs', 'RuntimeFlags',
  'ContentTemplates', 'Parameters', 'Snapshots', 'EnvView', 'AuditLog',
  'UserFeedback', 'PromptEvalWorkbench', 'ModelKeys', 'StoryTextLimit',
]

describe('page guides', () => {
  it('provides an introduction and purpose for every operations page', () => {
    for (const pageName of operationsPages) {
      const guide = getPageGuide(pageName)
      expect(guide, `missing guide for ${pageName}`).toEqual({
        title: expect.any(String),
        intro: expect.any(String),
        purpose: expect.any(String),
      })
    }
  })
})
