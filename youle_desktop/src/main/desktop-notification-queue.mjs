// Keep a burst of cloud triggers visible without blocking the account stream.
// A full queue throws so the durable feed retries instead of acknowledging loss.
export function createDesktopNotificationQueue({present, scope, enabled, onError=()=>{}, limit=200,
  schedule=setTimeout, cancel=clearTimeout}) {
  const pending=[];
  let active=null,retry=null;
  const resume=()=>{
    try {drain();} catch(error) {
      onError(error);
      retry=schedule(()=>{retry=null;resume();},5000);retry?.unref?.();
    }
  };
  const drain=()=>{
    if(active)return;
    if(retry){cancel(retry);retry=null;}
    while(pending.length) {
      const item=pending.shift();
      if(item.scope!==scope()||!enabled())continue;
      active=item;
      try {
        item.close=present(item.value,()=>{
          if(active!==item)return;
          active=null;
          // Avoid re-entering Electron's closed handler while it releases a window.
          queueMicrotask(resume);
        });
      } catch(error) {active=null;pending.unshift(item);throw error;}
      return;
    }
  };
  return {
    show(value) {
      if(!enabled())return;
      const current=scope(),key=value.evidenceId||value.turnId;
      if(key&&[active,...pending].some(item=>item?.scope===current&&(item.value.evidenceId||item.value.turnId)===key)){drain();return;}
      if(pending.length>=limit)throw Error('DESKTOP_NOTIFICATION_QUEUE_FULL');
      pending.push({value,scope:current});
      drain();
    },
    clear() {
      pending.length=0;
      if(retry){cancel(retry);retry=null;}
      const previous=active;active=null;
      previous?.close?.();
    },
  };
}
