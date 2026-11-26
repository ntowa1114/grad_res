'use strict';
// 悪性送信の宛先 sinkhole.localhost:8082（D29、D54）。CORS は付けない（スキマーは no-cors で出す）。
const { createReceiver } = require('../common/receiver');
module.exports = createReceiver({ name: 'sinkhole', defaultPort: 8082 });
if (require.main === module) module.exports.start().then((p) => console.log('sinkhole listening on 127.0.0.1:' + p));
