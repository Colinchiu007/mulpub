/**
 * PE 导入表解析 — 判断程序依赖的技术栈
 * 不需要反汇编器，直接读 PE 结构
 */
const fs = require("node:fs");

const targets = [
  {
    label: "融媒宝 WEMedia.exe",
    path: "D:\\Program Files (x86)\\融媒宝\\WEMedia.exe",
  },
  {
    label: "参考产品4.0.exe",
    path: "D:\\Program Files\\refproduct\\参考产品4.0.exe",
  },
];

function u16(b, o) { return b.readUInt16LE(o); }
function u32(b, o) { return b.readUInt32LE(o); }

function parsePE(buf) {
  const eLfa = u32(buf, 0x3c);
  if (buf.toString("ascii", eLfa, eLfa + 4) !== "PE\0\0")
    throw new Error("not a PE");
  const machine = u16(buf, eLfa + 4);
  const numSec = u16(buf, eLfa + 6);
  const optSize = u16(buf, eLfa + 20);
  const is64 = u16(buf, eLfa + 24) === 0x20b;
  const optStart = eLfa + 24;

  // 数据目录：Import = index 1
  const ddBase = optStart + (is64 ? 112 : 96);
  const impRva = u32(buf, ddBase + 8);
  const impSize = u32(buf, ddBase + 12);

  // 段表
  const secStart = eLfa + 24 + optSize;
  const secs = [];
  for (let i = 0; i < numSec; i++) {
    const o = secStart + i * 40;
    secs.push({
      name: buf.toString("ascii", o, 8).replace(/\0/g, "").trim(),
      vsize: u32(buf, o + 8),
      vaddr: u32(buf, o + 12),
      rawsize: u32(buf, o + 16),
      rawptr: u32(buf, o + 20),
    });
  }
  const rvaToOff = (rva) => {
    for (const s of secs) {
      if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawsize))
        return s.rawptr + (rva - s.vaddr);
    }
    return null;
  };

  const dlls = [];
  if (impRva && impSize) {
    let descOff = rvaToOff(impRva);
    if (descOff !== null) {
      while (true) {
        const oft = u32(buf, descOff);
        const nameRva = u32(buf, descOff + 12);
        const ft = u32(buf, descOff + 16);
        if (nameRva === 0 && oft === 0 && ft === 0) break;
        const nameOff = rvaToOff(nameRva);
        let dllName = "";
        if (nameOff !== null) {
          let end = nameOff;
          while (buf[end] !== 0) end++;
          dllName = buf.toString("ascii", nameOff, end - nameOff);
        }
        // thunk 遍历函数名
        const funcs = [];
        const thunkRva = oft || ft;
        const tOff = rvaToOff(thunkRva);
        if (tOff !== null) {
          const step = is64 ? 8 : 4;
          for (let k = 0; k < 400; k++) {
            const to = tOff + k * step;
            const val = is64 ? buf.readBigUInt64LE(to) : BigInt(u32(buf, to));
            if (val === 0n) break;
            // 最高位为 1 => 按序数导入
            const isOrdinal = (val & 0x8000000000000000n) === 0x8000000000000000n;
            if (!isOrdinal) {
              const hOff = rvaToOff(Number(val & 0x7fffffffn));
              if (hOff !== null) {
                let e2 = hOff + 2;
                while (buf[e2] !== 0) e2++;
                funcs.push(buf.toString("ascii", hOff + 2, e2 - hOff - 2));
              }
            }
          }
        }
        dlls.push({ dll: dllName, funcs });
        descOff += 20;
        if (dlls.length > 200) break;
      }
    }
  }
  return { machine, numSec, is64, impRva, impSize, dlls, secs };
}

/** 加壳文件导入目录不可读时，从全文件扫描已知 DLL 名 */
function scanDllNames(buf) {
  const known = [
    "KERNEL32.dll", "USER32.dll", "GDI32.dll", "ADVAPI32.dll",
    "SHELL32.dll", "OLE32.dll", "OLEAUT32.dll", "WS2_32.dll",
    "WININET.dll", "WINHTTP.dll", "IPHLPAPI.dll", "CRYPT32.dll",
    "BCRYPT.dll", "WINMM.dll", "MSVFW32.dll", "AVIFIL32.dll",
    "D3D9.dll", "D3D11.dll", "DDRAW.dll", "DXGI.dll",
    "MSVCRT.dll", "MSVCP140.dll", "VCRUNTIME140.dll", "UCRTBASE.dll",
    "libvlc.dll", "libvlccore.dll", "libcef.dll", "libEGL.dll",
    "libGLESv2.dll", "libeay32.dll", "ssleay32.dll", "libcurl.dll",
    "libssh2.dll", "zlib.dll", "MediaInfo.dll", "DuiLib.dll",
    "avcodec.dll", "avformat.dll", "swscale.dll", "ffmpeg.dll",
    "chrome_elf.dll", "d3dcompiler_47.dll", "vulkan-1.dll",
    "vk_swiftshader.dll", "node.dll", "ffmpeg.dll",
  ];
  const found = new Set();
  for (const name of known) {
    // UTF-16LE 与 ASCII 两种编码都扫
    const ascii = Buffer.from(name, "ascii");
    const utf16 = Buffer.from(name, "utf16le");
    if (buf.includes(ascii) || buf.includes(utf16)) found.add(name);
  }
  return [...found].sort();
}

// 技术栈指纹：DLL/API 名 → 技术含义
const TECH = [
  [/^KERNEL32/i, "Win32 核心"],
  [/^USER32/i, "Win32 UI"],
  [/^GDI32/i, "GDI 图形"],
  [/^ADVAPI32/i, "注册表/服务/安全"],
  [/^SHELL32/i, "Shell 集成"],
  [/^OLE32|OLEAUT32/i, "COM/OLE"],
  [/^WS2_32|WININET|WINHTTP|IPHLPAPI/i, "网络"],
  [/^CRYPT32|BCRYPT/i, "加密"],
  [/^WINMM|MSVFW|AVIFIL/i, "音视频（VFW）"],
  [/^D3D|DDRAW|DXGI/i, "DirectX 图形"],
  [/^MSVCRT|MSVCP|VCRUNTIME|UCRTBASE/i, "C/C++ 运行时"],
  [/^LIBVLC|vlc/i, "VLC 播放器"],
  [/^LIBCEF|libcef/i, "CEF 浏览器"],
  [/^LIBEAY|SSLEAY|LIBCURL|LIBSSH2|ZLIB/i, "网络库（OpenSSL/curl/ssh2/zlib）"],
  [/^MEDIAINFO/i, "MediaInfo 元数据"],
  [/^DUILIB/i, "DuiLib UI 框架"],
  [/^FFMPEG|avcodec|avformat|swscale/i, "FFmpeg"],
  [/^NODE|electron/i, "Node/Electron"],
];

for (const t of targets) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`## ${t.label}`);
  console.log("=".repeat(70));
  if (!fs.existsSync(t.path)) {
    console.log("  (不存在)");
    continue;
  }
  const buf = fs.readFileSync(t.path);
  const pe = parsePE(buf);
  console.log(
    `  Machine: ${pe.machine === 0x8664 ? "x64" : pe.machine === 0x14c ? "x86 (32位)" : "0x" + pe.machine.toString(16)}` +
      ` | Sections: ${pe.numSec} | ImportDir RVA: 0x${pe.impRva.toString(16)} size=${pe.impSize}`,
  );
  console.log(`  导入 DLL 数: ${pe.dlls.length}`);
  const namedDlls = pe.dlls.filter((d) => d.dll.length > 0);
  if (namedDlls.length === 0) {
    console.log(`\n  ⚠️ 导入目录不可读（加壳/压缩）。改用全文件 DLL 名扫描：`);
    const scanned = scanDllNames(buf);
    console.log(`  命中 ${scanned.length} 个已知 DLL 名（作为字符串存在于文件内）：\n`);
    for (const d of scanned) {
      const tech = TECH.filter(([re]) => re.test(d)).map(([, n]) => n);
      console.log(
        `    ${d.padEnd(26)}${tech.length ? "   ← " + tech.join(", ") : ""}`,
      );
    }
    console.log(`\n  说明：字符串命中 ≠ 静态导入。对加壳文件，这只表示该 DLL 名出现在文件内`);
    console.log(`        （可能是运行时动态加载，也可能是被打包进压缩流的资源）。`);
  } else {
    console.log(`\n  --- 导入的 DLL ---`);
    for (const d of namedDlls) {
      const tech = TECH.filter(([re]) => re.test(d.dll)).map(([, n]) => n);
      console.log(
        `    ${d.dll.padEnd(26)} ${String(d.funcs.length).padStart(4)} funcs${tech.length ? "   ← " + tech.join(", ") : ""}`,
      );
    }
    const interesting = [
      "CreateProcess", "WinExec", "ShellExecute",
      "VirtualAlloc", "VirtualProtect", "WriteProcessMemory",
      "CreateRemoteThread", "SetWindowsHookEx", "LoadLibrary",
      "RegSetValue", "CreateService", "OpenSCManager",
      "InternetOpen", "HttpSendRequest", "URLDownloadToFile",
      "CryptEncrypt", "CryptGenKey",
      "GetAsyncKeyState", "SetClipboardData",
    ];
    const found = new Set();
    for (const d of namedDlls) for (const f of d.funcs) {
      if (interesting.some((k) => f.toLowerCase().includes(k.toLowerCase())))
        found.add(`${f}  (${d.dll})`);
    }
    if (found.size) {
      console.log(`\n  --- 敏感/关注 API ---`);
      [...found].sort().forEach((f) => console.log(`    ${f}`));
    }
  }
}
