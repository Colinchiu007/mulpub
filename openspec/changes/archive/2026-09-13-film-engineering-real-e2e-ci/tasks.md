## 1. 规格与实现

- [x] 1.1 记录 OpenSpec change，明确真实 E2E 必须接入 Build & Release Windows job
- [x] 1.2 在 build.yml Windows 打包步骤后新增 `test:e2e:film-engineering` 执行步骤
- [x] 1.3 新增 E2E 报告 artifact 上传步骤（成功/失败均上传）
- [x] 1.4 按双模型审查加固：FILM_E2E_OUTPUT 按仓库根解析、job timeout-minutes=60、报告目录加入 .gitignore、生成按钮定位限定 .fe-shots

## 2. 验证

- [x] 2.1 运行 workflow-contract.test.js（14/14）与 YAML 校验，OpenSpec strict validate 通过
- [x] 2.2 Build & Release Windows job 真实执行 E2E 且上传证据；windows-latest 打包 EXE 24/24 PASS（artifact film-engineering-real-e2e）
- [x] 2.3 完成双模型审查并记录远程合并状态（PR #1130 CI 全绿）
