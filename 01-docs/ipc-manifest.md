# IPC 通道清单

> 自动生成: 2026-09-02
> 注册验证: scripts/ipc-manifest-registrar.js

## account

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `account:add` | IPC invoke | (event, ...args) | { code, data, message } |
| `account:check-login` | IPC invoke | (event, ...args) | { code, data, message } |
| `account:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `account:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `account:set-proxy` | IPC invoke | (event, ...args) | { code, data, message } |
| `accounts:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `auth:close` | IPC invoke | (event, ...args) | { code, data, message } |
| `auth:complete-login` | IPC invoke | (event, ...args) | { code, data, message } |
| `auth:login-silent` | IPC invoke | (event, ...args) | { code, data, message } |
| `auth:open-login` | IPC invoke | (event, ...args) | { code, data, message } |

## ai

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `ai:enhance-content` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:generate` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:generate-summary` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:generate-titles` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:get-config` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:is-configured` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:list-models` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:list-providers` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:save-config` | IPC invoke | (event, ...args) | { code, data, message } |
| `ai:test-connection` | IPC invoke | (event, ...args) | { code, data, message } |

## analytics

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `analytics:overview` | IPC invoke | (event, ...args) | { code, data, message } |
| `analytics:platform` | IPC invoke | (event, ...args) | { code, data, message } |
| `analytics:platforms` | IPC invoke | (event, ...args) | { code, data, message } |

## approval-gate

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `approval-gate:approve` | IPC invoke | (event, ...args) | { code, data, message } |
| `approval-gate:get` | IPC invoke | (event, ...args) | { code, data, message } |

## batch-manager

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `batch:create` | IPC invoke | (event, ...args) | { code, data, message } |
| `batch:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `batch:duplicate-article` | IPC invoke | (event, ...args) | { code, data, message } |
| `batch:execute` | IPC invoke | (event, ...args) | { code, data, message } |
| `batch:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `batch:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `batch:schedule` | IPC invoke | (event, ...args) | { code, data, message } |

## board

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `board:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `board:subscribe` | IPC invoke | (event, ...args) | { code, data, message } |
| `board:unsubscribe` | IPC invoke | (event, ...args) | { code, data, message } |

## cloud-publisher

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `cloud-publisher:get-task` | IPC invoke | (event, ...args) | { code, data, message } |
| `cloud-publisher:list-tasks` | IPC invoke | (event, ...args) | { code, data, message } |
| `cloud-publisher:platforms` | IPC invoke | (event, ...args) | { code, data, message } |
| `cloud-publisher:submit` | IPC invoke | (event, ...args) | { code, data, message } |

## comment-manager

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `comment:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `comment:reply` | IPC invoke | (event, ...args) | { code, data, message } |
| `comment:start-polling` | IPC invoke | (event, ...args) | { code, data, message } |
| `comment:status` | IPC invoke | (event, ...args) | { code, data, message } |
| `comment:stop-polling` | IPC invoke | (event, ...args) | { code, data, message } |

## contact-sheet

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `contact-sheet:approve` | IPC invoke | (event, ...args) | { code, data, message } |
| `contact-sheet:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `contact-sheet:reject` | IPC invoke | (event, ...args) | { code, data, message } |

## content-intelligence

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `intelligence:fetch-trending` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:find-references` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:get-benchmark` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:get-impact` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:get-optimal-time` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:save-impact` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:search` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:search-mentions` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:search-titles` | IPC invoke | (event, ...args) | { code, data, message } |
| `intelligence:suggest-tags` | IPC invoke | (event, ...args) | { code, data, message } |

## film-engineering

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `film-engineering:adapt-script` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:copy-text` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:copy-texts` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:doctrine` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:download-recycled` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:export` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:generate-selected` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:get-shot` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:list-scenes` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:list-shots` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:production-plan` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:production-update` | IPC event (main→renderer) | (payload: 批/镜计数，不含 shotIds；逐镜 `production:shot-progress` 携 `reason`=该镜失败原因，成功/未失败 null) | — |
| `film-engineering:production-run-batch` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:production-status` | IPC invoke | (event, ...args) | { code, data:{ batches[].shots[].error=逐镜失败原因(string\|null，见 PRD §5.5), batch.error }, message } |
| `film-engineering:retry-shot` | IPC invoke | (event, ...args) | { code, data, message } |
| `film-engineering:status` | IPC invoke | (event, ...args) | { code, data, message } |

## generation-feedback

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `generation:feedback` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-library:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-library:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-library:save` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-library:activate` | IPC invoke | (event, ...args) | { code, data, message } |

## identity

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `identity:get-state` | IPC invoke | (event, ...args) | { code, data, message } |
| `identity:sign-in` | IPC invoke | (event, ...args) | { code, data, message } |
| `identity:sign-out` | IPC invoke | (event, ...args) | { code, data, message } |
| `identity:switch-account` | IPC invoke | (event, ...args) | { code, data, message } |

## keyword

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `keyword:history` | IPC invoke | (event, ...args) | { code, data, message } |
| `keyword:start` | IPC invoke | (event, ...args) | { code, data, message } |
| `keyword:status` | IPC invoke | (event, ...args) | { code, data, message } |
| `keyword:stop` | IPC invoke | (event, ...args) | { code, data, message } |
| `keyword:stop-all` | IPC invoke | (event, ...args) | { code, data, message } |

## license

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `auth:get-access-level` | IPC invoke | (event, ...args) | { code, data, message } |
| `license:activate` | IPC invoke | (event, ...args) | { code, data, message } |
| `license:activate-trial` | IPC invoke | (event, ...args) | { code, data, message } |
| `license:deactivate` | IPC invoke | (event, ...args) | { code, data, message } |
| `license:features` | IPC invoke | (event, ...args) | { code, data, message } |
| `license:has-feature` | IPC invoke | (event, ...args) | { code, data, message } |
| `license:info` | IPC invoke | (event, ...args) | { code, data, message } |

## logs

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `feedback:submit` | IPC invoke | (event, ...args) | { code, data, message } |
| `logs:clear` | IPC invoke | (event, ...args) | { code, data, message } |
| `logs:error` | IPC invoke | (event, ...args) | { code, data, message } |
| `logs:info` | IPC invoke | (event, ...args) | { code, data, message } |

## misc

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `app:get-platform` | IPC invoke | (event, ...args) | { code, data, message } |
| `app:get-version` | IPC invoke | (event, ...args) | { code, data, message } |
| `first-run:check` | IPC invoke | (event, ...args) | { code, data, message } |
| `hotkeys:list` | IPC invoke | (event, ...args) | { code, data, message } |

## model-provider

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `model-provider:clean-logs` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:create` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:get-default` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:is-configured` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:logs` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:presets` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:set-capability-default` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:set-default` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:test` | IPC invoke | (event, ...args) | { code, data, message } |
| `model-provider:update` | IPC invoke | (event, ...args) | { code, data, message } |

## notify

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `notify:log` | IPC invoke | (event, ...args) | { code, data, message } |

## oauth-manager

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `oauth:close` | IPC invoke | (event, ...args) | { code, data, message } |
| `oauth:get-configs` | IPC invoke | (event, ...args) | { code, data, message } |
| `oauth:start` | IPC invoke | (event, ...args) | { code, data, message } |

## offline

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `offline:add-to-cache` | IPC invoke | (event, ...args) | { code, data, message } |
| `offline:cached-tasks` | IPC invoke | (event, ...args) | { code, data, message } |
| `offline:clear-cache` | IPC invoke | (event, ...args) | { code, data, message } |
| `offline:is-offline` | IPC invoke | (event, ...args) | { code, data, message } |
| `offline:status` | IPC invoke | (event, ...args) | { code, data, message } |

## onboarding

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `onboarding:complete` | IPC invoke | (event, ...args) | { code, data, message } |
| `onboarding:get-steps` | IPC invoke | (event, ...args) | { code, data, message } |
| `onboarding:status` | IPC invoke | (event, ...args) | { code, data, message } |

## ops-center-sync

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `ops-center-sync:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `ops-center-sync:now` | IPC invoke | (event, ...args) | { code, data, message } |
| `ops-center-sync:runtime` | IPC invoke | (event, ...args) | { code, data, message } |
| `ops-center-sync:save` | IPC invoke | (event, ...args) | { code, data, message } |

## payment

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `payment:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `payment:complete` | IPC invoke | (event, ...args) | { code, data, message } |
| `payment:create-order` | IPC invoke | (event, ...args) | { code, data, message } |
| `payment:get-order` | IPC invoke | (event, ...args) | { code, data, message } |
| `payment:list-orders` | IPC invoke | (event, ...args) | { code, data, message } |
| `payment:simulate` | IPC invoke | (event, ...args) | { code, data, message } |

## pipeline

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `pipeline:advance` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:delete-run` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:fetch` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:history` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:pause` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:pause-run` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:resume` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:start` | IPC invoke | (event, ...args) | { code, data, message } |
| `pipeline:status` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:pick-batch-files` | IPC invoke | (event, ...args) | { code, data, message } |

## platform

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `platform:definitions` | IPC invoke | (event, ...args) | { code, data, message } |
| `platform:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `platform:list` | IPC invoke | (event, ...args) | { code, data, message } |

## project

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `project:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `project:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `project:list` | IPC invoke | (event, ...args) | { code, data, message } |

## prompt-eval

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `prompt-eval:analyze` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-eval:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-eval:dimensions` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-eval:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-eval:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `prompt-eval:run` | IPC invoke | (event, ...args) | { code, data, message } |

## provider-manager

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `provider:create` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:delete-user-key` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:get-user` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:list-user` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:set-user-key` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:test` | IPC invoke | (event, ...args) | { code, data, message } |
| `provider:update` | IPC invoke | (event, ...args) | { code, data, message } |

## proxy

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `proxy:add` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:add-batch` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:get-next` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:remove` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:remove-dead` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:reset` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:status` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:test` | IPC invoke | (event, ...args) | { code, data, message } |
| `proxy:test-all` | IPC invoke | (event, ...args) | { code, data, message } |

## publish

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `cover:crop` | IPC invoke | (event, ...args) | { code, data, message } |
| `cover:extract` | IPC invoke | (event, ...args) | { code, data, message } |
| `cover:read-data` | IPC invoke | (event, ...args) | { code, data, message } |
| `dashboard:stats` | IPC invoke | (event, ...args) | { code, data, message } |
| `history:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `history:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `history:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `publish:batch` | IPC invoke | (event, ...args) | { code, data, message } |
| `publish:wechat` | IPC invoke | (event, ...args) | { code, data, message } |
| `queue:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `queue:history` | IPC invoke | (event, ...args) | { code, data, message } |
| `queue:retry` | IPC invoke | (event, ...args) | { code, data, message } |
| `queue:status` | IPC invoke | (event, ...args) | { code, data, message } |

## publish-impact-tracker

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `impact:get-active` | IPC invoke | (event, ...args) | { code, data, message } |
| `impact:get-recent-snapshots` | IPC invoke | (event, ...args) | { code, data, message } |

## qrcode-login

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `auth:open-qrcode-login` | IPC invoke | (event, ...args) | { code, data, message } |
| `auth:qrcode-close` | IPC invoke | (event, ...args) | { code, data, message } |

## rate-limit

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `rate-limit:report` | IPC invoke | (event, ...args) | { code, data, message } |
| `rate-limit:self-check` | IPC invoke | (event, ...args) | { code, data, message } |

## render

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `render:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `render:get-composition` | IPC invoke | (event, ...args) | { code, data, message } |
| `render:install-deps` | IPC invoke | (event, ...args) | { code, data, message } |
| `render:list-compositions` | IPC invoke | (event, ...args) | { code, data, message } |
| `render:start` | IPC invoke | (event, ...args) | { code, data, message } |
| `render:status` | IPC invoke | (event, ...args) | { code, data, message } |
| `render:validate-props` | IPC invoke | (event, ...args) | { code, data, message } |

## replay

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `replay:get` | IPC invoke | (event, ...args) | { code, data, message } |

## scheduler

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `scheduler:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `scheduler:create` | IPC invoke | (event, ...args) | { code, data, message } |
| `scheduler:list` | IPC invoke | (event, ...args) | { code, data, message } |

## sensitive

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `sensitive:check` | IPC invoke | (event, ...args) | { code, data, message } |
| `sensitive:replace` | IPC invoke | (event, ...args) | { code, data, message } |

## store

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `store:add-account` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:add-publish-record` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:add-scheduled-task` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:delete-account` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:delete-task` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:get-account` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:get-default-account` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:get-publish-stats` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:get-setting` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:list-accounts` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:list-callback-logs` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:list-publish-history` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:list-scheduled-tasks` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:set-default-account` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:set-setting` | IPC invoke | (event, ...args) | { code, data, message } |
| `store:update-account` | IPC invoke | (event, ...args) | { code, data, message } |

## story2video

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `story2video:bgm-library-add` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:bgm-library-delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:bgm-library-list` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:bgm-library-rename` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:capabilities` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:config-profile-create` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:config-profile-delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:config-profile-list` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:config-profile-rename` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:copy-path` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:create-share-url` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:delete-project` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:export-zip` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:generate-scene-ai-video` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:generate-scene-image` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:generate-scene-video` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:get-project` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:get-thumbnail` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:import-media` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:list-projects` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:recompose-project` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:regenerate-scene-audio` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:regenerate-scene-prompt` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:regenerate-scene-subtitle` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:replace-segment-audio` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:retry-segment` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:save-as` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:select-scene-material` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:show-in-folder` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:transcribe` | IPC invoke | (event, ...args) | { code, data, message } |
| `story2video:update-segments` | IPC invoke | (event, ...args) | { code, data, message } |

## sync

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `sync:all` | IPC invoke | (event, ...args) | { code, data, message } |
| `sync:cached` | IPC invoke | (event, ...args) | { code, data, message } |
| `sync:platform` | IPC invoke | (event, ...args) | { code, data, message } |

## system-tray

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `tray:flash` | IPC invoke | (event, ...args) | { code, data, message } |
| `tray:set-tooltip` | IPC invoke | (event, ...args) | { code, data, message } |

## templates

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `template:add` | IPC invoke | (event, ...args) | { code, data, message } |
| `template:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `template:get` | IPC invoke | (event, ...args) | { code, data, message } |
| `template:get-presets` | IPC invoke | (event, ...args) | { code, data, message } |
| `template:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `template:list-by-category` | IPC invoke | (event, ...args) | { code, data, message } |
| `template:update` | IPC invoke | (event, ...args) | { code, data, message } |

## tts-voice-catalog

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `tts-voice:capability` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice:catalog` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice:clear-preference` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice:select` | IPC invoke | (event, ...args) | { code, data, message } |

## tts-voice-clone

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `tts-voice-clone:add` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice-clone:choose-samples` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice-clone:delete` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice-clone:list` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice-clone:rename` | IPC invoke | (event, ...args) | { code, data, message } |
| `tts-voice-clone:requirements` | IPC invoke | (event, ...args) | { code, data, message } |

## update

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `update:check` | IPC invoke | (event, ...args) | { code, data, message } |
| `update:download` | IPC invoke | (event, ...args) | { code, data, message } |
| `update:install` | IPC invoke | (event, ...args) | { code, data, message } |
| `update:install-now` | IPC invoke | (event, ...args) | { code, data, message } — 侧边栏「新版本」入口：未下载则先下载，下载完成后自动退出并安装；`data` 为布尔受理结果（false = 当前无可用更新） |

## upload

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `upload:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `upload:chunked` | IPC invoke | (event, ...args) | { code, data, message } |

## url-collector

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `url-collect:fetch` | IPC invoke | (event, ...args) | { code, data, message } |

## video

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `video:analyze` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:generate-subtitle` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:list-analyze-types` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:list-process-types` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:list-stock-sources` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:mix-audio` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:process` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:search-stock` | IPC invoke | (event, ...args) | { code, data, message } |
| `video:status` | IPC invoke | (event, ...args) | { code, data, message } |

## video-clone

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `video-clone:cancel` | IPC invoke | (event, ...args) | { code, data, message } |
| `video-clone:history` | IPC invoke | (event, ...args) | { code, data, message } |
| `video-clone:pick-file` | IPC invoke | (event, ...args) | { code, data, message } |
| `video-clone:run` | IPC invoke | (event, ...args) | { code, data, message } |

## viral-engine

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `viral:analyze` | IPC invoke | (event, ...args) | { code, data, message } |
| `viral:generate` | IPC invoke | (event, ...args) | { code, data, message } |
| `viral:trending` | IPC invoke | (event, ...args) | { code, data, message } |

## webview-manager

| Channel | 类型 | 参数 | 返回 |
|---------|------|------|------|
| `page-manager:close-tab` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:create-new-tab-page` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:get-active-tab` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:get-all-tabs` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:get-home-tab` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:go-back` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:go-forward` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:navigate` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:reload` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:save-cookies` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:search-or-navigate` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:set-sidebar-width` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:subscribe-events` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:switch-tab` | IPC invoke | (event, ...args) | { code, data, message } |
| `page-manager:unsubscribe-events` | IPC invoke | (event, ...args) | { code, data, message } |
| `webview:close-all` | IPC invoke | (event, ...args) | { code, data, message } |
| `webview:close-tab` | IPC invoke | (event, ...args) | { code, data, message } |
| `webview:list-tabs` | IPC invoke | (event, ...args) | { code, data, message } |
| `webview:open-tab` | IPC invoke | (event, ...args) | { code, data, message } |
| `webview:set-layout` | IPC invoke | (event, ...args) | { code, data, message } |

