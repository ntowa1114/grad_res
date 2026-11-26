chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.set({ log: [{ t: Date.now(), msg: 'installed' }] }); });
