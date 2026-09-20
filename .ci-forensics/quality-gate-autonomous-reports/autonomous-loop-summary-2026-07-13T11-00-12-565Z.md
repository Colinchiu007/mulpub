# E2E 自动循环测试报告

**时间**: 2026-07-13T11:00:12.566Z
**耗时**: 253.8s
**轮次**: 2/3

## 结果: ❌ 21 项失败

### 像素对比
| 指标 | 值 |
|------|----|
| 通过 | 3 |
| 失败 | 18 |
| 总计 | 21 |

### 功能测试
| 指标 | 值 |
|------|----|
| 通过 | 3 |
| 失败 | 3 |
| 总计 | 6 |

## 失败详情

### 像素对比失败
- **accounts-list**: result.misMatchPercentage.toFixed is not a function
- **publish-form**: result.misMatchPercentage.toFixed is not a function
- **monitor-dashboard**: result.misMatchPercentage.toFixed is not a function
- **settings-general**: result.misMatchPercentage.toFixed is not a function
- **login-form**: result.misMatchPercentage.toFixed is not a function
- **create-editor**: result.misMatchPercentage.toFixed is not a function
- **first-run**: result.misMatchPercentage.toFixed is not a function
- **dashboard**: result.misMatchPercentage.toFixed is not a function
- **calendar**: result.misMatchPercentage.toFixed is not a function
- **cloud-publish**: result.misMatchPercentage.toFixed is not a function
- **viral-analysis**: result.misMatchPercentage.toFixed is not a function
- **create-result**: result.misMatchPercentage.toFixed is not a function
- **create-pipeline**: result.misMatchPercentage.toFixed is not a function
- **create-history**: result.misMatchPercentage.toFixed is not a function
- **intelligence**: result.misMatchPercentage.toFixed is not a function
- **keyword-monitor**: result.misMatchPercentage.toFixed is not a function
- **collection**: result.misMatchPercentage.toFixed is not a function
- **comments**: result.misMatchPercentage.toFixed is not a function

### 功能测试失败
- **model-provider-filter-chips**: 数量不足: 0/5
- **calendar-grid-cells**: 数量不足: 0/28
- **create-view-tabs**: 数量不足: 0/3

## 处理建议

1. 查看 `reports/` 目录下的详细 JSON 报告
2. 查看 `screenshots/` 目录下的当前截图
3. 像素失败 → 查看 `reports/pixel-diff/` 下的差异图
4. 功能失败 → 检查对应路由的组件交互逻辑
5. Agent 读取本摘要后，使用 `view_image` 查看截图判断
