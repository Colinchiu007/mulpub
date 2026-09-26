// W3 §5.3/§7 快手旧外包签名服务链下线 —— grep 门禁
// 口径（design §7 合规墙）：发布运行路径 src/adapters + src/publish 不得出现
// 外包签名服务调用痕迹（GetSign 端点 / signPorts 端口组 / 旧远程签名模块引用 / refpub 遗留），
// 注释行豁免（只拦截真实调用/字符串字面量）。__NS_sig3 是平台官方 query 参数名，不属禁词。
const fs = require('fs')
const path = require('path')

function walk (dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (/\.js$/.test(name)) out.push(p)
  }
  return out
}

const COMMENT = /^\s*(\/\/|\*|\/\*)/
const FORBIDDEN = [
  { re: /GetSign/, label: 'GetSign（外包签名服务端点）' },
  { re: /signPorts/, label: 'signPorts（外包签名服务端口组）' },
  { re: /getKuaishouSignature/, label: 'getKuaishouSignature（旧远程签名模块引用）' },
  { re: /refpub/, label: 'refpub（遗留外包签名通道字样）' },
]

describe('W3 §5.3 快手旧外包签名服务链下线（grep 门禁）', () => {
  const srcRoot = path.join(__dirname, '..', 'src')

  it('扫描目录存在（防止路径漂移导致门禁空跑）', () => {
    expect(fs.existsSync(path.join(srcRoot, 'adapters'))).toBe(true)
    expect(fs.existsSync(path.join(srcRoot, 'publish'))).toBe(true)
  })

  it('src/adapters + src/publish 运行时代码零命中外包签名服务调用痕迹', () => {
    const files = [].concat(
      walk(path.join(srcRoot, 'adapters')),
      walk(path.join(srcRoot, 'publish'))
    )
    expect(files.length).toBeGreaterThan(0)
    const hits = []
    files.forEach((f) => {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (COMMENT.test(line)) return
        for (const { re, label } of FORBIDDEN) {
          if (re.test(line)) hits.push(path.relative(srcRoot, f) + ':' + (i + 1) + ' → ' + label)
        }
      })
    })
    expect(hits).toEqual([])
  })

  it('新链 kuaishou-video.js 走进程内注册表求签 command（正向锚点：确已迁移到签名页通道）', () => {
    const txt = fs.readFileSync(path.join(srcRoot, 'publish', 'platforms', 'kuaishou-video.js'), 'utf8')
    expect(txt).toMatch(/kuaishou\.ns-sig3-browser/)
    expect(txt).toMatch(/__NS_sig3/)
    // 求签唯一出口是注入的 signer / 注册表；本模块不引入任何 HTTP 签名通道
    expect(txt).not.toMatch(/require\(['"]https?:\/\//)
  })
})
