/** Browser capabilities select only representations the platform already authorised. */
export class VideoCapabilities {
  constructor(video,capabilities) {this.video=video;this.capabilities=capabilities;this.cache=new Map();}
  async rank(streams,preferred,signal) {
    const rows=await Promise.all(streams.map(async stream=>{
      signal?.throwIfAborted();const contentType=`video/mp4; codecs="${stream.codec}"`;
      if(!this.video.canPlayType(contentType))return null;
      const key=[contentType,stream.width,stream.height,stream.frameRate,stream.bandwidth].join('|');
      if(!this.cache.has(key)){
        let timer;
        const probe=this.capabilities?.decodingInfo?Promise.race([
          this.capabilities.decodingInfo({type:'file',video:{contentType,width:stream.width,height:stream.height,bitrate:stream.bandwidth,framerate:stream.frameRate}}),
          new Promise(resolve=>{timer=setTimeout(()=>resolve(null),600);}),
        ]).catch(()=>null).finally(()=>clearTimeout(timer)):Promise.resolve(null);
        this.cache.set(key,probe);while(this.cache.size>64)this.cache.delete(this.cache.keys().next().value);
      }
      const support=await this.cache.get(key);signal?.throwIfAborted();if(support?.supported===false)return null;
      return {stream,smooth:support?.smooth!==false,efficient:support?.powerEfficient===true};
    }));
    const distance=q=>q<=preferred?preferred-q:1000+q-preferred;
    return rows.filter(Boolean).sort((a,b)=>Number(b.smooth)-Number(a.smooth) || distance(a.stream.quality)-distance(b.stream.quality) || Number(b.efficient)-Number(a.efficient) || Number(b.stream.codec.startsWith('avc'))-Number(a.stream.codec.startsWith('avc')) || a.stream.bandwidth-b.stream.bandwidth).map(row=>row.stream);
  }
}

export function boundedOrigin(value,width,height) {
  const finite=n=>Number.isFinite(Number(n));if(!value || !['x','y','width','height'].every(k=>finite(value[k])))return null;
  if(width<1 || height<1 || Number(value.width)<=0 || Number(value.height)<=0)return null;
  const x=Math.max(0,Math.min(width-1,Number(value.x))),y=Math.max(0,Math.min(height-1,Number(value.y)));
  const w=Math.max(1,Math.min(width-x,Number(value.width))),h=Math.max(1,Math.min(height-y,Number(value.height)));
  return {x,y,width:w,height:h};
}
