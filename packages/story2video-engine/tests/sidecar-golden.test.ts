/**
 * Python sidecar 金标对账（sidecar → TS 权威版）。
 *
 * ## 与共享向量的分工（别把这两个弄混）
 *
 * | 机制 | 回答的问题 | 谁定义"对" |
 * | --- | --- | --- |
 * | `subtitle_segmentation_vectors.json` 手工向量 | 这样切**对不对** | 人（按《字幕分割规范 v1.0》推导） |
 * | 本文件的 Python 金标 | 本地实现与线上 sidecar **是不是同一份行为** | sidecar（一致性参照，不是真值） |
 *
 * 金标是「实现输出快照」，天生有自证风险：三端一起漂移它不会红。这条风险由手工向量兜住
 * ——所以金标**不能**替代向量，只能叠加。改本文件时不要试图用金标去定义"正确切法"。
 *
 * ## 为什么参照系是 Python 而不是 TS
 *
 * 生产链路是 `StageExecutor.SPLIT → 8002 /v1/split → sidecar`；TS/JS 只在 sidecar 不可用时
 * 作为降级兜底。所以"两边是否一致"的真正风险是**降级后行为悄悄变了**，参照系自然是线上那一份。
 *
 * ## 金标怎么来
 *
 * `smart-sentence-splitter` 仓 `scripts/gen_subtitle_python_golden.py` 生成，
 * 禁止手改（文件里 `doNotHandEdit: true`）。语料只有输入，期望输出全部由生成器产出。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { splitTextToSubtitles } from '../src/text-segmentation';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const CORPUS_PATH = resolve(FIXTURES, 'subtitle_parity_corpus.json');
const GOLDEN_PATH = resolve(FIXTURES, 'subtitle_python_golden.json');
const LOCK_PATH = resolve(FIXTURES, 'sidecar-parity.lock.json');

interface CorpusCase {
  id: string;
  why?: string;
  text: string;
}

interface GoldenCase {
  id: string;
  blocks: string[];
}

interface Golden {
  schema: string;
  doNotHandEdit?: boolean;
  generatedBy?: string;
  provenance: {
    repo: string;
    commit: string;
    rulesLfSha256: string;
    vectorsLfSha256: string;
    corpusLfSha256: string;
  };
  cases: GoldenCase[];
}

interface SidecarParityLock {
  rulesLfSha256: string;
  vectorsLfSha256: string;
}

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

const corpus = loadJson<{ schema: string; cases: CorpusCase[] }>(CORPUS_PATH);
const golden = loadJson<Golden>(GOLDEN_PATH);
const lock = loadJson<SidecarParityLock>(LOCK_PATH);

describe('Python sidecar 金标对账', () => {
  it('语料与金标都声明了各自的 schema', () => {
    expect(corpus.schema).toBe('subtitle-parity-corpus/1');
    expect(golden.schema).toBe('subtitle-python-golden/1');
    expect(golden.doNotHandEdit).toBe(true);
  });

  it('语料用例集与金标用例集一一对应（防「两边各少一条」互相抵消）', () => {
    const corpusIds = corpus.cases.map((c) => c.id).sort();
    const goldenIds = golden.cases.map((c) => c.id).sort();
    expect(goldenIds).toEqual(corpusIds);
    // 双向去重锁：任一侧出现重复 id 都要红，否则 set 比较会把它吃掉。
    expect(new Set(corpusIds).size).toBe(corpusIds.length);
    expect(new Set(goldenIds).size).toBe(goldenIds.length);
  });

  it('金标记录的规则表/向量/语料哈希与当前一致（改了任一方都必须重生成金标）', () => {
    expect(
      golden.provenance.rulesLfSha256,
      [
        '金标是在另一版规则表上生成的，而当前规则表已变。',
        '正解：在 smart-sentence-splitter 仓重跑',
        '  PYTHONPATH=<repo>/src python scripts/gen_subtitle_python_golden.py',
        '（该生成器**没有命令行参数**：输入输出都在 sidecar 仓内的固定相对位置）',
        '然后把 tests/vectors/ 下的 subtitle_parity_corpus.json 与 subtitle_python_golden.json',
        '复制到本仓 packages/story2video-engine/tests/fixtures/，再跑本测试。',
        '不要手改金标里的 blocks：那是快照，手改等于把自己的输出当成 sidecar 的输出。',
      ].join('\n'),
    ).toBe(lock.rulesLfSha256);
    expect(golden.provenance.vectorsLfSha256).toBe(lock.vectorsLfSha256);
    // 语料也是一份跨仓副本：金标必须是在「当前这份语料」上生成的。
    const corpusLf = createHash('sha256')
      .update(readFileSync(CORPUS_PATH, 'utf-8').replace(/\r\n/g, '\n'), 'utf-8')
      .digest('hex');
    expect(
      golden.provenance.corpusLfSha256,
      '金标里的语料哈希与当前语料不一致：语料改过但生成器没重跑（或只同步了一边）。',
    ).toBe(corpusLf);
  });

  for (const c of corpus.cases) {
    it(`用例 ${c.id} 与 sidecar 输出逐字一致`, () => {
      const actual = splitTextToSubtitles(c.text);
      const expected = golden.cases.find((g) => g.id === c.id);
      expect(expected, `金标里缺少用例 ${c.id}（语料新增后必须重跑生成器）`).toBeDefined();
      expect(actual).toEqual(expected!.blocks);
    });
  }

  it('金标覆盖了空输入与非空输入两类（防止语料退化成全空导致判据空转）', () => {
    const nonEmpty = golden.cases.filter((c) => c.blocks.length > 0);
    const empty = golden.cases.filter((c) => c.blocks.length === 0);
    expect(nonEmpty.length).toBeGreaterThan(10);
    expect(empty.length).toBeGreaterThan(0);
  });
});
