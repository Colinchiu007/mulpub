import type { WatermarkConfig } from './types';
import { drawWatermark } from "./watermark";
export interface RenderFrame {
  image: HTMLImageElement;
  effect: string;
  duration: number;
}

export interface SubtitleSegment {
  text: string;
  startTime: number; // seconds
  endTime: number;   // seconds
  /** 每个字符的结束时间（秒，相对整体时间轴） */
  charTimings?: number[];
}

export interface SubtitleStyle {
  font: string;
  size: string;      // like '20px'
  color: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor?: string;
  padding?: number;
  borderRadius?: number;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('loadImage 需要浏览器环境 (document 不可用)'));
  }
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** 仅绘制图片（不清除画布），供 renderFrame 和 renderTransition 复用 */
function renderFrameCore(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  progress: number,
  width: number,
  height: number,
) {
  const { image, effect } = frame;
  const imgRatio = image.width / image.height;
  const canvasRatio = width / height;

  let dw = width, dh = height, dx = 0, dy = 0;
  if (imgRatio > canvasRatio) {
    dh = height;
    dw = dh * imgRatio;
    dx = (width - dw) / 2;
  } else {
    dw = width;
    dh = dw / imgRatio;
    dy = (height - dh) / 2;
  }

  let scale = 1;
  let panX = 0;
  let panY = 0;
  let rotate = 0;

  // 使用 ease-in-out 缓动消除线性运动的抖动感
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;

  switch (effect) {
    case 'zoom-in':
      scale = 1 + eased * 0.15;
      break;
    case 'zoom-out':
      scale = 1.15 - eased * 0.15;
      break;
    case 'pan-left':
      panX = -eased * dw * 0.1;
      break;
    case 'pan-right':
      panX = eased * dw * 0.1;
      break;
    case 'pan-up':
      panY = -eased * dh * 0.1;
      break;
    case 'pan-down':
      panY = eased * dh * 0.1;
      break;
    case 'zoom-pan':
      scale = 1 + eased * 0.12;
      panX = -eased * dw * 0.06;
      break;
    case 'rotate':
      scale = 1 + eased * 0.08;
      rotate = eased * 3 * (Math.PI / 180);
      break;
    case 'blur-in':
      scale = 1 + eased * 0.05;
      break;
    default:
      scale = 1;
  }

  // Apply blur-in effect by drawing progressively sharper
  if (effect === 'blur-in') {
    const blurAmount = (1 - progress) * 4;
    ctx.filter = blurAmount > 0.1 ? `blur(${blurAmount}px)` : 'none';
  }

  ctx.save();
  ctx.translate(width / 2 + panX, height / 2 + panY);
  if (rotate) ctx.rotate(rotate);
  ctx.scale(scale, scale);
  ctx.drawImage(image, -dw / 2 + dx, -dh / 2 + dy, dw, dh);
  ctx.restore();
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  progress: number,
  width: number,
  height: number,
) {
  // 确保滤镜状态干净，避免上一帧的 filter 残留
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  renderFrameCore(ctx, frame, progress, width, height);
  ctx.filter = 'none';
}

export function renderTransition(
  ctx: CanvasRenderingContext2D,
  fromFrame: RenderFrame,
  toFrame: RenderFrame,
  t: number,
  width: number,
  height: number,
  transitionType: string,
) {
  // 先统一清屏一次，避免多次调用 renderFrame 重复覆盖
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  if (transitionType === 'fade') {
    ctx.save();
    ctx.globalAlpha = 1 - t;
    renderFrameCore(ctx, fromFrame, 1, width, height);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = t;
    renderFrameCore(ctx, toFrame, 0, width, height);
    ctx.restore();
  } else if (transitionType === 'slide-left') {
    ctx.save();
    ctx.translate(t * width, 0);
    renderFrameCore(ctx, fromFrame, 1, width, height);
    ctx.restore();
    ctx.save();
    ctx.translate(-width + t * width, 0);
    renderFrameCore(ctx, toFrame, 0, width, height);
    ctx.restore();
  } else if (transitionType === 'slide-right') {
    ctx.save();
    ctx.translate(-t * width, 0);
    renderFrameCore(ctx, fromFrame, 1, width, height);
    ctx.restore();
    ctx.save();
    ctx.translate(width - t * width, 0);
    renderFrameCore(ctx, toFrame, 0, width, height);
    ctx.restore();
  } else if (transitionType === 'slide-up') {
    ctx.save();
    ctx.translate(0, t * height);
    renderFrameCore(ctx, fromFrame, 1, width, height);
    ctx.restore();
    ctx.save();
    ctx.translate(0, -height + t * height);
    renderFrameCore(ctx, toFrame, 0, width, height);
    ctx.restore();
  } else if (transitionType === 'slide-down') {
    ctx.save();
    ctx.translate(0, -t * height);
    renderFrameCore(ctx, fromFrame, 1, width, height);
    ctx.restore();
    ctx.save();
    ctx.translate(0, height - t * height);
    renderFrameCore(ctx, toFrame, 0, width, height);
    ctx.restore();
  } else {
    renderFrameCore(ctx, toFrame, 0, width, height);
  }

  ctx.filter = 'none';
}

/** 将颜色字符串解析为 RGBA 分量 */
function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  if (typeof document === 'undefined') {
    // 非浏览器环境：返回白色默认值
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  const computed = ctx.fillStyle;
  if (computed.startsWith('#')) {
    const hex = computed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  if (computed.startsWith('rgb')) {
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10),
        a: match[4] ? parseFloat(match[4]) : 1,
      };
    }
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

/** 降低颜色亮度（用于未高亮字符） */
function dimColor(color: string, dimFactor: number): string {
  const { r, g, b, a } = parseColor(color);
  return `rgba(${Math.round(r * dimFactor)}, ${Math.round(g * dimFactor)}, ${Math.round(b * dimFactor)}, ${a})`;
}

interface SubtitleLayoutLine {
  text: string;
  charIndices: number[];
  lineWidth: number;
  y: number;
  charWidths: number[];
}

interface SubtitleLayout {
  lines: SubtitleLayoutLine[];
  totalHeight: number;
  startY: number;
  bgWidth: number;
  bgX: number;
  bgY: number;
  seg: SubtitleSegment;
  fontSize: number;
  padding: number;
}

/** 预计算字幕布局，避免每帧重复 measureText */
function precomputeSubtitleLayout(
  ctx: CanvasRenderingContext2D,
  subtitles: SubtitleSegment[],
  style: SubtitleStyle,
  width: number,
  height: number,
): SubtitleLayout[] {
  const fontSize = parseInt(style.size, 10) || 20;
  const fontFamily = style.font || '"Noto Sans SC", sans-serif';
  const padding = style.padding ?? 8;
  const lineHeight = fontSize * 1.4;
  const maxTextWidth = width * 0.9;

  ctx.save();
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const layouts: SubtitleLayout[] = [];

  for (const seg of subtitles) {
    if (!seg.text.trim()) continue;

    const chars = seg.text.split('');
    const lines: string[] = [];
    const lineCharIndices: number[][] = [];
    let currentLine = '';
    let currentIndices: number[] = [];
    for (let idx = 0; idx < chars.length; idx++) {
      const ch = chars[idx];
      const test = currentLine + ch;
      if (ctx.measureText(test).width > maxTextWidth && currentLine.length > 0) {
        lines.push(currentLine);
        lineCharIndices.push(currentIndices);
        currentLine = ch;
        currentIndices = [idx];
      } else {
        currentLine = test;
        currentIndices.push(idx);
      }
    }
    if (currentLine) {
      lines.push(currentLine);
      lineCharIndices.push(currentIndices);
    }

    const totalHeight = lines.length * lineHeight + padding * 2;
    const startY = height - Math.max(40, totalHeight + 20) - 100;

    let bgWidth = 0;
    let bgX = 0;
    let bgY = startY;
    if (style.backgroundColor) {
      const bgPad = style.padding || 8;
      bgWidth = Math.min(
        width * 0.92,
        Math.max(...lines.map((l) => ctx.measureText(l).width)) + bgPad * 2,
      );
      bgX = (width - bgWidth) / 2;
    }

    const layoutLines: SubtitleLayoutLine[] = lines.map((line, lineIdx) => {
      const indices = lineCharIndices[lineIdx];
      const charWidths = indices.map((charIdx) => ctx.measureText(chars[charIdx]).width);
      return {
        text: line,
        charIndices: indices,
        lineWidth: ctx.measureText(line).width,
        y: startY + padding + (lineIdx + 1) * lineHeight - fontSize * 0.15,
        charWidths,
      };
    });

    layouts.push({
      lines: layoutLines,
      totalHeight,
      startY,
      bgWidth,
      bgX,
      bgY,
      seg,
      fontSize,
      padding,
    });
  }

  ctx.restore();
  return layouts;
}

/** Draw subtitle text on canvas at current time, using precomputed layout */
function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  layouts: SubtitleLayout[],
  style: SubtitleStyle,
  width: number,
) {
  const layout = layouts.find((l) => elapsed >= l.seg.startTime && elapsed <= l.seg.endTime);
  if (!layout) return;

  const { seg, fontSize, padding, lines, bgWidth, bgX, bgY } = layout;
  const dimmedColor = dimColor(style.color, 0.35);
  const hasTimings = seg.charTimings && seg.charTimings.length > 0;
  const chars = seg.text.split('');

  ctx.save();
  ctx.font = `bold ${fontSize}px ${style.font || '"Noto Sans SC", sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // Background
  if (style.backgroundColor) {
    ctx.fillStyle = style.backgroundColor;
    ctx.globalAlpha = 0.85;
    const r = style.borderRadius ?? 4;
    roundRect(ctx, bgX, bgY, bgWidth, layout.totalHeight, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Per-character highlight rendering
  const centerX = width / 2;
  for (const line of lines) {
    let xOffset = centerX - line.lineWidth / 2;
    for (let i = 0; i < line.charIndices.length; i++) {
      const charIdx = line.charIndices[i];
      const ch = chars[charIdx];
      const chWidth = line.charWidths[i];

      const isHighlighted = hasTimings && seg.charTimings![charIdx] !== undefined
        ? elapsed >= seg.charTimings![charIdx]
        : true;

      if (style.strokeWidth > 0) {
        ctx.lineWidth = style.strokeWidth;
        ctx.strokeStyle = style.strokeColor;
        ctx.strokeText(ch, xOffset, line.y);
      }

      ctx.fillStyle = isHighlighted ? style.color : dimmedColor;
      ctx.fillText(ch, xOffset, line.y);
      xOffset += chWidth;
    }
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export interface GalleryImageInput {
  image_url: string;
  prompt: string;
}

/** Map subtitle style keys to Canvas-usable colors */
export function mapSubtitleStyle(font?: string, size?: string, style?: string): SubtitleStyle {
  const sizeMap: Record<string, string> = {
    size1: '16px', size2: '18px', size3: '22px',
    size4: '26px', size5: '30px',
  };
  const styleMap: Record<string, Omit<SubtitleStyle, 'font' | 'size'>> = {
    style1: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 3 },
    style2: { color: '#000000', strokeColor: '#ffffff', strokeWidth: 2 },
    style3: { color: '#fde047', strokeColor: '#dc2626', strokeWidth: 3 },
    style4: { color: '#2563eb', strokeColor: '#ffffff', strokeWidth: 0, backgroundColor: 'rgba(255,255,255,0.85)', padding: 10, borderRadius: 4 },
    style5: { color: '#4ade80', strokeColor: '#000000', strokeWidth: 3 },
    style6: { color: '#ffffff', strokeColor: 'transparent', strokeWidth: 0, backgroundColor: 'rgba(37,99,235,0.85)', padding: 12, borderRadius: 4 },
    style7: { color: '#ec4899', strokeColor: 'transparent', strokeWidth: 0, backgroundColor: 'rgba(255,255,255,0.85)', padding: 10, borderRadius: 4 },
    style8: { color: '#d8b4fe', strokeColor: '#ffffff', strokeWidth: 2 },
    style9: { color: '#fb923c', strokeColor: 'transparent', strokeWidth: 0, backgroundColor: 'rgba(0,0,0,0.75)', padding: 10, borderRadius: 4 },
    style10: { color: '#67e8f9', strokeColor: 'transparent', strokeWidth: 0, backgroundColor: 'rgba(22,78,99,0.7)', padding: 10, borderRadius: 4 },
    style11: { color: '#dc2626', strokeColor: '#fecaca', strokeWidth: 1, backgroundColor: 'rgba(255,255,255,0.85)', padding: 10, borderRadius: 4 },
    style12: { color: '#d1d5db', strokeColor: '#000000', strokeWidth: 2 },
  };
  const mapped = styleMap[style || 'style1'] || styleMap.style1;
  return {
    font: font || '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    size: sizeMap[size || 'size3'] || '20px',
    ...mapped,
  };
}

function getSupportedMimeType(): string {
  const candidates = [
    // 优先尝试 mp4 格式
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.64001F,mp4a.40.2',
    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    // 回退到 webm
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'video/webm';
}

/** 根据 MIME type 获取视频文件扩展名 */
export function getVideoExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogv';
  if (mimeType.includes('mpeg')) return 'mpeg';
  return 'webm';
}

/**
 * 降级留痕出口（审计 P2·静默 catch 收口）。
 *
 * slideshow 里的 catch 全是「有意降级」而不是错误吞掉：音频取不到就退回默认 8s 时长、
 * BGM 取不到就无配乐、音轨混流失败就退回纯画面轨、录制器 stop 竞态忽略。
 * 但它们在线上没有任何痕迹，用户侧表现为「成片时长不对/没有声音」，排查时无从下手。
 * 统一收口为 onWarn(stage, msg)：宿主注入时交给宿主的 logger，未注入时落 console.warn
 * （浏览器控制台 / Node stdout 均可被捕获），绝不静默、也绝不因留痕本身再抛错。
 */
export function createDegradationSink(
  onWarn?: (stage: string, msg: string) => void,
): (stage: string, err: unknown) => void {
  return (stage, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (typeof onWarn === 'function') {
      try { onWarn(stage, msg); } catch { /* 宿主回调异常不得影响渲染主流程 */ }
      return;
    }
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[slideshow] ' + stage + ' 降级: ' + msg);
    }
  };
}

export async function createSlideshowVideo(
  images: GalleryImageInput[],
  audioUrl: string | null,
  imageEffect: string,
  transitionEffect: string,
  fps = 30,
  onProgress?: (progress: number) => void,
  options?: {
    bgmUrl?: string;
    bgmVolume?: number; // 1-10
    subtitles?: SubtitleSegment[];
    subtitleStyle?: SubtitleStyle;
    watermarkConfig?: WatermarkConfig;
    onWarn?: (stage: string, msg: string) => void; // 降级留痕回调（缺省 console.warn）
  },
): Promise<Blob> {
  if (images.length === 0) throw new Error('没有图片');
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('createSlideshowVideo 需要浏览器环境 (document/MediaRecorder 不可用)');
  }

  const warn = createDegradationSink(options?.onWarn);

  // Load all images in parallel for speed
  const preloaded = await Promise.all(
    images.map((img) => loadImage(img.image_url)),
  );
  const firstImg = preloaded[0];
  // Canvas 分辨率上限 1280，平衡画质与渲染性能
  const maxCanvasWidth = 1280;
  const width = Math.min(firstImg.width, maxCanvasWidth);
  const height = Math.round(width / (firstImg.width / firstImg.height));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const frames: RenderFrame[] = preloaded.map((loaded) => ({
    image: loaded,
    effect: imageEffect,
    duration: 0,
  }));

  let totalDuration = 8;
  let audioBuffer: AudioBuffer | null = null;
  let audioContext: AudioContext | null = null;
  let bgmBuffer: AudioBuffer | null = null;

  if (audioUrl) {
    try {
      const resp = await fetch(audioUrl);
      const arrayBuffer = await resp.arrayBuffer();
      audioContext = new AudioContext();
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      totalDuration = audioBuffer.duration;
    } catch (e) {
      // 配音取不到 → 时长回退默认 8s（成片会与文案长度不匹配，属用户可感知降级）
      warn('audio-duration', e);
    }
  }

  // Load BGM if provided
  if (options?.bgmUrl && audioContext) {
    try {
      const resp = await fetch(options.bgmUrl);
      const arrayBuffer = await resp.arrayBuffer();
      bgmBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
      // BGM 加载失败 → 无配乐继续（音量滑块对用户无效，需留痕）
      warn('bgm-load', e);
    }
  }

  const transitionDuration = transitionEffect === 'none' ? 0 : 0.8;
  const holdDuration = Math.max(1, (totalDuration - transitionDuration * (frames.length - 1)) / frames.length);

  const canvasStream = canvas.captureStream(fps);
  let combinedStream: MediaStream = canvasStream;
  let audioSource: AudioBufferSourceNode | null = null;
  let bgmSource: AudioBufferSourceNode | null = null;
  let audioTracks: MediaStreamTrack[] = [];

  // If audio exists, try to mix it into the video stream
  if (audioBuffer && audioContext) {
    try {
      const dest = audioContext.createMediaStreamDestination();

      // TTS voice
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.connect(dest);

      // BGM mixed at lower volume
      if (bgmBuffer) {
        bgmSource = audioContext.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.loop = true;
        const gain = audioContext.createGain();
        const vol = Math.max(0.01, Math.min(1, (options?.bgmVolume ?? 5) / 10));
        gain.gain.value = vol;
        bgmSource.connect(gain);
        gain.connect(dest);
      }

      audioTracks = dest.stream.getAudioTracks();
      combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioTracks,
      ]);
    } catch (e) {
      // 混流失败 → 退回纯画面轨（成片静音，是最需要被看见的降级）
      warn('audio-mix', e);
      audioTracks = [];
      combinedStream = canvasStream;
    }
  }

  const mimeType = getSupportedMimeType();
  // 平衡码率：视频 6Mbps + 音频 256kbps
  const recorderOptions: MediaRecorderOptions = {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 256_000,
  };
  const mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
  const chunks: Blob[] = [];

  // Precompute subtitle layouts for performance
  const subtitles = options?.subtitles;
  const subStyle = options?.subtitleStyle;
  const subtitleLayouts = (subtitles && subStyle)
    ? precomputeSubtitleLayout(ctx, subtitles, subStyle, width, height)
    : [];

  return new Promise((resolve, reject) => {
    let stopped = false;
    let stopping = false;
    let rafId = 0;

    // Safety timeout: 5 min buffer for background-tab throttling
    const safetyTimeout = setTimeout(() => {
      if (stopped || stopping) return;
      stopping = true;
      if (rafId) cancelAnimationFrame(rafId);
      // 安全超时兜底：录制器已处停止态时 stop() 会抛 InvalidStateError，属预期竞态
      try { mediaRecorder.stop(); } catch (e) { warn('recorder-stop', e); }
    }, Math.ceil((totalDuration + 300) * 1000));

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      if (stopped) return;
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(safetyTimeout);
      if (audioContext) audioContext.close();
      if (onProgress) onProgress(100);
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
    mediaRecorder.onerror = (e) => {
      if (stopped) return;
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(safetyTimeout);
      if (audioContext) audioContext.close();
      reject(new Error(`录制错误: ${e}`));
    };

    mediaRecorder.start();
    if (audioSource) audioSource.start();
    if (bgmSource) bgmSource.start();

    let startTime = performance.now();
    let elapsed = 0;
    let hiddenStart = 0;
    let lastProgressReport = 0;

    // Handle page visibility: compensate elapsed time after tab returns
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenStart = performance.now();
      } else if (hiddenStart > 0) {
        // Compensate for time spent in background
        const hiddenDuration = performance.now() - hiddenStart;
        startTime += hiddenDuration;
        hiddenStart = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    function renderLoop(timestamp: number) {
      if (stopped || stopping) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        return;
      }

      // Update elapsed time
      elapsed = (timestamp - startTime) / 1000;

      // Report progress at most every 500ms
      if (onProgress) {
        const progress = Math.min(95, Math.round((elapsed / totalDuration) * 95));
        if (progress !== lastProgressReport) {
          onProgress(progress);
          lastProgressReport = progress;
        }
      }

      if (elapsed >= totalDuration) {
        if (onProgress) onProgress(95);
        stopping = true;
        document.removeEventListener('visibilitychange', onVisibilityChange);
        clearTimeout(safetyTimeout);
        mediaRecorder.stop();
        return;
      }

      // Find current frame and local time
      let currentFrame = 0;
      let localTime = elapsed;
      for (let i = 0; i < frames.length; i++) {
        const segmentDuration = holdDuration + (i < frames.length - 1 ? transitionDuration : 0);
        if (localTime < segmentDuration) {
          currentFrame = i;
          break;
        }
        localTime -= segmentDuration;
      }
      if (currentFrame >= frames.length) {
        currentFrame = frames.length - 1;
        localTime = Math.min(localTime, holdDuration);
      }

      const nextFrame = Math.min(currentFrame + 1, frames.length - 1);

      // Render frame
      if (transitionEffect !== 'none' && nextFrame > currentFrame && localTime > holdDuration) {
        const t = Math.min((localTime - holdDuration) / transitionDuration, 1);
        renderTransition(ctx, frames[currentFrame], frames[nextFrame], t, width, height, transitionEffect);
      } else {
        const progress = Math.min(localTime / holdDuration, 1);
        renderFrame(ctx, frames[currentFrame], progress, width, height);
      }

      // Draw subtitle
      if (subtitles && subStyle && subtitleLayouts.length > 0) {
        drawSubtitle(ctx, elapsed, subtitleLayouts, subStyle, width);
      }

      // Draw watermark
      if (options?.watermarkConfig) {
        drawWatermark(ctx, options.watermarkConfig, width, height);
      }
      rafId = requestAnimationFrame(renderLoop);
    }

    rafId = requestAnimationFrame(renderLoop);
  });
}
