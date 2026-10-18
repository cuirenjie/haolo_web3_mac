import {renderCloudAlertPanel} from '../main/cloud-alert-view.mjs';

type Identity={accountId:string;baseUrl:string}|null;
export function createCloudAlertPanelController(options:{owner:()=>Identity;language:()=>string;load:()=>Promise<any>;changed:()=>void}) {
  let feed:any={items:[],recentEvents:[]},identity:Identity=null;
  const same=(a:Identity,b:Identity)=>!!a&&!!b&&a.accountId===b.accountId&&a.baseUrl===b.baseUrl;
  function apply(value:any) {
    const current=options.owner();
    if(!current){feed={items:[],recentEvents:[]};identity=null;return;}
    if(!same(current,value))return;
    feed=value;identity=current;options.changed();
  }
  return {apply,reset(){feed={items:[],recentEvents:[]};identity=null;},
    render(){return renderCloudAlertPanel(same(identity,options.owner())?feed:{items:[],recentEvents:[]},options.language());},
    async refresh(){
      const captured=options.owner();if(!captured)return;
      try {
        const result=await options.load();
        if(!same(captured,options.owner()))return;
        if(!result?.ok)throw Error('CLOUD_ALERT_FEED_UNAVAILABLE');
        apply(result);
      } catch {
        if(!same(captured,options.owner()))return;
        feed={...(same(identity,captured)?feed:{items:[],recentEvents:[]}),error:{code:'CLOUD_ALERT_FEED_UNAVAILABLE'}};
        identity=captured;options.changed();
      }
    }};
}
