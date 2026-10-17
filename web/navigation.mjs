const pages=new Set(['home','search','library','settings','creator','comments','collection','dynamic','following','live','webdav','transfer','notes','statistics','radio','cache','accounts']);
const boundedPage=value=>Number.isSafeInteger(value)&&value>=1&&value<=500?value:1;
const text=(value,limit)=>typeof value==='string'?value.slice(0,limit):'';
const normalize=route=>({page:pages.has(route?.page)?route.page:'home',accountSource:['qq','bili','netease'].includes(route?.accountSource)?route.accountSource:'',tab:typeof route?.tab==='string'?route.tab:'overview',playlistId:typeof route?.playlistId==='string'?route.playlistId:'',libraryGroup:text(route?.libraryGroup,2000),libraryQuery:text(route?.libraryQuery,200),libraryPage:Number.isSafeInteger(route?.libraryPage)?Math.max(0,Math.min(99,route.libraryPage)):0,player:!!route?.player,queueOpen:!!route?.queueOpen,videoOpen:!!route?.videoOpen && !!route?.player,creatorId:text(route?.creatorId,40),creatorSource:['qq','bili','netease'].includes(route?.creatorSource)?route.creatorSource:'',creatorPage:Number.isSafeInteger(route?.creatorPage)&&route.creatorPage>0&&route.creatorPage<=100?route.creatorPage:1,
  commentId:text(route?.commentId,200),commentRoot:text(route?.commentRoot,512),commentOrder:route?.commentOrder==='new'?'new':'hot',commentCursor:text(route?.commentCursor,2048),
  collectionSource:['qq','bili','netease'].includes(route?.collectionSource)?route.collectionSource:'',collectionId:text(route?.collectionId,40),collectionPage:boundedPage(route?.collectionPage),
  creatorTab:route?.creatorTab==='dynamics'?'dynamics':'works',dynamicId:typeof route?.dynamicId==='string' && /^[1-9][0-9]{0,23}$/.test(route.dynamicId)?route.dynamicId:'',followingTab:['creators','live'].includes(route?.followingTab)?route.followingTab:'dynamics',liveRoomId:typeof route?.liveRoomId==='string' && /^[1-9][0-9]{0,17}$/.test(route.liveRoomId)?route.liveRoomId:'',notesQuery:text(route?.notesQuery,128),notesCategory:text(route?.notesCategory,32),notesPage:Number.isSafeInteger(route?.notesPage)?Math.max(0,Math.min(416,route.notesPage)):0,statsPeriod:['day','week','month','year','all'].includes(route?.statsPeriod)?route.statsPeriod:'month',statsOffset:Number.isSafeInteger(route?.statsOffset)?Math.max(0,Math.min(120,route.statsOffset)):0,radioScope:['domestic','world','favorites','recent','qq'].includes(route?.radioScope)?route.radioScope:'domestic',radioQuery:text(route?.radioQuery,120),cacheFilter:['download','automatic'].includes(route?.cacheFilter)?route.cacheFilter:'all',cachePage:Number.isSafeInteger(route?.cachePage)?Math.max(0,Math.min(416,route.cachePage)):0});
/** Browser history and Canvas page state share one route, including player/queue overlays. */
export class RouteHistory {
  constructor(host,initial,apply) {
    this.host=host;this.apply=apply;this.route=normalize(initial);this.depth=0;this.closing=false;this.pending=null;
    host.history.replaceState({tinglanRoute:this.route,depth:0},'',`#${this.route.page}`);
    host.addEventListener('popstate',event=>{
      this.depth=Math.max(0,Number(event.state?.depth)||0);this.route=normalize(event.state?.tinglanRoute || {page:host.location.hash.slice(1)});this.closing=false;this.apply(this.route);
      if(this.pending){const pending=this.pending;this.pending=null;this.update(...pending);}
    });
  }
  update(patch,{replace=false}={}) {
    if(this.closing){this.pending=[patch,{replace}];return;}
    const next=normalize({...this.route,...patch});if(JSON.stringify(next)===JSON.stringify(this.route))return;
    this.route=next;if(!replace)++this.depth;
    this.host.history[replace?'replaceState':'pushState']({tinglanRoute:next,depth:this.depth},'',`#${next.page}`);this.apply(next);
  }
  close(key) {
    if(this.closing || !this.route[key])return;
    if(this.depth===0){this.update({[key]:['playlistId','libraryGroup'].includes(key)?'':false},{replace:true});return;}
    this.closing=true;this.route={...this.route,[key]:['playlistId','libraryGroup'].includes(key)?'':false};this.apply(this.route);this.host.history.back();
  }
  back() {if(this.closing)return;if(this.depth===0){this.update({page:'home',player:false,queueOpen:false,videoOpen:false},{replace:true});return;}this.closing=true;this.host.history.back();}
}
