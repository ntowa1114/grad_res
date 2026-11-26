'use strict';
// 実 Stripe 版の許可ホスト（D13 の例外。研究者の承認 2026-11-20。段階1の実測で接触したホストだけ。ワイルドカードなし）。
// 許可リスト外への通信は、ブラウザの名前解決の段階で止める（--host-resolver-rules）。Playwright の route は使わない
// （route は通信に介入するので、案A・案Bの観測に影響し得るため。NOTES_assumptions.md の Stripe 版の記録を参照）。
const STRIPE_HOSTS = [
  'js.stripe.com', 'api.stripe.com', 'r.stripe.com', 'm.stripe.com', 'm.stripe.network',
  'merchant-ui-api.stripe.com', 'b.stripecdn.com',
];
const LOCAL_HOSTS = ['localhost', '*.localhost', '127.0.0.1'];
const isLocal = (h) => h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1';
const isAllowedHost = (h) => isLocal(h) || STRIPE_HOSTS.includes(h);

// Chromium の起動引数: 許可リスト以外の名前は、解決に失敗させる（通信が出ない）
function hostResolverArg() {
  const rules = ['MAP * ~NOTFOUND', ...[...LOCAL_HOSTS, ...STRIPE_HOSTS].map((h) => `EXCLUDE ${h}`)];
  return `--host-resolver-rules=${rules.join(' , ')}`;
}

module.exports = { STRIPE_HOSTS, isAllowedHost, hostResolverArg };
