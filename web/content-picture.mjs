/** Feed imagery has its own resolution budget; music thumbnails remain small. */
export const PICTURE_SIZES=[384,768,1280];
export function pictureRequest(key){
  const match=/^(image-(?:qq|bili|netease)-[a-f0-9]{40}):picture-(384|768|1280)$/.exec(key);
  return match?{id:match[1],size:Number(match[2])}:null;
}
export async function resizeContentPicture(file,limit){
  if(!PICTURE_SIZES.includes(limit) || !file.type.startsWith('image/') || file.size>8*1048576)throw new Error('Unsupported image format or size');
  const bitmap=await createImageBitmap(file);
  try {
    // The feed tiles are square. Crop before reducing so portrait images do not
    // lose their horizontal resolution and get magnified by ContentScale.Crop.
    const edge=Math.min(bitmap.width,bitmap.height),size=Math.max(1,Math.min(limit,edge));
    const canvas=new OffscreenCanvas(size,size),context=canvas.getContext('2d');
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(bitmap,(bitmap.width-edge)/2,(bitmap.height-edge)/2,edge,edge,0,0,size,size);
    return await canvas.convertToBlob({type:'image/webp',quality:.94});
  }finally{bitmap.close();}
}
