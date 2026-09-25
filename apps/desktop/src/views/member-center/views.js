/**
 * 会员中心七栏子视图注册表（§4 信息架构，A 布局）。
 * 单独成文件便于测试替换（vi.mock）。
 */
import Overview from './Overview.vue'
import AccountSecurity from './AccountSecurity.vue'
import Subscription from './Subscription.vue'
import OrdersBilling from './OrdersBilling.vue'
import UsageQuota from './UsageQuota.vue'
import Messages from './Messages.vue'
import HelpSupport from './HelpSupport.vue'

export const MEMBER_VIEWS = { Overview, AccountSecurity, Subscription, OrdersBilling, UsageQuota, Messages, HelpSupport }
