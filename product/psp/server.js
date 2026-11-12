'use strict';
// ダミーPSP psp.localhost:8081（D54）。加盟店オリジンからの正規送信にだけ CORS を許可する。
// /frame（I型用）は段階2では作らない。
const { createReceiver } = require('../common/receiver');
module.exports = createReceiver({
  name: 'psp',
  defaultPort: 8081,
  corsAllowOrigin: 'http://merchant.localhost:8080',
});
if (require.main === module) module.exports.start().then((p) => console.log('psp listening on 127.0.0.1:' + p));
