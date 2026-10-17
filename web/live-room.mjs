/** Shared room identity/link rules. Room numbers must never pass through JS floating-point coercion. */
export const validRoom=id=>typeof id==='string' && /^[1-9][0-9]{0,17}$/.test(id);
export function liveRoomFromLink(value) {
  if(typeof value!=='string')return '';const text=value.trim();if(validRoom(text))return text;
  try {const u=new URL(text);return u.protocol==='https:' && u.hostname==='live.bilibili.com' && !u.username && !u.password && !u.port && /^\/[1-9][0-9]{0,17}\/?$/.test(u.pathname)?u.pathname.split('/')[1]:'';}catch{return '';}
}
