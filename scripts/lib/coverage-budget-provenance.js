// 兼容 shim（2026-10-20，change: gate-timeout-all-cells）。
//
// 单格常量已升格为逐格注册表：数据落在 `scripts/gate-timeout-registry.json`，
// 加载/校验在 `scripts/lib/gate-timeout-registry.js`。本文件只为**旧路径的消费者**留一次性出口
// （实测消费者：`scripts/gate-budget.test.js`），全部转发、**不持有任何数值**。
//
// 下一个人请直接 require `./gate-timeout-registry.js`；本文件会在消费者改完后删除。
'use strict';

const reg = require('./gate-timeout-registry.js');

module.exports = {
  JOB_NAME: reg.JOB_NAME,
  WORKFLOW_PATH: reg.WORKFLOW_PATH,
  SAFETY_MULTIPLIER: reg.SAFETY_MULTIPLIER,
  get TIMEOUT_MINUTES() { return reg.TIMEOUT_MINUTES; },
  get PROVENANCE() { return reg.PROVENANCE; },
};
