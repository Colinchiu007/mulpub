# 密钥轮换操作指引 (P0-1/P0-2/P0-8)

## 紧急程度

原 `.env.example` 中的 Ed25519 私钥（`MC4CAQAwBQYDK2Vw...`）已入 git 历史，
视为永久公开泄露。即使从未部署到生产，该密钥必须视为 compromised。

## 操作步骤（生产部署机）

### 1. 生成新密钥对

```bash
# Ed25519 签名密钥
python3 -c "
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
k = Ed25519PrivateKey.generate()
open('/etc/ops-center/runtime-signing-private.pem','wb').write(
    k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
open('/etc/ops-center/runtime-signing-public.pem','wb').write(
    k.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
"
chmod 600 /etc/ops-center/runtime-signing-private.pem
chown ops-center:ops-center /etc/ops-center/runtime-signing-private.pem

# Fernet 加密密钥
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# JWT 密钥
openssl rand -hex 32
```

### 2. 更新 EnvironmentFile

编辑 `/etc/ops-center/env`：
- `OPS_ENCRYPTION_KEY=<新 Fernet key>`
- `OPS_JWT_SECRET=<新 JWT secret>`
- `OPS_SECRET_KEY=<新 random hex>`

### 3. 双钥宽限期过渡（桌面端验签）

1. 运营中心同步配置中新增自定义公钥字段，填入**新公钥**
2. 桌面端代码已支持双公钥并行验证（宽限期内旧公钥仍接受）
3. 旧公钥到期日 = 轮换后 90 天（硬编码在 `license-access-control.js`）
4. 到期后旧公钥签发拒绝，未升级客户端受影响

### 4. 泄露面排查清单

- [ ] `git log -S "MC4CAQAwBQYDK2Vw" --all` 确认引入提交
- [ ] 所有部署机 `.env` / `EnvironmentFile` 无旧 PEM 残留
- [ ] systemd unit 无 `${...}` 字面量（改用 EnvironmentFile）
- [ ] CI secrets / 制品库无同密钥引用
- [ ] OPS_JWT_SECRET 已替换为独立随机值
- [ ] 新公钥验签通过，旧令牌已失效
- [ ] >= 95% 活跃客户端已升级到新公钥版本

### 5. 验证

```bash
systemctl restart ops-center
journalctl -u ops-center --since "1 min ago" | grep "P0.*passed"
# 期望: "[P0] All startup security checks passed."
```

## 残余风险声明

宽限期内旧客户端仍暴露于已泄露私钥伪造配置的残余风险。
运营方应评估受影响面并在必要时缩短宽限期。
