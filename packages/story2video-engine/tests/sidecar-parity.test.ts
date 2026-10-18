/**
 * 跨仓「单源规则表 + 共享向量」对账锁（sidecar-parity-lock/1）。
 *
 * ## 这条锁解决什么问题
 *
 * 字幕切分有 4 份实现（TS 权威版 / Electron JS 镜像 / smart-sentence-splitter 的 Python sidecar /
 * ops-center 的简化 Python），共享的只有 **两份手工维护的数据副本**：
 *   · 规则表 `subtitle-rules.json`
 *   · 切割向量 `subtitle_segmentation_vectors.json`
 *
 * 这两份数据在 mulpub 与 sidecar 各存一份，**没有任何东西会告诉你「只改了一边」**：
 * 单测各自读自己仓的副本，全绿；线上 8002 跑的是旧规则，本地降级路径跑的是新规则，
 * 而两者只在 sidecar 不可用那一刻才会同时出现在同一条链路里。
 *
 * 本文件把「两仓数据必须逐字节相同」变成机械判据：登记 LF 归一化 sha256，两仓各查自己。
 *
 * ## 口径为什么是「LF 归一化后的字节哈希」而不是 JSON 语义比较
 *
 * 语义比较会放过键序/缩进/行尾差异，而那些差异在跨语言侧（Python `json.dumps` 与
 * JS `JSON.stringify` 的浮点/转义规则不同）没有可靠的公共规范化实现——用两套规范化再比较，
 * 等于在判据里埋进一个自己就可能漂移的东西。字节级 + 只抹平 CRLF 是最小且无歧义的公共口径。
 *
 * ## 改数据时必须做什么
 *
 * 见锁文件自带的 `howToUpdate`。要点：**两个仓库同批改**，各自 CI 才会都绿；
 * 只改一边时另一边没有任何东西会红——所以这条锁靠的是「同批提交」的纪律 + 本仓这半边。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

const LOCK_PATH = resolve(FIXTURES, 'sidecar-parity.lock.json');
const RULES_PATH = resolve(import.meta.dirname, '..', 'src', 'subtitle-rules.json');
const VECTORS_PATH = resolve(FIXTURES, 'subtitle_segmentation_vectors.json');

interface SidecarParityLock {
  schema: string;
  note?: string;
  howToUpdate?: string;
  rulesLfSha256: string;
  vectorsLfSha256: string;
}

/** LF 归一化字节哈希：与 sidecar 侧 `gen_subtitle_python_golden.py::lf_sha256` 同一口径。 */
function lfSha256(absPath: string): string {
  const text = readFileSync(absPath, 'utf-8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function loadLock(): SidecarParityLock {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf-8')) as SidecarParityLock;
}

describe('跨仓数据对账锁（sidecar-parity.lock.json）', () => {
  const lock = loadLock();

  it('锁文件 schema 与必需字段齐全', () => {
    expect(lock.schema).toBe('sidecar-parity-lock/1');
    expect(lock.rulesLfSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lock.vectorsLfSha256).toMatch(/^[a-f0-9]{64}$/);
    // howToUpdate 不是装饰：改了数据却不知道下一步做什么，是这条锁最容易变成噪声的形态。
    expect(lock.howToUpdate ?? '').toContain('gen_subtitle_python_golden');
  });

  it('规则表与本仓登记值一致（改规则表必须同批更新锁与 sidecar 副本）', () => {
    expect(
      lfSha256(RULES_PATH),
      [
        '本仓 subtitle-rules.json 与 sidecar-parity.lock.json 登记值不一致。',
        '两种情况：',
        '  (a) 你改了规则表 —— 必须把同一份内容改到 smart-sentence-splitter 仓，',
        '      更新两个仓库的 sidecar-parity.lock.json，并重新生成 subtitle_python_golden.json；',
        '  (b) 你改了锁 —— 说明本仓数据没跟着改，先把数据改到与锁一致。',
        '不要「只把锁改成新值」了事：那样 sidecar 侧会在它自己的 CI 上变红。',
      ].join('\n'),
    ).toBe(lock.rulesLfSha256);
  });

  it('共享向量与本仓登记值一致（向量是双仓共用的同一份）', () => {
    expect(
      lfSha256(VECTORS_PATH),
      [
        '本仓 subtitle_segmentation_vectors.json 与锁登记值不一致。',
        '向量是 mulpub 与 smart-sentence-splitter 共用的同一份：改一边必须同步另一边，',
        '并同批更新两仓的 sidecar-parity.lock.json。',
        '期望值（expected_blocks）必须是手工真值，不得直接抄实现输出。',
      ].join('\n'),
    ).toBe(lock.vectorsLfSha256);
  });

  it('哈希口径对行尾不敏感（否则 Windows worktree 上会必假红）', () => {
    // 锁的价值依赖于「同一份内容在 LF/CRLF 两种检出下算出同一个值」。
    // 反证：把规则表内容人为换成 CRLF 再走同一口径，必须仍等于登记值。
    const lfText = readFileSync(RULES_PATH, 'utf-8').replace(/\r\n/g, '\n');
    const crlfText = lfText.replace(/\n/g, '\r\n');
    const digest = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
    const normalized = (s: string) => digest(s.replace(/\r\n/g, '\n'));

    expect(normalized(crlfText)).toBe(normalized(lfText));
    expect(normalized(lfText)).toBe(lock.rulesLfSha256);
    // 未归一化时两者必须不同——否则上一条断言是空转（CRLF 根本没参与）。
    expect(digest(crlfText)).not.toBe(digest(lfText));
  });
});
