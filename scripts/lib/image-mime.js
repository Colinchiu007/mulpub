/**
 * image-mime.js — re-export 桥（scripts/lib → shared-utils 真源）
 *
 * 真源在 `packages/shared-utils/src/image-mime.js`（桌面运行时链路要打进 asar，必须在包内）。
 * 本文件只是让 scripts 侧的结构锁与测试用同一份实现（require 路径短）。
 * 真源的语义说明与「为什么 api-publish-engine 豁免」见 shared-utils 版头注释。
 */
'use strict'
module.exports = require('../../packages/shared-utils/src/image-mime')
