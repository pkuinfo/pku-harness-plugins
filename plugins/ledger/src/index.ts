import { definePlugin } from '@pku-harness/sdk';

import { AddScreen } from './screens/add';
import { BudgetScreen } from './screens/budget';
import { CategoriesScreen } from './screens/categories';
import { HomeScreen } from './screens/home';
import { YearScreen } from './screens/year';
import { tools } from './tools';
import { MonthWidget, TrendWidget } from './widgets';

/**
 * 记账: a personal ledger. Record spending and income from a keypad sheet or by telling the
 * agent ("午饭 18"), set monthly budgets, and see where the money went. Everything stays in the
 * plugin's kv on this phone (no network). Campus-card spending can be imported by the agent
 * through wallet.cardTransactions + addMany (externalId dedupes re-imports).
 */
export const ledgerPlugin = definePlugin({
  id: 'ledger',
  name: '记账',
  description: '随手记录收支，说一句或点几下就记好；月度 / 年度统计、预算和图表。数据只存在手机上。',
  version: '1.0.0',
  icon: 'ledger',
  scopes: [],
  i18n: {
    en: {
      name: 'Ledger',
      description: 'Record spending and income with a sentence or a few taps; monthly and yearly totals, budgets and charts. Your data stays on the phone.',
      tools: {
        add: { title: 'Record an entry' },
        addMany: { title: 'Record several entries' },
        list: { title: 'List entries' },
        summary: { title: 'Spending summary' },
        update: { title: 'Edit an entry' },
        delete: { title: 'Delete entries' },
        budgetSet: { title: 'Set budget' },
        budgetStatus: { title: 'Budget status' },
        categories: { title: 'List categories' },
        categoryEdit: { title: 'Manage categories' },
      },
      widgets: {
        month: { title: 'Spent this month', description: 'This month’s spending; with a budget, a ring of how much is used (small) or what is left and the top category with a category donut (medium).' },
        trend: { title: 'Spending, last 30 days', description: 'Daily spending over the last 30 days as a line, with the total and the daily average.' },
      },
      screens: { home: { title: 'Ledger' }, add: { title: 'Add entry' }, year: { title: 'Year report' }, budget: { title: 'Monthly budget' }, categories: { title: 'Categories' } },
      settings: { home: { title: 'Ledger', subtitle: 'Spending, income, budgets and charts' } },
      commands: {
        jizhang: { description: 'Record spending or income', argHint: 'lunch 18', aliases: ['spend', 'ledger'], prompt: 'Record this in my ledger: {{input}}' },
        'month-spend': { description: 'How much I spent this month', aliases: ['spent'], prompt: 'How much have I spent this month? Break it down by category.' },
      },
    },
  },
  contributes: {
    screens: {
      home: { title: '记账', component: HomeScreen },
      add: { title: '记一笔', component: AddScreen, presentation: 'modal' },
      year: { title: '年度报表', component: YearScreen },
      budget: { title: '月预算', component: BudgetScreen, presentation: 'modal' },
      categories: { title: '分类管理', component: CategoriesScreen },
    },
    settings: [{ screen: 'home', title: '记账', subtitle: '收支、预算与图表', icon: 'ledger' }],
    widgets: {
      month: {
        title: '本月支出',
        description: '本月支出；设了预算时小号显示预算用量圆环，中号显示剩余预算、花得最多的分类和分类环形图。',
        sizes: ['sm', 'md'],
        defaultSize: 'sm',
        component: MonthWidget,
      },
      trend: {
        title: '近 30 天支出',
        description: '最近 30 天每天的支出曲线，附合计和日均。',
        sizes: ['md'],
        defaultSize: 'md',
        component: TrendWidget,
      },
    },
    commands: {
      jizhang: { description: '记一笔收支', aliases: ['记账', 'spend'], argHint: '午饭 18', prompt: '帮我记一笔：{{input}}' },
      'month-spend': { description: '这个月花了多少', aliases: ['本月支出'], prompt: '这个月我花了多少钱？按分类说说。' },
    },
  },
  instructions: `记账（ledger，金额单位：元，数据只在本机）：
- 用户说花了 / 收到多少钱（"午饭花了18"、"打车 32 微信"、"收到奖学金5000"、"昨天超市买了 56.8 的日用品"），直接用 ledger__add 记下，尽量不追问：日期默认今天（"昨天""上周五"自己换算成 YYYY-MM-DD），类型默认支出，分类按内容推断，账户不知道就不填（未指定），备注写简短的事由。只有金额缺失或含糊时才问。一句话里有多笔就用 ledger__addMany（source: agent）。
- 记完用一句话确认，例如「记下了：餐饮 ¥18（午饭），本月已支出 ¥1,234」。结果里有 budgetAlerts 时顺带提醒（超支，或照现在速度月底会超）。
- 支出分类：餐饮 交通 购物 日用 学习 娱乐 住房 医疗 通讯 人情 其他；收入分类：生活费 工资 奖助学金 兼职 红包 理财 其他。用户可能有自定义分类：不确定时先调 ledger__categories。分类不存在时不要乱建，就近归类；用户明确要新分类才用 ledger__categoryEdit。
- 问"这个月花了多少""今年花了多少""上个月钱都花哪了"：调 ledger__summary（period: month / last-month / year / last-year / week / today，或 from/to），用数字回答：总支出、收入、结余、前几个分类和占比，必要时和上一期比较（进行中的月份用 sameTime 那组数字比同期）。想直观展示时可以用 ui 插件画图（Chart 元素：donut 看分类、column 看每天或每月）。
- 预算：ledger__budgetSet 设置每月总预算或分类预算，ledger__budgetStatus 看进度（status: ahead 表示花得比时间快）。
- 改 / 删：先 ledger__list 找到那一笔的 id，再 ledger__update / ledger__delete，并说明改了或删了什么。
- 导入校园卡消费：调 wallet__cardTransactions（按需给 from/to），把 amount < 0 的消费逐笔转成 ledger__addMany（source: import）：amount 取绝对值，account: 校园卡，note 用商户名，when 用交易时间，externalId 用 "card:" + 交易时间 + ":" + 金额 + ":" + 商户名；食堂 / 餐厅 → 餐饮，超市 / 商店 → 购物或日用，浴室 / 洗衣 → 日用，其余 → 其他。跳过充值、转账、补助这类收入（它们只是钱在账户间移动，记了会重复）。重复导入会自动跳过已有的。
- 用户说"我要记账，我直接说给你听"时，只回一句「说吧，比如『午饭 18』」，等他说。`,
  tools,
});
