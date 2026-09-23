import type { ImageEffect, TransitionEffect, EffectMeta } from './types';

/** 所有支持的图片动效 */
export const IMAGE_EFFECTS: EffectMeta[] = [
  {
    id: 'zoom-in',
    label: '放大',
    description: '画面从原始尺寸缓慢放大，产生推进感',
    suitable: ['风景', '建筑', '产品展示'],
    hint: '适合突出细节',
  },
  {
    id: 'zoom-out',
    label: '缩小',
    description: '画面从放大状态缓慢缩小到原始尺寸，产生拉远感',
    suitable: ['人像', '群体照'],
    hint: '适合开场',
  },
  {
    id: 'pan-left',
    label: '左移',
    description: '画面从右向左平移，产生横向移动感',
    suitable: ['全景', '长图'],
    hint: '适合宽幅画面',
  },
  {
    id: 'pan-right',
    label: '右移',
    description: '画面从左向右平移，产生横向移动感',
    suitable: ['全景', '长图'],
    hint: '适合宽幅画面',
  },
  {
    id: 'pan-up',
    label: '上移',
    description: '画面从下向上平移，产生上升感',
    suitable: ['建筑', '人像全身'],
    hint: '适合纵向构图',
  },
  {
    id: 'pan-down',
    label: '下移',
    description: '画面从上向下平移，产生下降感',
    suitable: ['建筑', '风景'],
    hint: '适合纵向构图',
  },
  {
    id: 'zoom-pan',
    label: '放大平移',
    description: '放大同时平移，产生电影级运镜效果',
    suitable: ['高端展示', '品牌宣传'],
    hint: '电影感',
  },
  {
    id: 'rotate',
    label: '旋转',
    description: '画面缓慢旋转，产生动感效果',
    suitable: ['创意短片', '娱乐内容'],
    hint: '适合动感场景',
  },
  {
    id: 'blur-in',
    label: '模糊渐入',
    description: '画面从模糊逐渐变清晰',
    suitable: ['回忆', '梦境', '开场'],
    hint: '文艺感',
  },
  {
    id: 'none',
    label: '无效果',
    description: '画面保持静止，无任何动态效果',
    suitable: ['所有场景'],
    hint: '最省资源',
  },
];

/** 所有支持的转场效果 */
export const TRANSITION_EFFECTS: EffectMeta[] = [
  {
    id: 'fade',
    label: '渐隐',
    description: '前画面淡出同时后画面淡入，平滑过渡',
    suitable: ['所有场景'],
    hint: '最通用',
  },
  {
    id: 'slide-left',
    label: '左滑',
    description: '后画面从右侧滑入，推到左侧，类似翻页',
    suitable: ['幻灯片', '产品展示'],
    hint: '适合时序叙事',
  },
  {
    id: 'slide-right',
    label: '右滑',
    description: '后画面从左侧滑入，推到右侧，反向翻页',
    suitable: ['返回', '逆向展示'],
    hint: '反向叙事',
  },
  {
    id: 'slide-up',
    label: '上滑',
    description: '后画面从下方滑入，推到上方',
    suitable: ['滚动浏览', '列表展示'],
    hint: '向上递进',
  },
  {
    id: 'slide-down',
    label: '下滑',
    description: '后画面从上方滑入，推到下方',
    suitable: ['下拉刷新', '层级深入'],
    hint: '向下递进',
  },
  {
    id: 'none',
    label: '直接切换',
    description: '无过渡动画，瞬间切换到下一画面',
    suitable: ['快节奏剪辑'],
    hint: '最省资源',
  },
];

/**
 * 动效/转场 ID 白名单（单一来源，审计 P2·枚举双份收口）。
 *
 * 由上方元数据数组派生，消费方（桌面端「恢复上次使用的选项」白名单校验）不再手抄。
 * 排序口径：'none'（无效果 / 直接切换）恒置顶，其余保持元数据登记顺序 —— 与迁移前
 * 桌面端两处硬编码列表逐项一致，保证下拉与快照恢复行为零变化。
 * 新增效果只需在 IMAGE_EFFECTS / TRANSITION_EFFECTS 登记一次；未同步到 UI 选项时
 * 由 apps/desktop 的 effects-single-source 回归用例阻断（防反向漂移）。
 */
export const IMAGE_EFFECT_IDS: readonly string[] = Object.freeze([
  'none',
  ...IMAGE_EFFECTS.filter((e) => e.id !== 'none').map((e) => e.id),
]);

export const TRANSITION_EFFECT_IDS: readonly string[] = Object.freeze([
  'none',
  ...TRANSITION_EFFECTS.filter((e) => e.id !== 'none').map((e) => e.id),
]);

/** 按 ID 获取图片动效 */
export function getImageEffectById(id: string): EffectMeta | undefined {
  return IMAGE_EFFECTS.find((e) => e.id === id);
}

/** 按 ID 获取转场效果 */
export function getTransitionEffectById(id: string): EffectMeta | undefined {
  return TRANSITION_EFFECTS.find((e) => e.id === id);
}

/** 获取图片动效标签 */
export function getImageEffectLabel(id: string): string {
  return getImageEffectById(id)?.label ?? id;
}

/** 获取转场效果标签 */
export function getTransitionEffectLabel(id: string): string {
  return getTransitionEffectById(id)?.label ?? id;
}

/** 建议搭配：给定的图片动效适合哪些转场 */
export function getRecommendedTransitions(imageEffectId: string): string[] {
  const effect = getImageEffectById(imageEffectId);
  if (!effect) return ['fade', 'none'];
  // 动态效果搭配渐隐最安全，静态效果可搭配滑入
  if (effect.id === 'none') return ['fade', 'slide-left', 'slide-right', 'slide-up', 'none'];
  return ['fade', 'none'];
}
