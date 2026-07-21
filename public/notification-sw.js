const SAFE_ROUTES=new Set(['/dashboard','/dashboard/tasks','/dashboard/announcements','/dashboard/maintenance','/dashboard/incidents','/dashboard/evidence-review','/dashboard/settings']);
const DEDUP_DB='hospibrain-push-dedup-v1';
const DEDUP_STORE='displayed';

function claimVisibleNotification(notificationId){
  if(typeof notificationId!=='string'||!notificationId)return Promise.resolve(true);
  return new Promise((resolve)=>{
    const open=indexedDB.open(DEDUP_DB,1);
    open.onupgradeneeded=()=>open.result.createObjectStore(DEDUP_STORE,{keyPath:'id'});
    open.onerror=()=>resolve(false);
    open.onsuccess=()=>{
      const db=open.result;const transaction=db.transaction(DEDUP_STORE,'readwrite');
      const add=transaction.objectStore(DEDUP_STORE).add({id:notificationId,displayedAt:Date.now()});
      add.onsuccess=()=>resolve(true);
      add.onerror=(event)=>{if(add.error?.name==='ConstraintError')event.preventDefault();resolve(false);};
      transaction.oncomplete=()=>db.close();transaction.onerror=()=>db.close();transaction.onabort=()=>db.close();
    };
  });
}

self.addEventListener('push',(event)=>{let data={};try{data=event.data?.json()??{};}catch{}
  const route=SAFE_ROUTES.has(data.route)?data.route:'/dashboard';
  const notificationId=typeof data.notificationId==='string'?data.notificationId:null;
  const title=typeof data.title==='string'?data.title:'HospiBrain update';
  const body=typeof data.summary==='string'?data.summary:'Open HospiBrain to view this notification.';
  event.waitUntil((async()=>{
    const shouldDisplay=await claimVisibleNotification(notificationId);
    if(shouldDisplay)await self.registration.showNotification(title,{body,icon:'/window.svg',badge:'/window.svg',data:{route,notificationId},tag:notificationId?`notification:${notificationId}`:undefined,renotify:false});
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    windows.forEach(client=>client.postMessage({type:'notification-received'}));
  })());
});

self.addEventListener('notificationclick',(event)=>{event.notification.close();
  const route=SAFE_ROUTES.has(event.notification.data?.route)?event.notification.data.route:'/dashboard';
  const notificationId=event.notification.data?.notificationId;
  event.waitUntil((async()=>{
    if(typeof notificationId==='string')await fetch('/api/notifications',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',notificationId})}).catch(()=>undefined);
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if('focus'in client){await client.navigate(route);return client.focus();}}
    return clients.openWindow(route);
  })());
});
